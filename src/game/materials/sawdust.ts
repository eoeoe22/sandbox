import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Powder fuel: falls and piles, but light (density < water) so a scatter of it
// floats on water rather than sinking. The *second-fastest* fuel — behind
// Gasoline, ahead of Wood — because loose, airy shavings catch far more readily
// than the solid timber they were milled from: a high ignite chance and a
// modest autoignition point. Just burns; never detonates. See combustion.ts for
// the shared model.
const SPEC: Combustible = { burnChance: 0.28, autoIgniteTemp: 320 };

function updateSawdust(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  updatePowder(x, y, sim);
}

export const SAWDUST = register({
  id: 27,
  name: 'Sawdust',
  phase: Phase.Powder,
  color: rgb(196, 160, 105),
  density: 2,
  thermal: { conductivity: 0.2 },
  update: updateSawdust,
});
