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

function updateSalt(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(DISSOLVE_CHANCE)) {
      sim.set(x, y, EMPTY);
      sim.spawn(nx, ny, SALTWATER.id);
      return;
    }
  }
  updatePowder(x, y, sim);
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
