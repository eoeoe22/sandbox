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
import { WIRE } from './wire';
import { ALUMINUM } from './aluminum';

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
//   • Saltwater / Acid — electrolytes, bleed strength slowly (~63 cells, which
//     crosses any tank you're likely to build); both conduct at the same rate.
//   • Water — bleeds strength twice as fast as the electrolytes, but a pulse still
//     runs a long way through it (~31 cells) instead of dying after a couple.
//   • Slime — a thick, non-ionic goo: still the worst conductor in the roster (its
//     acidic cousin aside), but no longer a dead end — a pulse carries a good
//     stretch into a blob (on par with fresh Water) and genuinely carries on
//     through (see below) rather than just reacting on contact.
//   • Wire — a metal core in an insulating jacket: zero loss like the metals, but
//     the only conductor that doesn't *leak*. A pulse on Wire hands off to Wire
//     alone, never to a bare conductor beside it, so a cable crosses a water tank
//     or an iron frame without electrifying it; it still reaches the appliance or
//     charge at the end of the run, since those consume the pulse rather than
//     relaying it. One tag, `Material.insulated`, read in the hand-off below.
//
// Class and strength used to fight over a single 8-bit `aux`, which made "add a
// conductor" a zero-sum trade against "how far does current reach": the 8th
// conductor (Acid Slime) filled the 3-bit class field, widening it to 4 bits
// halved FULL_STRENGTH (31→15), and the 16th would have halved it again (→7).
// `aux` is now 16 bits per cell (see Grid.aux), so the two fields get a full
// byte each and the trade is gone — 255 conductor slots *and* a strength ceiling
// of 255, neither one paid for out of the other.
//
// State packed into the spark cell's `aux` word:
//   • the conductor CLASS (low 8 bits) — which conductor to revert back into
//     (Iron→Iron, Water→Water, …); class 0 = "no conductor" → the spark fizzles.
//   • the remaining STRENGTH (high 8 bits, 0..255).
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
// Class + strength split the 16-bit `aux` word (Grid.aux) evenly, one byte each:
// classes 1..255 in the low byte (0 = "none"), strength 0..255 in the high byte.
// Both fields are now far wider than the design needs, which is the point — a new
// conductor no longer costs reach, and raising reach no longer costs slots.
const CLASS_BITS = 8;
const CLASS_MASK = (1 << CLASS_BITS) - 1; // 0xff — low byte holds the conductor class
const MAX_STRENGTH = 0xffff >> CLASS_BITS; // 255 — high byte holds strength
/** Strength a fresh pulse starts at (what a Battery/Turbine injects) — the
 *  engine-wide "how far does current reach" knob, divided by a medium's
 *  CONDUCTOR_LOSS to give its reach in cells.
 *
 *  Deliberately *not* pinned to MAX_STRENGTH (255) any more. While the two
 *  fields shared a byte this had to sit at the packing's ceiling to squeeze out
 *  every cell of reach, so widening the class field visibly shortened every
 *  lossy conductor. With a byte of its own it's a free tuning value: 63 gives
 *  water/slime ~31 cells and brine/acid ~63 — roughly double the pre-Acid-Slime
 *  reach and four times what the 4-bit field allowed — while leaving lossy media
 *  meaningfully lossy against the metals' unlimited run. Raise it toward
 *  MAX_STRENGTH for longer reach; nothing else has to move. */
export const FULL_STRENGTH = 63;

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
  WIRE.id,
  ALUMINUM.id,
];
// Strength lost entering a cell of each class — the engine's per-medium
// resistance, and the lever for "how far does current reach". Each conductor
// declares its own as `Material.sparkLoss` (omitted ⇒ 0, the engine's floor), so
// this is only the packed-index view of it: the same roster as CONDUCTOR_IDS,
// read off the materials rather than restated as a second hand-kept column that
// could line up wrong. At FULL_STRENGTH 63 the roster comes out as metals,
// Nichrome and Acid Slime at 0 (runs the whole wire — Acid Slime's 전기전도성
// 최대치 puts it level with any metal, unlike its plain cousin), brine and acid at
// 1 (~63 cells, well past a big tank), and fresh Water and Slime at 2 (~31
// cells) — Slime is still the poorest conductor in spirit, a thick non-ionic goo
// with no business carrying current well, but no longer dies within a cell or
// two, so sustained current has room to punch into a blob before a pulse gives
// out.
//
// These reaches used to be a hostage of the class field: every widening of it
// halved FULL_STRENGTH and so halved this whole column. The 16-bit aux ended
// that, and FULL_STRENGTH 15→63 restored (and then some) what the 4-bit class
// field had taken.
const CONDUCTOR_LOSS = CONDUCTOR_IDS.map((id) => getMaterial(id).sparkLoss ?? 0);

// The conductor CLASS is packed into the low CLASS_BITS bits of the spark's aux
// word, with class 0 reserved for "no conductor" (classes 1..CLASS_MASK = 1..255).
// A conductor past CLASS_MASK would encode as class CLASS_MASK+1, wrap to 0 under
// `& CLASS_MASK`, and be silently deleted on revert (myClass===0 ⇒ set EMPTY) — so
// fail loudly at load instead. The guard is now a formality rather than a live
// budget: with a full byte per field the roster would have to grow 25× before it
// bites, and adding a conductor no longer costs FULL_STRENGTH anything.
if (CONDUCTOR_IDS.length > CLASS_MASK) {
  throw new Error(
    `Too many spark conductors (${CONDUCTOR_IDS.length}) for a ${CLASS_BITS}-bit class field (max ${CLASS_MASK}).`,
  );
}
// Losses are read off the materials now, so the old "the two columns must line
// up" check has nothing left to catch — a conductor cannot be appended to one
// table and forgotten in the other. What can still drift is the roster against
// the tag the propagation gate actually reads: a material listed here but not
// `conductive` is a dead class slot no spark will ever enter, so it means either
// the tag was dropped or the wrong material was listed.
CONDUCTOR_IDS.forEach((id) => {
  if (getMaterial(id).conductive !== true) {
    throw new Error(
      `${getMaterial(id).name} is listed as a spark conductor but is not tagged Material.conductive — a spark would never reach it.`,
    );
  }
});
// `Material.wiring` (배선재 — read by the `'wiring'` emission gate below) is a
// declared tag, so it *can* drift from the losses. Half of it is derivable and is
// checked here: wiring is a cable or a metal, and every one of those conducts at
// the engine's floor, so a `wiring` conductor with a non-zero `sparkLoss` is a
// mistake — either the tag is on the wrong material or its loss was retuned
// without anyone noticing that a generator feeds it. The converse is NOT asserted:
// a zero-loss conductor that isn't wiring is exactly the Acid Slime case, and the
// whole point of the tag is to be able to say that.
CONDUCTOR_IDS.forEach((id, i) => {
  if (getMaterial(id).wiring === true && CONDUCTOR_LOSS[i] !== 0) {
    throw new Error(
      `${getMaterial(id).name} is tagged Material.wiring but loses strength per cell — wiring is zero-loss by definition.`,
    );
  }
});

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
/** Is this material proper wiring — a cable or a metal (`Material.wiring`)? The
 *  test behind the `'wiring'` emission gate below. A declared tag rather than a
 *  `classLoss === 0` test, because zero-loss and wiring are different questions:
 *  Acid Slime conducts as far as any metal (전기전도성 최대치) and is still goo, not
 *  a wire, so it is not something a generator should be pushing power into. The
 *  half that *is* derivable is asserted at load instead — see the guard below. */
function isWiring(id: number): boolean {
  return getMaterial(id).wiring === true;
}
/** Pack a spark's (strength, conductor class) into its aux word. */
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

/**
 * Which conductors a pulse *source* is willing to feed — the emission-side knob
 * of `pulseCell`, chosen by the source rather than by the material being entered
 * (that's `Material.insulated`, which governs a travelling Spark's hand-off).
 *
 *   • `'any'` — every ready conductor, lossy media included. What a Battery
 *     terminal, a Solar Panel face and the 전기 브러시 use: a bare terminal in a
 *     puddle electrifies the puddle, which is the honest reading of a bare
 *     terminal.
 *   • `'wiring'` — 전선처럼 (wired output): only cables and metals
 *     (`Material.wiring`). Water, brine, acid, Slime *and Acid Slime* are skipped
 *     outright — Acid Slime carries a pulse at zero loss but is goo, not wire, and
 *     the tag is declared rather than derived from loss precisely so that
 *     distinction survives. A source gated this way pushes its power into wiring
 *     instead of into whatever it happens to be sitting in. The Turbine uses it
 *     (see turbine.ts): it stands in a boiler by construction, and a bare face
 *     used to dump every beat into the condensate around it — electrolysing the
 *     boiler water away. The non-conductor branch is deliberately untouched,
 *     exactly like Wire's jacket: appliances (`directPulse`) and explosive
 *     charges are one-way sinks that *consume* a pulse rather than spread it, so
 *     도체 없이 직접 연결 still works.
 */
export type PulseGate = 'any' | 'wiring';

/**
 * Deliver one full-strength pulse to the cell (x,y) *itself* — the single
 * "what does a pulse do to this cell" rule, shared by every direct-contact
 * source: a Battery/LFP Battery terminal and a Turbine face (each applying it
 * to their neighbors, see battery.ts's `injectPulses` / turbine.ts's
 * `energizeNeighbors`) and the 전기 브러시, which applies it to every cell under
 * its own footprint (engine/brushTools.sparkCells).
 *
 * A ready `conductive` cell becomes a Spark at FULL_STRENGTH, keeping its own
 * heat (so energizing a hot wire doesn't cool it). A conductor still holding
 * per-cell state — a post-pulse refractory countdown, a Slime dissolve budget —
 * is left alone rather than overwritten, the same `aux === 0` readiness gate the
 * Spark-to-Spark hand-off uses. Anything else (empty air aside) is dispatched
 * through `reactToPulse`, so an appliance (`directPulse`) or an explosive charge
 * reacts exactly as it would to a pulse relayed down a wire. Returns whether the
 * pulse did anything at all.
 *
 * `gate` narrows only the conductor branch (see PulseGate): a `'wiring'` source
 * refuses to energize anything that isn't a cable or a metal, while reacting to
 * devices and charges exactly as an ungated one does.
 */
export function pulseCell(
  sim: SimContext,
  x: number,
  y: number,
  gate: PulseGate = 'any',
): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return false;
  if (getMaterial(id).conductive) {
    if (gate === 'wiring' && !isWiring(id)) return false;
    if (sim.getAux(x, y) !== 0) return false; // refractory / carrying other state
    const cls = conductorClass(id);
    if (cls === 0) return false;
    energize(sim, x, y, cls, FULL_STRENGTH);
    return true;
  }
  return reactToPulse(sim, x, y, id);
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
  // The conductor this pulse is riding, and whether that conductor's jacket keeps
  // the current in (Wire — see Material.insulated). An insulated pulse hands off
  // only to more of the same conductor; it still reaches appliances and charges
  // below, which consume the pulse rather than spreading it.
  const myConductorId = myClass === 0 ? EMPTY : classToId(myClass);
  const insulated = myClass !== 0 && getMaterial(myConductorId).insulated === true;

  let arced = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) continue;
    const m = getMaterial(nid);
    if (m.conductive && sim.getAux(nx, ny) === 0) {
      // 피복: a pulse riding an insulated cable never crosses into a *different*
      // conductor — the puddle it runs through, the iron frame it's clipped to —
      // only into more of the same cable. The check is on the conductor being
      // entered, so it's one-way by construction: a bare Iron pulse still feeds a
      // Wire it touches (that's how a cable gets power), it just can't get back
      // out that way.
      if (insulated && nid !== myConductorId) continue;
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
    // …and mark it, because Slime is a reaction-table partner (acid.ts's
    // 산 + 슬라임 → 산성 슬라임). Left unmarked, an Acid cell that has not been
    // scanned yet this tick would pick this freshly-reverted cell up as a
    // `with: SLIME.id` partner, chaining Spark → Slime → Acid Slime inside a
    // single tick — the same-tick cascade engine/reactions.ts exists to prevent.
    // The mark costs nothing here: spark propagation never consults the moved
    // flag (nothing else in this file does), and the cell has already taken its
    // turn as a Spark, so this only closes it to *other* cells' passes.
    sim.markMoved(x, y);
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
    sim.markMoved(x, y); // twin of the Slime branch above — same reason, kept in step
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
  category: 'electric',
  // Normal conductivity is fine: the spark only lives one tick and its temp is
  // the wire's heat being ferried across, restored right after spawn.
  thermal: { conductivity: 0.3 },
  update: updateSpark,
});
