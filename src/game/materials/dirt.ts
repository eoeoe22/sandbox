import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { MUD } from './mud';

// Dirt — plain earth: a powder that falls and piles like sand but never melts.
// Wet it and it turns to Mud (soaking up the water cell that touched it); the
// Mud later dries back to Dirt when the water is gone, so a rained-on dirt pile
// slumps into mud and firms up again as it drains. It's the terrain Moss likes
// to creep over (see moss.ts), making it the ground layer of a little ecosystem.
const SOAK_CHANCE = 0.06;

function updateDirt(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(SOAK_CHANCE)) {
      // Soak up the water: this grain becomes Mud, that Water cell is consumed.
      sim.set(nx, ny, EMPTY);
      sim.set(x, y, MUD.id);
      return;
    }
  }
  updatePowder(x, y, sim);
}

export const DIRT = register({
  id: 43,
  name: 'Dirt',
  phase: Phase.Powder,
  color: rgb(112, 82, 52),
  density: 5,
  category: '가루',
  thermal: { conductivity: 0.3 },
  update: updateDirt,
});
