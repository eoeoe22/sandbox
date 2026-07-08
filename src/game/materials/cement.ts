import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { CONCRETE } from './concrete';

// Cement — a dry grey powder that falls and piles like sand, but touch it to
// water and it *sets*: the grain hardens into solid Concrete and consumes the
// water that set it. That makes it the game's construction tool — pour dry
// cement into a mold or a gap, splash water on it, and it freezes into a rigid
// structure you can build with. (Like Salt/Seed consuming their triggering
// water, this keeps one puddle from setting an unlimited amount at once.)
const SET_CHANCE = 0.09;

function updateCement(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if ((nid === WATER.id || nid === SALTWATER.id) && sim.chance(SET_CHANCE)) {
      sim.set(nx, ny, EMPTY); // the water is used up curing this grain
      sim.set(x, y, CONCRETE.id);
      return;
    }
  }
  updatePowder(x, y, sim);
}

export const CEMENT = register({
  id: 45,
  name: 'Cement',
  phase: Phase.Powder,
  color: rgb(165, 165, 170),
  density: 5,
  category: '가루',
  thermal: { conductivity: 0.3 },
  update: updateCement,
});
