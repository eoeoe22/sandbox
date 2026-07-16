import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Powder fuel: falls and piles, but light (density < water) so a scatter of it
// floats on water rather than sinking. The *second-fastest* fuel — behind
// Gasoline, ahead of Wood — because loose, airy shavings catch far more readily
// than the solid timber they were milled from: a higher ignite chance than the
// solids and a modest autoignition point, though it still burns as a creeping
// front rather than a flash. A consumed cell has a chance to leave a fleck of
// Ash behind (see combustion.ts) instead of just puffing into Fire. Just burns;
// never detonates. See combustion.ts for the shared model.
const SPEC: Combustible = { burnChance: 0.08, autoIgniteTemp: 450, ashChance: 0.15 };

function updateSawdust(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  updatePowder(x, y, sim);
}

export const SAWDUST = register({
  id: 27,
  name: 'Sawdust',
  phase: Phase.Powder,
  color: rgb(184, 146, 92),
  density: 2,
  combustible: true,
  category: '불·열',
  thermal: { conductivity: 0.2 },
  update: updateSawdust,
});
