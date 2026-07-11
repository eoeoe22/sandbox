import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { tryBurn, type Combustible } from './combustion';

// Plant — a living green growth that drinks. Where it touches water it soaks
// that water up and grows into the cell it just emptied, so a Plant sitting in a
// puddle slowly eats the puddle and turns it into more Plant. Growth is
// deliberately irregular: each tick it only *sometimes* grows, and when it does
// it picks one random adjacent water cell rather than filling them all — so the
// growth wanders off in tendrils and branches instead of advancing as a flat
// front, and stops the moment the water runs out.
//
// Dry vegetation is eager fuel: rather than the single global-rate `flammable`
// tag (which every flammable material shares and can't tune), Plant burns on the
// self-sustaining combustion model with its own `burnChance` — set a notch above
// Wood (0.06) so a lit Plant catches readily and carries a flame front through
// the whole clump, and a low autoignition point so nearby heat sets it off. Wet
// Plant is safe: water smothers a burning cell (see combustion.tryBurn), so only
// growth that has dried away from its water actually burns.
const GROW_CHANCE = 0.15;
const BURN_SPEC: Combustible = { burnChance: 0.1, autoIgniteTemp: 400 };

function isWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

function updatePlant(x: number, y: number, sim: SimContext): void {
  // Combustion first: if the cell is alight it burns (and, once consumed, turns
  // to Fire — stop here). A burning Plant doesn't grow, so skip the growth step
  // while it's hot.
  if (tryBurn(x, y, sim, BURN_SPEC)) return;
  if (sim.getTemp(x, y) >= BURN_SPEC.autoIgniteTemp) return;

  // Grow only some ticks — spacing growth out in time is half of what makes the
  // spread look like an irregular creeping vine rather than a solid flood-fill.
  if (!sim.chance(GROW_CHANCE)) return;

  // Gather every adjacent water cell, then pick one at random. Choosing a random
  // neighbor (instead of the first in DIR8 order) keeps growth from favoring a
  // fixed direction, so tendrils wander unpredictably through the water.
  let count = 0;
  let tx = -1;
  let ty = -1;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isWater(sim.get(nx, ny))) {
      count++;
      // Reservoir sampling: each eligible cell has a 1/count chance of being the
      // chosen one, giving a uniform pick in a single pass without an array.
      if (sim.randInt(count) === 0) {
        tx = nx;
        ty = ny;
      }
    }
  }

  if (count === 0) return; // no water in reach — nothing to drink, so no growth

  // spawn overwrites the water (absorbing it) with fresh Plant and marks the
  // cell moved, so the new growth can't be re-processed this tick — capping
  // growth to one cell per tick.
  sim.spawn(tx, ty, PLANT.id);
}

export const PLANT = register({
  id: 47,
  name: 'Plant',
  phase: Phase.Solid,
  color: rgb(74, 122, 52),
  density: 1000,
  // Burns via the shared combustion model (see updatePlant / combustion.ts), so
  // it's tagged `combustible`, not `flammable` — the two ignition paths are
  // mutually exclusive by design (combustion.ts) to keep the per-fuel burn rate.
  combustible: true,
  category: '생명',
  thermal: { conductivity: 0.3 },
  update: updatePlant,
});
