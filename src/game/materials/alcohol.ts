import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn } from './combustion';
import { VIRUS } from './virus';
import { WATER } from './water';

// Alcohol — a thin, volatile spirit and the most eager liquid fuel there is: it
// catches almost instantly and races across a spill, burning out fast (a high
// burn chance and a low autoignition point). It's lighter than every other
// liquid fuel, so it floats on oil and gasoline alike — pour it over a pool and
// it sits on top, ready to whoosh into flame at the first spark.
//
// **Water is the exception, and it's the one every player tries first:** spirits
// mix into water, they don't float on it. It's `miscible` with Water (see
// types.ts), so the pair never sorts by density and the two interdiffuse until
// the puddle is one weak, still-flammable solution — a drink, not a slick. The
// practical upshot is that you can't put an alcohol fire out by pouring water
// under it: the fuel follows the water in and the whole puddle burns.
//
// It's also an antiseptic, like rubbing alcohol: an adjacent Virus cell is
// oxidised away outright. Unlike H₂O₂ (which seeds a colony-wide spreading cure),
// alcohol only cleans what it directly touches — no wave — so wiping out a plague
// with it takes actually soaking the whole thing.
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
  if (tryBurn(x, y, sim)) return;
  updateLiquid(x, y, sim);
}

export const ALCOHOL = register({
  id: 42,
  name: 'Alcohol',
  phase: Phase.Liquid,
  color: rgb(222, 228, 238),
  density: 1.9,
  combustion: { burnChance: 0.15, autoIgniteTemp: 250 },
  // 물과 섞인다 — see the header. Declared on this side because it's alcohol's
  // trait, not water's: water is the solvent everything else dissolves *into*,
  // and listing its partners on plain Water would make one material own half the
  // chemistry set. The engine registers the pair both ways round regardless.
  miscible: [WATER.id],
  category: 'liquid',
  thermal: { conductivity: 0.2 },
  // Freezes only at a brutal chill (real ethanol sets near -114°); needs a strong
  // cold sink like Liquid N₂ to harden it in place.
  freeze: { temp: -80 },
  update: updateAlcohol,
});
