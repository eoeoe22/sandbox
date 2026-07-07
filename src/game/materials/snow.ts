import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER, FROST_MELT_TEMP, WATER_DEEP_FREEZE_TEMP } from './water';
import { ICE } from './ice';

// Powder: a light, fluffy flake that flutters down and piles. It's the mild end
// of the water phase diagram — Water chills to Snow just below freezing (see
// water.ts), Snow thaws back to Water once warmed past the melt point, and if a
// Snow pile is chilled further (past the deep-freeze point) it packs down into
// solid Ice. Placed cold but not as deep-frozen as Ice.
//
// Two departures from a plain powder: a fall gate makes it descend at roughly
// half speed (settling flakes, not dropping sand), and its conductivity is low
// (fluffy snow insulates) so it holds its cold and melts slowly against warm
// neighbors.
const SNOW_INIT_TEMP = -6;
const SNOW_FALL_CHANCE = 0.45; // skip movement most-of-a-tick → a slow flutter

function updateSnow(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  if (t >= FROST_MELT_TEMP) {
    // Warmed past melting → Water (keeps the now-warm temperature in place).
    sim.set(x, y, WATER.id);
    return;
  }
  if (t <= WATER_DEEP_FREEZE_TEMP) {
    // Chilled well past freezing → packs down into solid Ice.
    sim.set(x, y, ICE.id);
    return;
  }
  if (sim.chance(SNOW_FALL_CHANCE)) updatePowder(x, y, sim);
}

export const SNOW = register({
  id: 22,
  name: 'Snow',
  phase: Phase.Powder,
  color: rgb(238, 246, 252),
  density: 2,
  thermal: { init: SNOW_INIT_TEMP, conductivity: 0.12 },
  update: updateSnow,
});
