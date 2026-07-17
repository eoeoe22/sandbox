import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { detonate } from './blast';
import { IRON } from './iron';
import { MERCURY } from './mercury';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { ACID } from './acid';
import { HYDROGEN } from './hydrogen';
import { OXYGEN } from './oxygen';
import { NICHROME, nichromeJouleHeat } from './nichrome';
import { SLIME, SLIME_DISSOLVE_BUDGET } from './slime';
import { WOOFER, wooferBodyPulse } from './woofer';

// Spark — a travelling electric charge, the moving pulse of the electricity
// subsystem. It's never a material you paint (like Ember, it's deliberately
// absent from the palette): it only ever exists for a single tick where a
// conductor is momentarily energized, spawned by a Battery or handed on from an
// adjacent Spark. A pulse therefore reads as a bright dot racing along a wire.
//
// Conductors and strength: current flows only through `conductive` materials
// (Iron, Mercury, Nichrome, Water, Saltwater, Acid, Slime); everything else is an
// insulator that blocks it outright. A pulse carries a *strength* that decays as
// it travels, so it fades out in a resistive medium instead of running forever.
// The whole subsystem's conductivity lives in the two knobs below (FULL_STRENGTH
// and CONDUCTOR_LOSS) — raise the first or lower the second and *every* conductor
// carries current further, without touching any material's own definition:
//   • Iron / Mercury (metal) — no loss, the pulse keeps full strength end to end.
//   • Nichrome — a mild resistor, bleeds a little and heats up as pulses pass
//     (Joule heating — see nichrome.ts); still carries most of a wire's length.
//   • Saltwater / Acid — electrolytes, bleed strength slowly (carry a long way);
//     both conduct at the same rate.
//   • Water — bleeds strength faster than the electrolytes, but a pulse now still
//     runs a good stretch through it (roughly a third of a full wire) instead of
//     dying after a couple of cells.
//   • Slime — a thick, non-ionic goo: still the worst conductor in the roster,
//     but no longer a dead end — a pulse now carries a good stretch into a blob
//     (roughly a third of a wire, on par with fresh Water) instead of dying
//     within a cell or two, and it genuinely carries on through (see below)
//     rather than just reacting on contact.
//
// State packed into the spark cell's single `aux` byte:
//   • the conductor CLASS (low 3 bits) — which conductor to revert back into
//     (Iron→Iron, Water→Water, …); class 0 = "no conductor" → the spark fizzles.
//   • the remaining STRENGTH (high 5 bits, 0..31).
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
const CLASS_BITS = 3;
const CLASS_MASK = (1 << CLASS_BITS) - 1; // 0b111 — low bits hold the conductor class
const MAX_STRENGTH = 0xff >> CLASS_BITS; // 31 — high 5 bits hold strength
/** Strength a fresh pulse starts at (what a Battery/Turbine injects). Sits at the
 *  packing's ceiling (MAX_STRENGTH) so every conductor gets the longest reach the
 *  5-bit strength field allows — the engine-wide "more range" knob. */
export const FULL_STRENGTH = 31;

// Conductors that can carry a spark, indexed by (class - 1). Order is fixed;
// appending a new conductor keeps existing packed values valid. Every material
// tagged `conductive` must appear here so a spark on it knows what to revert to.
const CONDUCTOR_IDS = [IRON.id, MERCURY.id, WATER.id, SALTWATER.id, NICHROME.id, ACID.id, SLIME.id];
// Strength lost entering a cell of each class — the engine's per-medium
// resistance, and the lever for "how far does current reach". At FULL_STRENGTH 31:
// metal keeps it (0 → runs the whole wire), brine and acid barely bleed
// (1 → ~31 cells, essentially across a tank), nichrome is a mild resistor
// (1 → ~31 cells, but also Joule-heats), and fresh water and Slime both bleed
// at the same middling rate (3 → ~10 cells) — Slime is still the poorest
// conductor in spirit (a thick, non-ionic goo has no business carrying current
// well) but no longer dies within a cell or two, so sustained current has room
// to actually punch into a blob before a pulse gives out. These were raised
// across the board from the old [8,2,1,2] water/brine/nichrome/acid, where a
// pulse died after only a few cells of water — the whole-subsystem conductivity
// uplift, done here in the engine rather than by editing any material's
// `conductive` flag. Nichrome's resistance also shows up as heat: each passing
// pulse deposits a fixed dose of Joule heat into the wire on revert (see
// nichromeJouleHeat), separate from this per-cell strength loss.
const CONDUCTOR_LOSS = [0, 0, 3, 1, 1, 1, 3];

// The conductor CLASS is packed into the low CLASS_BITS bits of the spark's aux
// byte, with class 0 reserved for "no conductor"; adding Slime brings the count
// to 7, which exactly fills the 3-bit field (classes 1..CLASS_MASK). An 8th
// conductor would encode as class CLASS_MASK+1, wrap to 0 under `& CLASS_MASK`,
// and be silently deleted on revert (myClass===0 ⇒ set EMPTY) — so fail loudly at
// load instead. Widen CLASS_BITS (at the cost of strength bits) before adding one.
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
    } else if (!arced && m.explosive) {
      // Electricity sets off explosives (electric detonator) but no longer
      // ignites ordinary fuels or flammable gas. One arc per tick is plenty.
      if (m.electricDetonate) {
        // A charge that only answers to a shock/arc (C4): detonate it directly,
        // so the trigger is deterministic and works even when the charge is
        // packed flush against a wall with no open cell for a fire hand-off.
        detonate(sim, nx, ny);
        arced = true;
      } else {
        arced = arcFireBeside(sim, nx, ny);
      }
    } else if (nid === WOOFER.id) {
      // Electric appliance, not a charge: relayed current reaching any face
      // of the connected Woofer body floods the whole body and fires its
      // (invisible, non-destructive) shockwave at once — see woofer.ts's
      // design note on the one-way "outside → inside" sink. Driven directly
      // off the Spark's own arc phase, the same scan-order-independent trick
      // electricDetonate uses for C4 — Woofer's own per-tick update can't
      // reliably self-check for an adjacent Spark since the Spark may already
      // have reverted to its conductor by the time Woofer's turn comes up
      // this same tick. Never spawns a Spark on the Woofer cell itself, so
      // nothing is rendered traveling inside/on the body.
      wooferBodyPulse(sim, nx, ny);
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
