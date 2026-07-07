import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';

// Powder: falls and piles like sand (inherits updatePowder), but a Water
// neighbor has a chance to dissolve it each tick — self vanishes, the water
// cell becomes Saltwater. ~4%/tick ≈ dissolves within roughly a second of
// contact at 60Hz.
//
// Density is deliberately > Saltwater (4): Salt only dissolves in *fresh* Water,
// so a grain that reaches already-salted water (treated as saturated) should
// sink through and settle on the bottom rather than float on the surface. Equal
// densities left it stranded on top — the density sort needs a strict
// difference to displace (see SimContext.tryMove).
const DISSOLVE_CHANCE = 0.04;

// One grain is concentrated enough to salinate a whole connected pocket of
// Water, not just the single cell it touches — a pinch of salt salts a whole
// glass, not one drop. SALTWATER's boiling (saltwater.ts) deposits Salt back
// at this same rate via a shared running total, so the round trip is
// symmetric: it takes roughly this many evaporated cells to re-form one grain.
export const SALT_WATER_RATIO = 8;

function updateSalt(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(DISSOLVE_CHANCE)) {
      const converted = salinatePocket(nx, ny, sim);
      // A pocket smaller than SALT_WATER_RATIO can't use up the whole grain —
      // credit the unused portion to the same running total that boiling
      // (saltwater.ts) draws from, rather than silently destroying it, so a
      // grain dissolving into a too-small puddle never leaks salt mass. If
      // that pushes the total back up to a full grain, it simply doesn't
      // finish leaving this cell.
      sim.saltDebt += (SALT_WATER_RATIO - converted) / SALT_WATER_RATIO;
      if (sim.saltDebt >= 1) {
        sim.saltDebt -= 1;
        sim.set(x, y, SALT.id);
      } else {
        sim.set(x, y, EMPTY);
      }
      return;
    }
  }
  updatePowder(x, y, sim);
}

// Bounded breadth-first flood fill over connected fresh Water, converting up
// to SALT_WATER_RATIO cells to Saltwater in one shot. Stops early if the
// connected pocket is smaller than that — a grain can't salinate water that
// isn't there — and returns however many cells it actually converted.
function salinatePocket(startX: number, startY: number, sim: SimContext): number {
  const queue: Array<[number, number]> = [[startX, startY]];
  const visited = new Set<string>([`${startX},${startY}`]);
  let converted = 0;
  while (queue.length > 0 && converted < SALT_WATER_RATIO) {
    const [x, y] = queue.shift()!;
    sim.spawn(x, y, SALTWATER.id);
    converted++;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key) || !sim.inBounds(nx, ny)) continue;
      visited.add(key);
      if (sim.get(nx, ny) === WATER.id) queue.push([nx, ny]);
    }
  }
  return converted;
}

export const SALT = register({
  id: 7,
  name: 'Salt',
  phase: Phase.Powder,
  color: rgb(235, 235, 228),
  density: 5,
  thermal: { conductivity: 0.35 },
  update: updateSalt,
});
