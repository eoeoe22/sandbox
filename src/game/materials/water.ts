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
// lit fuel is pinned near 800°, far above its ~400–450° autoignition points and
// far above the 150–380° range it merely distills in while unlit), so water
// touching an oil fire can tell it apart from water just sitting under warm,
// unlit crude — see Material.petroleum / combustion.ts.
const PETROLEUM_BURN_TEMP = 500;

// How low a water cell touching a burning oil layer is held instead of
// flashing to Steam. Just suppressing the boil isn't enough on its own: left
// free to keep climbing, the interface cell would itself become an
// ever-hotter secondary heat source that conducts the fire's heat on down into
// the water beneath it, eventually boiling that away too even though it never
// touches the flame. Capping the interface here keeps the whole body below
// boiling instead, which is what makes an oil fire on water self-sustaining
// rather than slowly steaming away its own base (유류화재 재현). combustion.ts's
// burnStep applies the same cap from the fuel's side as a second line of
// defense against the same runaway.
export const WATER_SURFACE_CAP = 95;

// How far a water column looks "up" (against gravity, toward the surface a
// slick would float on) for a burning petroleum layer above it. Just checking
// the immediate interface cell isn't enough: heat diffusion runs once for the
// *whole* grid before any material update this tick, so the interface — reset
// to WATER_SURFACE_CAP at the *end* of the previous tick — still gets diffused
// against the fuel's 800° this tick same as any other neighbor pair, and can
// overshoot well past boiling *before* its own turn clamps it back down. The
// next cell down samples that transient overshoot during the same diffusion
// pass, so a little extra heat leaks past the interface every single tick —
// too little to boil the interface itself (which self-corrects every turn) but
// enough to slowly ratchet the water beneath it toward boiling over time.
// Shielding the whole column instead of only the top cell means every cell in
// the path — not just the one actually touching the fuel — refuses to boil,
// so that creeping leak can never accumulate into an evaporating pool. Set
// past the tallest sandbox grid (config.GRID_H) so a realistic pool is always
// shielded end to end; the scan only ever runs on a cell that's actually about
// to boil, so the depth costs nothing on the (overwhelming) common case.
const SHIELD_SCAN_DEPTH = 256;

/** True if a *burning* petroleum layer (Crude Oil / Gasoline / Kerosene /
 *  Diesel) is touching this cell, or floats somewhere above it in the same
 *  liquid column — used by Water/Saltwater/Sugar Water to suppress boiling so
 *  an oil fire on water keeps burning on the surface instead of steaming away
 *  the water that's holding it up (see SHIELD_SCAN_DEPTH for why the column
 *  scan is needed on top of the immediate-neighbor check). */
export function burningPetroleumAdjacent(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === 0) continue;
    if (getMaterial(nid).petroleum === true && sim.getTemp(nx, ny) >= PETROLEUM_BURN_TEMP) return true;
  }
  let cx = x - sim.gravityX;
  let cy = y - sim.gravityY;
  for (let i = 0; i < SHIELD_SCAN_DEPTH && sim.inBounds(cx, cy); i++) {
    const cid = sim.get(cx, cy);
    if (cid === 0) break;
    const mat = getMaterial(cid);
    if (mat.petroleum === true && sim.getTemp(cx, cy) >= PETROLEUM_BURN_TEMP) return true;
    if (mat.phase !== Phase.Liquid) break; // hit a solid/gas — the slick's chain stops here
    cx -= sim.gravityX;
    cy -= sim.gravityY;
  }
  return false;
}

function updateWater(x: number, y: number, sim: SimContext): void {
  // Conductor bookkeeping: tick down the post-spark refractory stamped in `aux`
  // so this cell can carry current again (mirrors Iron/Mercury — see spark.ts).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  const t = sim.getTemp(x, y);
  if (t >= WATER_BOIL_TEMP) {
    if (burningPetroleumAdjacent(x, y, sim)) {
      sim.setTemp(x, y, WATER_SURFACE_CAP);
    } else {
      // Boil in place: the resulting Steam keeps the (hot) temperature, then
      // rises and cools/condenses on its own (see steam.ts).
      sim.set(x, y, STEAM.id);
      return;
    }
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
  // A little surface tension (표면장력): stray droplets round up and thin trickles
  // bead rather than smearing into a one-cell film, without holding a full pool
  // back from finding its level (only poorly-connected edge cells cohere).
  surfaceTension: 0.12,
  thermal: { conductivity: 0.6 },
  update: updateWater,
});
