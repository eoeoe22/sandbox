import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { detonate } from './blast';
import { IRON } from './iron';
import { MERCURY } from './mercury';
import { GALLIUM } from './gallium';
import { LIQUID_GALLIUM } from './liquidgallium';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { ACID } from './acid';
import { HYDROGEN } from './hydrogen';
import { OXYGEN } from './oxygen';
import { NICHROME, nichromeJouleHeat } from './nichrome';
import { SLIME, SLIME_DISSOLVE_BUDGET } from './slime';
import { ACID_SLIME } from './acidslime';

// Spark — a travelling electric charge, the moving pulse of the electricity
// subsystem. It's never a material you paint (like Ember, it's deliberately
// absent from the palette): it only ever exists for a single tick where a
// conductor is momentarily energized, spawned by a Battery or handed on from an
// adjacent Spark. A pulse therefore reads as a bright dot racing along a wire.
//
// Conductors and strength: current flows only through `conductive` materials
// (Iron, Mercury, Gallium, Liquid Gallium, Nichrome, Water, Saltwater, Acid,
// Slime, Acid Slime); everything else is an insulator that blocks it outright.
// The metal-class conductors (Iron/Mercury/Gallium/Liquid Gallium/Nichrome) run a
// pulse at full strength end to end. A pulse carries a *strength* that
// decays as it travels, so it fades out in a resistive medium instead of running
// forever. The whole subsystem's conductivity lives in the two knobs below
// (FULL_STRENGTH and CONDUCTOR_LOSS) — raise the first or lower the second and
// *every* conductor carries current further, without touching any material's own
// definition:
//   • Iron / Mercury / Nichrome (metal-class conductors) — no signal loss, a
//     pulse keeps full strength end to end. Nichrome still Joule-heats as
//     pulses pass (see nichrome.ts) — its resistance now lives entirely in
//     that heating, not in how far a pulse reaches.
//   • Acid Slime — the one non-metal at zero loss: it conducts at the maximum, a
//     pulse running full strength end to end through a blob (전기전도성 최대치),
//     while still carrying Slime's electric-dissolve weakness (see below).
//   • Saltwater / Acid — electrolytes, bleed strength slowly (carry a long way);
//     both conduct at the same rate.
//   • Water — bleeds strength faster than the electrolytes, but a pulse still runs
//     a good stretch through it (about half a full wire) instead of dying after a
//     couple of cells.
//   • Slime — a thick, non-ionic goo: still the worst conductor in the roster (its
//     acidic cousin aside), but no longer a dead end — a pulse carries a good
//     stretch into a blob (on par with fresh Water) and genuinely carries on
//     through (see below) rather than just reacting on contact.
//
// Adding Acid Slime as an 8th conductor filled the 3-bit class field, so it was
// widened to 4 bits (CLASS_BITS) — which necessarily shrinks the strength field to
// 4 bits (FULL_STRENGTH 15, was 31), the two sharing one 8-bit `aux`. Reaches in
// the lossy media are correspondingly shorter than before (electrolytes span a big
// tank rather than an enormous one; water/slime reach ~half a wire) — the metals
// and zero-loss Acid Slime are unaffected since 0 loss runs any length regardless.
//
// State packed into the spark cell's single `aux` byte:
//   • the conductor CLASS (low 4 bits) — which conductor to revert back into
//     (Iron→Iron, Water→Water, …); class 0 = "no conductor" → the spark fizzles.
//   • the remaining STRENGTH (high 4 bits, 0..15).
// A compact class (a 1-based index into CONDUCTOR_IDS) rather than the raw id
// leaves room for the strength in the same byte, and — as before — the
// conductor's heat rides untouched in `temp`, so energizing a hot wire doesn't
// cool it.
//
// Each turn a spark: (1) hands the pulse to every ready `conductive` neighbor,
// subtracting that medium's strength loss (a pulse too weak to survive the next
// cell simply stops); (2) if an *explosive* is adjacent, drops a lick of Fire
// into open air beside it so the ordinary rules set the charge off (an electric
// detonator) — it no longer ignites ordinary fuels or flammable gas; then (3)
// reverts to its conductor and stamps a refractory countdown so the wave only
// moves forward. Sparks travelling through Water/Saltwater/Acid also, at a low
// rate, electrolyse that cell into Hydrogen and Oxygen (2H₂O → 2H₂ + O₂), leaving
// no residue behind; a spark reverting on Slime instead has a chance to seed the
// blob's own electric-dissolve front (a bounded, ragged bite back to Water — see
// slime.ts), so current that actually passes *through* the goo is what damages
// it, rather than a special-cased touch-and-seed on first contact.
const REFRACTORY_TICKS = 3;

// --- Electricity strength -----------------------------------------------------
// The class + strength share one 8-bit `aux` byte. With 10 conductors the class
// needs 4 bits (classes 1..15, 0 = "none"), leaving 4 bits for strength (0..15).
const CLASS_BITS = 4;
const CLASS_MASK = (1 << CLASS_BITS) - 1; // 0b1111 — low bits hold the conductor class
const MAX_STRENGTH = 0xff >> CLASS_BITS; // 15 — high 4 bits hold strength
/** Strength a fresh pulse starts at (what a Battery/Turbine injects). Sits at the
 *  packing's ceiling (MAX_STRENGTH) so every conductor gets the longest reach the
 *  4-bit strength field allows — the engine-wide "more range" knob. Halved from
 *  the old 31 when the class field grew to 4 bits to make room for an 8th
 *  conductor (Acid Slime); the lossy media reach correspondingly less far, the
 *  zero-loss ones (metals, Acid Slime) not at all. */
export const FULL_STRENGTH = 15;

// Conductors that can carry a spark, indexed by (class - 1). Order is fixed;
// appending a new conductor keeps existing packed values valid. Every material
// tagged `conductive` must appear here so a spark on it knows what to revert to.
const CONDUCTOR_IDS = [
  IRON.id,
  MERCURY.id,
  WATER.id,
  SALTWATER.id,
  NICHROME.id,
  ACID.id,
  SLIME.id,
  ACID_SLIME.id,
  GALLIUM.id,
  LIQUID_GALLIUM.id,
];
// Strength lost entering a cell of each class — the engine's per-medium
// resistance, and the lever for "how far does current reach". At FULL_STRENGTH 15:
// metal and nichrome keep it in full (0 → runs the whole wire — nichrome's
// resistance is now down at the engine's floor, same as Iron/Mercury); Acid Slime
// also sits at 0 (전기전도성 최대치 — it conducts as far as any metal, unlike its
// plain cousin); brine and acid barely bleed (1 → ~15 cells, a big tank); and
// fresh water and Slime bleed at the same middling rate (2 → ~7 cells) — Slime is
// still the poorest conductor in spirit (a thick, non-ionic goo has no business
// carrying current well) but no longer dies within a cell or two, so sustained
// current has room to actually punch into a blob before a pulse gives out. Water
// and Slime dropped from 3→2 to soften the shorter reach that came with halving
// FULL_STRENGTH (31→15) to fit the widened 4-bit class field. Nichrome's
// resistance still shows up as heat: each passing pulse deposits a fixed dose
// of Joule heat into the wire on revert (see nichromeJouleHeat), independent
// of this per-cell strength loss.
// (…, GALLIUM 0, LIQUID GALLIUM 0) — both are metals (solid & molten Gallium),
// so they conduct at the engine's floor exactly like Iron/Mercury: a pulse runs
// full strength end to end through a Gallium wire or puddle.
const CONDUCTOR_LOSS = [0, 0, 2, 1, 0, 1, 2, 0, 0, 0];

// The conductor CLASS is packed into the low CLASS_BITS bits of the spark's aux
// byte, with class 0 reserved for "no conductor". Adding Acid Slime brought the
// count to 8, so the field was widened from 3 to 4 bits (classes 1..CLASS_MASK =
// 1..15). A conductor past CLASS_MASK would encode as class CLASS_MASK+1, wrap to
// 0 under `& CLASS_MASK`, and be silently deleted on revert (myClass===0 ⇒ set
// EMPTY) — so fail loudly at load instead. Widen CLASS_BITS further (at the cost
// of strength bits, both sharing one 8-bit aux) before adding a 16th.
if (CONDUCTOR_IDS.length > CLASS_MASK) {
  throw new Error(
    `Too many spark conductors (${CONDUCTOR_IDS.length}) for a ${CLASS_BITS}-bit class field (max ${CLASS_MASK}).`,
  );
}

// Electrolysis: a spark passing through Water/Saltwater/Acid occasionally splits
// it into Hydrogen (and, half the time, an Oxygen bubble too). Deliberately low so
// it's a slow trickle of gas, not a fizzing torrent.
const ELECTROLYSIS_CHANCE = 0.02;
const ELECTROLYSIS_OXYGEN_CHANCE = 0.5;

// Slime's own weakness to electricity (see slime.ts): rarer than every hop
// simply reverting to plain Slime, a pulse that just travelled through a cell
// instead reverts it to Water and seeds a single bounded dissolve front (the
// same SLIME_DISSOLVE_BUDGET-limited, ragged corrosion slime.ts already carries
// through the blob). Deliberately low, like ELECTROLYSIS_CHANCE, so one lone
// spark still only takes a small bite; a battery pulsing spark after spark
// through the goo is what erodes a whole blob (지속적인 전류가 필요).
const SLIME_SHOCK_CHANCE = 0.05;

/** Conductor material id → 1-based class, or 0 if it can't carry a spark. */
export function conductorClass(id: number): number {
  const i = CONDUCTOR_IDS.indexOf(id);
  return i < 0 ? 0 : i + 1;
}
function classToId(cls: number): number {
  return CONDUCTOR_IDS[cls - 1];
}
function classLoss(cls: number): number {
  return CONDUCTOR_LOSS[cls - 1];
}
/** Pack a spark's (strength, conductor class) into its aux byte. */
export function packSpark(strength: number, cls: number): number {
  const s = strength < 0 ? 0 : strength > MAX_STRENGTH ? MAX_STRENGTH : strength;
  return (s << CLASS_BITS) | (cls & CLASS_MASK);
}

/** Energize one conductor cell: replace it with a Spark that remembers the
 *  conductor (class) and its remaining strength in aux, and preserves the
 *  conductor's heat in temp. */
function energize(sim: SimContext, nx: number, ny: number, cls: number, strength: number): void {
  const heat = sim.getTemp(nx, ny);
  sim.spawn(nx, ny, SPARK.id); // marks moved (won't be re-processed this tick)
  sim.setTemp(nx, ny, heat); // carry the wire's heat through the spark
  sim.setAux(nx, ny, packSpark(strength, cls)); // remember conductor + strength
}

/** Seat a lick of Fire in an open cell touching (nx,ny), so Fire's own rules
 *  set off the explosive there. Returns whether one was placed. */
function arcFireBeside(sim: SimContext, nx: number, ny: number): boolean {
  for (const [ex, ey] of DIR8) {
    const ax = nx + ex;
    const ay = ny + ey;
    if (sim.inBounds(ax, ay) && sim.isEmpty(ax, ay)) {
      sim.spawn(ax, ay, FIRE.id);
      return true;
    }
  }
  return false;
}

/** React an explosive neighbor touched by a live pulse — shared by a Spark's
 *  own arc phase (reached through a relay of conductors) and a Battery's
 *  direct-contact injection (배터리 직접 연결, no wire needed), the same two
 *  call sites that special-case Woofer by id (see woofer.ts's design note). A
 *  charge that only answers to a shock/arc (C4, `electricDetonate`) detonates
 *  directly and deterministically; every other explosive instead gets a lick
 *  of Fire seated beside it so its own ignition rules catch it — electricity
 *  still doesn't ignite ordinary fuels or flammable gas. Returns false for a
 *  non-explosive neighbor, or for an ordinary explosive with no open cell free
 *  to seat the arcing Fire in (a full arcFireBeside miss). */
export function tryArcExplosive(sim: SimContext, nx: number, ny: number, nid: number): boolean {
  const m = getMaterial(nid);
  if (!m.explosive) return false;
  if (m.electricDetonate) {
    detonate(sim, nx, ny);
    return true;
  }
  return arcFireBeside(sim, nx, ny);
}

/** Deliver a live electric pulse to a NON-conductive neighbor (nx,ny) of a pulse
 *  source (a Battery/Turbine in direct contact, or a travelling Spark's arc
 *  phase): fire the material's electric-appliance hook if it declares one
 *  (`Material.directPulse` — Fan, Woofer, and any future device), otherwise try
 *  to set it off as an explosive (electric detonator). Returns true if the pulse
 *  did something (so a Spark can cap itself to one arc per tick — see
 *  updateSpark). This is the single dispatch every pulse source shares for its
 *  non-conductor branch, so a new electric-reaction material reacts to *every*
 *  source (all battery chemistries and the Turbine, direct-contact or wired) the
 *  moment it registers `directPulse`/`explosive` — no source special-cases it by
 *  id. */
export function reactToPulse(sim: SimContext, nx: number, ny: number, nid: number): boolean {
  const hook = getMaterial(nid).directPulse;
  if (hook) {
    hook(sim, nx, ny);
    return true;
  }
  return tryArcExplosive(sim, nx, ny, nid);
}

/** Electrolyse an energized Water/Saltwater/Acid cell into gas: the cell becomes
 *  Hydrogen, and about half the time a free open neighbor gets an Oxygen bubble
 *  (2H₂O → 2H₂ + O₂). */
function electrolyse(sim: SimContext, x: number, y: number): void {
  sim.set(x, y, HYDROGEN.id);
  sim.setAux(x, y, 0); // shed the packed spark state; Hydrogen keeps none
  if (sim.chance(ELECTROLYSIS_OXYGEN_CHANCE)) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
        sim.spawn(nx, ny, OXYGEN.id);
        break;
      }
    }
  }
}

function updateSpark(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const myClass = aux & CLASS_MASK;
  const strength = aux >> CLASS_BITS;

  let arced = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) continue;
    const m = getMaterial(nid);
    if (m.conductive && sim.getAux(nx, ny) === 0) {
      // Hand the pulse on, losing strength for the medium it's entering. If the
      // pulse would arrive dead (or the conductor isn't one we can revert to),
      // it simply stops here — that decay is what makes current fade out in
      // water while running full-length through metal. (Slime included: it's
      // still the poorest conductor here, but now reaches about as far as
      // fresh water — see CONDUCTOR_LOSS.)
      const cls = conductorClass(nid);
      if (cls !== 0) {
        const next = strength - classLoss(cls);
        if (next > 0) energize(sim, nx, ny, cls, next);
      }
    } else if (m.directPulse) {
      // Electric appliance, not a charge (Fan, Woofer, any future device):
      // relayed current reaching any face of the connected body floods the whole
      // body and reacts at once via its registered hook — the one-way
      // "outside → inside" sink (see woofer.ts's design note). Ungated by
      // `arced`: an appliance and an explosive are different reactions, and a
      // pulse can legitimately power a fan *and* set off a charge on other faces
      // the same tick. Driven off the Spark's own arc phase (the same
      // scan-order-independent trick electricDetonate uses for C4) because the
      // appliance's own update can't reliably see an adjacent Spark — it may have
      // reverted to its conductor before the appliance's turn this same tick.
      m.directPulse(sim, nx, ny);
    } else if (!arced && m.explosive) {
      // Electricity sets off explosives (electric detonator) but no longer
      // ignites ordinary fuels or flammable gas. One arc per tick is plenty.
      arced = tryArcExplosive(sim, nx, ny, nid);
    }
  }

  // If this spark just detonated an adjacent electric charge (electricDetonate
  // above), that blast may have flashed this very cell to BLAST — in which case
  // it was craterized and must NOT be revived. Bail out and leave the flash,
  // exactly as tnt/gunpowder return straight after they detonate. When the cell
  // wasn't reached it's still a Spark and collapses normally below.
  if (sim.get(x, y) !== SPARK.id) return;

  // Collapse back to the conductor (or fizzle if there was none). A spark that
  // was travelling through water/brine may instead electrolyse that cell into
  // gas; otherwise it reverts and leaves a brief refractory mark so the pulse
  // can't immediately double back.
  if (myClass === 0) {
    sim.set(x, y, EMPTY);
    return;
  }
  const conductorId = classToId(myClass);
  if (
    (conductorId === WATER.id ||
      conductorId === SALTWATER.id ||
      conductorId === ACID.id) &&
    sim.chance(ELECTROLYSIS_CHANCE)
  ) {
    electrolyse(sim, x, y);
    return;
  }
  if (conductorId === SLIME.id) {
    // Slime uses its aux byte for ONE thing only — the dissolve-front budget, which
    // slime.ts reads as "any non-zero aux ⇒ dissolve this cell next tick" and never
    // ticks down as a refractory (unlike Iron/Water/…). So a reverting slime spark
    // must NOT carry the ordinary REFRACTORY_TICKS stamp: updateSlime would misread
    // that 3 as a reach-3 dissolve budget and eat the blob on EVERY hop, defeating
    // the "poor conductor, sustained current needed" design. Instead a low-chance
    // shock seeds a real bounded dissolve front (aux = budget, updateSlime reverts
    // this cell to Water next tick and frays outward); every other hop reverts to
    // inert Slime (aux 0). Slime therefore has no anti-doubleback refractory, but
    // its heavy per-cell strength loss (CONDUCTOR_LOSS) already bounds how far a
    // pulse can spread through a blob.
    sim.set(x, y, SLIME.id);
    sim.setAux(x, y, sim.chance(SLIME_SHOCK_CHANCE) ? SLIME_DISSOLVE_BUDGET : 0);
    return;
  }
  if (conductorId === ACID_SLIME.id) {
    // Acid Slime carries Slime's identical electric-dissolve weakness (its aux is
    // the very same dissolve-front budget, read by acidslime.ts's own updateAcidSlime
    // — "any non-zero aux ⇒ dissolve to Water next tick"), so it reverts exactly like
    // Slime above: no REFRACTORY_TICKS stamp (that 3 would be misread as a reach-3
    // budget and eat the blob every hop), just a low-chance shock that seeds a real
    // bounded dissolve front, every other hop reverting to inert Acid Slime (aux 0).
    // Unlike Slime it's a zero-loss conductor, so range is bounded by SLIME_SHOCK_CHANCE
    // needing a sustained pulse train, not by the medium's strength loss.
    sim.set(x, y, ACID_SLIME.id);
    sim.setAux(x, y, sim.chance(SLIME_SHOCK_CHANCE) ? SLIME_DISSOLVE_BUDGET : 0);
    return;
  }
  sim.set(x, y, conductorId);
  sim.setAux(x, y, REFRACTORY_TICKS);
  if (conductorId === NICHROME.id) {
    // Resistive (Joule) heating: every pulse that passes deposits heat into
    // the element (capped, cold-ended — see nichromeJouleHeat), so a powered
    // coil climbs to a glow while its terminals and leads stay cool.
    nichromeJouleHeat(x, y, sim, SPARK.id);
  }
}

export const SPARK = register({
  id: 38,
  name: 'Spark',
  phase: Phase.Solid,
  color: rgb(255, 255, 190),
  density: 1,
  category: '전기',
  // Normal conductivity is fine: the spark only lives one tick and its temp is
  // the wire's heat being ferried across, restored right after spawn.
  thermal: { conductivity: 0.3 },
  update: updateSpark,
});
