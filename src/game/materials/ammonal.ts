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
import { BLUE_FLAME } from './blueflame';
import { BLAST, detonate, type DetonateOptions } from './blast';

// Ammonal (암모날) — the metal-fuelled member of the ammonium nitrate family,
// and the fourth crafting recipe: **Ammonium Nitrate + Aluminum Powder →
// Ammonal** (declared in aluminumpowder.ts alongside the Thermite and Flash
// Powder rows, with the same 0.25 mixing chance and the same 150° cold gate, so
// all four recipes feel identical in the hand). Both ingredients are the real
// ones — ammonal genuinely is AN plus aluminum powder, a mining and shell
// filling from the First World War on.
//
// It sits directly beside ANFO (anfo.ts), which is the same prill fed a *liquid*
// fuel (Diesel/Kerosene soaked in through the 겹침 layer — see
// ammoniumnitrate.ts), and the comparison is the whole point of it:
//
//  • **It hits harder — harder than anything else in the palette.** Reach 17.5
//    against TNT's 16 and ANFO's 14, and it is the only charge whose destructive
//    power goes over the 100,000 default. That ordering is the real one
//    (ammonal's aluminum raises the heat of explosion past both a fuel-oil mix
//    and a cast military charge), and the price for it is paid in ingredients,
//    not in the blast: Aluminum Powder is the most contested powder in the game
//    — Thermite, Flash Powder and the entire casting line all want the same
//    grains — whereas the diesel ANFO drinks is a bulk product of the petroleum
//    line. Cheap-and-nearly-as-good vs. expensive-and-best.
//  • **It burns the crater.** A metal-fuelled explosion throws out far more
//    incandescent debris than a hydrocarbon one, so instead of the usual
//    shockwave flash most of the open air inside the reach takes a lick of
//    Fire. That is a genuine double edge, not a straight upgrade: ANFO leaves a
//    hole, ammonal leaves a hole *and* sets fire to whatever was standing
//    around it, including the rest of your scene.
//
// Everything else it inherits from the prill it is made of: it needs 300° or a
// flame to go off, and it is a dud while wet — the palette-wide "적시면 무력화"
// convention (Gunpowder, Flash Powder, ammonium nitrate itself), and true of
// real ammonal, whose oxidizer simply dissolves away.
const DECOMP_TEMP = 300;
// Just over TNT's own BLAST_RADIUS/power (16 / an unset 100,000 — see tnt.ts).
// Declared on the material rather than forced through DetonateOptions, the same
// as TNT and ANFO: every charge in the family is scaled by the one surveyed
// √-law on the connected mass (blast.ts `computeReach`), so this ordering holds
// at a single grain and at a wall of the stuff alike, instead of a fixed reach
// being overtaken by a big enough pile of something nominally weaker.
const BLAST_RADIUS = 17.5;
const DESTRUCTIVE_POWER = 110_000;
// Per open-air cell inside the reach, the chance the front leaves Fire there
// rather than the default shockwave flash. High — this is the material's visual
// signature — but short of 1 so the disc still reads as an explosion with a
// fireball in it rather than a solid block of flame.
const AIR_FIRE_CHANCE = 0.55;

/** Repaint one cell the blast front reached. Only open air is ours; every other
 *  cell (the charge's own grains, the loose matter being shoved, the solids
 *  shadowing the front) falls through to blast.ts's default handling, so the
 *  physics is untouched and only what the eye sees changes — the same
 *  air-only discipline flashpowder.ts's white light uses. */
function paintFireball(sim: SimContext, x: number, y: number, prevId: number): boolean {
  if (prevId !== EMPTY) return false;
  if (!sim.chance(AIR_FIRE_CHANCE)) return false; // default flash for the rest
  sim.spawn(x, y, FIRE.id);
  return true;
}

// Only the repaint — reach and power come from the material fields above via the
// ordinary mass survey, exactly like TNT's.
const AMMONAL_OPTS: DetonateOptions = { onCell: paintFireball };

function isTrigger(id: number): boolean {
  return id === FIRE.id || id === LAVA.id || id === BLUE_FLAME.id || id === BLAST.id;
}

function isWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

function updateAmmonal(x: number, y: number, sim: SimContext): void {
  // Water soaked into the grain counts, not just water beside it: an ordinary
  // powder hosts any liquid, so the inside of a rained-on heap would otherwise
  // read bone dry and go off (see ammoniumnitrate.ts, which shares the check).
  let wet = isWater(sim.getOverlay(x, y));
  let trigger = sim.getTemp(x, y) >= DECOMP_TEMP;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    // Id-based trigger detection rather than the `flammable` tag, the same
    // scan-order-independent discipline every other charge here uses.
    if (isWater(nid)) wet = true;
    else if (isTrigger(nid)) trigger = true;
  }

  if (trigger && !wet) {
    detonate(sim, x, y, 0, AMMONAL_OPTS);
    return;
  }
  updatePowder(x, y, sim);
}

export const AMMONAL = register({
  id: 145,
  name: 'Ammonal',
  phase: Phase.Powder,
  // Ammonium Nitrate's pale prill (228, 224, 206) greyed down by the metal dust
  // ground into it — darker than either ingredient, so a mixing heap visibly
  // *dulls* as the recipe takes, the way the Flash Powder heap visibly whitens.
  color: rgb(196, 190, 172),
  // Between its two ingredients (Ammonium Nitrate 3.7, Aluminum Powder 4.6), the
  // same place Gunpowder and Flash Powder sit relative to theirs. Still under the
  // mineral powders (Sand/Salt 5) and over Water (3), so a charge poured into a
  // pool sinks and reliably misfires down there rather than bobbing dry.
  density: 4.1,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  destructivePower: DESTRUCTIVE_POWER,
  category: 'explosive',
  // Crystalline prills with metal dust through them — grips a touch more than
  // the bare prill (0.4) (마찰).
  friction: 0.42,
  // Between the prill's 0.3 and the metal dust's 0.4.
  thermal: { conductivity: 0.35 },
  update: updateAmmonal,
});
