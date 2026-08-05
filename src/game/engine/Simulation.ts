import type { Grid } from './Grid';
import { SimContext } from './SimContext';
import { getMaterial, allMaterials } from '../materials/registry';
import { tryReact } from './reactions';
import { irradiate } from './radiation';
import { EMPTY, type BorderMode } from './types';
import {
  HEAT_DIFFUSION_RATE,
  HEAT_DIFFUSION_SUBSTEPS,
  SPARK_STEPS_PER_TICK,
  SPARK_STEP_BUDGET,
  DEFAULT_CONDUCTIVITY,
  effectiveConductivity,
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
import { stepSparkFrontier } from '../materials/spark';
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
  /** Conductivity per material id (0..1), flattened for the diffusion hot loop.
   *  Holds the *curved* value (config.effectiveConductivity), not the authored
   *  one — the kernels read this table verbatim and know nothing of the curve. */
  private cond: Float32Array;
  /** 1 for a material id the diffusion pass can prove inert (curved conductivity
   *  exactly 0 — Empty air and Wall). Drives the all-inert tile skip below. */
  private heatInert: Uint8Array;
  /** One byte per 16×16 tile: 1 = the tile holds at least one conducting cell and
   *  must be diffused. Rebuilt from `cells` at the top of every heat pass, so it
   *  can never go stale (see buildHeatTiles). */
  private heatTiles: Uint8Array;
  private heatTilesX = 0;
  private heatTilesY = 0;
  /** Grid dimensions `heatTiles` was sized for; a resize reallocates the mask. */
  private heatTilesW = -1;
  private heatTilesH = -1;
  /** Per-tick decay probability per material id for the generalized lifetime tag
   *  (Material.life), flattened for the update hot loop. 0 = no lifetime. */
  private lifeP: Float32Array;
  /** What a decaying life-tagged material turns into, per id (default Empty). */
  private lifeInto: Uint8Array;
  /** 1 for a `Material.magnetic` id — the only occupants an Electromagnet's grip
   *  applies to, checked before honouring a hold (see updateCell). */
  private magneticId: Uint8Array;
  /** Per-tick, per-neighbour radiation dose per material id (Material.radiation),
   *  flattened for the update hot loop. 0 = not a 방사선원 (almost everything), so
   *  a world with no radioactive matter in it pays one array read per cell. */
  private radiationP: Float32Array;
  /** Rolling cursor into the background tint field, so each tick drifts a
   *  different 1/STRIDE slice of it (see driftBackground). */
  private bgCursor = 0;

  constructor(grid: Grid) {
    this.grid = grid;
    this.ctx = new SimContext(grid);
    this.cond = new Float32Array(256).fill(effectiveConductivity(DEFAULT_CONDUCTIVITY));
    this.heatInert = new Uint8Array(256);
    this.heatTiles = new Uint8Array(0);
    this.lifeP = new Float32Array(256);
    this.lifeInto = new Uint8Array(256);
    this.magneticId = new Uint8Array(256);
    this.radiationP = new Float32Array(256);
    for (const m of allMaterials()) {
      if (m.magnetic) this.magneticId[m.id] = 1;
      if (m.radiation) this.radiationP[m.id] = m.radiation;
      // Authored 0..1 dial → the exponential speed curve the kernel consumes.
      this.cond[m.id] = effectiveConductivity(m.thermal?.conductivity ?? DEFAULT_CONDUCTIVITY);
      if (m.life) {
        // Memoryless decay: P(decay this tick) = 1/ticks gives a mean lifetime of
        // `ticks` with natural spread (the model Smoke always used).
        this.lifeP[m.id] = 1 / Math.max(1, m.life.ticks);
        this.lifeInto[m.id] = m.life.into ?? EMPTY;
      }
    }
    // Ids the diffusion pass provably cannot move heat through. Derived from the
    // final table (not from `m.thermal`) so an id with no material registered —
    // a gap in the id space — counts as conducting and is never skipped.
    for (let id = 0; id < 256; id++) this.heatInert[id] = this.cond[id] === 0 ? 1 : 0;
  }

  /**
   * The live SimContext every material rule runs through, exposed so the input
   * layer can act through the same seam: the 전기/충격파 brushes deliver a real
   * electric pulse / Woofer shockwave rather than reimplementing either against
   * the raw grid (see input/PointerPainter and engine/brushTools). Sharing the
   * one context is what keeps their per-tick bookkeeping — the Woofer body-flood
   * memo and the object-knockback event queue — consistent with the simulation's
   * own.
   */
  get context(): SimContext {
    return this.ctx;
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
    // Which 16×16 tiles hold anything that conducts. Recomputed from `cells`
    // every tick, so it is a fact about this instant rather than an invariant
    // some other writer has to remember to uphold (see buildHeatTiles).
    this.buildHeatTiles();
    // Run several conduction substeps per tick so heat spreads much faster
    // globally while each substep stays numerically stable (see config). The
    // Rust/WASM kernel runs all substeps in one call (bit-identical to the JS
    // path, proven by wasm/test/golden.mjs); if it isn't loaded/enabled we fall
    // back to the JS loop transparently.
    if (
      USE_WASM_HEAT &&
      heatWasmReady() &&
      diffuseHeatWasm(
        g.cells,
        this.cond,
        g.temp,
        g.width,
        g.height,
        HEAT_DIFFUSION_RATE,
        HEAT_DIFFUSION_SUBSTEPS,
        this.heatTiles,
        this.heatTilesX,
        this.heatTilesY,
      )
    ) {
      // WASM wrote the diffused field back into g.temp in place.
    } else {
      // Seed the back buffer so the tiles the substeps skip already hold the
      // right temperatures on *both* sides of the ping-pong. Those cells are
      // inert for the whole pass (nothing writes them), so one copy up front
      // keeps them correct through every swap — see diffuseHeat.
      g.tempScratch.set(g.temp);
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
    g.tick = this.tick;
    this.ctx.tick = this.tick;
    // Drop any wavefront left over from last tick before the scan below refills
    // it. Two things end up here and both want the same treatment — the tail of a
    // front that ran out of this tick's work budget, and sparks the 전기 브러시
    // injected *between* ticks (it acts through the same SimContext seam material
    // rules do). Either way the cells are still Sparks sitting on the grid, and
    // the scan is about to give them their hop; leaving them queued as well would
    // run each of them twice in one tick.
    this.ctx.sparkFrontierX.length = 0;
    this.ctx.sparkFrontierY.length = 0;
    this.ctx.electricStep++;
    // Clear the transient wind field from last tick before the fans repaint it in
    // the scan below (a Fan stamps the empty cells of its beam via ctx.setWind).
    // Lazy: only fill when a fan actually wrote last tick, so a world with no fans
    // never pays for it — and when the last fan stops, this one final clear wipes
    // the gust the instant it's unpowered. Read afterward by stepObjects (object
    // knockback) and by the renderer (the animated wind streaks).
    if (this.ctx.windStamped) {
      g.wind.fill(0);
      this.ctx.windStamped = false;
    }
    // Roll last tick's "was anything burning" accumulator forward, same shape as
    // the wind flag above. Read by materials/suppress.ts's fightingFire as an
    // O(1) early-out so a fire-free world never pays for its 7x7 sweep.
    this.ctx.fireActive = this.ctx.fireSeen;
    this.ctx.fireSeen = false;
    // Likewise drop last tick's live Electromagnet fields before powered magnets
    // re-stamp them in the scan below (ctx.emitMagnetField) — so the renderer's
    // field rings track exactly the current tick's powered bodies and vanish the
    // instant a magnet's countdown lapses. Already lazy: a no-magnet world holds
    // an empty list and this is a no-op.
    if (g.magnetFields.length > 0) g.magnetFields.length = 0;
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

    // 전기의 즉시성: the scan above carried every live pulse exactly one cell, the
    // way it always did. Now carry it the rest of the way — SPARK_STEPS_PER_TICK−1
    // more hops over the wavefront queue the scan just filled (see
    // materials/spark.ts stepSparkFrontier), so a pulse crosses ~10 cells a tick
    // instead of one and a wire reads as a wire rather than as a fuse.
    //
    // Deliberately a pass of its own rather than a knob inside the scan: the hops
    // have to happen in wavefront order (ring by ring), which is exactly what the
    // scan's raster order is not, and folding them in would also hand every *other*
    // material a tenfold clock it never asked for.
    //
    // Placed after the CA scan and before the object pass so a pulse that arrives
    // this tick has already powered its appliances (a Laser's fire countdown, a
    // Fan's wind field) by the time the objects read the world — the same ordering
    // a pulse that arrived during the scan itself gets.
    //
    // The budget is a spike limiter, not a reach limit: an over-budget front is
    // left sitting on the grid as Spark cells and the next tick's scan picks it
    // straight up, so it travels at the old speed rather than dying.
    if (this.ctx.sparkFrontierX.length > 0) {
      let spent = 0;
      for (let s = 1; s < SPARK_STEPS_PER_TICK && spent < SPARK_STEP_BUDGET; s++) {
        this.ctx.electricStep++;
        const did = stepSparkFrontier(this.ctx);
        if (did === 0) break; // front died out (or hit a refractory wall) — done
        spent += did;
      }
      if (prof) {
        const n = performance.now();
        profiler.add('spark', n - t);
        t = n;
      }
    }

    // Free rigid objects (the 독립 오브젝트 layer) advance in their own pass,
    // after the CA scan and fully separate from it — they carry their own
    // continuous position/velocity and only read the grid (see engine/objects.ts).
    stepObjects(g.objects, this.ctx);
    // The Woofer pulse queue is a one-tick event list, and the object pass above
    // is its only consumer — drop it here, now that it has been read. Leaving it
    // to the next flood's lazy reset (materials/woofer.ts) would mean a tick with
    // no Woofer firing at all still re-shoves every nearby body from the *last*
    // pulse, over and over until some Woofer happens to fire again. That also
    // makes the queue safe to fill from outside a step: the 충격파 브러시 appends
    // to it between ticks (see input/PointerPainter), and the very next step
    // delivers that thump to the object layer exactly once.
    this.ctx.wooferPulseX.length = 0;
    this.ctx.wooferPulseY.length = 0;
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
   * Mark every 16×16 tile that contains at least one conducting cell, into
   * `heatTiles`. Tiles left at 0 hold nothing but Empty air and Wall, and the
   * diffusion substeps skip them wholesale.
   *
   * ## Why skipping is bit-identical
   *
   * A cell whose (curved) conductivity is exactly 0 does two things in
   * `diffuseHeat`: it copies its own temperature through unchanged, and it
   * contributes nothing to any neighbor, because the exchange is gated by
   * `min(ci, cj)` and one side is 0. A tile of nothing but such cells is
   * therefore a pure no-op — the same argument dirtyTiles makes for the CA
   * scan, on the one property the heat kernel actually depends on. The
   * copy-through is handled once per tick instead of once per substep, by
   * seeding the back buffer before the loop (see `step`): those cells are
   * untouched for the whole pass, so one copy keeps both ping-pong buffers
   * correct through every swap.
   *
   * Rebuilt from `cells` each tick rather than maintained incrementally. The
   * pass is a `Uint8Array` read per cell with a per-tile early-out — cheap next
   * to the `HEAT_DIFFUSION_SUBSTEPS` float passes it gates — and buying it that
   * way means there is no "every writer must wake its tile" invariant to get
   * wrong, unlike the dirtyTiles marks.
   */
  private buildHeatTiles(): void {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    if (this.heatTilesW !== w || this.heatTilesH !== h) {
      this.heatTilesX = (w + TILE - 1) >> TILE_BITS;
      this.heatTilesY = (h + TILE - 1) >> TILE_BITS;
      this.heatTiles = new Uint8Array(this.heatTilesX * this.heatTilesY);
      this.heatTilesW = w;
      this.heatTilesH = h;
    }
    const tiles = this.heatTiles;
    const tilesX = this.heatTilesX;
    const cells = g.cells;
    const inert = this.heatInert;
    tiles.fill(0);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const trow = (y >> TILE_BITS) * tilesX;
      for (let tx = 0; tx < tilesX; tx++) {
        // Already marked by an earlier row — nothing this row can add.
        if (tiles[trow + tx] === 1) continue;
        const x0 = tx << TILE_BITS;
        const x1 = Math.min(x0 + TILE, w);
        for (let x = x0; x < x1; x++) {
          if (inert[cells[row + x]] === 0) {
            tiles[trow + tx] = 1;
            break;
          }
        }
      }
    }
  }

  /**
   * One explicit finite-difference step of direct heat conduction: every cell
   * exchanges heat with its 4 orthogonal neighbors, the exchanged fraction
   * scaled by the lower of the two cells' conductivities (so the more
   * insulating side gates the flow, and the exchange is symmetric → energy is
   * conserved). Computed into `tempScratch` from the current `temp` snapshot,
   * then the buffers are swapped. No convection or radiation is modeled — heat
   * only moves cell-to-cell here (and by material physically moving, in swap()).
   *
   * Visits only the tiles `buildHeatTiles` marked as conducting. That reorders
   * the visits but changes no result: this is a Jacobi step, reading only `cur`
   * and writing only `next`, so no cell can see another's update within a
   * substep and the traversal order is free.
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
    const tiles = this.heatTiles;
    const tilesX = this.heatTilesX;
    const tilesY = this.heatTilesY;

    for (let ty = 0; ty < tilesY; ty++) {
      const trow = ty * tilesX;
      const y0 = ty << TILE_BITS;
      const y1 = Math.min(y0 + TILE, h);
      for (let tx = 0; tx < tilesX; tx++) {
        if (tiles[trow + tx] === 0) continue; // all-inert tile: proven no-op
        const x0 = tx << TILE_BITS;
        const x1 = Math.min(x0 + TILE, w);
        for (let y = y0; y < y1; y++) {
          const row = y * w;
          for (let x = x0; x < x1; x++) {
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
    // A cell a live Electromagnet is gripping skips its own turn entirely — the
    // field's gravity override (see SimContext.isMagnetHeld). It doesn't fall,
    // crawl or react; the magnet moves it, one cell along the field, when the
    // magnet's own cell is scanned. Gated on `magnetGripping` so a world without a
    // powered magnet pays a single boolean for it. The `magneticId` test is the
    // cheap half of "is this grip actually this cell's": only magnetic matter is
    // ever gripped, so anything else skips the lookup entirely; `isMagnetHeld` then
    // checks the grip was taken out on this very material, since a cell can change
    // hands between ticks — the player erases the held filing and paints something
    // else in, or another grain arrives (see SimContext's note).
    const id = g.cells[i];
    const held =
      this.magneticId[id] === 1 && this.ctx.magnetGripping && this.ctx.isMagnetHeld(i, id);
    if (!g.moved[i] && !held) {
      if (id !== EMPTY) {
        // 방사선 (Material.radiation): a 방사능 cell doses its eight neighbours on
        // its turn, killing whatever living matter is touching it (see
        // engine/radiation.ts). Driven from here rather than from each source's
        // `update` so no radioactive material can be added without it — and run
        // before that update, since a source whose update transforms the cell
        // (uranium melting down) would otherwise skip its own last dose.
        const rp = this.radiationP[id];
        if (rp > 0) irradiate(x, y, this.ctx, rp);
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
    // The 겹침 overlap fluid sharing this cell takes its own turn, under its own
    // moved guard (the primary having moved — or not — says nothing about its
    // passenger). Re-read after the primary update: it may have carried the
    // overlay away, or newly absorbed one. Interactions with the grain holding it
    // come first (updateSoaked — 스며든 액체도 반응한다), then movement; the second
    // guard re-read matters because a reaction can consume the fluid, release it
    // into the cell, or pin it for the tick.
    if (g.overlay[i] !== 0 && !g.overlayMoved[i]) {
      this.ctx.updateSoaked(x, y);
      if (g.overlay[i] !== 0 && !g.overlayMoved[i]) this.ctx.updateOverlay(x, y);
    }
  }
}
