import type { Grid } from './Grid';
import type { MatId } from './types';
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
 * Heat (mode 'absolute', rate > 0, or 'relative', rate > 0) or cool (rate < 0)
 * every non-empty cell in `cells`, clamped to [min, max]. In 'absolute' mode
 * every cell moves by the same flat `rate` degrees; in 'relative' mode each
 * cell moves by `rate` times its *own current temperature*, so a hotter cell
 * heats/cools faster in absolute terms. Empty air is skipped on purpose: it has
 * zero conductivity, so it can neither hold heat nor pass it on, and it's reset
 * to ambient whenever written — warming it would be a no-op. Temperature is
 * what the heat system and material rules already read, so this plugs straight
 * into boiling/freezing.
 */
export function heatCells(
  grid: Grid,
  cells: readonly number[],
  mode: 'absolute' | 'relative',
  rate: number,
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
    const cur = grid.getTemp(x, y);
    const t = cur + (mode === 'absolute' ? rate : cur * rate);
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
    // shuffleIndices writes cells/overlay directly (bypassing Grid.set), so wake
    // every touched cell's tile for the active-tile scan — otherwise a grain
    // stirred up into an otherwise-empty tile would be skipped and hang frozen
    // (see engine/dirtyTiles.ts; this is the one occupancy write outside the
    // Grid/SimContext seams).
    for (const idx of comp) grid.markActive(idx % w, (idx / w) | 0);
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

/** One material's share of what the inspect (돋보기) brush sees under its
 *  footprint: the material id/name/color (for a UI swatch) and how many cells
 *  it occupies. `count` is a cell count; the UI derives the percentage from
 *  `InspectStats.occupied`. */
export interface InspectEntry {
  id: MatId;
  name: string;
  /** Packed 0xAABBGGRR base color, for a UI swatch (see render/color.ts). */
  color: number;
  count: number;
  /** Mean temperature over this material's occurrences that participate in the
   *  temperature system, or null when none do. Wall / packedTemp occurrences are
   *  excluded (same rule as the overall `InspectStats.avgTemp`). Note this counts
   *  겹침 overlay occurrences too — a soaked fluid shares its host cell's temp —
   *  whereas the overall `avgTemp` only averages base occupants, so per-material
   *  temps need not reconcile to the overall mean when overlays are present. */
  avgTemp: number | null;
}

/** What the inspect (돋보기) brush reports for the cells under its footprint:
 *  how full the brush is, how many cells are wet with a 겹침 overlay fluid, the
 *  average temperature of the occupied cells, and a per-material breakdown.
 *
 *  겹침 (overlap): a powder/porous cell can host a liquid soaked into it (see
 *  Grid.overlay) — wet sand carrying water. Both the host and the overlapped
 *  fluid are tallied, so a cell of sand soaked in water contributes one to Sand
 *  and one to Water. `entries[].count` therefore counts every material
 *  *occurrence* (host or overlay), and the ratios are taken over `occupied +
 *  overlapped` (the total material occurrences) so they still sum to 100%.
 *
 *  Empty air is excluded from the breakdown and the temperature average (it has
 *  no material and resets to ambient anyway); Wall counts toward occupancy but
 *  is left out of the average since it sits outside the temperature system (see
 *  wall.ts / heatCells). */
export interface InspectStats {
  /** Total cells the brush mask covers (including empty air). */
  footprint: number;
  /** Occupied (non-Empty host) cells in the footprint. */
  occupied: number;
  /** Cells carrying a 겹침 overlay fluid (a subset of `occupied` — wet cells). */
  overlapped: number;
  /** Mean temperature over occupied, non-Wall cells, or null if there are none. */
  avgTemp: number | null;
  /** Per-material breakdown (host + overlay occurrences), most-common first
   *  (ties broken by id for stability). */
  entries: InspectEntry[];
}

/**
 * Survey the cells under the brush for the inspect (돋보기) tool: tally each
 * material (both the primary occupant and any 겹침 overlay fluid soaked into
 * it), count occupancy, and average the temperature. Pure grid logic, no DOM —
 * the input layer gathers the footprint and hands it here, exactly like the
 * heat/mix brushes, so the readout stays unit-testable without a browser.
 */
export function inspectCells(grid: Grid, cells: readonly number[]): InspectStats {
  const counts = new Map<MatId, number>();
  // Per-material temperature accumulators, filled in lockstep with `counts` for
  // occurrences that participate in the temperature system (Wall / packedTemp
  // excluded, same as the overall average). A material can appear in `counts`
  // but not here (e.g. a wall), so `avgTemp` for it resolves to null.
  const tempSums = new Map<MatId, number>();
  const tempCounts = new Map<MatId, number>();
  let occupied = 0;
  let overlapped = 0;
  let tempSum = 0;
  let tempCount = 0;
  // Add one temperature sample for material `id` at cell temp `t`.
  const addTemp = (id: MatId, t: number): void => {
    tempSums.set(id, (tempSums.get(id) ?? 0) + t);
    tempCounts.set(id, (tempCounts.get(id) ?? 0) + 1);
  };
  for (let k = 0; k < cells.length; k += 2) {
    const x = cells[k];
    const y = cells[k + 1];
    const id = grid.get(x, y);
    if (id !== EMPTY) {
      occupied++;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      // Wall is deliberately outside the temperature system, so leave it out of
      // the average (mirrors heatCells) — otherwise a wall's fixed ambient
      // reading would drag the mean toward 20°C. A `packedTemp` material (a flying
      // Ember/Debris/Blast cell) is likewise excluded: its `temp` holds packed
      // flight/life state in the tens of thousands, not a real degree reading, and
      // would otherwise wildly skew the reported mean (see Material.packedTemp).
      const mat = getMaterial(id);
      if (!mat.isWall && !mat.packedTemp) {
        const t = grid.getTemp(x, y);
        tempSum += t;
        tempCount++;
        addTemp(id, t);
      }
    }
    // 겹침: a fluid soaked into this cell counts as its own occurrence, so wet
    // sand reports both the sand and the water it carries. An overlay only ever
    // exists over a non-empty host, so this never runs on truly empty air. The
    // overlay fluid shares the host cell's temperature, so it feeds that
    // material's per-material average too (overlays are liquids, never Wall).
    const ov = grid.getOverlay(x, y);
    if (ov !== EMPTY) {
      overlapped++;
      counts.set(ov, (counts.get(ov) ?? 0) + 1);
      const ovMat = getMaterial(ov);
      if (!ovMat.isWall && !ovMat.packedTemp) addTemp(ov, grid.getTemp(x, y));
    }
  }
  const entries: InspectEntry[] = [];
  for (const [id, count] of counts) {
    const mat = getMaterial(id);
    const tc = tempCounts.get(id) ?? 0;
    const avgTemp = tc > 0 ? (tempSums.get(id) ?? 0) / tc : null;
    entries.push({ id, name: mat.name, color: mat.color, count, avgTemp });
  }
  // Most-common first; ties by id so the list order is stable frame to frame.
  entries.sort((a, b) => b.count - a.count || a.id - b.id);
  return {
    footprint: cells.length / 2,
    occupied,
    overlapped,
    avgTemp: tempCount > 0 ? tempSum / tempCount : null,
    entries,
  };
}
