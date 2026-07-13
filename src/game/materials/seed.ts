import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { DIRT } from './dirt';
import { MUD } from './mud';
import { PLANT, PLANT_START_MOISTURE } from './plant';

// Seed (씨앗) — a little kernel that falls and piles like any powder, but planted
// in damp earth it sprouts. When a seed comes to rest on soil (Dirt or Mud) with
// moisture in reach (adjacent Water, or the Mud it's sitting in), it slowly
// germinates: a per-tick countdown stored in its `aux` byte ticks up, and once it
// matures the seed becomes a Plant sprout — which then grows upward on its own
// (see plant.ts). Dry it out or lift it off the soil and germination just pauses.
//
// This is the front of the little ecosystem: Water + Dirt → Mud, drop a Seed, and
// a plant climbs out of the wet ground and keeps growing as long as it can drink.
const GERMINATE_CHANCE = 0.1; // how often a planted, moist seed advances
const SPROUT_PROGRESS = 15; // aux count to reach before it becomes a Plant (~150 ticks)

function isSoil(id: number): boolean {
  return id === DIRT.id || id === MUD.id;
}

function isMoisture(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id || id === MUD.id;
}

function updateSeed(x: number, y: number, sim: SimContext): void {
  // Planted only when resting on soil directly below.
  const onSoil = sim.inBounds(x, y + 1) && isSoil(sim.get(x, y + 1));
  let moist = false;
  if (onSoil) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny) && isMoisture(sim.get(nx, ny))) {
        moist = true;
        break;
      }
    }
  }

  if (onSoil && moist) {
    const progress = sim.getAux(x, y);
    if (progress >= SPROUT_PROGRESS) {
      // Germinate: become a Plant sprout, pre-charged with moisture so it can
      // start climbing straight away (plant.ts reads aux as its moisture store).
      sim.set(x, y, PLANT.id);
      sim.setAux(x, y, PLANT_START_MOISTURE);
      return;
    }
    if (sim.chance(GERMINATE_CHANCE)) sim.setAux(x, y, progress + 1);
    return; // planted seeds stay put while they mature
  }

  updatePowder(x, y, sim);
}

export const SEED = register({
  id: 90,
  name: 'Seed',
  phase: Phase.Powder,
  color: rgb(122, 94, 52),
  density: 5,
  category: '생명',
  thermal: { conductivity: 0.3 },
  update: updateSeed,
});
