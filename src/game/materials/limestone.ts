import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryRiseThroughFlux } from './moltenironore';

// Limestone — the optional flux of the smelting kit. Its main role is to be
// *read* by an adjacent reducing iron-ore cell, which lifts that cell's iron
// yield from 0.70 to 0.95 and consumes a grain of limestone (a hint of the
// real calcining that carries impurities off into the slag). Charge ore +
// coal alone and you still smelt iron, just a dirtier bloom shot through with
// slag; add a pinch of limestone and the bloom comes out cleaner. See
// moltenironore.ts for the flux branch.
//
// "가벼운 가루" (light powder), the same mechanism every powder gets
// (updatePowder's generic density-based buoyancy — see engine/behaviors.ts):
// against ordinary liquids (water, oil, Mercury, Molten Uranium, …) it just
// floats or sinks by density like any other powder. The three smelting
// liquids are the deliberate exception, handled first by material identity
// instead of density (tryRiseThroughFlux, shared with Coal Powder — see
// moltenironore.ts) — Molten Iron Ore is where it's actually being read by a
// reducing neighbour (see moltenironore.ts's flux branch) and Slag is where
// it settles as waste, so a grain submerged in *either* stays put instead of
// skimming straight back to the surface (which the generic density rule
// would otherwise do, since both are denser than Limestone); only once it's
// below both, in the finished Molten Metal (nothing left for it to flux),
// does it bubble back up. tryRiseThroughFlux returns false for every other
// liquid, so updatePowder's generic buoyancy takes over there.
function updateLimestone(x: number, y: number, sim: SimContext): void {
  if (tryRiseThroughFlux(x, y, sim)) return;
  updatePowder(x, y, sim);
}

export const LIMESTONE = register({
  id: 69,
  name: 'Limestone',
  phase: Phase.Powder,
  color: rgb(216, 210, 196),
  // Lighter than every smelting liquid, but only actually floats clear of
  // Molten Metal (see updateLimestone) — Slag and Molten Iron Ore hold it in.
  density: 5,
  category: '제련',
  thermal: { conductivity: 0.35 },
  update: updateLimestone,
});
