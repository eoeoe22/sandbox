import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { ACID } from './acid';
import { ACID_VAPOR } from './acidvapor';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { DIRT } from './dirt';
import { SAND } from './sand';
import { MUD } from './mud';

// Virus — a plague that converts what it touches into more of itself, then
// spreads from there. It infects soft, "organic" matter — anything flammable or
// combustible (plants, wood, the fuels…) plus water and loose earth — one cell
// per tick via `spawn` (so, like Vine, it can't fill a region in a single
// frame). It leaves the hard world alone: Stone, metals, Glass, Concrete, Wall,
// the gases, and the explosives are all immune, so a virus outbreak is contained
// by a stone or glass wall.
//
// The cure is heat and chemistry: it's tagged `flammable`, so Fire and Lava burn
// it out; and an adjacent Acid/Acid Vapor cell, or being heated to boiling,
// kills a cell outright. So the counters are exactly what you'd reach for —
// torch it, douse it in acid, or steam it.
const INFECT_CHANCE = 0.05;
const CURE_TEMP = 100;

function isInfectable(id: number): boolean {
  if (id === EMPTY || id === VIRUS.id) return false;
  if (id === WATER.id || id === SALTWATER.id || id === DIRT.id || id === SAND.id || id === MUD.id) {
    return true;
  }
  const m = getMaterial(id);
  return !!(m.flammable || m.combustible);
}

function updateVirus(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= CURE_TEMP) {
    sim.set(x, y, EMPTY); // boiled/burned away
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === ACID.id || nid === ACID_VAPOR.id) {
      sim.set(x, y, EMPTY); // dissolved by acid
      return;
    }
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isInfectable(sim.get(nx, ny)) && sim.chance(INFECT_CHANCE)) {
      sim.spawn(nx, ny, VIRUS.id);
      return;
    }
  }
}

export const VIRUS = register({
  id: 48,
  name: 'Virus',
  phase: Phase.Solid,
  color: rgb(158, 66, 176),
  density: 1000,
  flammable: true,
  category: '생명',
  thermal: { conductivity: 0.3 },
  update: updateVirus,
});
