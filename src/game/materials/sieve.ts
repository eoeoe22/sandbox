import type { SimContext } from '../engine/SimContext';
import { EMPTY, Phase } from '../engine/types';
import { getMaterial } from './registry';

// Shared "sieve" pass-through used by Mesh (체) and Turbine — a static solid that
// a fluid seeps *through* while the solid itself never moves. The fluid tunnels
// through the whole contiguous run of `porous` cells in its travel direction to
// the first EMPTY cell beyond, so a mesh wall of ANY thickness drains instead of
// acting solid (a 2-cell-thick wall would otherwise block the fluid, since the
// cell just past the first mesh cell is more mesh, not empty):
//
//   • Down (gravity): a Liquid resting on the near face falls through to the
//     empty cell below the run.
//   • Up (buoyancy): a Gas pooled under the near face rises through to the empty
//     cell above the run.
//   • Sideways (pressure/leveling): a Liquid or Gas pressed against one face
//     crosses to the empty cell past the far face — this is what lets a vertical
//     mesh wall drain a tank instead of holding it like a plain wall.
//
// Powders and solids are always blocked (they rest against it like any solid),
// and a liquid chilled below its freezing point acts solid too
// (SimContext.isFrozen). A source parcel that already moved this tick is skipped
// (SimContext.hasMoved), so one drop can't be relayed through several separate
// runs in a single tick — it advances one screen per tick like everything else.
// Only EMPTY exits receive the fluid (never a push into other fluid), so it
// never cascades. Returns the id of whatever passed this tick (so a Turbine can
// tell a puff of Steam went through and make power), or EMPTY when nothing moved.

/** Cap on how thick a porous run a single pass tunnels across in one tick — a
 *  backstop so a giant porous block can't make the walk unbounded. Walls are
 *  thin in practice; anything past this many cells is treated as solid. */
const MAX_TUNNEL = 64;

function isPorous(id: number): boolean {
  return getMaterial(id).porous === true;
}

/**
 * Try to pass a fluid through the porous cell at (x,y) travelling in direction
 * (dx,dy). The source fluid must sit directly BEHIND the cell (at x-dx,y-dy);
 * the fluid then tunnels forward through the contiguous porous run to the first
 * empty cell beyond and swaps into it. `allowed` filters which phase may pass
 * this direction. Returns the passed id, or EMPTY when nothing moved.
 */
function pass(
  x: number,
  y: number,
  sim: SimContext,
  dx: number,
  dy: number,
  allowed: (p: Phase) => boolean,
): number {
  const bx = x - dx;
  const by = y - dy;
  if (!sim.inBounds(bx, by)) return EMPTY;
  const sid = sim.get(bx, by);
  if (sid === EMPTY) return EMPTY;
  const ph = getMaterial(sid).phase;
  if (!allowed(ph)) return EMPTY;
  if (ph === Phase.Liquid && sim.isFrozen(bx, by)) return EMPTY; // frozen = acts solid
  if (sim.hasMoved(bx, by)) return EMPTY; // don't relay an already-moved parcel

  // Walk forward through the contiguous porous run to the first non-porous cell.
  let cx = x;
  let cy = y;
  for (let steps = 0; isPorous(sim.get(cx, cy)); steps++) {
    if (steps >= MAX_TUNNEL) return EMPTY;
    cx += dx;
    cy += dy;
    if (!sim.inBounds(cx, cy)) return EMPTY;
  }
  // The exit must be empty to receive the fluid (EMPTY-only — no cascade).
  if (sim.get(cx, cy) !== EMPTY) return EMPTY;
  sim.swap(bx, by, cx, cy);
  return sid;
}

const isLiquid = (p: Phase): boolean => p === Phase.Liquid;
const isGas = (p: Phase): boolean => p === Phase.Gas;
const isFluid = (p: Phase): boolean => p === Phase.Liquid || p === Phase.Gas;

export function sift(x: number, y: number, sim: SimContext): number {
  // Down: a liquid on the top face falls through to the empty cell below the run.
  let p = pass(x, y, sim, 0, 1, isLiquid);
  if (p !== EMPTY) return p;
  // Up: a gas under the bottom face rises through to the empty cell above the run.
  p = pass(x, y, sim, 0, -1, isGas);
  if (p !== EMPTY) return p;
  // Sideways: a fluid crosses to the empty far side. Randomize which side wins
  // first so a symmetric setup has no left/right bias.
  const dir = sim.chance(0.5) ? 1 : -1;
  p = pass(x, y, sim, dir, 0, isFluid);
  if (p !== EMPTY) return p;
  return pass(x, y, sim, -dir, 0, isFluid);
}
