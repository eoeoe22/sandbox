import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Powder fuel: falls and piles like sand, denser than water (5) so a lump sinks
// rather than floating. One of the two *slowest*-burning fuels (paired with
// Crude Oil): a low ignite chance makes a heap smoulder for a long time instead
// of flashing over, and a high autoignition point resists catching from stray
// heat. Just burns; never detonates. See combustion.ts for the shared model.
const SPEC: Combustible = { burnChance: 0.06, autoIgniteTemp: 580 };

function updateCoal(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  updatePowder(x, y, sim);
}

export const COAL = register({
  id: 25,
  name: 'Coal',
  phase: Phase.Powder,
  color: rgb(26, 24, 30),
  density: 5,
  thermal: { conductivity: 0.2 },
  update: updateCoal,
});
