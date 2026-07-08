import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { CO2 } from './co2';
import { FIRE } from './fire';
import { BLUE_FLAME } from './blueflame';

// Liquid Nitrogen — the cryogenic mirror of Lava: placed at a brutal -196° and,
// like isolated Lava never cooling, an isolated pool never warms (air conducts
// no heat), so it holds its chill until something warmer bridges heat into it.
// It's a *cold sink* the way Lava/Fire are heat sources: its cold conducts into
// neighbors and, via the ordinary heat system, freezes Water into Snow and Ice
// and flash-cools whatever it touches. Reaching anything hot, it also instantly
// snuffs open flame — the fire's heat flash-boils the LN₂ into a puff of cold
// CO₂ fog. Warmed past its boiling point it likewise boils off into CO₂.
//
// Lighter than water (density 2.5), so it floats on top of a pool it's busy
// freezing from above.
const LN2_BOIL_TEMP = -100;

function updateLiquidNitrogen(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= LN2_BOIL_TEMP) {
    // Warmed enough to boil off. In-place `set` keeps the (still cold)
    // temperature, so the fresh CO₂ starts out as a chilly fog.
    sim.set(x, y, CO2.id);
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === FIRE.id || nid === BLUE_FLAME.id) {
      // Snuff the flame and flash-boil this cell into cold fog absorbing its heat.
      sim.set(nx, ny, EMPTY);
      sim.set(x, y, CO2.id);
      return;
    }
  }

  updateLiquid(x, y, sim);
}

export const LIQUID_NITROGEN = register({
  id: 33,
  name: 'Liquid N₂',
  phase: Phase.Liquid,
  color: rgb(200, 232, 240),
  density: 2.5,
  category: '냉각',
  // Conducts its cold readily, so it acts as a real cold sink like Water/Ice.
  thermal: { init: -196, conductivity: 0.6 },
  update: updateLiquidNitrogen,
});
