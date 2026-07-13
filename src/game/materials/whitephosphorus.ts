import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { FIRE } from './fire';
import { SMOKE } from './smoke';

// White Phosphorus (백린) — a waxy powder that bursts into flame the instant it
// meets air. Exposed to an open (EMPTY) neighbour and not touching water, a grain
// self-ignites: it burns white-hot, throws a lick of Fire, and pours out a thick
// screen of white Smoke — the incendiary/smoke-grenade material. A burning grain
// lights any fuel it touches and still falls and piles as it burns.
//
// Its one weakness (and how you handle it safely) is water: a grain with any
// Water/Saltwater neighbour is submerged and inert — it can't get the air it needs,
// so it just sits there as a cold powder, and dunking a burning grain snuffs it.
// Keep it under water; let it dry out and it flares.
const BURN_TEMP = 1100; // burns white-hot
const IGNITE_CHANCE = 0.3; // per-tick chance a freshly exposed grain flares up
const HOT_THRESHOLD = 200; // already-burning grains stay lit above this
const FIRE_CHANCE = 0.14; // lick of flame into an open neighbour
const SMOKE_CHANCE = 0.32; // thick white smoke screen
const SPREAD_CHANCE = 0.25; // lights adjacent fuel
const CONSUME_CHANCE = 0.06; // spent → a final puff of Smoke

function updateWhitePhosphorus(x: number, y: number, sim: SimContext): void {
  let wet = false;
  let hasAir = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id) wet = true;
    else if (nid === EMPTY) hasAir = true;
  }

  // Submerged: safe and inert. Douse it if it was burning, then behave as powder.
  if (wet) {
    if (sim.getTemp(x, y) >= HOT_THRESHOLD) sim.setTemp(x, y, 20);
    updatePowder(x, y, sim);
    return;
  }

  const burning = sim.getTemp(x, y) >= HOT_THRESHOLD;
  if (hasAir && (burning || sim.chance(IGNITE_CHANCE))) {
    // Burn: pin white-hot, wreath fire and pour smoke into open air, light any
    // fuel neighbour, and slowly consume into a last puff of smoke.
    sim.setTemp(x, y, BURN_TEMP);
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (nid === EMPTY) {
        if (sim.chance(FIRE_CHANCE)) sim.spawn(nx, ny, FIRE.id);
        else if (sim.chance(SMOKE_CHANCE)) sim.spawn(nx, ny, SMOKE.id);
      } else if (
        getMaterial(nid).combustible &&
        sim.getTemp(nx, ny) < BURN_TEMP &&
        sim.chance(SPREAD_CHANCE)
      ) {
        // Light the fuel by pinning it into its burning band (see combustion.ts).
        sim.setTemp(nx, ny, BURN_TEMP);
      }
    }
    if (sim.chance(CONSUME_CHANCE)) {
      sim.set(x, y, SMOKE.id);
      return;
    }
    updatePowder(x, y, sim); // a burning grain still tumbles and piles
    return;
  }

  // No air (buried) and no water: nothing to react with — an ordinary powder.
  updatePowder(x, y, sim);
}

export const WHITE_PHOSPHORUS = register({
  id: 94,
  name: 'White Phosphorus',
  phase: Phase.Powder,
  color: rgb(255, 250, 235),
  density: 5,
  category: '불·열',
  thermal: { init: 20, conductivity: 0.3 },
  // Waxy pale yellow when cold, glaring white-hot while it burns.
  glow: { min: 60, max: BURN_TEMP, cool: rgb(224, 214, 150) },
  update: updateWhitePhosphorus,
});
