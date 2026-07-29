import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLAST, detonate } from './blast';
import { flashLight } from './flash';

// Flash Powder (섬광화약) — the aluminum line's answer to black powder, and the
// palette's third crafting recipe: **Aluminum Powder + Saltpeter → Flash
// Powder** (declared in aluminumpowder.ts, the same one-row declarative form
// the Thermite recipe uses). Both ingredients are the real ones — flash powder
// genuinely is a metal fuel plus a nitrate oxidizer — and the pairing closes a
// neat loop with the recipes already here: Saltpeter, which the black-powder
// mix needs, now makes two different explosives depending on which fuel you
// grind it with, and Aluminum Powder, which makes Thermite with an oxide, makes
// this with an oxidizer salt.
//
// Its identity is deliberately the *opposite* of Thermite's, out of the same
// metal: Thermite is the slow, blinding-hot cutting charge that bores a hole
// and destroys almost nothing else; Flash Powder is all at once — a wide white
// flash and a bang that breaks nothing at all. Against Gunpowder, the palette's
// other weak charge, the axis is sensitivity, not size:
//
//  • It reaches farther than Gunpowder (10 vs 8) but carries the same feeble
//    파괴력 6 — below every phase's default durability (see blast.ts), so it
//    cannot crack stone, metal or glass. All it does over that wider disc is
//    flash white, dust the area with fire as the flash dies, and heave loose
//    powder/liquid aside as mass-conserving Debris. A flash-bang, not a
//    demolition charge.
//  • It is the most *sensitive* explosive in the game, which is the price for
//    that reach. Real flash powder is notorious for exactly this: it lights
//    from a spark, from friction, from a warm surface. Here it goes off at a
//    mere 200° — an ember, a hot pipe, a pan that has been sitting in the sun
//    of a fire — and, like C4, it is `electricDetonate`, so a Spark reaching a
//    conductive neighbour sets it off directly and deterministically rather
//    than via the usual drop-a-lick-of-Fire hand-off. It is the cheap electric
//    detonator: two craftable powders and a wire, no C4 needed.
//    So it cannot be stockpiled anywhere warm, and it is the wrong charge to
//    carry through a scene that is already on fire.
//
// The light is its own material (flash.ts) rather than the ordinary shockwave
// flash. That was the whole visual problem with the first version: the default
// BLAST cell fades white → orange, so a charge whose entire identity is "it
// breaks nothing, it just blinds you" looked exactly like a small bomb. The
// `onCell` hook below repaints only the *open air* the front reaches — every
// other cell keeps the default fate, so the physics (the loose-matter shove,
// the solids that shadow it, the charge's own consumption) is untouched and
// only what the eye sees changes.
//
// Air is also where the incendiary character lives. The default flash dusts a
// crater with fire as it dies (SHELL_FIRE_CHANCE, 28%) and swapping the whole
// disc for inert light would have quietly removed that, so a fraction of the
// air cells take a lick of Fire instead of the flash. Well below the default so
// the disc still reads white with sparks in it, not as a fireball.
//
// Like Gunpowder, a Water/Saltwater neighbour makes it wet and blocks
// detonation for that tick (misfire) even with a trigger touching it — the
// palette-wide convention for "적시면 무력화", and true of real flash powder,
// whose oxidizer simply dissolves away.
const BLAST_RADIUS = 10;
// The same value Gunpowder carries, and for the same reason: below every
// phase's default durability, so the blast breaks nothing solid and shoves all
// loose matter within reach instead of cratering.
const DESTRUCTIVE_POWER = 6;
// Self-ignition point. By far the lowest of any explosive here (Ammonium
// Nitrate needs 300°, and every fuel needs more still), and low enough that
// ordinary radiant heat from a nearby fire will find it.
const AUTOIGNITE_TEMP = 200;
// Per open-air cell, the chance the front leaves a lick of Fire there rather
// than white light. Under half the default flash's own 28%, since here it is
// the *only* source of fire in the disc (the light itself is inert) and a
// flash charge should scatter sparks, not light a bonfire.
const AIR_FIRE_CHANCE = 0.12;

/** Repaint one cell the blast front reached. Only open air is ours: everything
 *  else — the charge's own grains, the loose matter being shoved, the solids
 *  shadowing the front — falls through to blast.ts's default handling, which is
 *  what keeps this a purely visual override. Returning true claims the cell. */
function paintFlash(sim: SimContext, x: number, y: number, prevId: number): boolean {
  if (prevId !== EMPTY) return false;
  if (sim.chance(AIR_FIRE_CHANCE)) sim.spawn(x, y, FIRE.id);
  else flashLight(sim, x, y);
  return true;
}

function updateFlashPowder(x: number, y: number, sim: SimContext): void {
  let wet = false;
  // Hot enough on its own — no flame contact needed. Checked before the
  // neighbour scan so a grain warmed through a wall still goes off, but the
  // wet gate below can still veto it (a soaked grain is a dud however hot it
  // gets, matching Gunpowder's misfire rule).
  let trigger = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    // Id-based trigger detection, not the `flammable` tag — the same
    // scan-order-independent discipline Gunpowder uses (a tagged material can
    // be swallowed into plain Fire by Fire's own ignite pass before its turn
    // runs, skipping the detonation entirely).
    if (nid === WATER.id || nid === SALTWATER.id) wet = true;
    else if (nid === FIRE.id || nid === LAVA.id || nid === BLAST.id) trigger = true;
  }

  if (!wet && trigger) {
    detonate(sim, x, y, undefined, { onCell: paintFlash });
    return;
  }
  updatePowder(x, y, sim);
}

export const FLASH_POWDER = register({
  id: 137,
  name: 'Flash Powder',
  phase: Phase.Powder,
  // The brightest powder in the palette — brighter than Salt (235,235,228) and
  // than either of its own ingredients (Aluminum Powder 208,212,218 /
  // Saltpeter 222,216,240), so a mixed heap visibly turns *whiter* as the
  // recipe takes, the way the black-powder heap visibly turns black.
  color: rgb(243, 243, 236),
  // Between its two ingredients (Aluminum Powder 4.6, Saltpeter 4.3), like
  // Gunpowder sits under the mineral powders. Still dense enough to sink in
  // Water (3), so a dunked charge stays down there wet and reliably misfires
  // rather than bobbing back up dry.
  density: 4.4,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  destructivePower: DESTRUCTIVE_POWER, // weak: shoves loose matter, cracks nothing
  // A Spark detonates it directly, on the spot — see Material.electricDetonate.
  electricDetonate: true,
  category: 'explosive',
  thermal: { conductivity: 0.35 },
  update: updateFlashPowder,
});
