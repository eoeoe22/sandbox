import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';

// Gas: rises/diffuses like the default gas behavior, then probabilistically
// dissipates to nothing so it doesn't accumulate forever. ~0.6%/tick gives a
// ~2-3s average lifetime at the sim's 60Hz tick rate.
const DECAY_CHANCE = 0.006;

function updateSmoke(x: number, y: number, sim: SimContext): void {
  if (sim.chance(DECAY_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }
  updateGas(x, y, sim);
}

export const SMOKE = register({
  id: 6,
  name: 'Smoke',
  phase: Phase.Gas,
  color: rgb(180, 180, 188),
  density: 1,
  update: updateSmoke,
});
