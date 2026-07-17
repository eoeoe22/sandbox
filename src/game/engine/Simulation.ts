import type { Grid } from './Grid';
import { SimContext } from './SimContext';
import { getMaterial, allMaterials } from '../materials/registry';
import { tryReact } from './reactions';
import { EMPTY, type BorderMode } from './types';
import {
  HEAT_DIFFUSION_RATE,
  HEAT_DIFFUSION_SUBSTEPS,
  DEFAULT_CONDUCTIVITY,
  USE_WASM_HEAT,
  RADIANT_HEAT_MIN_TEMP,
  RADIANT_HEAT_RANGE,
  RADIANT_HEAT_RATE,
  type SmokeLevel,
  type GravityDir,
} from '../config';
import { DIR8 } from './directions';
import { TILE, TILE_BITS } from './dirtyTiles';
import { BG_DRIFT_DECAY, BG_DRIFT_KICK, BG_DRIFT_STRIDE, TINT_NEUTRAL } from '../tint';
import { stepObjects } from './objects';
import { heatWasmReady, diffuseHeatWasm } from './heatWasm';
import { profiler } from './profiler';

/**
 * Cellular-automata update loop. Scans bottom-to-top so falling material settles
 * one cell per tick, and alternates the horizontal scan direction each tick to
 * avoid a left/right drift bias. The per-cell `moved` guard keeps a cell from
 * being processed twice within a single step.
 *
 * Each tick also runs a heat-conduction pass before the material scan, so
 * temperature-driven reactions in material `update` rules react to freshly
 * diffused temperatures.
 */
export class Simulation {
  readonly grid: Grid;
  private ctx: SimContext;
  private tick = 0;
  /** Conductivity per material id (0..1), flattened for the diffusion hot loop. */
  private cond: Float32Array;
  /** Per-tick decay probability per material id for the generalized lifetime tag
   *  (Material.life), flattened for the update hot loop. 0 = no lifetime. */
  private lifeP: Float32Array;
  /** What a decaying life-tagged material turns into, per id (default Empty). */
  private lifeInto: Uint8Array;
  /** Rolling cursor into the background tint field, so each tick drifts a
   *  different 1/STRIDE slice of it (see driftBackground). */
  private bgCursor = 0;

  constructor(grid: Grid) {
    this.grid = grid;
    this.ctx = new SimContext(grid);
    this.cond = new Float32Array(256).fill(DEFAULT_CONDUCTIVITY);
    this.lifeP = new Float32Array(256);
    this.lifeInto = new Uint8Array(256);
    for (const m of allMaterials()) {
      this.cond[m.id] = m.thermal?.conductivity ?? DEFAULT_CONDUCTIVITY;
      if (m.life) {
        // Memoryless decay: P(decay this tick) = 1/ticks gives a mean lifetime of
        // `ticks` with natural spread (the model Smoke always used).
        this.lifeP[m.id] = 1 / Math.max(1, m.life.ticks);
        this.lifeInto[m.id] = m.life.into ?? EMPTY;
      }
    }
  }

  /** Choose how the sandbox edges behave (solid wall vs. open void). Forwarded
   *  to the SimContext that all material movement flows through. */
  setBorderMode(mode: BorderMode): void {
    this.ctx.borderMode = mode;
  }

  /** Set how much Smoke reactions emit (high/medium/off). Forwarded to the
   *  SimContext seam that thins reaction Smoke (see SimContext.smokeLevel). */
  setSmokeLevel(level: SmokeLevel): void {
    this.ctx.smokeLevel = level;
  }

  /** Point gravity in `dir` at `strength` (0..1). Forwarded to the SimContext
   *  the movement primitives read; the per-tick scan orients itself to match
   *  (see step). */
  setGravity(dir: GravityDir, strength: number): void {
    this.ctx.setGravity(dir, strength);
  }

  step(): void {
    const g = this.grid;
    g.moved.fill(0);
    g.overlayMoved.fill(0);
    // When the Phase 0 profiler is on, time each pass; `t` tracks the last mark.
    // The whole block compiles to a boolean check per pass when it's off (the
    // production default), so instrumentation is free unless you ask for it.
    const prof = profiler.enabled;
    let t = prof ? performance.now() : 0;
    // Run several conduction substeps per tick so heat spreads ~3× faster
    // globally while each substep stays numerically stable (see config). The
    // Rust/WASM kernel runs all substeps in one call (bit-identical to the JS
    // path, proven by wasm/test/golden.mjs); if it isn't loaded/enabled we fall
    // back to the JS loop transparently.
    if (
      USE_WASM_HEAT &&
      heatWasmReady() &&
      diffuseHeatWasm(g.cells, this.cond, g.temp, g.width, g.height, HEAT_DIFFUSION_RATE, HEAT_DIFFUSION_SUBSTEPS)
    ) {
      // WASM wrote the diffused field back into g.temp in place.
    } else {
      for (let s = 0; s < HEAT_DIFFUSION_SUBSTEPS; s++) this.diffuseHeat();
    }
    // Once per tick (not per substep): the short-range radiative nudge that
    // bridges a small air gap, on top of the direct-conduction substeps above.
    this.radiateHeat();
    if (prof) {
      const n = performance.now();
      profiler.add('heat', n - t);
      t = n;
    }
    this.ctx.tick = this.tick;
    // Alternate the cross-gravity scan direction each tick to avoid a drift bias.
    const flip = (this.tick++ & 1) === 0;

    // Scan cells in the gravity direction first (the cell a grain falls *into*
    // is processed before the grain), so a column settles a cell per tick
    // instead of draining slowly. For default down-gravity this is the classic
    // bottom-to-top, left/right-alternating scan. The `moved` guard makes any
    // order correct (no teleporting); orienting it just keeps the settle crisp.
    // The active-tile scan skips tiles holding only inert (empty, un-overlapped)
    // cells — bit-identical to the full scan, just faster on scenes with empty
    // space (see engine/dirtyTiles.ts). beginTick rolls this tick's scan set
    // from the marks accumulated last tick; if disabled we walk every cell.
    if (g.dirty.enabled) {
      g.dirty.beginTick();
      this.scanTiles(flip);
    } else {
      this.scanFull(flip);
    }

    if (prof) {
      const n = performance.now();
      profiler.add('ca', n - t);
      t = n;
    }

    // Free rigid objects (the 독립 오브젝트 layer) advance in their own pass,
    // after the CA scan and fully separate from it — they carry their own
    // continuous position/velocity and only read the grid (see engine/objects.ts).
    stepObjects(g.objects, this.ctx);
    if (prof) {
      const n = performance.now();
      profiler.add('objects', n - t);
      t = n;
    }

    this.driftBackground();
    if (prof) {
      profiler.add('drift', performance.now() - t);
      profiler.tick();
    }
  }

  /**
   * Slowly drift the positional background tint field (Grid.bgTint) that liquids
   * are rendered through (see game/tint.ts). Powder grains have a fixed
   * per-particle tint set at creation, so nothing updates them here — this pass
   * touches only the location-bound background, independent of what occupies each
   * cell. Each tick nudges a rolling 1/STRIDE slice of the field with a centered
   * Ornstein–Uhlenbeck step (decay toward neutral + a random kick), so the whole
   * field breathes gently and cheaply. Purely visual: the simulation never reads
   * bgTint.
   */
  private driftBackground(): void {
    const bg = this.grid.bgTint;
    const size = bg.length;
    const stride = BG_DRIFT_STRIDE;
    for (let i = this.bgCursor; i < size; i += stride) {
      const c = (bg[i] - TINT_NEUTRAL) * BG_DRIFT_DECAY + (Math.random() * 2 - 1) * BG_DRIFT_KICK;
      let v = (c + TINT_NEUTRAL + 0.5) | 0;
      if (v < 0) v = 0;
      else if (v > 255) v = 255;
      bg[i] = v;
    }
    this.bgCursor = (this.bgCursor + 1) % stride;
  }

  /**
   * One explicit finite-difference step of direct heat conduction: every cell
   * exchanges heat with its 4 orthogonal neighbors, the exchanged fraction
   * scaled by the lower of the two cells' conductivities (so the more
   * insulating side gates the flow, and the exchange is symmetric → energy is
   * conserved). Computed into `tempScratch` from the current `temp` snapshot,
   * then the buffers are swapped. No convection or radiation is modeled — heat
   * only moves cell-to-cell here (and by material physically moving, in swap()).
   */
  private diffuseHeat(): void {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    const cur = g.temp;
    const next = g.tempScratch;
    const cond = this.cond;
    const rate = HEAT_DIFFUSION_RATE;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const ci = cond[cells[i]];
        const ti = cur[i];
        if (ci === 0) {
          // Perfect insulator (air/Empty): never exchanges, stays put. Its
          // neighbors see min(cj, 0) = 0 too, so the whole edge is inert.
          next[i] = ti;
          continue;
        }
        let acc = ti;
        if (x > 0) {
          const cj = cond[cells[i - 1]];
          acc += rate * (ci < cj ? ci : cj) * (cur[i - 1] - ti);
        }
        if (x < w - 1) {
          const cj = cond[cells[i + 1]];
          acc += rate * (ci < cj ? ci : cj) * (cur[i + 1] - ti);
        }
        if (y > 0) {
          const cj = cond[cells[i - w]];
          acc += rate * (ci < cj ? ci : cj) * (cur[i - w] - ti);
        }
        if (y < h - 1) {
          const cj = cond[cells[i + w]];
          acc += rate * (ci < cj ? ci : cj) * (cur[i + w] - ti);
        }
        next[i] = acc;
      }
    }

    g.temp = next;
    g.tempScratch = cur;
  }

  /**
   * Near-field radiative heat transfer (근거리 간접 복사 열전도) — see the
   * config.ts doc comment for the motivating bug (isolated solidified metal
   * floating just above a molten pool, never touching it, staying cold
   * forever). A ray stops at (and only exchanges heat with) the first
   * non-Empty cell it hits — usually a solid, but a gas (Smoke/Steam/Fire)
   * blocks and receives it too, same as it would block line of sight. Mutates
   * `temp` directly in place rather than double-buffering: this is a small
   * secondary effect layered on top of the conduction substeps above, not the
   * primary diffusion model, so a little order dependence within one tick is
   * an acceptable trade for the simplicity (the same trade every material's
   * own `update` already makes when it calls `SimContext.setTemp`).
   */
  private radiateHeat(): void {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    const temp = g.temp;
    const cond = this.cond;
    const range = RADIANT_HEAT_RANGE;
    const minTemp = RADIANT_HEAT_MIN_TEMP;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const ci = cond[cells[i]];
        // Empty (cond 0) never radiates, and neither does anything colder
        // than the glow threshold — cheap rejects that skip almost every
        // cell in a typical scene before the ray-cast below ever runs.
        if (ci === 0) continue;
        const ti = temp[i];
        if (ti < minTemp) continue;

        for (const [dx, dy] of DIR8) {
          // diffuseHeat only exchanges with the 4 *orthogonal* neighbors — a
          // diagonal neighbor (dx and dy both non-zero) never gets a direct
          // conduction exchange at all, even at distance 1. So the "already
          // handled by diffuseHeat, skip it here" exemption below applies
          // only to orthogonal rays; a diagonal ray still radiates at
          // distance 1, or a corner-touching solid would get heat from
          // neither pass — the exact bug this feature exists to fix.
          const orthogonal = dx === 0 || dy === 0;
          let nx = x;
          let ny = y;
          for (let dist = 1; dist <= range; dist++) {
            nx += dx;
            ny += dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) break; // ran off the grid
            const j = ny * w + nx;
            if (cells[j] === EMPTY) continue; // keep looking further along the ray
            // Hit a non-Empty cell — the ray stops here either way (radiation
            // doesn't pass through matter), but only exchanges heat with it
            // when that isn't already diffuseHeat's job (see `orthogonal` above).
            if (dist >= 2 || !orthogonal) {
              const cj = cond[cells[j]];
              if (cj > 0) {
                // True squared distance, not squared step count: a diagonal
                // step covers √2 cells, so its inverse-square falloff divisor
                // is 2×dist² (dx²+dy²=2), not dist² (which would double-count
                // diagonal reach as if it were orthogonal).
                const dist2 = dist * dist * (dx * dx + dy * dy);
                const flux = (RADIANT_HEAT_RATE * (ci < cj ? ci : cj) * (ti - temp[j])) / dist2;
                temp[i] -= flux;
                temp[j] += flux;
              }
            }
            break;
          }
        }
      }
    }
  }

  /**
   * The full CA scan: visit every cell in gravity order. `flip` alternates the
   * cross-gravity direction each tick to avoid a drift bias. This is the
   * fallback path (USE_ACTIVE_TILES off) and the reference the active-tile scan
   * is proven bit-identical against.
   */
  private scanFull(flip: boolean): void {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    if (this.ctx.gravityX === 0) {
      // Vertical gravity: outer over rows from the gravity end, inner over cols.
      const down = this.ctx.gravityY >= 0;
      for (let k = 0; k < h; k++) {
        const y = down ? h - 1 - k : k;
        if (flip) {
          for (let x = 0; x < w; x++) this.updateCell(x, y);
        } else {
          for (let x = w - 1; x >= 0; x--) this.updateCell(x, y);
        }
      }
    } else {
      // Horizontal gravity: outer over cols from the gravity end, inner over rows.
      const right = this.ctx.gravityX >= 0;
      for (let k = 0; k < w; k++) {
        const x = right ? w - 1 - k : k;
        if (flip) {
          for (let y = 0; y < h; y++) this.updateCell(x, y);
        } else {
          for (let y = h - 1; y >= 0; y--) this.updateCell(x, y);
        }
      }
    }
  }

  /**
   * The active-tile scan: identical cell visit order to scanFull, but tiles
   * holding only inert cells (empty + no overlay) are skipped — they can't do
   * anything, so the result is bit-identical (see engine/dirtyTiles.ts). Each
   * scanned tile is re-armed for next tick if it still holds an active cell, so
   * a settled pile keeps being scanned while empty space falls away.
   */
  private scanTiles(flip: boolean): void {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const dirty = g.dirty;
    const tilesX = dirty.tilesX;
    const cells = g.cells;
    const overlay = g.overlay;
    if (this.ctx.gravityX === 0) {
      const down = this.ctx.gravityY >= 0;
      for (let k = 0; k < h; k++) {
        const y = down ? h - 1 - k : k;
        const trow = (y >> TILE_BITS) * tilesX;
        const rowBase = y * w;
        if (flip) {
          for (let tc = 0; tc < tilesX; tc++) {
            const ti = trow + tc;
            if (!dirty.shouldScan(ti)) continue;
            const x0 = tc << TILE_BITS;
            const x1 = x0 + TILE < w ? x0 + TILE : w;
            let active = false;
            for (let x = x0; x < x1; x++) {
              this.updateCell(x, y);
              // Re-arm this tile if it still holds an active cell. Short-circuit
              // once found: on a dense tile that's one check, not one per cell.
              if (!active) {
                const i = rowBase + x;
                if (cells[i] !== EMPTY || overlay[i] !== 0) active = true;
              }
            }
            if (active) dirty.arm(ti);
          }
        } else {
          for (let tc = tilesX - 1; tc >= 0; tc--) {
            const ti = trow + tc;
            if (!dirty.shouldScan(ti)) continue;
            const x0 = tc << TILE_BITS;
            const x1 = x0 + TILE < w ? x0 + TILE : w;
            let active = false;
            for (let x = x1 - 1; x >= x0; x--) {
              this.updateCell(x, y);
              if (!active) {
                const i = rowBase + x;
                if (cells[i] !== EMPTY || overlay[i] !== 0) active = true;
              }
            }
            if (active) dirty.arm(ti);
          }
        }
      }
    } else {
      const right = this.ctx.gravityX >= 0;
      const tilesY = dirty.tilesY;
      for (let k = 0; k < w; k++) {
        const x = right ? w - 1 - k : k;
        const tcol = x >> TILE_BITS;
        if (flip) {
          for (let tr = 0; tr < tilesY; tr++) {
            const ti = tr * tilesX + tcol;
            if (!dirty.shouldScan(ti)) continue;
            const y0 = tr << TILE_BITS;
            const y1 = y0 + TILE < h ? y0 + TILE : h;
            let active = false;
            for (let y = y0; y < y1; y++) {
              this.updateCell(x, y);
              if (!active) {
                const i = y * w + x;
                if (cells[i] !== EMPTY || overlay[i] !== 0) active = true;
              }
            }
            if (active) dirty.arm(ti);
          }
        } else {
          for (let tr = tilesY - 1; tr >= 0; tr--) {
            const ti = tr * tilesX + tcol;
            if (!dirty.shouldScan(ti)) continue;
            const y0 = tr << TILE_BITS;
            const y1 = y0 + TILE < h ? y0 + TILE : h;
            let active = false;
            for (let y = y1 - 1; y >= y0; y--) {
              this.updateCell(x, y);
              if (!active) {
                const i = y * w + x;
                if (cells[i] !== EMPTY || overlay[i] !== 0) active = true;
              }
            }
            if (active) dirty.arm(ti);
          }
        }
      }
    }
  }

  private updateCell(x: number, y: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    if (!g.moved[i]) {
      const id = g.cells[i];
      if (id !== EMPTY) {
        // Generalized lifetime (Material.life): a memoryless per-tick decay into
        // its successor material. A cell that decays this tick is done — it skips
        // both the reaction pass and its own update.
        const lp = this.lifeP[id];
        if (lp > 0 && this.ctx.chance(lp)) {
          const into = this.lifeInto[id];
          this.ctx.set(x, y, into);
          if (into !== EMPTY) this.ctx.markMoved(x, y);
        } else if (!tryReact(x, y, this.ctx)) {
          // Declarative contact reactions run before the material's own update; a
          // cell that reacted was transformed + marked moved, so skip its update.
          getMaterial(id).update?.(x, y, this.ctx);
        }
      }
    }
    // The 겹침 overlap fluid sharing this cell moves on its own schedule, under
    // its own moved guard (the primary having moved — or not — says nothing
    // about its passenger). Re-read after the primary update: it may have
    // carried the overlay away, or newly absorbed one.
    if (g.overlay[i] !== 0 && !g.overlayMoved[i]) this.ctx.updateOverlay(x, y);
  }
}
