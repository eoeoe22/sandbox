import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { VIRUS } from './virus';

// Alcohol — a thin, volatile spirit and the most eager liquid fuel there is: it
// catches almost instantly and races across a spill, burning out fast (a high
// burn chance and a low autoignition point). It's lighter than every other
// liquid fuel, so it floats on water, oil and gasoline alike — pour it over a
// pool and it sits on top, ready to whoosh into flame at the first spark.
//
// It's also an antiseptic, like rubbing alcohol: an adjacent Virus cell is
// oxidised away outright. Unlike H₂O₂ (which seeds a colony-wide spreading cure),
// alcohol only cleans what it directly touches — no wave — so wiping out a plague
// with it takes actually soaking the whole thing.
const SPEC: Combustible = { burnChance: 0.15, autoIgniteTemp: 250 };
const STERILIZE_CHANCE = 0.4; // per-tick chance to kill a touched Virus cell

function updateAlcohol(x: number, y: number, sim: SimContext): void {
  // Contact disinfection: clear an adjacent Virus (EMPTY writes are always safe).
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === VIRUS.id && sim.chance(STERILIZE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
    }
  }
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
