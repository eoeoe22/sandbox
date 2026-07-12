import type { SimContext } from '../engine/SimContext';
import { EMPTY, Phase } from '../engine/types';
import { getMaterial } from './registry';

// Shared "sieve" pass-through used by Mesh (체) and Turbine — a static solid that
// a fluid seeps *through* while the solid itself never moves. A fluid crosses the
// screen into an EMPTY cell on the far side (the same EMPTY-only rule pushAside
// uses, so it never cascades across the grid):
//
//   • Vertical (gravity/buoyancy): a Liquid resting directly on top falls through
//     to the empty cell below; a Gas pooled directly underneath rises through to
//     the empty cell above.
//   • Horizontal (pressure/leveling): a Liquid or Gas pressed against one side
//     crosses to the empty cell on the opposite side — this is what lets a
//     *vertical* mesh wall drain a tank sideways instead of acting like a plain
//     wall (otherwise fluid approaching from the side is simply blocked).
//
// Powders and solids are always blocked (they rest against it like any solid),
// and a liquid chilled below its freezing point acts solid too
// (SimContext.isFrozen), so it no longer seeps through — matching how
// tryMove/pushAside treat a frozen puddle everywhere else. A source parcel that
// already moved this tick is skipped (SimContext.hasMoved), so one drop can't be
// relayed through several spaced mesh cells in a single tick — it advances one
// screen per tick like everything else. Returns the id of whatever passed this
// tick (so a Turbine can tell a puff of Steam went through and make power), or
// EMPTY when nothing moved.

/** True if the fluid at (x,y) may seep through this tick — a liquid (not frozen)
 *  or a gas, and not one already relocated this tick (see hasMoved above). */
function seeps(x: number, y: number, sim: SimContext): boolean {
  if (sim.hasMoved(x, y)) return false;
  const p = getMaterial(sim.get(x, y)).phase;
  if (p === Phase.Gas) return true;
  return p === Phase.Liquid && !sim.isFrozen(x, y);
}

export function sift(x: number, y: number, sim: SimContext): number {
  // Vertical: a liquid on top falls straight down through into the empty cell below.
  if (
    sim.inBounds(x, y - 1) &&
    sim.inBounds(x, y + 1) &&
    sim.get(x, y + 1) === EMPTY &&
    sim.get(x, y - 1) !== EMPTY &&
    getMaterial(sim.get(x, y - 1)).phase === Phase.Liquid &&
    !sim.isFrozen(x, y - 1) &&
    !sim.hasMoved(x, y - 1)
  ) {
    const passed = sim.get(x, y - 1);
    sim.swap(x, y - 1, x, y + 1);
    return passed;
  }
  // Vertical: a gas underneath bubbles straight up through into the empty cell above.
  if (
    sim.inBounds(x, y - 1) &&
    sim.inBounds(x, y + 1) &&
    sim.get(x, y - 1) === EMPTY &&
    sim.get(x, y + 1) !== EMPTY &&
    getMaterial(sim.get(x, y + 1)).phase === Phase.Gas &&
    !sim.hasMoved(x, y + 1)
  ) {
    const passed = sim.get(x, y + 1);
    sim.swap(x, y + 1, x, y - 1);
    return passed;
  }
  // Horizontal: a fluid pressed against one side crosses to the empty opposite
  // side (drains a vertical mesh wall). Randomize which side wins first so a
  // symmetric setup has no left/right bias.
  const dir = sim.chance(0.5) ? 1 : -1;
  for (const d of [dir, -dir]) {
    if (!sim.inBounds(x - d, y) || !sim.inBounds(x + d, y)) continue;
    if (sim.get(x + d, y) !== EMPTY) continue; // need an empty cell to receive it
    if (sim.get(x - d, y) === EMPTY) continue; // need a fluid to send
    if (seeps(x - d, y, sim)) {
      const passed = sim.get(x - d, y);
      sim.swap(x - d, y, x + d, y);
      return passed;
    }
  }
  return EMPTY;
}
