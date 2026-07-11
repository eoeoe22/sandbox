import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { EMPTY } from '../engine/types';
import { STEAM } from './steam';
import { SALT, SALT_WATER_RATIO } from './salt';
import { WATER_BOIL_TEMP } from './water';

// Liquid: denser than fresh water (3) so it sinks below it, still lighter than
// the powders (Salt/Sand at 5), so undissolved Salt grains sink through it and
// settle on the bottom instead of floating. Flows/spreads like water and, like
// water, boils to Steam once the heat system drives it to the boiling point.
//
// The dissolved salt isn't tracked as a separate quantity, and one grain
// salinates SALT_WATER_RATIO cells' worth of Water (salt.ts), so boiling can't
// deposit a full grain back per evaporated cell — that would be far too much
// residue. Instead each boiling cell adds 1/SALT_WATER_RATIO to a shared
// running total (SimContext.saltDebt); only once that total reaches a whole
// grain does a Salt cell actually crystallize, elsewhere it evaporates clean.
// This keeps the round trip's volumes matched without needing a per-cell
// concentration field, and salt mass still can't be lost: the departing water
// is always represented by spawning a Steam cell in a free neighbor first —
// if every neighbor is occupied there's nowhere for the steam to go, so the
// cell stays Saltwater and retries next tick instead of evaporating anyway.
function updateSaltwater(x: number, y: number, sim: SimContext): void {
  // Conductor bookkeeping: tick down the post-spark refractory stamped in `aux`
  // so this cell can carry current again (mirrors Iron/Mercury — see spark.ts).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (sim.getTemp(x, y) >= WATER_BOIL_TEMP) {
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
        sim.spawn(nx, ny, STEAM.id);
        sim.saltDebt += 1 / SALT_WATER_RATIO;
        if (sim.saltDebt >= 1) {
          sim.saltDebt -= 1;
          sim.set(x, y, SALT.id);
        } else {
          sim.set(x, y, EMPTY);
        }
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
  // A weak electrolyte: a Spark travels through it but loses strength slowly, so
  // a pulse carries a fair distance through brine before fading (see spark.ts).
  conductive: true,
  thermal: { conductivity: 0.55 },
  // Freezing-point depression: brine sets a good deal colder than fresh water.
  // Freezes in place (frosted) rather than crystallizing to a separate solid.
  freeze: { temp: -18 },
  update: updateSaltwater,
});
