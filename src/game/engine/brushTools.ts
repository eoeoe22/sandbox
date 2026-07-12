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
    const id = grid.get(x, y);
    // Skip empty air (zero conductivity, resets to ambient anyway) and Wall,
    // which is deliberately outside the temperature system (see wall.ts).
    if (id === EMPTY || getMaterial(id).isWall) continue;
    const t = grid.getTemp(x, y) + delta;
    grid.setTemp(x, y, t < min ? min : t > max ? max : t);
  }
}

/** Fisher–Yates shuffle of one set of flat cell indices in place, carrying each
 *  particle's (id, temperature, aux, tint, 겹침 overlay + its parked overlayAux)
 *  as it moves — the whole tuple travels together, so a wet grain stays wet, a
 *  tagged overlay fluid keeps its state, and an overlay is never stranded on a
 *  cell that can't host it. */
function shuffleIndices(grid: Grid, idxs: number[], rand: () => number): void {
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
    const x = grid.aux[a];
    grid.aux[a] = grid.aux[b];
    grid.aux[b] = x;
    const n = grid.tint[a];
    grid.tint[a] = grid.tint[b];
    grid.tint[b] = n;
    const o = grid.overlay[a];
    grid.overlay[a] = grid.overlay[b];
    grid.overlay[b] = o;
    const oa = grid.overlayAux[a];
    grid.overlayAux[a] = grid.overlayAux[b];
    grid.overlayAux[b] = oa;
  }
}

/**
 * Shuffle the non-solid cells among `cells` in place — a Fisher–Yates
 * permutation over their (id, temperature, aux, tint) tuples, so each particle
 * carries its own state as it moves. Solid cells (Phase.Solid: Wall/Stone/Glass/
 * Iron/…) are excluded and stay put; empty cells do take part, so stirring a
 * powder into a liquid genuinely disperses it before the physics step re-sorts
 * everything by density on release.
 *
 * The stir respects solid barriers: the eligible cells under the brush are
 * split into connected pockets (4-connected, with solid cells acting as walls),
 * and each pocket is shuffled only within itself. So a brush straddling a solid
 * wall that fully divides its footprint mixes the two sides independently —
 * material never teleports across a barrier into a sealed-off chamber.
 *
 * `rand` is injectable so a test can make the permutation deterministic; it
 * defaults to `Math.random` (the same RNG the rest of the sim uses).
 */
export function mixCells(grid: Grid, cells: readonly number[], rand: () => number = Math.random): void {
  const w = grid.width;
  const h = grid.height;
  // Eligible (non-solid) cells under the brush, as flat indices, for O(1)
  // connectivity lookup.
  const eligible = new Set<number>();
  for (let k = 0; k < cells.length; k += 2) {
    const id = grid.get(cells[k], cells[k + 1]);
    if (id !== EMPTY && getMaterial(id).phase === Phase.Solid) continue;
    eligible.add(grid.idx(cells[k], cells[k + 1]));
  }

  // Flood each connected pocket through eligible cells only (solids and cells
  // outside the brush footprint aren't in the set, so they block the flood) and
  // shuffle it on its own.
  const visited = new Set<number>();
  for (const start of eligible) {
    if (visited.has(start)) continue;
    const comp: number[] = [];
    const stack: number[] = [start];
    visited.add(start);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      comp.push(idx);
      const x = idx % w;
      const y = (idx - x) / w;
      // 4-neighbours, guarded against wrapping across the grid edges.
      if (y > 0) pushIfEligible(idx - w, eligible, visited, stack);
      if (y < h - 1) pushIfEligible(idx + w, eligible, visited, stack);
      if (x > 0) pushIfEligible(idx - 1, eligible, visited, stack);
      if (x < w - 1) pushIfEligible(idx + 1, eligible, visited, stack);
    }
    shuffleIndices(grid, comp, rand);
  }
}

function pushIfEligible(
  idx: number,
  eligible: Set<number>,
  visited: Set<number>,
  stack: number[],
): void {
  if (eligible.has(idx) && !visited.has(idx)) {
    visited.add(idx);
    stack.push(idx);
  }
}
