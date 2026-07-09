import type { SimContext } from '../engine/SimContext';
import { PETROLEUM_VAPOR } from './petroleumvapor';
import { flameAdjacent } from './combustion';

// Shared "reflux" behaviour for the refined petroleum cuts (Gasoline, Kerosene,
// Diesel). In a still, a condensed cut that drips back down into the hot zone
// must not just sit there and cook until it autoignites — it should *re-boil*
// and rise back toward the cooler collection region, exactly like reflux in a
// real fractionating column. So each cut, once heated past its own boiling
// point, flashes back to Petroleum Vapor (tagged so it re-condenses to the same
// cut higher up). This self-regulation is what keeps a flame-heated vessel from
// steadily driving its own products up to the ignition band: a cut leaves as
// vapour at ~200-320° long before it could reach the ~780° burning band.
//
// Pair it with a high `autoIgniteTemp` on the cut (flame-contact ignition only,
// like Crude Oil) so mere radiant heat refluxes rather than ignites — drop fire
// *on* the fuel and it still burns, but a sealed hot still just keeps refluxing.

/** Vapour aux tags (must match petroleumvapor.ts's condense mapping). */
export const REFLUX_GASOLINE = 1;
export const REFLUX_KEROSENE = 2;
export const REFLUX_DIESEL = 3;

const SIMMER_CHANCE = 0.08; // gentle per-tick boil just above the boiling point
const SUPERHEAT = 60; // above boilTemp + this, boiling is certain (can't overheat further)

/**
 * If this cut is hot enough, re-boil it into rising vapour and return true (the
 * caller must then stop — the cell is vapour now, not liquid to flow). A gentle
 * simmer just above `boilTemp`, becoming certain once superheated, so the cut
 * can never climb far past its boiling point toward autoignition.
 */
export function refluxBoil(
  x: number,
  y: number,
  sim: SimContext,
  boilTemp: number,
  code: number,
): boolean {
  const t = sim.getTemp(x, y);
  if (t < boilTemp) return false;
  // Direct flame contact wins over reflux: let an adjacent flame burn the cut
  // instead of boiling it away (mirrors oil.ts).
  if (flameAdjacent(x, y, sim)) return false;
  if (t >= boilTemp + SUPERHEAT || sim.chance(SIMMER_CHANCE)) {
    // In-place set keeps the (hot) temperature so the fresh vapour rises hot and
    // condenses on its own as it cools higher up (see petroleumvapor.ts).
    sim.set(x, y, PETROLEUM_VAPOR.id);
    sim.setAux(x, y, code);
    return true;
  }
  return false;
}
