import type { Grid } from './Grid';
import { EMPTY, Phase } from './types';
import { getMaterial } from '../materials/registry';

/**
 * The narrow surface that material `update` functions operate through. It hides
 * grid indexing and the per-tick "moved" bookkeeping, so material rules read
 * declaratively ("fall down, else slide diagonally"). This is the seam that a
 * Web Worker / WASM port would reimplement without touching material code.
 */
export class SimContext {
  constructor(private grid: Grid) {}

  inBounds(x: number, y: number): boolean {
    return this.grid.inBounds(x, y);
  }

  get(x: number, y: number): number {
    return this.grid.get(x, y);
  }

  set(x: number, y: number, id: number): void {
    this.grid.set(x, y, id);
  }

  isEmpty(x: number, y: number): boolean {
    return this.grid.get(x, y) === EMPTY;
  }

  /** True with probability `p` (0-1). Routes material randomness through the
   * same seam as movement, so a future deterministic/worker RNG swap only
   * touches this file. */
  chance(p: number): boolean {
    return Math.random() < p;
  }

  /** Swap two cells and mark both as moved this tick. */
  swap(x1: number, y1: number, x2: number, y2: number): void {
    const g = this.grid;
    const a = g.idx(x1, y1);
    const b = g.idx(x2, y2);
    const t = g.cells[a];
    g.cells[a] = g.cells[b];
    g.cells[b] = t;
    g.moved[a] = 1;
    g.moved[b] = 1;
  }

  /** Fluids and gases can be displaced by denser materials; solids and powders block. */
  private isDisplaceable(id: number): boolean {
    if (id === EMPTY) return true;
    const p = getMaterial(id).phase;
    return p === Phase.Liquid || p === Phase.Gas;
  }

  /**
   * Try to move the cell at (x,y) into (tx,ty). Moves into empty space, or
   * displaces a fluid/gas cell when doing so sorts the pair by density: a
   * denser cell sinks through a lighter one below it (ty > y), and a lighter
   * cell rises through a denser one above it (ty < y) — e.g. gas bubbling up
   * through a liquid. Returns true if it moved.
   */
  tryMove(x: number, y: number, tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const targetId = this.get(tx, ty);
    if (targetId === EMPTY) {
      this.swap(x, y, tx, ty);
      return true;
    }
    if (this.isDisplaceable(targetId)) {
      const src = getMaterial(this.get(x, y));
      const tgt = getMaterial(targetId);
      const displaces = ty < y ? src.density < tgt.density : src.density > tgt.density;
      if (displaces) {
        this.swap(x, y, tx, ty);
        return true;
      }
    }
    return false;
  }

  moveDown(x: number, y: number): boolean {
    return this.tryMove(x, y, x, y + 1);
  }

  moveDiagonalDown(x: number, y: number): boolean {
    const dir = Math.random() < 0.5 ? -1 : 1;
    return this.tryMove(x, y, x + dir, y + 1) || this.tryMove(x, y, x - dir, y + 1);
  }

  moveUp(x: number, y: number): boolean {
    return this.tryMove(x, y, x, y - 1);
  }

  moveDiagonalUp(x: number, y: number): boolean {
    const dir = Math.random() < 0.5 ? -1 : 1;
    return this.tryMove(x, y, x + dir, y - 1) || this.tryMove(x, y, x - dir, y - 1);
  }

  moveSideways(x: number, y: number): boolean {
    const dir = Math.random() < 0.5 ? -1 : 1;
    return this.tryMove(x, y, x + dir, y) || this.tryMove(x, y, x - dir, y);
  }
}
