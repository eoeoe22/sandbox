import type { Grid } from './Grid';
import { SimContext } from './SimContext';
import { getMaterial, allMaterials } from '../materials/registry';
import { tryReact } from './reactions';
import { EMPTY, type BorderMode } from './types';
import {
  HEAT_DIFFUSION_RATE,
  HEAT_DIFFUSION_SUBSTEPS,
  DEFAULT_CONDUCTIVITY,
  type SmokeLevel,
  type GravityDir,
} from '../config';
import { BG_DRIFT_DECAY, BG_DRIFT_KICK, BG_DRIFT_STRIDE, TINT_NEUTRAL } from '../tint';
import { ObjectLayer } from '../objects/ObjectLayer';

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
  /** 독립 오브젝트 레이어 — 셀 그리드 밖에 사는 원/캡슐 개체들. 매 스텝의 CA
   *  스캔이 끝난 뒤 적분된다 (step 참조); Game이 렌더러/입력에 이 참조를 물려
   *  배치·그리기를 잇는다. */
  readonly objects: ObjectLayer;
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
    this.objects = new ObjectLayer(grid);
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
    // Run several conduction substeps per tick so heat spreads ~3× faster
    // globally while each substep stays numerically stable (see config).
    for (let s = 0; s < HEAT_DIFFUSION_SUBSTEPS; s++) this.diffuseHeat();
    this.ctx.tick = this.tick;
    // Alternate the cross-gravity scan direction each tick to avoid a drift bias.
    const flip = (this.tick++ & 1) === 0;

    // Scan cells in the gravity direction first (the cell a grain falls *into*
    // is processed before the grain), so a column settles a cell per tick
    // instead of draining slowly. For default down-gravity this is the classic
    // bottom-to-top, left/right-alternating scan. The `moved` guard makes any
    // order correct (no teleporting); orienting it just keeps the settle crisp.
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

    // 오브젝트 레이어는 CA 스캔이 끝난, 이 틱의 정착된 그리드를 상대로
    // 적분한다. 여기서 그리드에 쓴 것(터미널 이벤트/변위)은 moved 마킹되어
    // 다음 틱의 CA가 물질 update와 같은 계약으로 처리한다.
    this.objects.step(this.ctx);

    this.driftBackground();
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
