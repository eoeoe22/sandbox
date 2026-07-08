import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { DIRT } from './dirt';

// Mud — saturated Dirt (see dirt.ts). A thick, sluggish liquid: it slumps and
// oozes only on a fraction of ticks, so it holds a soft mound rather than
// leveling out like water. Away from any water it slowly dries back into solid
// Dirt, so mud is the transient wet state between dry dirt and a puddle. Denser
// than water (5.5), so a mud layer sinks beneath standing water.
const FLOW_CHANCE = 0.2;
const DRY_CHANCE = 0.01;

function updateMud(x: number, y: number, sim: SimContext): void {
  let wet = false;
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id) {
      wet = true;
      break;
    }
  }

  if (!wet && sim.chance(DRY_CHANCE)) {
    // Drained and drying: firm back up into Dirt.
    sim.set(x, y, DIRT.id);
    return;
  }

  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const MUD = register({
  id: 44,
  name: 'Mud',
  phase: Phase.Liquid,
  color: rgb(84, 60, 40),
  density: 5.5,
  category: '액체',
  thermal: { conductivity: 0.35 },
  update: updateMud,
});
