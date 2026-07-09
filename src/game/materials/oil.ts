import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { PETROLEUM_GAS } from './petroleumgas';
import { PETROLEUM_VAPOR } from './petroleumvapor';
import { ASPHALT } from './asphalt';

// Liquid fuel: flows/pools like water but lighter (density < 3), so it floats on
// water — while heavier than Gasoline, so gasoline in turn floats on it. The
// *second-fastest*-burning fuel, behind only Gasoline: crude oil vaporizes and
// catches readily, so it's tuned closer to its refined cousin than to the
// solid fuels (Coal, Wood) it used to smoulder alongside. Just burns; never
// detonates. See combustion.ts for the shared model.
const SPEC: Combustible = { burnChance: 0.1, autoIgniteTemp: 430 };

// --- Fractional distillation --------------------------------------------------
// Gently heated (not set alight), crude oil boils apart into its cuts the way a
// refinery's fractionating column does — lightest first, in temperature order.
// Each oil cell tracks how far it has distilled in its own `aux` byte (the
// stage, 0..3), and every time its temperature crosses that stage's boiling
// point it vents the next cut as a rising gas/vapour and advances a stage:
//
//   stage 0  ≥150°  → Petroleum Gas (the light gas product, never condenses)
//   stage 1  ≥200°  → petroleum vapour tagged Gasoline  → condenses to Gasoline
//   stage 2  ≥260°  → petroleum vapour tagged Kerosene  → condenses to Kerosene
//   stage 3  ≥320°  → petroleum vapour tagged Diesel, and the spent cell itself
//                     collapses into Asphalt (the heavy tar residue)
//
// All four bands sit below the autoignition point (430), with headroom, so a
// cell distils cleanly rather than catching fire — PROVIDED the heat is
// indirect. `tryBurn` ignites oil the instant a flame (Fire/Lava) is adjacent,
// regardless of temperature, and the cuts it gives off are themselves flammable,
// so an open flame sets the whole still alight. Distillation is therefore driven
// by *indirect* heat: the heat brush (+), or a Fire/Lava source behind an
// Iron/Wall barrier so the oil's neighbours are hot metal, not flame. "Dump fire
// on crude → it burns; gently heat it in a closed still → it distils."
const STAGE_TEMP = [150, 200, 260, 320];
// Vapour aux tags read back by petroleumvapor.ts to pick the condensate.
const VAPOR_GASOLINE = 1;
const VAPOR_KEROSENE = 2;
const VAPOR_DIESEL = 3;
// Vent search order: straight up first, then the upper diagonals, then sideways
// — a boiling cut escapes upward, and only nudges sideways if capped directly
// above. Buried cells (no empty neighbour here) simply wait until the surface
// above them has boiled off, so distillation eats the pool from the top down.
const VENT_DIRS = [
  [0, -1],
  [-1, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
];

function findEmptyVent(x: number, y: number, sim: SimContext): [number, number] | null {
  for (const [dx, dy] of VENT_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) return [nx, ny];
  }
  return null;
}

/**
 * Advance this oil cell one distillation stage if it's hot enough and has an
 * empty cell to vent into. Returns true if it vented (so the caller stops for
 * the tick), false if it couldn't (too cool, or hemmed in) and should carry on
 * with normal burning/flow.
 */
function distillStep(x: number, y: number, sim: SimContext, t: number): boolean {
  const stage = sim.getAux(x, y);
  if (t < STAGE_TEMP[stage]) return false;
  const vent = findEmptyVent(x, y, sim);
  if (!vent) return false;
  const [nx, ny] = vent;
  if (stage === 0) {
    sim.spawn(nx, ny, PETROLEUM_GAS.id);
    sim.setAux(x, y, 1);
  } else if (stage === 1) {
    sim.spawn(nx, ny, PETROLEUM_VAPOR.id);
    sim.setAux(nx, ny, VAPOR_GASOLINE);
    sim.setAux(x, y, 2);
  } else if (stage === 2) {
    sim.spawn(nx, ny, PETROLEUM_VAPOR.id);
    sim.setAux(nx, ny, VAPOR_KEROSENE);
    sim.setAux(x, y, 3);
  } else {
    // Final cut: vent the diesel vapour and collapse the spent cell into tar.
    // In-place `set` keeps the (hot) temperature; Asphalt is a dense liquid so
    // it sinks and never seals the pool (see asphalt.ts).
    sim.spawn(nx, ny, PETROLEUM_VAPOR.id);
    sim.setAux(nx, ny, VAPOR_DIESEL);
    sim.set(x, y, ASPHALT.id);
  }
  return true;
}

function updateOil(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  // Gentle-heat band only: distil while below autoignition and not already
  // ablaze (a burning cell is pinned to ~800 by combustion, so `t < 430` is
  // false and it burns instead of distilling — preserving "oil on fire burns").
  if (t >= STAGE_TEMP[0] && t < SPEC.autoIgniteTemp) {
    if (distillStep(x, y, sim, t)) return;
  }
  if (tryBurn(x, y, sim, SPEC)) return;
  updateLiquid(x, y, sim);
}

export const OIL = register({
  id: 23,
  name: 'Crude Oil',
  phase: Phase.Liquid,
  color: rgb(48, 40, 34),
  density: 2.6,
  combustible: true,
  category: '석유',
  thermal: { conductivity: 0.2 },
  update: updateOil,
});
