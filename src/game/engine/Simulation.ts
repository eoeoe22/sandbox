import type { Grid } from './Grid';
import { SimContext } from './SimContext';
import { getMaterial, allMaterials } from '../materials/registry';
import { EMPTY, type BorderMode } from './types';
import { HEAT_DIFFUSION_RATE, DEFAULT_CONDUCTIVITY } from '../config';
import {
  varyMode,
  VARY_ON_MOVE,
  VARY_DRIFT,
  LIQUID_DRIFT_DECAY,
  LIQUID_DRIFT_KICK,
  TINT_NEUTRAL,
} from '../tint';

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
  /** Per-material-id tint update mode (VARY_*), flattened for the tint pass. */
  private vary: Uint8Array;

  constructor(grid: Grid) {
    this.grid = grid;
    this.ctx = new SimContext(grid);
    this.cond = new Float32Array(256).fill(DEFAULT_CONDUCTIVITY);
    this.vary = new Uint8Array(256);
    for (const m of allMaterials()) {
      this.cond[m.id] = m.thermal?.conductivity ?? DEFAULT_CONDUCTIVITY;
      this.vary[m.id] = varyMode(m);
    }
  }

  /** Choose how the sandbox edges behave (solid wall vs. open void). Forwarded
   *  to the SimContext that all material movement flows through. */
  setBorderMode(mode: BorderMode): void {
    this.ctx.borderMode = mode;
  }

  /** Toggle whether reactions emit Smoke. When off, combustion/explosion rules
   *  that would spawn Smoke produce nothing instead (see SimContext.smokeEnabled). */
  setSmokeEnabled(on: boolean): void {
    this.ctx.smokeEnabled = on;
  }

  step(): void {
    const g = this.grid;
    g.moved.fill(0);
    this.diffuseHeat();
    this.ctx.tick = this.tick;
    const leftToRight = (this.tick++ & 1) === 0;

    for (let y = g.height - 1; y >= 0; y--) {
      if (leftToRight) {
        for (let x = 0; x < g.width; x++) this.updateCell(x, y);
      } else {
        for (let x = g.width - 1; x >= 0; x--) this.updateCell(x, y);
      }
    }

    this.varyTints();
  }

  /**
   * Advance each particle's cosmetic tint (see game/tint.ts). Runs after the
   * material scan, while the `moved` flags still mark what shifted this tick:
   *   - Powder grains re-roll their tint only on the ticks they actually moved,
   *     so a settled pile holds a stable grain while a falling stream shimmers.
   *   - Liquid cells drift their tint every tick (even at rest) with a gentle
   *     pull back toward neutral, giving a still pool a living shimmer instead
   *     of a frozen speckle pattern.
   * Purely visual: nothing in the simulation reads `tint`.
   */
  private varyTints(): void {
    const g = this.grid;
    const cells = g.cells;
    const tint = g.tint;
    const moved = g.moved;
    const vary = this.vary;
    for (let i = 0; i < cells.length; i++) {
      const mode = vary[cells[i]];
      if (mode === VARY_ON_MOVE) {
        if (moved[i]) tint[i] = (Math.random() * 256) | 0;
      } else if (mode === VARY_DRIFT) {
        // Centered Ornstein–Uhlenbeck step: decay toward neutral + random kick.
        const c = (tint[i] - TINT_NEUTRAL) * LIQUID_DRIFT_DECAY + (Math.random() * 2 - 1) * LIQUID_DRIFT_KICK;
        let v = (c + TINT_NEUTRAL + 0.5) | 0;
        if (v < 0) v = 0;
        else if (v > 255) v = 255;
        tint[i] = v;
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
    if (g.moved[i]) return;
    const id = g.cells[i];
    if (id === EMPTY) return;
    getMaterial(id).update?.(x, y, this.ctx);
  }
}
