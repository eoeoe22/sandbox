import type { Grid } from './Grid';
import { SimContext } from './SimContext';
import { getMaterial, allMaterials } from '../materials/registry';
import { EMPTY, type BorderMode } from './types';
import { HEAT_DIFFUSION_RATE, DEFAULT_CONDUCTIVITY } from '../config';
import { BG_DRIFT_DECAY, BG_DRIFT_KICK, BG_DRIFT_STRIDE, TINT_NEUTRAL } from '../tint';

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
  /** Rolling cursor into the background tint field, so each tick drifts a
   *  different 1/STRIDE slice of it (see driftBackground). */
  private bgCursor = 0;

  constructor(grid: Grid) {
    this.grid = grid;
    this.ctx = new SimContext(grid);
    this.cond = new Float32Array(256).fill(DEFAULT_CONDUCTIVITY);
    for (const m of allMaterials()) {
      this.cond[m.id] = m.thermal?.conductivity ?? DEFAULT_CONDUCTIVITY;
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
    if (g.moved[i]) return;
    const id = g.cells[i];
    if (id === EMPTY) return;
    getMaterial(id).update?.(x, y, this.ctx);
  }
}
