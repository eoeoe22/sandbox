import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { isFlame } from './combustion';
import { WATER } from './water';
import { SMOKE } from './smoke';

// Slime (슬라임) — a thick, gooey green semi-fluid. It oozes rather than flows,
// slumping only on a fraction of ticks (like Honey/Mud), so a dropped blob holds
// a wobbling mound before it slowly spreads. Its gimmick is that it *feeds*: an
// adjacent Water cell is absorbed and turned into more Slime, so a blob dropped in
// a puddle swells as it drinks the water up — 통과 유체를 흡수해 몸집을 키운다.
//
// Fire is its bane: an open flame beside it (or enough heat) melts the goo, and it
// boils away as a puff of Smoke. So the way to deal with a spreading slime is to
// burn it back.
const FLOW_CHANCE = 0.14; // very viscous — holds a mound, oozes slowly
const ABSORB_CHANCE = 0.05; // drinks an adjacent water cell into more slime
const MELT_CHANCE = 0.3; // per-tick chance a flame beside it melts it
const MELT_TEMP = 130; // …or enough ambient heat does the same

function updateSlime(x: number, y: number, sim: SimContext): void {
  // Melt away in heat: past the melt point, or beside an open flame.
  if (sim.getTemp(x, y) >= MELT_TEMP) {
    sim.set(x, y, SMOKE.id);
    return;
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isFlame(sim.get(nx, ny)) && sim.chance(MELT_CHANCE)) {
      sim.set(x, y, SMOKE.id);
      return;
    }
  }

  // Feed: absorb an adjacent Water cell, growing the blob by one cell.
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(ABSORB_CHANCE)) {
      sim.spawn(nx, ny, SLIME.id);
      return;
    }
  }

  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const SLIME = register({
  id: 91,
  name: 'Slime',
  phase: Phase.Liquid,
  color: rgb(96, 190, 88),
  // Denser than water so a blob sinks and oozes along the floor of a pool while
  // it drinks the water around it.
  density: 4,
  category: '생명',
  thermal: { conductivity: 0.2 },
  update: updateSlime,
});
