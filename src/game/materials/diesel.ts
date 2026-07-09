import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { refluxBoil, REFLUX_DIESEL } from './petroleumdistill';

// The heaviest of the liquid fuel cuts distilled from crude oil (see oil.ts):
// condenses out of petroleum vapor at the hottest band, just before the residue
// turns to Asphalt. Denser than Kerosene and Gasoline but still lighter than
// Crude Oil (2.6), so it layers directly on top of the crude, beneath the
// lighter cuts. The slowest-catching of the liquid fuels — an amber, oily fuel.
// See combustion.ts. Re-boils (refluxes) at the highest cut boiling point and
// ignites by flame contact only, like the other cuts (see petroleumdistill.ts).
const SPEC: Combustible = { burnChance: 0.06, autoIgniteTemp: 780 };
const BOIL_TEMP = 320;

function updateDiesel(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  if (refluxBoil(x, y, sim, BOIL_TEMP, REFLUX_DIESEL)) return;
  updateLiquid(x, y, sim);
}

export const DIESEL = register({
  id: 61,
  name: 'Diesel',
  phase: Phase.Liquid,
  color: rgb(150, 120, 70),
  density: 2.45,
  combustible: true,
  category: '석유',
  thermal: { conductivity: 0.2 },
  update: updateDiesel,
});
