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
import { HYDROGEN } from './hydrogen';
import { OXYGEN } from './oxygen';

// Spark — a travelling electric charge, the moving pulse of the electricity
// subsystem. It's never a material you paint (like Ember, it's deliberately
// absent from the palette): it only ever exists for a single tick where a
// conductor is momentarily energized, spawned by a Battery or handed on from an
// adjacent Spark. A pulse therefore reads as a bright dot racing along a wire.
//
// Conductors and strength: current flows only through `conductive` materials
// (Iron, Mercury, and — now — Water and Saltwater); everything else is an
// insulator that blocks it outright. A pulse carries a *strength* that decays as
// it travels, so it fades out in a resistive medium instead of running forever:
//   • Iron / Mercury (metal) — no loss, the pulse keeps full strength end to end.
//   • Saltwater — a weak electrolyte, bleeds strength slowly (carries a good way).
//   • Water — bleeds strength fast (dies after just a few cells).
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
// moves forward. Sparks travelling through Water/Saltwater also, at a low rate,
// electrolyse that cell into Hydrogen and Oxygen (2H₂O → 2H₂ + O₂).
const REFRACTORY_TICKS = 3;

// --- Electricity strength -----------------------------------------------------
const CLASS_BITS = 3;
const CLASS_MASK = (1 << CLASS_BITS) - 1; // 0b111 — low bits hold the conductor class
const MAX_STRENGTH = 0xff >> CLASS_BITS; // 31 — high 5 bits hold strength
/** Strength a fresh pulse starts at (what a Battery injects). */
export const FULL_STRENGTH = 30;

// Conductors that can carry a spark, indexed by (class - 1). Order is fixed;
// appending a new conductor keeps existing packed values valid. Every material
// tagged `conductive` must appear here so a spark on it knows what to revert to.
const CONDUCTOR_IDS = [IRON.id, MERCURY.id, WATER.id, SALTWATER.id];
// Strength lost entering a cell of each class: metal keeps it (0), brine bleeds
// slowly (2 → ~15 cells), fresh water bleeds fast (8 → ~4 cells).
const CONDUCTOR_LOSS = [0, 0, 8, 2];

// Electrolysis: a spark passing through Water/Saltwater occasionally splits it
// into Hydrogen (and, half the time, an Oxygen bubble too). Deliberately low so
// it's a slow trickle of gas, not a fizzing torrent.
const ELECTROLYSIS_CHANCE = 0.02;
const ELECTROLYSIS_OXYGEN_CHANCE = 0.5;

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

/** Electrolyse an energized Water/Saltwater cell into gas: the cell becomes
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
      // water while running full-length through metal.
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
    (conductorId === WATER.id || conductorId === SALTWATER.id) &&
    sim.chance(ELECTROLYSIS_CHANCE)
  ) {
    electrolyse(sim, x, y);
    return;
  }
  sim.set(x, y, conductorId);
  sim.setAux(x, y, REFRACTORY_TICKS);
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
