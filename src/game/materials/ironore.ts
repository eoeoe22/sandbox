import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_IRON_ORE } from './moltenironore';

// Iron Ore — a red-brown powder smelted in two steps: first MELT it with heat,
// then feed carbon to the molten pool it becomes (see moltenironore.ts). The
// melt point sits low enough that an *ordinary Fire* melts it (Fire cells run
// ~1000°) — you don't need Lava or Blue Flame, though those (and a coal fire,
// or the heat brush) melt it too. Coal now runs hot enough (1300°, see coal.ts)
// to melt ore it merely conducts heat into. Coal *Powder* touching ore directly
// is shielded from combustion and acts purely as a reductant instead (see
// touchingMelt in coalpowder.ts); solid Coal has no such shield, so a lump
// resting straight against ore just burns and melts it like any other heat
// source.
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
  // Sinks through water (3) and the lighter liquid Slag (6); rides level with its
  // own melt (7) and sinks under Molten Metal (8), so a fresh ore charge settles
  // beneath the light waste slag while the heavy reduced iron pools on the floor.
  density: 7,
  category: '제련',
  // High conductivity so heat drives deep into a pile quickly and it melts
  // briskly rather than crawling in from the surface.
  thermal: { conductivity: 0.85 },
  update: updateIronOre,
});
