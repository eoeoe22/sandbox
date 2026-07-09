import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, flameAdjacent, type Combustible } from './combustion';
import { PETROLEUM_GAS } from './petroleumgas';
import { PETROLEUM_VAPOR } from './petroleumvapor';
import { ASPHALT } from './asphalt';

// Liquid fuel: flows/pools like water but lighter (density < 3), so it floats on
// water — while heavier than Gasoline, so gasoline in turn floats on it. Just
// burns; never detonates. See combustion.ts for the shared model.
//
// Ignition is by *flame contact*: a flame touching the crude skips distillation
// (see flameAdjacent below) and the flame's heat drives it to autoignition, so
// dumped Fire lights it readily. But it never self-ignites from *indirect* heat,
// because it cracks to inert Asphalt at RESIDUE_TEMP (380) — below this
// autoignition point — before conduction could ever get it that hot. That's what
// lets a sealed still (crude in a Stone/Iron vessel heated from outside) be
// driven through the distillation range by conduction without catching fire:
// dump Fire *on* the crude and it burns; heat it *through a wall* and it distils.
const SPEC: Combustible = { burnChance: 0.1, autoIgniteTemp: 420 };

// --- Fractional distillation --------------------------------------------------
// Gently heated (not set alight), crude oil boils apart into its cuts the way a
// refinery's fractionating column does. Each cell, once past its boiling point,
// has a per-tick chance to flash the cut matching its *current* temperature into
// a rising gas/vapour (which then condenses higher up — see petroleumvapor.ts);
// the hotter it is, the heavier the cut it gives off. Anything driven past the
// cracking point is left behind as the heavy tar residue, Asphalt. Because a
// cell boils *in place* into a gas that bubbles up through the liquid above it,
// buried crude distils just as well as the surface — no open vent needed — and a
// vessel heated from the bottom sets up a temperature gradient that fractionates
// by height on its own: heavy cuts and residue low and hot, light cuts and gas
// high and cool.
//
// The bands all sit *below* the cracking/residue point (380), which itself sits
// far below the ignition band, so a conduction-heated still always distils to
// inert Asphalt before it could ever get hot enough to read as burning.
const BOIL_MIN = 150; // below this it's just liquid
const RESIDUE_TEMP = 380; // at/above this the spent crude cracks to Asphalt
const BURNING_TEMP = 600; // at/above this the cell is on fire (pinned ~800), not distilling
const BOIL_CHANCE = 0.08; // per-tick chance a cell in a boiling band flashes off its cut

// Vapour aux tags read back by petroleumvapor.ts to pick the condensate.
const VAPOR_GASOLINE = 1;
const VAPOR_KEROSENE = 2;
const VAPOR_DIESEL = 3;

/** Boil this cell off into the gas/vapour matching its temperature, lightest cut
 *  at the low end up to diesel just under the cracking point. In-place `set`
 *  keeps the (hot) temperature, so the fresh vapour rises hot and condenses on
 *  its own as it cools higher up. */
function boilOff(x: number, y: number, sim: SimContext, t: number): void {
  if (t < 205) {
    sim.set(x, y, PETROLEUM_GAS.id); // lightest — the gas product, never condenses
    return;
  }
  sim.set(x, y, PETROLEUM_VAPOR.id);
  if (t < 258) sim.setAux(x, y, VAPOR_GASOLINE);
  else if (t < 315) sim.setAux(x, y, VAPOR_KEROSENE);
  else sim.setAux(x, y, VAPOR_DIESEL);
}

function updateOil(x: number, y: number, sim: SimContext): void {
  // Flame contact (or an already-burning cell) burns — handled first so a lit
  // slick is consumed exactly as before, never distilling.
  if (tryBurn(x, y, sim, SPEC)) return;
  const t = sim.getTemp(x, y);
  // Direct flame contact wins over distillation: an adjacent flame is left to
  // ignite the crude (burn), so crude only distils under *indirect* heat.
  if (t < BURNING_TEMP && !flameAdjacent(x, y, sim)) {
    // Not on fire and no flame touching it: distil by whatever heat has reached
    // it (a heat brush, or conduction through a hot vessel wall).
    if (t >= RESIDUE_TEMP) {
      // Cracked: collapse into tar. Asphalt is a dense liquid so it sinks and
      // never seals the pool (see asphalt.ts).
      sim.set(x, y, ASPHALT.id);
      return;
    }
    if (t >= BOIL_MIN && sim.chance(BOIL_CHANCE)) {
      boilOff(x, y, sim, t);
      return;
    }
  }
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
