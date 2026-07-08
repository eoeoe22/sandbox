import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Fuse — a slow-burning cord for timed and remote detonations. It's a static
// solid fuel that burns along its own length one cell at a time (via the shared
// surface-front combustion model), giving off Fire that lights whatever the
// cord leads to. Because it's the *slowest* combustible here, a line of fuse is
// a visible countdown: light one end and watch the ember crawl toward the TNT.
// Lay it between a spark source and a charge and you've built a detonator with a
// delay you can tune by how long you draw the cord.
const SPEC: Combustible = { burnChance: 0.06, autoIgniteTemp: 260 };

function updateFuse(x: number, y: number, sim: SimContext): void {
  // Solid: combustion is its only behavior — if it doesn't burn this tick it
  // simply stays put (mirrors Coal/Wood).
  tryBurn(x, y, sim, SPEC);
}

export const FUSE = register({
  id: 53,
  name: 'Fuse',
  phase: Phase.Solid,
  color: rgb(112, 92, 64),
  density: 1000,
  combustible: true,
  category: '폭발',
  thermal: { conductivity: 0.25 },
  update: updateFuse,
});
