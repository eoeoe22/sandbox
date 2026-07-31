import { getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { HYDROGEN } from './hydrogen';

// 부식 (corrosion) — the one acid-interaction pass, shared by every corrosive
// material in the game: liquid Acid (acid.ts), Acid Vapor (acidvapor.ts) and
// Acid Slime (acidslime.ts).
//
// The three used to carry three byte-identical copies of this code — the same
// `isCorrodible` predicate and the same eat-a-neighbour/spend-yourself loop,
// pasted once per file. That is exactly the shape this project has been burned
// by before (see the hand-copied `acidHydrogen` roster the acidmetal harness now
// enumerates): three copies drift, and the drift is silent because each file
// looks self-consistent on its own. `Material.acidResistant` in particular is
// only as good as its *least* careful reader — a fourth corrosive material that
// forgot the flag would quietly eat through Glass, Nichrome and Polyethylene.
// So there is one reader now, and a new corrosive material gets the whole
// contract by calling `tryCorrode`.
//
// What differs between the three is data, not code, and it lives in the specs
// below.

/**
 * Everything that distinguishes one corrosive material's bite from another's.
 * Held as data so the pass itself stays single-copy.
 */
export interface CorrosionSpec {
  /** Per-neighbour, per-tick chance to eat a corrodible cell down to Empty. */
  readonly corrodeChance: number;
  /**
   * Chance the corroder is used up, rolled once per tick and only if it actually
   * ate something. Corroders never shrink on their own — with no corrodible
   * neighbour a puddle just sits there — so this is what bounds how much a given
   * amount of acid can chew through.
   */
  readonly selfConsumeChance: number;
  /**
   * Whether a metal above hydrogen in the reactivity series (`acidHydrogen`)
   * fizzes instead of blinking out silently. Only the liquid does, and that
   * predates this module — the aluminum three always reacted to `ACID.id` alone
   * (docs/MATERIAL-SYSTEMS.md, 산 + 금속 → 수소). The fizz spends the corroding
   * cell *as* the bubble, which the other two can't afford: a puff of goo turning
   * into a puff of gas would melt a blob away from the inside, and the vapour is
   * dry hydrogen chloride, which is a different reaction from acid in solution.
   */
  readonly evolvesHydrogen: boolean;
}

/**
 * Liquid Acid's bite — and Acid Slime's, which reuses these numbers verbatim so
 * the goo corrodes exactly as hard as the liquid it is made of (동일한 부식력).
 * Sharing one constant is the point: the two specs below can no longer drift
 * apart the way two copied literals could.
 */
const ACID_CORRODE_CHANCE = 0.03;
const ACID_SELF_CONSUME_CHANCE = 0.08;

/** Liquid Acid (acid.ts) — the full bite, fizzing included. */
export const ACID_CORROSION: CorrosionSpec = {
  corrodeChance: ACID_CORRODE_CHANCE,
  selfConsumeChance: ACID_SELF_CONSUME_CHANCE,
  evolvesHydrogen: true,
};

/** Acid Slime (acidslime.ts) — Acid's corrosive power in a body that oozes. */
export const ACID_SLIME_CORROSION: CorrosionSpec = {
  corrodeChance: ACID_CORRODE_CHANCE,
  selfConsumeChance: ACID_SELF_CONSUME_CHANCE,
  evolvesHydrogen: false,
};

/** Acid Vapor (acidvapor.ts) — fumes bite more slowly than the liquid. */
export const ACID_VAPOR_CORROSION: CorrosionSpec = {
  corrodeChance: 0.015,
  selfConsumeChance: 0.05,
  evolvesHydrogen: false,
};

/**
 * Default heat of reaction for the hydrogen evolution below (an individual
 * metal's `Material.acidHydrogen` may override it). Deliberately well under
 * Hydrogen's 200° autoignition point, so the bubble is born cool enough to rise
 * and collect under a ceiling instead of lighting the instant it appears — the
 * whole point of the 산 → 수소 chain is that you get to choose when it goes off.
 */
const HYDROGEN_HEAT = 25;

/**
 * What acid can eat: any non-resistant Solid or Powder.
 *
 * Phase is the whole rule, which has two consequences worth naming because
 * material files lean on them. Liquids are never corroded, so no puddle in the
 * game dissolves in acid (liquid Gallium's exemption is this rule, not a claim
 * about its chemistry — see gallium.ts). And `Material.acidResistant` is read
 * here and only here, so declaring the flag is genuinely all a material has to
 * do to be acid-proof against all three corroders.
 */
export function isCorrodible(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.acidResistant) return false;
  return m.phase === Phase.Solid || m.phase === Phase.Powder;
}

/**
 * 산 + 이온화 경향이 수소보다 큰 금속 → 수소. A metal tagged `acidHydrogen`
 * (types.ts) doesn't just blink out when acid eats it: the acid cell at (x,y)
 * *becomes* the hydrogen bubble while the metal cell at (nx,ny) dissolves.
 *
 * The bubble replaces the *acid* cell rather than venting into a free neighbor
 * because a metal sitting at the bottom of a puddle — which is where every player
 * will put it — has no empty neighbor at all, so a vented byproduct would be
 * invisible exactly when it matters. Consuming both sides 1:1 also keeps it
 * honest: the puddle is used up as it works, so a given amount of acid dissolves
 * a bounded amount of metal instead of acting as a free hydrogen catalyst.
 *
 * Returns true when it fired (the acid cell is gone — the caller must stop).
 */
function tryEvolveHydrogen(x: number, y: number, nx: number, ny: number, sim: SimContext): boolean {
  const spec = getMaterial(sim.get(nx, ny)).acidHydrogen;
  if (spec === undefined || !sim.chance(spec.chance)) return false;
  sim.set(nx, ny, EMPTY);
  // In-place set() keeps this cell's temperature, so the heat of reaction lands
  // on top of however warm the puddle already was.
  sim.set(x, y, HYDROGEN.id);
  sim.setTemp(x, y, sim.getTemp(x, y) + (spec.heat ?? HYDROGEN_HEAT));
  // The fresh gas has already had its turn this tick (it rises from the next one)
  // — mirrors the moved-guard the declarative reaction pass applies to both
  // participants, so nothing downstream in this scan picks the bubble up again.
  sim.markMoved(x, y);
  return true;
}

/**
 * One corroder's corrosion turn: bite each of the four orthogonal neighbours in
 * turn, then — if anything was actually eaten — roll to be spent doing so.
 *
 * Returns **true when the cell at (x,y) is gone** (consumed, or turned into a
 * hydrogen bubble). Every caller must return immediately on true; anything it
 * did afterwards would be acting on a cell that is no longer itself.
 */
export function tryCorrode(x: number, y: number, sim: SimContext, spec: CorrosionSpec): boolean {
  let corroded = false;
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (!isCorrodible(sim.get(nx, ny))) continue;
    // A hydrogen-evolving metal gets its own roll first, so the characteristic
    // fizz can't lose a race against this very pass (the lesson the aluminum
    // line's `reactions`-row workaround left behind — see types.ts's
    // `acidHydrogen`). A miss falls straight through to the plain silent bite.
    if (spec.evolvesHydrogen && tryEvolveHydrogen(x, y, nx, ny, sim)) return true;
    if (sim.chance(spec.corrodeChance)) {
      sim.set(nx, ny, EMPTY);
      corroded = true;
    }
  }
  if (corroded && sim.chance(spec.selfConsumeChance)) {
    sim.set(x, y, EMPTY);
    return true;
  }
  return false;
}
