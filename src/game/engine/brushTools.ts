import type { Grid } from './Grid';
import { EMPTY, Phase } from './types';
import { getMaterial } from '../materials/registry';

/**
 * Special-brush operations that act on cells already in the grid, as opposed to
 * painting fresh material. Kept in the engine layer — pure grid logic, no DOM —
 * so the input layer only has to gather the brush footprint and delegate, and so
 * they stay unit-testable without a browser (mirroring how material rules are
 * pure functions over `SimContext`).
 *
 * `cells` is a flat run of in-bounds coordinates the brush covers, packed as
 * `[x0, y0, x1, y1, ...]` (the shape mask is applied by the caller when it
 * builds the list).
 */

/**
 * Heat (delta > 0) or cool (delta < 0) every non-empty cell in `cells`, clamped
 * to [min, max]. Empty air is skipped on purpose: it has zero conductivity, so
 * it can neither hold heat nor pass it on, and it's reset to ambient whenever
 * written — warming it would be a no-op. Temperature is what the heat system and
 * material rules already read, so this plugs straight into boiling/freezing.
 */
export function heatCells(
  grid: Grid,
  cells: readonly number[],
  delta: number,
  min: number,
  max: number,
): void {
  for (let k = 0; k < cells.length; k += 2) {
    const x = cells[k];
    const y = cells[k + 1];
    if (grid.get(x, y) === EMPTY) continue;
    const t = grid.getTemp(x, y) + delta;
    grid.setTemp(x, y, t < min ? min : t > max ? max : t);
  }
}

/**
 * Shuffle the non-solid cells among `cells` in place — a Fisher–Yates
 * permutation over their (id, temperature) pairs, so each particle carries its
 * own heat as it moves. Solid cells (Phase.Solid: Wall/Stone/Vine) are excluded
 * and stay put, acting as fixed boundaries the mix stirs around; empty cells do
 * take part, so stirring a powder into a liquid genuinely disperses it before
 * the physics step re-sorts everything by density on release.
 *
 * `rand` is injectable so a test can make the permutation deterministic; it
 * defaults to `Math.random` (the same RNG the rest of the sim uses).
 */
export function mixCells(grid: Grid, cells: readonly number[], rand: () => number = Math.random): void {
  const idxs: number[] = [];
  for (let k = 0; k < cells.length; k += 2) {
    const id = grid.get(cells[k], cells[k + 1]);
    if (id !== EMPTY && getMaterial(id).phase === Phase.Solid) continue;
    idxs.push(grid.idx(cells[k], cells[k + 1]));
  }
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = idxs[i];
    const b = idxs[j];
    const c = grid.cells[a];
    grid.cells[a] = grid.cells[b];
    grid.cells[b] = c;
    const t = grid.temp[a];
    grid.temp[a] = grid.temp[b];
    grid.temp[b] = t;
  }
}
