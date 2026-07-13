import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';

// Mercury — liquid metal: the densest fluid in the game (9), so it sinks beneath
// everything, even Molten Metal, and shoulders lighter liquids up and out of its
// way. Its party trick is that it's `conductive`: a Spark travels through a
// puddle of mercury exactly as it does through solid Iron, so you can bridge a
// circuit across a pool of it or let it flow into a gap to close a switch. As a
// moving conductor it does the same one job Iron does for the electricity
// system — tick down the post-spark refractory stamped in its `aux` — before
// flowing as a normal (rather heavy) liquid.
function updateMercury(x: number, y: number, sim: SimContext): void {
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);
  updateLiquid(x, y, sim);
}

export const MERCURY = register({
  id: 40,
  name: 'Mercury',
  phase: Phase.Liquid,
  color: rgb(205, 208, 216),
  density: 9,
  conductive: true,
  category: '액체',
  // Beads up hard (표면장력): scattered drops pull themselves into tight rounded
  // balls instead of wetting a surface — the signature "quicksilver beads".
  surfaceTension: 0.6,
  // A smooth mirror-like metal, so it renders as a flat single colour rather than
  // sampling the shimmering background tint field the other liquids use.
  colorVary: 0,
  thermal: { conductivity: 0.7 },
  // Freezes solid deep below zero (real mercury sets at ~-39°): a chilled puddle
  // hardens in place (still conducts electricity — solid metal) until it warms.
  freeze: { temp: -38 },
  update: updateMercury,
});
