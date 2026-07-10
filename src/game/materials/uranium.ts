import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { AMBIENT_TEMP } from '../config';
import type { SimContext } from '../engine/SimContext';
import { detonate } from './blast';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';

// Uranium — a radioactive solid whose heat output scales with how many fellow
// uranium cells surround it, modelling neutron-moderated chain reaction. A lone
// grain is inert (no neighbors → no heat), but pile enough together and the
// interior cells each see up to eight neighbors and pump out heat far faster
// than conduction can bleed it through the surface. The mass warms visibly —
// via the glow ramp, dark olive at ambient brightening to blazing yellow-green
// over many seconds — until it hits MELTDOWN_TEMP and goes critical: a single
// enormous detonation (see blast.ts) that levels everything including
// blast-proof Diamond — only the indestructible boundary Wall survives.
//
// The "critical mass" is emergent: it falls out of the geometry (surface-area-
// to-volume) and the thermal conduction system. A thin line or a few scattered
// grains never build enough heat; a thick block does.
//
// REACTOR — Water (or Saltwater) adjacent to uranium provides active cooling:
// each tick, every adjacent water cell has a chance to flash into Steam,
// carrying heat away from the uranium (COOL_AMOUNT per cell boiled). Keep a
// steady flow of water and the mass stays sub-critical indefinitely — the
// rising Steam is the visible sign the reactor is running. Cut the water
// supply and cooling stops; the chain reaction resumes and meltdown follows.
const HEAT_PER_NEIGHBOR = 1;
const MELTDOWN_TEMP = 1500;
const MELTDOWN_RADIUS = 18;
const COOL_CHANCE = 0.12;
const COOL_AMOUNT = 25;

function updateUranium(x: number, y: number, sim: SimContext): void {
  let neighbors = 0;
  let temp = sim.getTemp(x, y);

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === URANIUM.id) {
      neighbors++;
    } else if (nid === WATER.id || nid === SALTWATER.id) {
      if (sim.chance(COOL_CHANCE)) {
        sim.spawn(nx, ny, STEAM.id);
        temp -= COOL_AMOUNT;
      }
    }
  }

  if (neighbors > 0) {
    temp += neighbors * HEAT_PER_NEIGHBOR;
  }

  sim.setTemp(x, y, temp);

  if (temp >= MELTDOWN_TEMP) {
    detonate(sim, x, y, MELTDOWN_RADIUS, true);
    return;
  }
}

export const URANIUM = register({
  id: 63,
  name: 'Uranium',
  phase: Phase.Solid,
  color: rgb(210, 225, 70),
  density: 1000,
  category: '특수',
  thermal: { conductivity: 0.5 },
  glow: { min: AMBIENT_TEMP, max: MELTDOWN_TEMP, cool: rgb(70, 90, 30) },
  update: updateUranium,
});
