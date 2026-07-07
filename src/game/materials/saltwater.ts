import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';
import { SALT } from './salt';
import { WATER_BOIL_TEMP } from './water';

// Liquid: denser than fresh water (3) so it sinks below it, still lighter than
// the powders (Salt/Sand at 5), so undissolved Salt grains sink through it and
// settle on the bottom instead of floating. Flows/spreads like water and, like
// water, boils to Steam once the heat system drives it to the boiling point.
// The dissolved salt isn't tracked cell-by-cell, so each boiling tick instead
// rolls a small chance to leave a Salt grain behind (crystallizing out) rather
// than turning to Steam — approximating real evaporation concentrating the
// salt until it precipitates.
const SALT_LEFT_BEHIND_CHANCE = 0.08;

function updateSaltwater(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= WATER_BOIL_TEMP) {
    sim.set(x, y, sim.chance(SALT_LEFT_BEHIND_CHANCE) ? SALT.id : STEAM.id);
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
