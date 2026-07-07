import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';

// Liquid: falls and spreads sideways to find its level (updateLiquid). Lighter
// than sand, so sand displaces it. Water also flashes to Steam once the
// heat-conduction system pushes its temperature to the boiling point — so
// water poured onto lava (directly, or across the Stone crust that forms
// between them) heats up and boils off, which is what carries heat away from
// the lava and lets it solidify.
export const WATER_BOIL_TEMP = 100;

function updateWater(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= WATER_BOIL_TEMP) {
    // Boil in place: the resulting Steam keeps the (hot) temperature, then
    // rises and cools/condenses on its own (see steam.ts).
    sim.set(x, y, STEAM.id);
    return;
  }
  updateLiquid(x, y, sim);
}

export const WATER = register({
  id: 3,
  name: 'Water',
  phase: Phase.Liquid,
  color: rgb(60, 130, 210),
  density: 3,
  thermal: { conductivity: 0.6 },
  update: updateWater,
});
