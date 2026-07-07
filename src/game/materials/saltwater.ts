import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';
import { WATER_BOIL_TEMP } from './water';

// Liquid: denser than fresh water (3) so it sinks below it, still far lighter
// than sand (5). Flows/spreads like water and, like water, boils to Steam once
// the heat system drives it to the boiling point (the dissolved salt is not
// tracked, so it simply leaves with the steam — a deliberate simplification).
function updateSaltwater(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= WATER_BOIL_TEMP) {
    sim.set(x, y, STEAM.id);
    return;
  }
  updateLiquid(x, y, sim);
}

export const SALTWATER = register({
  id: 5,
  name: 'Saltwater',
  phase: Phase.Liquid,
  color: rgb(84, 140, 175),
  density: 4,
  thermal: { conductivity: 0.55 },
  update: updateSaltwater,
});
