import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { AMBIENT_TEMP } from '../config';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { MOLTEN_URANIUM } from './moltenuranium';

// Uranium — a radioactive solid whose heat output scales with how many fellow
// uranium cells surround it, modelling a self-sustaining chain reaction. A
// lone grain is inert (no neighbors → no heat), but pile enough together and
// the interior cells each see up to eight neighbors and pump out heat far
// faster than conduction can bleed it through the surface. The mass warms
// visibly — via the glow ramp, dark olive at ambient brightening to blazing
// yellow-green over many seconds — until it crosses MELT_TEMP and
// *melts down*: the cell turns into Molten Uranium (see moltenuranium.ts), a
// free-flowing, densest-of-all liquid that keeps the chain reaction going. No
// instant detonation happens here anymore — catastrophe now unfolds in stages:
// melt → the pool keeps self-heating → criticality → a slow, screen-sweeping
// Heat Ray burn (see moltenuranium.ts / heatray.ts). Cool the melt back below
// its freeze point and it sets into solid Uranium again, so the whole
// meltdown is reversible right up until the fuel actually burns.
//
// The "critical mass" is emergent: it falls out of the geometry (surface-area-
// to-volume) and the thermal conduction system. A thin line or a few scattered
// grains never build enough heat; a thick block does. Stray Heat Rays also
// dump heat into any uranium they strike, so a burning deposit elsewhere can
// push this one over the edge — chain reactions jump between piles.
//
// REACTOR — Water (or Saltwater) adjacent to uranium provides active cooling:
// each tick, every adjacent water cell has a chance to flash into Steam,
// carrying heat away from the uranium (COOL_AMOUNT per cell boiled). Keep a
// steady flow of water and the mass stays sub-critical indefinitely — the
// rising Steam is the visible sign the reactor is running. Cut the water
// supply and cooling stops; the chain reaction resumes and meltdown follows.
const HEAT_PER_NEIGHBOR = 1;
const MELT_TEMP = 1500;
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
    if (nid === URANIUM.id || nid === MOLTEN_URANIUM.id) {
      // Molten neighbors keep feeding the solid's chain reaction, so a
      // half-melted mass doesn't stall at the melt front.
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

  if (temp >= MELT_TEMP) {
    // Meltdown: melt in place. The in-place `set` keeps the (now high)
    // temperature, so the fresh melt reads as molten instead of instantly
    // refreezing on its next turn.
    sim.set(x, y, MOLTEN_URANIUM.id);
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
  glow: { min: AMBIENT_TEMP, max: MELT_TEMP, cool: rgb(70, 90, 30) },
  update: updateUranium,
});
