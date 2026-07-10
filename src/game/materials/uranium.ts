import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { AMBIENT_TEMP } from '../config';
import type { SimContext } from '../engine/SimContext';
import { detonate } from './blast';

// Uranium — a radioactive solid whose heat output scales with how many fellow
// uranium cells surround it, modelling neutron-moderated chain reaction. A lone
// grain is inert (no neighbors → no heat), but pile enough together and the
// interior cells each see up to eight neighbors and pump out heat far faster
// than conduction can bleed it through the surface. The mass warms visibly —
// via the glow ramp, dark olive at ambient brightening to blazing yellow-green
// — until it hits MELTDOWN_TEMP and goes critical: a single large detonation
// (see blast.ts) carves a crater and scatters fire, and any surviving uranium
// at the fringe, still hot, chain-melts on the next ticks.
//
// The "critical mass" is emergent, not hard-coded: it falls out of the geometry
// (surface-area-to-volume) and the thermal conduction system. A thin line or a
// few scattered grains never build enough heat; a thick block does. Placing it
// on a cold conductor (stone, water) draws heat away and raises the threshold,
// so immersion cooling delays or prevents meltdown — the player's tool for
// building a "reactor" that stays sub-critical.
const HEAT_PER_NEIGHBOR = 3;
const MELTDOWN_TEMP = 600;
const MELTDOWN_RADIUS = 12;

function updateUranium(x: number, y: number, sim: SimContext): void {
  let neighbors = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === URANIUM.id) neighbors++;
  }

  if (neighbors > 0) {
    sim.setTemp(x, y, sim.getTemp(x, y) + neighbors * HEAT_PER_NEIGHBOR);
  }

  if (sim.getTemp(x, y) >= MELTDOWN_TEMP) {
    detonate(sim, x, y, MELTDOWN_RADIUS);
    return;
  }
}

export const URANIUM = register({
  id: 63,
  name: 'Uranium',
  phase: Phase.Solid,
  // Base color is the hot/blazing end of the glow ramp; at ambient the cell
  // renders as the dark olive `glow.cool` instead, then brightens as it heats.
  color: rgb(210, 225, 70),
  density: 1000,
  category: '특수',
  // Conducts well so heat from the interior reaches the surface — and a cold
  // sink (stone, water) touching the surface can draw enough heat to keep the
  // mass sub-critical. This is the lever for "immersion cooling a reactor".
  thermal: { conductivity: 0.5 },
  // Glows dark olive at ambient, brightening to blazing yellow-green as it
  // approaches meltdown, so the player can see the reaction building up.
  glow: { min: AMBIENT_TEMP, max: MELTDOWN_TEMP, cool: rgb(70, 90, 30) },
  update: updateUranium,
});
