import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder, tryBuoyantRise } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Powder fuel: falls and piles like ordinary Sand, but light (density < water)
// so a scatter of it floats on water rather than sinking — and "가벼운 가루":
// if it ends up submerged (water poured over a pile, a pool closing back over
// it), it actively bubbles back up through the water instead of sitting
// pinned under it like solid ground (tryBuoyantRise, shared with Ash). The
// *second-fastest* fuel — behind Gasoline, ahead of Wood — because loose, airy
// shavings catch far more readily than the solid timber they were milled from:
// a higher ignite chance than the solids and a modest autoignition point,
// though it still burns as a creeping front rather than a flash. A consumed
// cell has a chance to leave a fleck of Ash behind (see combustion.ts) instead
// of just puffing into Fire. Just burns; never detonates. See combustion.ts for
// the shared model.
const SPEC: Combustible = { burnChance: 0.08, autoIgniteTemp: 450, ashChance: 0.15 };

function updateSawdust(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  if (tryBuoyantRise(x, y, sim)) return;
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
