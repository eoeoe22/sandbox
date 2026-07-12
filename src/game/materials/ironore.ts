import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_IRON_ORE } from './moltenironore';

// Iron Ore — a red-brown powder smelted in two steps: first MELT it with heat,
// then feed carbon to the molten pool it becomes (see moltenironore.ts). The
// melt point sits low enough that an *ordinary Fire* melts it (Fire cells run
// ~1000°) — you don't need Lava or Blue Flame, though those (and an oxygen-blown
// coal fire, or the heat brush) melt it too. A bare smouldering fuel bed pins at
// only 800° and so won't quite melt it, which keeps "melt with flame" a distinct
// first step from "add coal to reduce".
//
// Melting alone yields no iron: heat only turns the ore into a molten pool, and
// that pool left without carbon cools back into useless Slag. Iron comes only
// from dusting Coal (Powder) onto the glowing melt — "heat alone makes slag,
// heat + carbon makes iron".
const ORE_MELT_TEMP = 850;

function updateIronOre(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= ORE_MELT_TEMP) {
    // In-place set keeps the (now high) temperature so the fresh melt reads as
    // molten instead of instantly re-solidifying next tick.
    sim.set(x, y, MOLTEN_IRON_ORE.id);
    return;
  }
  // Below the melt point: fall and pile like an ordinary powder.
  updatePowder(x, y, sim);
}

export const IRON_ORE = register({
  id: 67,
  name: 'Iron Ore',
  phase: Phase.Powder,
  color: rgb(148, 90, 62),
  // Sinks through water (3) and liquid slag (6); floats on Molten Metal (8) and
  // its own melt (7) so charged ore rides on top of a molten hearth.
  density: 7,
  category: '제련',
  thermal: { conductivity: 0.4 },
  update: updateIronOre,
});
