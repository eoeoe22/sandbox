import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';

// Gas: rises/diffuses like the default gas behavior, then probabilistically
// condenses back to Water. The condense chance jumps when the cell directly
// above is blocked (ceiling/wall or the grid edge) — steam pooling under
// something condenses noticeably faster than steam still rising freely.
const CONDENSE_CHANCE = 0.003;
const CONDENSE_CHANCE_BLOCKED = 0.02;

function updateSteam(x: number, y: number, sim: SimContext): void {
  const blocked = !sim.inBounds(x, y - 1) || !sim.isEmpty(x, y - 1);
  if (sim.chance(blocked ? CONDENSE_CHANCE_BLOCKED : CONDENSE_CHANCE)) {
    sim.set(x, y, WATER.id);
    return;
  }
  updateGas(x, y, sim);
}

export const STEAM = register({
  id: 8,
  name: 'Steam',
  phase: Phase.Gas,
  color: rgb(225, 232, 235),
  density: 1,
  update: updateSteam,
});
