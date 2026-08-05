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
import { BLAST, detonate, type DetonateOptions } from './blast';

// ANFO (Ammonium Nitrate/Fuel Oil) — the liquid-fuelled member of the ammonium
// nitrate family, and the sibling of Ammonal: same prill, one fed Diesel or
// Kerosene, the other fed aluminum dust.
//
// It is *made*, never poured from the palette in the field: pour Diesel or
// Kerosene over a heap of Ammonium Nitrate and the fuel soaks down into the
// prills through the 겹침 (overlap) layer exactly like water into sand, and each
// grain that admits a drop turns into ANFO on the spot, drinking the fuel
// (`overlapFluids` + the conversion branch in ammoniumnitrate.ts). Partly
// drenched heaps really are part ANFO and part bare prill, and because the blast
// survey walks the 8-connected mass without caring which explosive it is
// (blast.ts `surveyMass`), a half-soaked pile lands at a yield in between — how
// thoroughly you wet the heap is the dial.
//
// **Where it sits in the palette's power order.** Bare prills are a modest pop
// (blastRadius 6); ANFO is the real thing at 14, just under TNT's 16; Ammonal
// tops both at 17.5. That ordering is the real one — a fuel-oil mix is a genuine
// mining/demolition workhorse but does not match a cast military charge, while
// ammonal's aluminum pushes the heat of explosion past both. All four scale the
// same way (the surveyed √-law on the connected mass), so the ordering holds at
// any charge size rather than only for a single grain.
//
// The price is paid in ingredients, not in the blast: Diesel is a bulk product
// of the petroleum line, whereas the Aluminum Powder ammonal wants is the most
// contested powder in the game (Thermite, Flash Powder and the whole casting
// line all queue for it). Cheap and nearly as strong is the point of ANFO.
//
// **Water spoils it rather than stopping it — the one place it parts company
// with the rest of the family.** Ammonium Nitrate and Ammonal are flat duds
// while wet ("적시면 무력화", the palette-wide convention Gunpowder and Flash
// Powder also follow): the prill dissolves, and there is nothing left to set
// off. ANFO's grains are already coated in fuel oil, so they don't dissolve —
// a soaked charge is still a charge, just a ruined one. It goes off at a fixed
// pop smaller even than the bare prill's instead of refusing, which is both the
// truer outcome (water kills the oxygen balance, it doesn't remove the
// explosive) and the more interesting one: a wet ANFO charge is a trap that
// still bangs, not one that silently does nothing.
const DECOMP_TEMP = 300;
// 87.5% of TNT's own BLAST_RADIUS (tnt.ts) — declared on the material rather
// than forced through DetonateOptions, so the connected-mass survey scales it
// the same way it scales TNT.
const BLAST_RADIUS = 14;
// 80% of TNT's (unset ⇒ DEFAULT_DESTRUCTIVE_POWER) 100,000 — far above every
// durability in the game, so the difference from TNT shows up as crater size
// rather than as "this one can't break granite".
const DESTRUCTIVE_POWER = 80_000;
// A soaked charge, fixed and tiny — below even the bare prill's reach 6, and
// carrying the prill's feeble 210 power so it barely marks stone. Fixed rather
// than surveyed on purpose: a spoiled charge shouldn't get *stronger* because
// you piled more spoiled charge next to it, so a whole drowned magazine coughs
// exactly as weakly as one grain (the same fixed-reach seam napalm uses).
const WET_BLAST_RADIUS = 4;
const WET_DESTRUCTIVE_POWER = 210;
const WET_OPTS: DetonateOptions = { reach: WET_BLAST_RADIUS, power: WET_DESTRUCTIVE_POWER };

function isTrigger(id: number): boolean {
  return id === FIRE.id || id === LAVA.id || id === BLUE_FLAME.id || id === BLAST.id;
}

function isWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

function updateAnfo(x: number, y: number, sim: SimContext): void {
  // Water soaked INTO this grain counts, not just water sitting beside it. ANFO
  // is an ordinary powder as far as the 겹침 layer is concerned (no
  // `overlapFluids` allowlist ⇒ it hosts any liquid), so a heap rained on takes
  // water into most of its grains and the primary-neighbor scan alone would
  // never see it — the inside of a drowned pile would read bone dry.
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

  // Wet still fires — just pitifully. See the header: the fuel coating means the
  // grain never dissolves, so unlike the rest of the family there is always
  // something left to go off.
  if (trigger) {
    detonate(sim, x, y, 0, wet ? WET_OPTS : undefined);
    return;
  }
  updatePowder(x, y, sim);
}

export const ANFO = register({
  id: 148,
  name: 'ANFO',
  phase: Phase.Powder,
  // Ammonium Nitrate's pale prill (228, 224, 206) darkened and warmed by the
  // fuel oil soaked through it — an amber-damp heap, clearly apart from both the
  // bare prill it came from and Ammonal's grey metal dust (196, 190, 172), so a
  // heap you have poured diesel over visibly reads as "wetted" at a glance.
  color: rgb(205, 186, 140),
  // Between its ingredients (Ammonium Nitrate 3.7, Diesel 2.45) — fuel-coated
  // prills are lighter than dry ones. Still over Water (3), so a charge poured
  // into a pool sinks and reliably misfires down there rather than bobbing dry
  // (the same reasoning as Ammonal's 4.1).
  density: 3.5,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  destructivePower: DESTRUCTIVE_POWER,
  category: 'explosive',
  // Same crystalline grip as the bare prill (마찰).
  friction: 0.4,
  thermal: { conductivity: 0.3 },
  // No `overlapFluids`, i.e. an ordinary powder that hosts any liquid — an
  // allowlist only ever *narrows* hosting, it is not what keeps a fluid out
  // (see canHostOverlap). So water does soak into a rained-on heap, which is
  // exactly why `updateAnfo`'s wet check reads this cell's own 겹침 slot and not
  // only its neighbors.
  update: updateAnfo,
});
