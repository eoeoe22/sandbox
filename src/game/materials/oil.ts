import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Liquid fuel: flows/pools like water but lighter (density < 3), so it floats on
// water — while heavier than Gasoline, so gasoline in turn floats on it. The
// *second-fastest*-burning fuel, behind only Gasoline: crude oil vaporizes and
// catches readily, so it's tuned closer to its refined cousin than to the
// solid fuels (Coal, Wood) it used to smoulder alongside. Just burns; never
// detonates. See combustion.ts for the shared model.
const SPEC: Combustible = { burnChance: 0.1, autoIgniteTemp: 430 };

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
  combustible: true,
  category: '불·열',
  thermal: { conductivity: 0.2 },
  update: updateOil,
});
