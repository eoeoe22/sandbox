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
// ironore.ts for the flux branch.
//
// "가벼운 가루" (light powder), the same mechanism Ash/Sawdust use: it falls
// and piles like an ordinary powder everywhere (density 5 sinks through every
// ordinary liquid — water, oil, lava, even Mercury or Molten Uranium), but a
// scatter of flux is meant to skim the melt rather than disappear into the
// bloom, so specifically against the three molten smelting liquids — Slag,
// Molten Iron Ore, Molten Metal — it actively bubbles back up if one of them
// closes back over it (tryRiseThroughFlux, shared with Coal Powder — see
// moltenironore.ts — gated on material identity instead of the generic
// density comparison, since all three happen to be denser than Limestone
// anyway). Every other liquid sinks it as before.
function updateLimestone(x: number, y: number, sim: SimContext): void {
  if (tryRiseThroughFlux(x, y, sim)) return;
  updatePowder(x, y, sim);
}

export const LIMESTONE = register({
  id: 69,
  name: 'Limestone',
  phase: Phase.Powder,
  color: rgb(216, 210, 196),
  // Lighter than liquid Slag (6): a scatter of flux floats on a molten slag pool.
  density: 5,
  category: '제련',
  thermal: { conductivity: 0.35 },
  update: updateLimestone,
});
