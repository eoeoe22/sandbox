import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';
import { SUGAR, SUGAR_WATER_RATIO } from './sugar';
import { WATER_BOIL_TEMP } from './water';
import { YEAST } from './yeast';
import { ALCOHOL } from './alcohol';
import { CO2 } from './co2';

// Sugar Water (설탕물) — fresh water with sugar dissolved in it (drop Sugar into
// Water and it melts in — see sugar.ts). The sweet counterpart of Saltwater, and
// built the same way, with two deliberate differences from brine:
//
//  • It's NOT an electrolyte. Dissolved sugar is a neutral molecule, not ions, so
//    unlike Saltwater it carries no current — a Spark dies at its surface. (That's
//    why it declares no `conductive` and needs no spark-refractory bookkeeping.)
//  • It ferments. Sitting against a Yeast culture, sugar water is exactly what
//    yeast eats: the cell turns to Alcohol and burps a bubble of CO₂ (C₆H₁₂O₆ →
//    alcohol + CO₂), with the yeast the persistent catalyst (left untouched, it
//    keeps working). This is why the sugar→sugar-water→booze pipeline still works
//    even though the sugar dissolves before the yeast can reach a solid grain —
//    the yeast just ferments the sugar water instead.
//
// Like water it flows, levels, and boils to Steam once the heat system drives it
// to the boiling point — and, like Saltwater depositing Salt, a boiling cell hands
// its sugar back to the world through a shared running total (SimContext.sugarDebt):
// only once SUGAR_WATER_RATIO cells' worth has evaporated does one Sugar grain
// actually crystallise, so the round trip's volumes stay matched and no sugar mass
// is lost. The departing water is always represented by a Steam cell spawned in a
// free neighbour first; if boxed in with nowhere for the steam to go, the cell
// stays Sugar Water and retries next tick instead of evaporating anyway.
const FERMENT_CHANCE = 0.12; // per adjacent-yeast contact per tick (matches yeast.ts)
// Fermentation is biological, so it stops when things get hot — set a little
// below the DIE_TEMP (60°) at which the yeast itself dies (see yeast.ts).
const FERMENT_MAX_TEMP = 55;

/** Burp a CO₂ bubble into a free neighbour, preferring straight "up" (against
 *  gravity) so it rises off the liquid; silently skipped if the cell is boxed in. */
function ventCO2(x: number, y: number, sim: SimContext): void {
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  if (sim.inBounds(ux, uy) && sim.isEmpty(ux, uy)) {
    sim.spawn(ux, uy, CO2.id);
    return;
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
      sim.spawn(nx, ny, CO2.id);
      return;
    }
  }
}

function updateSugarWater(x: number, y: number, sim: SimContext): void {
  // Ferment against an adjacent Yeast culture: this cell (sugar + water in one)
  // becomes Alcohol and vents a CO₂ bubble. The yeast is untouched — the persistent
  // culture keeps converting as long as sugar water reaches it. Gated below the
  // heat at which yeast dies, so hot/boiling sugar water doesn't ferment.
  if (sim.getTemp(x, y) < FERMENT_MAX_TEMP) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      if (sim.get(nx, ny) === YEAST.id && sim.chance(FERMENT_CHANCE)) {
        ventCO2(x, y, sim); // burp a rising CO₂ bubble (skipped if boxed in)
        sim.set(x, y, ALCOHOL.id); // the sugar water becomes spirit
        return;
      }
    }
  }

  if (sim.getTemp(x, y) >= WATER_BOIL_TEMP) {
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
        sim.spawn(nx, ny, STEAM.id);
        sim.sugarDebt += 1 / SUGAR_WATER_RATIO;
        if (sim.sugarDebt >= 1) {
          sim.sugarDebt -= 1;
          sim.set(x, y, SUGAR.id);
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

export const SUGAR_WATER = register({
  id: 104,
  name: 'Sugar Water',
  phase: Phase.Liquid,
  // A pale, warm sugary tint — clearly not the blue of Water/Saltwater.
  color: rgb(208, 198, 150),
  // Denser than fresh Water (3) so a sweet layer sinks beneath it, still lighter
  // than a Sugar grain (5) so undissolved sugar sinks through it to the bottom.
  density: 3.6,
  category: '액체',
  thermal: { conductivity: 0.5 },
  // A mild freezing-point depression (less than brine's −18): sets a little below
  // fresh water. Freezes in place (frosted) rather than crystallizing to a solid.
  freeze: { temp: -6 },
  update: updateSugarWater,
});
