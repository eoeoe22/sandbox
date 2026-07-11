import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
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

// A petroleum neighbour at/above this temperature is a *burning* oil layer (a
// lit fuel is pinned near 800°, far above its 150–380° distillation range), so
// the water beneath an oil fire spots it and refuses to boil — an oil fire
// floating on water doesn't flash the water below to Steam (see the comment on
// suppressBoil). Below this it's just warm/distilling petroleum and water boils
// normally.
const PETROLEUM_BURN_TEMP = 500;

/** True if a *burning* petroleum layer (Crude Oil / Gasoline / Kerosene /
 *  Diesel) is touching this cell — used to suppress the water's boiling so an
 *  oil fire on water keeps burning on the surface instead of steaming away the
 *  water that's holding it up (유류화재 재현). */
function burningPetroleumAdjacent(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === 0) continue;
    if (getMaterial(nid).petroleum && sim.getTemp(nx, ny) >= PETROLEUM_BURN_TEMP) return true;
  }
  return false;
}

function updateWater(x: number, y: number, sim: SimContext): void {
  // Conductor bookkeeping: tick down the post-spark refractory stamped in `aux`
  // so this cell can carry current again (mirrors Iron/Mercury — see spark.ts).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  const t = sim.getTemp(x, y);
  if (t >= WATER_BOIL_TEMP && !burningPetroleumAdjacent(x, y, sim)) {
    // Boil in place: the resulting Steam keeps the (hot) temperature, then
    // rises and cools/condenses on its own (see steam.ts). Suppressed while a
    // burning oil slick floats on top, so an oil fire on water doesn't rapidly
    // boil off the water beneath it.
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
  // Fresh water conducts electricity but poorly: a Spark loses strength fast in
  // it, so a pulse only travels a few cells before dying (see spark.ts). Its own
  // cold-side change (Snow/Ice) is richer than the generic `freeze`, so it keeps
  // that instead of declaring one.
  conductive: true,
  thermal: { conductivity: 0.6 },
  update: updateWater,
});
