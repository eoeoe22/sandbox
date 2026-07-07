import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { VINE } from './vine';

// Powder: falls/piles like sand. A Water neighbor has a chance to germinate
// it each tick (self -> Vine). Flammable: fuel for Fire/Lava.
const GERMINATE_CHANCE = 0.05;

function updateSeed(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(GERMINATE_CHANCE)) {
      sim.set(x, y, VINE.id);
      return;
    }
  }
  updatePowder(x, y, sim);
}

export const SEED = register({
  id: 14,
  name: 'Seed',
  phase: Phase.Powder,
  color: rgb(120, 90, 60),
  density: 4,
  flammable: true,
  update: updateSeed,
});
