import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_IRON_ORE } from './moltenironore';
import { MOLTEN_METAL } from './moltenmetal';
import { SLAG } from './slag';

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
// closes back over it (tryBuoyantRise's rise, gated on material identity
// instead of the generic density comparison, since all three happen to be
// denser than Limestone anyway). Every other liquid sinks it as before.
const RISE_STALL_CHANCE = 0.3; // rises in a bobbing flutter, not a dead-straight snap
const RISE_SWAY_CHANCE = 0.35; // occasional sideways drift while rising

function isMoltenFlux(id: number): boolean {
  return id === SLAG.id || id === MOLTEN_IRON_ORE.id || id === MOLTEN_METAL.id;
}

function trySkimMelt(x: number, y: number, sim: SimContext): boolean {
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  if (!sim.inBounds(ux, uy) || !isMoltenFlux(sim.get(ux, uy))) return false;
  if (sim.chance(RISE_STALL_CHANCE)) return true;
  if (sim.chance(RISE_SWAY_CHANCE) && sim.moveDiagonalUp(x, y)) return true;
  if (sim.moveUp(x, y)) return true;
  sim.moveDiagonalUp(x, y);
  return true;
}

function updateLimestone(x: number, y: number, sim: SimContext): void {
  if (trySkimMelt(x, y, sim)) return;
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
