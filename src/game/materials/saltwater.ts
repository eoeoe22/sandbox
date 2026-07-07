import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';
import { SALT } from './salt';
import { WATER_BOIL_TEMP } from './water';

// Liquid: denser than fresh water (3) so it sinks below it, still lighter than
// the powders (Salt/Sand at 5), so undissolved Salt grains sink through it and
// settle on the bottom instead of floating. Flows/spreads like water and, like
// water, boils to Steam once the heat system drives it to the boiling point.
//
// The dissolved salt isn't tracked as a separate quantity — each Saltwater
// cell instead deterministically *becomes* Salt on boiling (the water leaves,
// the salt can't), while the departing water is represented by spawning a
// Steam cell in a free neighbor. This keeps salt mass exactly conserved
// (every evaporated cell yields exactly one Salt grain) instead of it being
// randomly destroyed along with the steam. If every neighbor is occupied
// there's nowhere for the steam to go, so the cell stays Saltwater and tries
// again next tick rather than losing the salt anyway.
function updateSaltwater(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= WATER_BOIL_TEMP) {
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
        sim.spawn(nx, ny, STEAM.id);
        sim.set(x, y, SALT.id);
        return;
      }
    }
    updateLiquid(x, y, sim);
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
