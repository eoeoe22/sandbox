import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
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
    // Condensing means it has shed its heat — drop back to ambient so the fresh
    // Water doesn't sit above boiling and instantly flash back to Steam.
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, WATER.id);
    return;
  }
  updateGas(x, y, sim);
}

export const STEAM = register({
  id: 8,
  name: 'Steam',
  phase: Phase.Gas,
  color: rgb(0, 202, 235),
  density: 1,
  // Placed/spawned just above boiling; conducts poorly (a gas), so it mostly
  // carries heat by physically rising rather than by conduction.
  thermal: { init: 110, conductivity: 0.08 },
  update: updateSteam,
});
