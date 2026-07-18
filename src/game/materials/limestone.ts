import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowderMix } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { COAL_POWDER } from './coalpowder';
import { tryHoldInActiveMelt } from './moltenironore';

// Limestone — the optional flux of the smelting kit. Its main role is to be
// *read* by an adjacent reducing iron-ore cell, which lifts that cell's iron
// yield from 0.70 to 0.95 and consumes a grain of limestone (a hint of the
// real calcining that carries impurities off into the slag). Charge ore +
// coal alone and you still smelt iron, just a dirtier bloom shot through with
// slag; add a pinch of limestone and the bloom comes out cleaner. See
// moltenironore.ts for the flux branch.
//
// "가벼운 가루" (light powder) — the lightest thing in the whole smelting stack
// (Limestone 5 < Slag 5.75 < Molten Iron Ore 6.5 < Coal Powder 7.5 < Molten
// Metal 8, see moltenironore.ts/coalpowder.ts/slag.ts/moltenmetal.ts), the same
// generic density-based buoyancy every powder gets (updatePowderMix/updatePowder —
// see engine/behaviors.ts): against ordinary liquids (water, oil, Mercury,
// Molten Uranium, …) it just floats or sinks by density like any other powder.
// Molten Iron Ore and Slag are the deliberate exception, held by material
// identity instead of density (tryHoldInActiveMelt, shared with Coal Powder —
// see moltenironore.ts, though the 제련 밀도 재서열 round made that sharing a
// no-op for Coal Powder specifically, which is now denser than both liquids
// anyway) — Molten Iron Ore is where it's actually being read by a reducing
// neighbour (see moltenironore.ts's flux branch) and Slag is where it settles
// as waste, so a grain submerged in *either* stays put (though still free to
// sink further if there's room below) instead of skimming straight back to the
// surface, which the generic density rule would otherwise do since both are
// denser than Limestone. Molten Metal needs no such override: once the grain
// is below both Ore and Slag, in the finished layer (nothing left for it to
// flux), tryHoldInActiveMelt returns false and updatePowderMix's ordinary
// generic buoyancy floats it clear on its own, the same as any other liquid
// — Coal Powder is in its mixIds so the two can still swap past each other
// there if they've floated clear together with no open liquid between them
// (see SimContext.moveSidewaysMix).
// Lazily built (not a plain module-level literal): COAL_POWDER comes from
// coalpowder.ts, which imports back from this file, so a top-level
// `[COAL_POWDER.id]` would read COAL_POWDER before that circular import
// finishes resolving and crash (confirmed by trying it — reads `.id` off
// `undefined`). Deferring construction to updateLimestone's first actual
// call — long after both modules have finished loading — avoids that while
// still only allocating the array once.
let mixIds: readonly number[] | undefined;

function updateLimestone(x: number, y: number, sim: SimContext): void {
  if (tryHoldInActiveMelt(x, y, sim)) return;
  updatePowderMix(x, y, sim, mixIds ?? (mixIds = [COAL_POWDER.id]));
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
