import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { BLAST, detonate } from './blast';
import { DIESEL } from './diesel';
import { KEROSENE } from './kerosene';
import { ANFO } from './anfo';

// Ammonium Nitrate (질산암모늄, NH₄NO₃) — the poster child for the reaction table's
// heat term, because it demonstrates BOTH ends of it:
//
//  • Endothermic (흡열): dissolving in water *absorbs* heat — the instant cold-pack
//    reaction. A grain touching Water dissolves (→ Water) and pulls heat out of
//    both cells, so pouring water over a pile chills the puddle down toward
//    freezing (it can frost into Snow/Ice as the cold accumulates). This lives in
//    the declarative `reactions` table below (heat < 0), gated to only run while
//    cool (tempMax) — once it's hot, the *other* reaction takes over.
//
//  • Exothermic (발열): heated hard enough it decomposes explosively — the
//    fertilizer-bomb / ANFO detonation that *releases* a huge amount of energy. A
//    dry grain past its decomposition temperature (or lit by a flame/blast) sets
//    off the whole connected mass as one shockwave that scales with how much you
//    piled up (it's tagged `explosive`, so blast surveys the mass — see blast.ts).
//    On its own it is the *weakest* of the family by a wide margin (reach 6
//    against TNT's 16) — the prill is an oxidizer looking for a fuel, and the two
//    fuels it can be given are what turn it into a real charge.
//
// Water is the switch between the two: wet ammonium nitrate does the cold pack and
// *cannot* detonate (a misfire, like wet gunpowder), so it has to be dry to go off.
//
// **The two recipes.** Both take the prill somewhere much stronger, and both are
// separate materials rather than a buffed state of this one:
//
//  • **Aluminum Powder → Ammonal** (ammonal.ts), the contact-mix recipe declared
//    in aluminumpowder.ts alongside Thermite and Flash Powder.
//  • **Diesel/Kerosene → ANFO** (anfo.ts), handled here: the fuel soaks down into
//    the heap through the 겹침 (overlap) layer and a grain holding a drop turns
//    into ANFO — but only slowly (MIX_CHANCE below), so the fuel keeps
//    percolating while it works. Pouring is the whole interface; there is no
//    mixing ratio to get right, just keep the fuel coming.
//
// **It is an ordinary powder, and that is deliberate.** No `overlapFluids`
// allowlist: every liquid soaks into it the way water soaks into sand. An
// earlier design narrowed the allowlist to the two fuels so that water would
// stay outside as a primary cell where the cold-pack rule and the wet/misfire
// check could see it — but that made the prill the one powder in the palette
// that rain ran off. It isn't needed either: soaked water reacts across the
// seam on its own (`reactions.ts` `tryReactSoaked` runs this table against the
// 겹침 occupant), and the misfire check below simply reads the slot.
const DECOMP_TEMP = 300; // dry grain this hot decomposes explosively
const BLAST_RADIUS = 6; // a lone grain's pop; a packed mass reaches much farther
// A powerful high explosive: above a solid's default durability (200), so a proper
// charge craters stone/metal, unlike Gunpowder's loose-matter-only concussion.
const DESTRUCTIVE_POWER = 210;
// Per-tick chance that a grain holding a drop of fuel actually takes it up as
// ANFO. Deliberately far below the contact recipes' 0.25 (Thermite, Flash
// Powder, Ammonal): those are two powders ground together and finish in a few
// ticks, whereas this is a liquid draining through a bed. A low chance means
// the drop is usually still travelling when it converts something, so a poured
// heap goes over as a speckled, deepening patch instead of flipping wholesale
// the instant it gets damp — and since the drop is consumed by the grain that
// takes it, **how much fuel you pour is the size of the charge you get**.
const MIX_CHANCE = 0.04;

function isTrigger(id: number): boolean {
  return id === FIRE.id || id === LAVA.id || id === BLUE_FLAME.id || id === BLAST.id;
}

function isFuelLiquid(id: number): boolean {
  return id === DIESEL.id || id === KEROSENE.id;
}

function isWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

function updateAmmoniumNitrate(x: number, y: number, sim: SimContext): void {
  // (The endothermic cold-pack dissolution is handled by the declarative reaction
  // table before this update runs; if it fired, this cell is already Water.)

  // A grain holding Diesel/Kerosene in its 겹침 slot may take it up as ANFO,
  // consuming the drop it drank (anfo.ts). Only MIX_CHANCE of the time, so the
  // drop usually drains on to another grain first — see the constant. Checked
  // before the ignition scan below, so a heap being fuelled while already alight
  // simply detonates a tick later as the stronger charge it just turned into.
  const soak = sim.getOverlay(x, y);
  if (isFuelLiquid(soak) && sim.chance(MIX_CHANCE)) {
    sim.clearOverlay(x, y);
    sim.set(x, y, ANFO.id);
    return;
  }

  // Water soaked INTO the grain counts as wet too, not just water beside it: the
  // prill hosts any liquid (no allowlist — see the header), so the inside of a
  // rained-on heap would otherwise read bone dry and detonate.
  let wet = isWater(soak);
  let trigger = sim.getTemp(x, y) >= DECOMP_TEMP;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (isWater(nid)) wet = true;
    else if (isTrigger(nid)) trigger = true;
  }

  // Dry + triggered → explosive decomposition. Wet grains never detonate (they
  // dissolve/cold-pack instead), matching real ammonium nitrate's need to be dry.
  if (trigger && !wet) {
    detonate(sim, x, y, 0);
    return;
  }
  updatePowder(x, y, sim);
}

export const AMMONIUM_NITRATE = register({
  id: 99,
  name: 'Ammonium Nitrate',
  phase: Phase.Powder,
  // Pale off-white crystalline prills.
  color: rgb(228, 224, 206),
  // Real ammonium nitrate prills (~1.72 g/cm³) are notably lighter than
  // mineral powders like Sand/Salt (~2.2-2.65) — still dense enough to sink
  // through Water so a dry charge poured into a pool gets fully wetted (and
  // the cold-pack reaction can't be dodged by floating on the surface).
  density: 3.7,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  destructivePower: DESTRUCTIVE_POWER,
  // Crystalline prills grip and pile fairly steeply (마찰).
  friction: 0.4,
  // No `overlapFluids` allowlist and `liquidOverlap` left at its default: an
  // ordinary porous powder that drinks whatever you pour on it, grain by grain
  // (not every grain admits) — which is what makes a fuelled heap come out part
  // ANFO and part bare prill. See the header for why the old two-fuel allowlist
  // went away.
  // Filed under 폭발 (explosive), next to the two charges it is the base of — it
  // detonates on its own and its whole role in the palette is being the front of
  // that family. The endothermic cold pack (pour water on a pile and it frosts
  // the puddle toward freezing) is still its other half; the category is only a
  // palette grouping, not a claim about what it does.
  category: 'explosive',
  thermal: { conductivity: 0.3 },
  // Endothermic cold-pack dissolution (흡열): a grain touching Water dissolves into
  // it, pulling heat out of both cells (heat < 0). Only while cool — once hot the
  // explosive decomposition path (update) takes over instead. Gradual (probability)
  // so a pile chills its puddle over time rather than flashing it cold at once.
  // Now that water can soak in, this table also runs across the 겹침 seam
  // (reactions.ts `tryReactSoaked`), which is what keeps the cold pack working
  // for a buried grain. It does not behave identically to the neighbour case,
  // and the difference is worth stating plainly:
  //
  //   • **Neighbour water**: the prill cell turns into Water and the puddle
  //     beside it is untouched, so dissolving a heap *adds* a cell of water per
  //     grain.
  //   • **Soaked water**: the cell is holding two things (grain + drop) and can
  //     only produce one, so the drop merges into the Water the grain becomes
  //     (SimContext.set destroys an occupant the new host can't hold — its
  //     documented "transformed into a non-host" rule). No cell is added.
  //
  // Measured on a 14×14 sealed pocket of fully soaked prills, 200 ticks: 197
  // water where the neighbour path's accounting would predict 387, i.e. one drop
  // per dissolution, ~49%. An open bed on a floor lands the same way (~58%).
  // From the player's side it reads as "the water you poured comes back", not as
  // a leak, because the extra cell they never had is the thing that goes missing.
  // Re-plumbing applySoakedReaction to vent the drop instead was tried and
  // changes nothing (48–51% sealed): the cell it would vent into is Water, and a
  // packed heap has no empty neighbour to take it. Left as is deliberately —
  // note the same destroy applies to the ordinary neighbour path (applyReaction)
  // whenever a soaked cell is transformed, so this is an engine-wide property,
  // not something this material introduced.
  reactions: [
    { with: WATER.id, produce: WATER.id, probability: 0.06, heat: -18, tempMax: 80 },
    { with: SALTWATER.id, produce: SALTWATER.id, probability: 0.06, heat: -18, tempMax: 80 },
  ],
  update: updateAmmoniumNitrate,
});
