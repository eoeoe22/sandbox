import type { Grid } from './Grid';
import { EMPTY, Phase, type BorderMode } from './types';
import { getMaterial } from '../materials/registry';
import { AMBIENT_TEMP } from '../config';

/**
 * The narrow surface that material `update` functions operate through. It hides
 * grid indexing and the per-tick "moved" bookkeeping, so material rules read
 * declaratively ("fall down, else slide diagonally"). This is the seam that a
 * Web Worker / WASM port would reimplement without touching material code.
 */
export class SimContext {
  /**
   * Edge behavior for movement. `wall` (default) blocks any move out of the grid
   * — the original solid-container behavior. `void` deletes a particle that
   * moves out of bounds, so the sandbox has no walls or floor and drains itself.
   * Set from the UI via Simulation.setBorderMode; only movement (tryMove) reads
   * it — neighbor reactions still treat out-of-bounds as simply "nothing there".
   */
  borderMode: BorderMode = 'wall';

  constructor(private grid: Grid) {}

  inBounds(x: number, y: number): boolean {
    return this.grid.inBounds(x, y);
  }

  get(x: number, y: number): number {
    return this.grid.get(x, y);
  }

  set(x: number, y: number, id: number): void {
    this.grid.set(x, y, id);
    // Erasing/emptying a cell resets it to ambient so no stale heat lingers in
    // air (which conducts nothing and would otherwise be carried around by a
    // later swap). In-place transforms to a *non-empty* material deliberately
    // keep the cell's temperature — that's what lets a just-frozen Stone crust
    // stay cool and a just-boiled Steam cell stay hot.
    if (id === EMPTY) this.grid.setTemp(x, y, AMBIENT_TEMP);
  }

  /** Current temperature at a cell. Material `update` rules read this to drive
   *  temperature-based phase changes (Lava→Stone freeze, Water→Steam boil). */
  getTemp(x: number, y: number): number {
    return this.grid.getTemp(x, y);
  }

  setTemp(x: number, y: number, t: number): void {
    this.grid.setTemp(x, y, t);
  }

  /** Like set(), but also marks the cell moved. Use this for any write to a
   * neighbor (non-self) cell that isn't Empty — otherwise a not-yet-scanned
   * neighbor can be reprocessed again within the same tick (runaway spread /
   * growth / explosion chains). Writes to the material's own (x,y), and
   * writes of EMPTY to any cell, are always safe via plain set(). Bounds-
   * checked (unlike a raw grid write) since, unlike today's call sites, a
   * future caller isn't guaranteed to have checked first. */
  spawn(x: number, y: number, id: number): void {
    if (!this.inBounds(x, y)) return;
    this.grid.set(x, y, id);
    // A spawned cell is newly created material, so it starts at that material's
    // own initial temperature (hot for Fire/Steam, ambient for the rest) —
    // mirroring how the brush places fresh material.
    this.grid.setTemp(x, y, getMaterial(id).thermal?.init ?? AMBIENT_TEMP);
    this.grid.moved[this.grid.idx(x, y)] = 1;
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

  /** Swap two cells and mark both as moved this tick. Temperature travels with
   *  the material, so a moving cell carries its heat (a falling drop of cold
   *  water stays cold, molten lava that flows stays hot). */
  swap(x1: number, y1: number, x2: number, y2: number): void {
    const g = this.grid;
    const a = g.idx(x1, y1);
    const b = g.idx(x2, y2);
    const t = g.cells[a];
    g.cells[a] = g.cells[b];
    g.cells[b] = t;
    const ta = g.temp[a];
    g.temp[a] = g.temp[b];
    g.temp[b] = ta;
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
    if (!this.inBounds(tx, ty)) {
      // Void border: moving off the grid means falling out of the world. Delete
      // the source cell and count it as a move so the material "flows out". In
      // wall mode the edge is solid, so the move is simply blocked.
      if (this.borderMode === 'void') {
        this.set(x, y, EMPTY);
        return true;
      }
      return false;
    }
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
