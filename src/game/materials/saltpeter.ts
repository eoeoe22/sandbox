import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { isFlame } from './combustion';
import { OXYGEN } from './oxygen';
import { SALT } from './salt';
import { tryMixGunpowder } from './gunpowdermix';

// Saltpeter (초석, KNO₃) — the oxidizer. Two-thirds of what makes black powder
// work, and the second of the three black-powder ingredients (see
// gunpowdermix.ts: Sulfur + Saltpeter + Coal Powder → Gunpowder).
//
// Its solo toy is what an oxidizer actually *is*: it carries its own oxygen and
// hands it to a fire. A grain that touches flame — or just gets hot enough on
// its own — decomposes, venting a cell of Oxygen and leaving a spent white Salt
// residue behind (real KNO₃ decomposes near 400°C into potassium nitrite plus
// O₂, and real black-powder fouling is exactly that: potassium salts).
//
// That single line plugs straight into machinery that already exists.
// combustion.ts's forced draught (see OXY_BOOST there) makes every adjacent
// Oxygen cell push a burning fuel's temperature up 250°, and a fully oxygenated
// fire throws *Blue Flame* instead of ordinary Fire. So sprinkling saltpeter on
// a campfire is a genuine chain reaction: the fire decomposes the grains, the
// released O₂ drives the fire toward 1800°, and the hotter fire decomposes more
// grains. A coal bed you couldn't melt iron with becomes a cutting torch, with
// no bottled Oxygen anywhere in the scene. It's self-limiting — each grain is
// spent into Salt — so it flares and subsides instead of running forever.
//
// (Nice knock-on: at Blue Flame temperatures the Salt residue is already past
// its own 800° melting point, so a hard flare-up leaves puddles of Molten Salt
// where the pile was — salt.ts handles that on the residue's own next turn.)
const DECOMP_TEMP = 400; // real KNO₃ decomposition point, near enough
const DECOMP_CHANCE = 0.2; // per-tick, so a pile vents over a beat rather than at once

/** True if the grain should decompose this tick: hot enough on its own, or
 *  touching an open flame (the same id-based, scan-order-independent trigger
 *  the explosives and fuels use). */
function decomposing(x: number, y: number, sim: SimContext): boolean {
  if (sim.getTemp(x, y) >= DECOMP_TEMP) return true;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && isFlame(sim.get(nx, ny))) return true;
  }
  return false;
}

/** Release the grain's oxygen into an adjacent open cell, preferring straight
 *  "up" (opposite gravity) so the bubble rises off the reaction — the same
 *  venting shape engine/reactions.ts uses for its declarative `byproduct`.
 *  Returns false when the grain is boxed in with nowhere to vent: it simply
 *  waits, so a buried pile decomposes from its exposed face inward rather than
 *  silently destroying itself. */
function ventOxygen(x: number, y: number, sim: SimContext): boolean {
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  if (sim.inBounds(ux, uy) && sim.isEmpty(ux, uy)) {
    sim.spawn(ux, uy, OXYGEN.id);
    return true;
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
      sim.spawn(nx, ny, OXYGEN.id);
      return true;
    }
  }
  return false;
}

function updateSaltpeter(x: number, y: number, sim: SimContext): void {
  // The recipe first: cold saltpeter against sulfur and coal dust grinds into
  // Gunpowder. The mix is temperature-gated below DECOMP_TEMP (see
  // gunpowdermix.ts), so the two paths can never contend — a grain in a fire
  // decomposes, a cold one in a pile mixes.
  if (tryMixGunpowder(x, y, sim)) return;

  // Decomposition: vent the oxygen, leave the spent salt. `set` keeps the cell's
  // temperature, so residue left in a blaze arrives already hot (and melts on its
  // own turn if the fire is past salt's 800° melting point).
  if (decomposing(x, y, sim) && sim.chance(DECOMP_CHANCE) && ventOxygen(x, y, sim)) {
    sim.set(x, y, SALT.id);
    return;
  }

  updatePowder(x, y, sim);
}

export const SALTPETER = register({
  id: 126,
  name: 'Saltpeter',
  phase: Phase.Powder,
  // Pale lilac-white crystal — potassium's own flame color, and enough of a cool
  // cast to tell it apart at a glance from the other white powders it sits near
  // (Salt 235/235/228, Sugar 242/240/233, Ammonium Nitrate 228/224/206).
  color: rgb(222, 216, 240),
  // Real saltpeter (~2.1 g/cm³) is a shade denser than Sulfur and lighter than
  // the Sand/Salt mineral powders (5) — so a poured mix layers Coal Powder at the
  // bottom, then saltpeter, then sulfur, and all three sink in fresh water (3).
  density: 4.3,
  // Not an explosive by itself — an oxidizer, and the one that decomposes into
  // fire's own oxygen supply — so it's filed under 불・열 alongside Sulfur
  // rather than the finished explosives it's an ingredient of.
  category: 'fire',
  // Interlocking crystals, like Salt (마찰).
  friction: 0.38,
  thermal: { conductivity: 0.3 },
  update: updateSaltpeter,
});
