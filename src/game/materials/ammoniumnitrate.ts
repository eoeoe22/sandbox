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
//    the heap through the 겹침 (overlap) layer (see `overlapFluids` below) and each
//    grain that admits a drop converts on the spot, drinking the fuel. Pouring is
//    the whole interface — no mixing ratio to get right, just wet the pile.
const DECOMP_TEMP = 300; // dry grain this hot decomposes explosively
const BLAST_RADIUS = 6; // a lone grain's pop; a packed mass reaches much farther
// A powerful high explosive: above a solid's default durability (200), so a proper
// charge craters stone/metal, unlike Gunpowder's loose-matter-only concussion.
const DESTRUCTIVE_POWER = 210;

function isTrigger(id: number): boolean {
  return id === FIRE.id || id === LAVA.id || id === BLUE_FLAME.id || id === BLAST.id;
}

function isFuelLiquid(id: number): boolean {
  return id === DIESEL.id || id === KEROSENE.id;
}

function updateAmmoniumNitrate(x: number, y: number, sim: SimContext): void {
  // (The endothermic cold-pack dissolution is handled by the declarative reaction
  // table before this update runs; if it fired, this cell is already Water.)

  // A grain that has taken Diesel/Kerosene into its 겹침 slot *becomes* ANFO right
  // there, consuming the drop it drank (anfo.ts). Checked before the ignition scan
  // below, so a heap being wetted while already alight simply detonates one tick
  // later as the stronger charge it just turned into.
  if (isFuelLiquid(sim.getOverlay(x, y))) {
    sim.clearOverlay(x, y);
    sim.set(x, y, ANFO.id);
    return;
  }

  let wet = false;
  let trigger = sim.getTemp(x, y) >= DECOMP_TEMP;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id) wet = true;
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
  // 겹침 (overlap) is restricted to just Diesel/Kerosene (the ANFO soak, see
  // above) via overlapFluids — Water is deliberately left OUT of that allowlist
  // so it keeps pooling against the prills as an ordinary primary neighbor cell
  // instead of soaking away invisibly; otherwise the cold-pack reaction and the
  // wet/misfire check above (both of which only look at primary cells) would
  // stop seeing it. liquidOverlap left at its default coefficient — the soak is
  // grain-by-grain (not every grain admits) like any other powder's, which is
  // what makes a partly poured heap come out part ANFO and part bare prill.
  overlapFluids: [DIESEL.id, KEROSENE.id],
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
  reactions: [
    { with: WATER.id, produce: WATER.id, probability: 0.06, heat: -18, tempMax: 80 },
    { with: SALTWATER.id, produce: SALTWATER.id, probability: 0.06, heat: -18, tempMax: 80 },
  ],
  update: updateAmmoniumNitrate,
});
