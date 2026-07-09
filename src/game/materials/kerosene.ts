import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { refluxBoil, REFLUX_KEROSENE } from './petroleumdistill';

// A middle distillate of crude oil (see oil.ts): the cut that condenses out of
// petroleum vapor between Gasoline and Diesel. Lighter than Crude Oil (2.6) and
// heavier than Gasoline (2.2), so once condensed it settles into its own layer
// — floating on the crude, under the gasoline. Burns like the other liquid
// fuels via the shared surface-front model, a touch slower than Gasoline. See
// combustion.ts. Stays properly flammable (a flame touching it ignites it), and
// re-boils (refluxes) at its own mid boiling point — its boil point (260) plus
// the reflux superheat cap (60) sits below autoignition, so a flameless still
// refluxes it away rather than igniting it (see petroleumdistill.ts / oil.ts).
const SPEC: Combustible = { burnChance: 0.08, autoIgniteTemp: 420 };
const BOIL_TEMP = 260;

function updateKerosene(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  if (refluxBoil(x, y, sim, BOIL_TEMP, REFLUX_KEROSENE)) return;
  updateLiquid(x, y, sim);
}

export const KEROSENE = register({
  id: 60,
  name: 'Kerosene',
  phase: Phase.Liquid,
  color: rgb(232, 222, 150),
  density: 2.35,
  combustible: true,
  category: '석유',
  thermal: { conductivity: 0.2 },
  update: updateKerosene,
});
