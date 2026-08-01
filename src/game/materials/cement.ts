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
// structure you can build with. (Like Salt consuming the water it dissolves
// into, this keeps one puddle from setting an unlimited amount at once.)
const SET_CHANCE = 0.09;

function updateCement(x: number, y: number, sim: SimContext): void {
  // 스며든 물로도 굳는다: a grain that swallowed the water through the 겹침 layer
  // (액체 겹침 계수 — most grains do) sets on it exactly as it would on a puddle
  // touching its face. Without this, splashing a pile only cured the grains the
  // water never got inside, and the soaked ones stayed powder forever — the same
  // blind spot acid had before corrosion.ts learned to bite from inside.
  const soaked = sim.getOverlay(x, y);
  if ((soaked === WATER.id || soaked === SALTWATER.id) && sim.chance(SET_CHANCE)) {
    sim.clearOverlay(x, y); // the water is used up curing this grain
    sim.set(x, y, CONCRETE.id);
    return;
  }
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
  category: 'powder',
  // Fine, cohesive dry powder — the steepest-piling of the powders (마찰).
  friction: 0.52,
  thermal: { conductivity: 0.3 },
  update: updateCement,
});
