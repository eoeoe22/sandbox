import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Alcohol — a thin, volatile spirit and the most eager liquid fuel there is: it
// catches almost instantly and races across a spill, burning out fast (a high
// burn chance and a low autoignition point). It's lighter than every other
// liquid fuel, so it floats on water, oil and gasoline alike — pour it over a
// pool and it sits on top, ready to whoosh into flame at the first spark.
const SPEC: Combustible = { burnChance: 0.15, autoIgniteTemp: 250 };

function updateAlcohol(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  updateLiquid(x, y, sim);
}

export const ALCOHOL = register({
  id: 42,
  name: 'Alcohol',
  phase: Phase.Liquid,
  color: rgb(222, 228, 238),
  density: 1.9,
  combustible: true,
  category: '액체',
  thermal: { conductivity: 0.2 },
  // Freezes only at a brutal chill (real ethanol sets near -114°); needs a strong
  // cold sink like Liquid N₂ to harden it in place.
  freeze: { temp: -80 },
  update: updateAlcohol,
});
