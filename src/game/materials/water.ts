import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';
import { ICE } from './ice';
import { SNOW } from './snow';

// Liquid: falls and spreads sideways to find its level (updateLiquid). Lighter
// than sand, so sand displaces it. Water also flashes to Steam once the
// heat-conduction system pushes its temperature to the boiling point — so
// water poured onto lava (directly, or across the Stone crust that forms
// between them) heats up and boils off, which is what carries heat away from
// the lava and lets it solidify.
//
// The cold end mirrors the hot end: once the heat system pulls a cell below
// freezing it turns to Snow (a light powder), and once it's chilled well past
// that it freezes solid into Ice. Both are driven purely by conduction — a cold
// sink (the cool brush, or an existing block of Ice/Snow) has to draw the heat
// out first, exactly the way boiling needs a heat source. Left alone in air
// (which conducts nothing) water just sits at ambient, so it never spontaneously
// freezes — the symmetric counterpart to isolated lava never solidifying.
export const WATER_BOIL_TEMP = 100;
// Water at/below this chills into Snow; well below it (past the deep-freeze
// point) it freezes straight to solid Ice instead. The wide gap up to
// FROST_MELT_TEMP is deliberate hysteresis so a cell hovering right at freezing
// doesn't flip-flop between liquid and solid every tick.
export const WATER_FREEZE_TEMP = 0;
export const WATER_DEEP_FREEZE_TEMP = -12;
/** Ice/Snow warmed to this thaw back into Water (shared by ice.ts/snow.ts). */
export const FROST_MELT_TEMP = 2;

function updateWater(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  if (t >= WATER_BOIL_TEMP) {
    // Boil in place: the resulting Steam keeps the (hot) temperature, then
    // rises and cools/condenses on its own (see steam.ts).
    sim.set(x, y, STEAM.id);
    return;
  }
  if (t <= WATER_DEEP_FREEZE_TEMP) {
    // Deeply chilled → solid Ice. In-place `set` keeps the (very cold)
    // temperature so the fresh Ice reads as frozen instead of instantly thawing.
    sim.set(x, y, ICE.id);
    return;
  }
  if (t <= WATER_FREEZE_TEMP) {
    // Merely below freezing → light Snow (flutters down as a powder).
    sim.set(x, y, SNOW.id);
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
