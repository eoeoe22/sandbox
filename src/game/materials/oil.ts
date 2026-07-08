import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Liquid fuel: flows/pools like water but lighter (density < 3), so it floats on
// water — while heavier than Gasoline, so gasoline in turn floats on it. One of
// the two *slowest*-burning fuels (paired with Coal): a low ignite chance makes
// it smoulder, creeping across the surface of a pool rather than flashing over,
// and a high autoignition point means it needs real sustained heat to catch on
// its own. Just burns; never detonates. See combustion.ts for the shared model.
const SPEC: Combustible = { burnChance: 0.035, autoIgniteTemp: 560 };

function updateOil(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  updateLiquid(x, y, sim);
}

export const OIL = register({
  id: 23,
  name: 'Crude Oil',
  phase: Phase.Liquid,
  color: rgb(48, 40, 34),
  density: 2.6,
  thermal: { conductivity: 0.2 },
  update: updateOil,
});
