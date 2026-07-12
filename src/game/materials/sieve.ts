import type { SimContext } from '../engine/SimContext';
import { EMPTY, Phase } from '../engine/types';
import { getMaterial } from './registry';

// Shared "sieve" pass-through used by Mesh (체) and Turbine — a static solid that
// a fluid seeps *through* while the solid itself never moves. Movement is only
// vertical and density-driven, and only into an EMPTY cell (the same EMPTY-only
// rule pushAside uses, so it never cascades across the grid): a Liquid resting
// directly on top falls through to the empty cell below, and a Gas pooled
// directly underneath rises through to the empty cell above. Powders and solids
// are blocked — they just rest against it like any other solid. Returns the id
// of whatever passed this tick (so a Turbine can tell a puff of Steam went
// through and make power), or EMPTY when nothing moved.
export function siftVertical(x: number, y: number, sim: SimContext): number {
  if (!sim.inBounds(x, y - 1) || !sim.inBounds(x, y + 1)) return EMPTY;
  const aboveId = sim.get(x, y - 1);
  const belowId = sim.get(x, y + 1);

  // Liquid resting on top seeps down into the empty cell below.
  if (belowId === EMPTY && aboveId !== EMPTY && getMaterial(aboveId).phase === Phase.Liquid) {
    sim.swap(x, y - 1, x, y + 1);
    return aboveId;
  }
  // Gas pooled underneath bubbles up into the empty cell above.
  if (aboveId === EMPTY && belowId !== EMPTY && getMaterial(belowId).phase === Phase.Gas) {
    sim.swap(x, y + 1, x, y - 1);
    return belowId;
  }
  return EMPTY;
}
