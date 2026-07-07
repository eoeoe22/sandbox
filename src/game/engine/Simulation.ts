import type { Grid } from './Grid';
import { SimContext } from './SimContext';
import { getMaterial } from '../materials/registry';
import { EMPTY } from './types';

/**
 * Cellular-automata update loop. Scans bottom-to-top so falling material settles
 * one cell per tick, and alternates the horizontal scan direction each tick to
 * avoid a left/right drift bias. The per-cell `moved` guard keeps a cell from
 * being processed twice within a single step.
 */
export class Simulation {
  readonly grid: Grid;
  private ctx: SimContext;
  private tick = 0;

  constructor(grid: Grid) {
    this.grid = grid;
    this.ctx = new SimContext(grid);
  }

  step(): void {
    const g = this.grid;
    g.moved.fill(0);
    const leftToRight = (this.tick++ & 1) === 0;

    for (let y = g.height - 1; y >= 0; y--) {
      if (leftToRight) {
        for (let x = 0; x < g.width; x++) this.updateCell(x, y);
      } else {
        for (let x = g.width - 1; x >= 0; x--) this.updateCell(x, y);
      }
    }
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
