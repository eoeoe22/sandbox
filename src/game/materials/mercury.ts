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
  thermal: { conductivity: 0.7 },
  update: updateMercury,
});
