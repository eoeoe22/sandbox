import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { MUD } from './mud';
import { STONE } from './stone';
import { DIRT } from './dirt';
import { WOOD } from './wood';
import { CONCRETE } from './concrete';

// Moss — a creeping green growth that overtakes damp surfaces. Like Vine it's a
// static solid with a custom growth rule, but instead of climbing it spreads
// *across* neighboring surfaces: as long as moisture (Water, Saltwater, or Mud)
// is somewhere in its 8-neighborhood, it slowly converts an adjacent Stone,
// Dirt, Wood, or Concrete cell into more Moss. The surface stays solid — it's
// just greened over — but it also becomes flammable, so a mossy wall that dries
// out is now something Fire can run across. Growth naturally halts where it's
// dry, so moss forms bands along waterlines rather than swallowing everything.
const SPREAD_CHANCE = 0.03;

function isColonizable(id: number): boolean {
  return id === STONE.id || id === DIRT.id || id === WOOD.id || id === CONCRETE.id;
}

function updateMoss(x: number, y: number, sim: SimContext): void {
  let damp = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id || nid === MUD.id) {
      damp = true;
      break;
    }
  }
  if (!damp) return; // dry moss just sits there (still a flammable fuel)

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isColonizable(sim.get(nx, ny)) && sim.chance(SPREAD_CHANCE)) {
      // spawn marks the new cell moved, so it can't be re-processed this tick —
      // capping growth to one cell per tick (the same guard Vine relies on).
      sim.spawn(nx, ny, MOSS.id);
      return;
    }
  }
}

export const MOSS = register({
  id: 47,
  name: 'Moss',
  phase: Phase.Solid,
  color: rgb(74, 122, 52),
  density: 1000,
  flammable: true,
  category: '생명',
  thermal: { conductivity: 0.3 },
  update: updateMoss,
});
