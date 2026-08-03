import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { MUD } from './mud';
import { DIRT } from './dirt';
import { SEED } from './seed';
import { ASH } from './ash';
import { findMoisture, moistDrinkable, ROOT_REACH } from './soil';
import { tryBurn } from './combustion';

// Plant — a living green growth that drinks water and *climbs*. It grows the way
// a real one does: roots at the waterline drink, that moisture wicks up the stem
// cell by cell, and the growing tip spends it to push new growth upward — so a
// plant sprouts from a wet patch and creeps up toward the light, slowing and
// stopping as it outgrows its water supply.
//
// 성장 패턴 개편 — the old rule let *every* watered cell put out a neighbour, so a
// plant thickened into a green blob that filled whatever space it could reach.
// Real vegetation has an architecture instead: a stem grows from its *tip*, runs
// a while, forks into two shoots, and each shoot runs and forks again until the
// plant runs out of vigour and sets buds. That's what this models — a tiny
// L-system per plant, so growth reads as stems and branches rather than a stain:
//
//   • Only a TIP grows. The cell it grows into becomes the new tip and the old
//     one settles into plain stem, so a shoot advances one cell at a time along
//     a line instead of every cell budding sideways at once.
//   • A tip carries a heading (up-left / up / up-right) and mostly keeps it,
//     turning one step now and then — the wobble that makes a stem look grown
//     rather than drawn.
//   • Each shoot runs a short random SEGMENT of cells, then FORKS into two tips
//     that diverge, each with one less generation of vigour left. After MAX_GEN
//     forks a tip stops growing and becomes a bud — so a plant is naturally
//     finite and ends up crown-shaped rather than expanding forever. Forking
//     often, with only a cell or three between forks, is what makes it read as
//     foliage; long runs between rare forks read as limbs.
//   • Nothing grows into a spot that already has more than CROWD_LIMIT plant
//     neighbours, which is what keeps branches thin and stops two shoots that
//     drift together from merging back into a slab.
//   • A tip that has run out of vigour becomes a BUD, and a bud leafs: it fills
//     the open cells around it with foliage that never grows or branches itself.
//     Branches alone are a bare frame — the leaf clusters on their ends are what
//     make the plant read as full. Leaves may bunch against more neighbours than
//     a branch may (LEAF_CROWD), and stop on their own once they have.
//   • A bud that is still well watered occasionally drops a SEED — the plant's
//     own way of spreading (see seed.ts), closing the Water → Dirt → Seed →
//     Plant loop.
//   • Cut a plant back and an exposed, well-watered stem can put out a fresh
//     lateral shoot (spending one generation of its own vigour), so a trimmed
//     plant re-sprouts from the side the way a real one does.
//
// Water still governs all of it, through a per-cell moisture store in `aux`:
//   • Drink — a cell touching Water tops itself up to full and consumes that
//     cell, so you can watch the puddle shrink as the plant drinks it. Roots in
//     Mud draw it dry instead, leaving plain Dirt behind. Failing both, the
//     roots reach DOWN through the soil for the water table (see soil.ts) —
//     without that, a plant in a watered bed starves, because poured water
//     drains out of sight into the ground within seconds. Saltwater is NOT
//     drinkable: brine is Coral's element (coral.ts), and a plant left in it
//     simply dries out.
//   • Wick — each tick a cell pulls moisture up from its wettest plant
//     neighbour, losing WICK_STEP per hop. Moisture climbs from the roots as a
//     decaying gradient, so a tip more than ~MAX/WICK_STEP cells from water is
//     too dry to grow — a water-limited height cap with no bookkeeping.
//   • Decay — a slow drain, so when the water runs dry the whole plant's
//     moisture bleeds away and growth halts (the plant then reads as dry fuel).
//   • Spend — extending costs GROW_COST, forking costs BRANCH_COST and a seed
//     costs SEED_COST, so how lush a plant gets is exactly how much water it can
//     reach: a trickle grows one thin stem, a pond grows a bush.
//
// Dry vegetation is eager fuel: it burns on the self-sustaining combustion model
// (see combustion.ts) with its own `burnChance`, and water smothers a burning
// cell — so only growth that has dried away from its water actually catches.

// --- aux layout (16 bits, see Grid.aux) -------------------------------------
//   bits 0-6   moisture 0..127
//   bit  7     tip (only a tip grows)
//   bits 8-9   heading: 0 = up-left, 1 = up, 2 = up-right
//   bits 10-11 segment cells left before this shoot forks
//   bits 12-14 generations of vigour left (forks remaining)
//   bit  15    initialised (this cell has been given a structural role)
//
// The "initialised" flag lives in the TOP bit on purpose, and that's a
// save-compatibility rule, not a stylistic one: a Plant cell saved before this
// rework stored a bare 0..250 moisture value in `aux` (and `aux` is persisted —
// see Grid.aux / SNAPSHOTS.md), so any bit from 8 up is guaranteed clear in old
// data. Reading such a cell therefore finds the flag *unset* and re-initialises
// it into a proper sprout on its first tick. Had the flag sat in the low byte,
// every old plant that happened to be saved above half moisture would have
// decoded as an already-initialised, vigour-0, non-tip cell — permanently unable
// to grow again, with nothing on screen to say why.
const MOIST_MASK = 0x7f;
const MAX_MOISTURE = 127;
const TIP_BIT = 1 << 7;
const DIR_SHIFT = 8;
const SEG_SHIFT = 10;
const SEG_MASK = 0b11;
const GEN_SHIFT = 12;
const GEN_MASK = 0b111;
const INIT_BIT = 1 << 15;
// Fork depth. Deep and short beats shallow and long: with only three forks and
// long runs between them a plant came out as a handful of long crooked limbs —
// more legs than foliage. Six forks with a run of 1-3 cells between them gives
// the same height out of many more twigs, which is what reads as a bush.
const MAX_GEN = 6;

/** Moisture a fresh sprout (a germinated Seed) starts with, so it can climb out
 *  of the soil straight away before its roots have topped up. */
const START_MOISTURE = 76;

const DRINK_CHANCE = 0.25; // per-tick chance a thirsty root tops up from water
const THIRST = 63; // roots only drink once they're down to about half — a plant
//                    sips its pond rather than swallowing a cell every few ticks
const MUD_DRINK_CHANCE = 0.12; // damp earth gives its moisture up more slowly
const SOIL_MOISTURE = 76; // what damp ground alone sustains — enough for a modest
//                           plant, well short of what standing water gives
// Moisture lost per cell as it wicks up the stem. This single number decides how
// bushy a plant can get, because a fork needs BRANCH_COST *at the tip*: at a
// steep 7 per cell only the bottom four cells could ever afford one, so a plant
// spent its vigour as one long bare stalk with a token Y on top. At 4 the
// gradient reaches roughly twice as far and the crown actually fills in, while
// the cap it puts on height (moisture / WICK_STEP cells from water) is still
// what stops a plant climbing forever. At 3 the outermost twigs can still afford
// to fork, which is where the difference between a bush and a bare frame is.
const WICK_STEP = 3;
const DECAY_CHANCE = 0.5; // chance of losing 1 moisture per tick
const GROW_CHANCE = 0.09; // how often a tip attempts to advance
const GROW_COST = 12; // moisture a tip spends to put out one new cell
const BRANCH_COST = 30; // a fork puts out two cells and needs real reserves
const LEAF_COST = 9; // …and a leaf is the cheapest thing a plant makes
const LEAF_CHANCE = 0.05; // how often a spent bud puts out another leaf
// Leaves may sit against more neighbours than a growing branch may: branches
// have to stay thin or the plant fills in as a slab, but foliage is *supposed*
// to bunch up. This split is what puts leafy clusters on the ends of bare twigs.
const LEAF_CROWD = 4;
const TURN_CHANCE = 0.3; // chance a tip's heading wanders one step
const SHOOT_CHANCE = 0.0025; // chance an exposed, wet stem puts out a new shoot
const SEED_CHANCE = 0.004; // chance a well-fed bud sets a seed
const SEED_COST = 70; // a seed is expensive — it takes a sustained water supply
const CROWD_LIMIT = 2; // max plant neighbours a cell may grow into (keeps it thin)

const moistOf = (a: number): number => a & MOIST_MASK;
const dirOf = (a: number): number => (a >> DIR_SHIFT) & 0b11;
const segOf = (a: number): number => (a >> SEG_SHIFT) & SEG_MASK;
const genOf = (a: number): number => (a >> GEN_SHIFT) & GEN_MASK;
const isTip = (a: number): boolean => (a & TIP_BIT) !== 0;
const clampMoist = (m: number): number => (m < 0 ? 0 : m > MAX_MOISTURE ? MAX_MOISTURE : m);

/** Replace a cell's moisture, clamped into the 7 bits that hold it. */
function withMoist(a: number, m: number): number {
  return (a & ~MOIST_MASK) | clampMoist(m);
}

function pack(m: number, tip: boolean, dir: number, seg: number, gen: number): number {
  return (
    clampMoist(m) |
    INIT_BIT |
    (tip ? TIP_BIT : 0) |
    ((dir & 0b11) << DIR_SHIFT) |
    ((seg & SEG_MASK) << SEG_SHIFT) |
    ((gen & GEN_MASK) << GEN_SHIFT)
  );
}

/** Cells a shoot runs before it forks — 1..3, so branches come out short and
 *  the plant spends its height on twigs rather than on long bare limbs. */
const randSeg = (sim: SimContext): number => 1 + sim.randInt(3);

/** The `aux` a freshly germinated Seed hands its sprout: a full-vigour tip
 *  heading straight up, pre-charged with moisture so it can start climbing
 *  before its roots have topped up (see seed.ts). */
export function plantSproutAux(sim: SimContext): number {
  return pack(START_MOISTURE, true, 1, randSeg(sim), MAX_GEN);
}

/** Headings, in left-to-right / right-to-left order, tried when the preferred
 *  one is blocked (module-level so the fallback allocates nothing). */
const ASC: readonly number[] = [0, 1, 2];
const DESC: readonly number[] = [2, 1, 0];

/** How many of the 8 neighbours of (x,y) are Plant. */
function plantNeighbours(x: number, y: number, sim: SimContext): number {
  let n = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === PLANT.id) n++;
  }
  return n;
}

/** Open space a shoot may take: empty, in bounds, and not already crowded by
 *  plant — the thin-branch rule that stops growth filling in as a slab. */
function canGrowInto(x: number, y: number, sim: SimContext): boolean {
  return sim.inBounds(x, y) && sim.isEmpty(x, y) && plantNeighbours(x, y, sim) <= CROWD_LIMIT;
}

// Scratch for findGrowth/pickEmpty results (the chosen cell and the heading to
// stamp on it) — a CA hot path, so they report through these module locals
// rather than allocating a tuple on every attempt.
let growX = 0;
let growY = 0;
let growDir = 1;

/**
 * Pick where a tip heading `dir` extends to. Prefers its own heading (wandering
 * one step with TURN_CHANCE), falls back to the other two upward cells, and only
 * creeps sideways when capped from above — so a plant boxed in under a ceiling
 * spreads along it instead of stalling. Writes growX/growY/growDir.
 */
function findGrowth(x: number, y: number, sim: SimContext, dir: number): boolean {
  let d = dir;
  if (sim.chance(TURN_CHANCE)) d = sim.chance(0.5) ? d - 1 : d + 1;
  if (d < 0) d = 0;
  else if (d > 2) d = 2;

  if (canGrowInto(x + d - 1, y - 1, sim)) {
    growX = x + d - 1;
    growY = y - 1;
    growDir = d;
    return true;
  }
  const order = sim.chance(0.5) ? ASC : DESC;
  for (const c of order) {
    if (c === d) continue;
    if (canGrowInto(x + c - 1, y - 1, sim)) {
      growX = x + c - 1;
      growY = y - 1;
      growDir = c;
      return true;
    }
  }
  // Capped from above: creep sideways, keeping the heading's horizontal sense
  // where it has one so a stem under a ceiling carries on the way it leaned.
  const first = d === 1 ? (sim.chance(0.5) ? -1 : 1) : d - 1;
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? first : -first;
    if (canGrowInto(x + sx, y, sim)) {
      growX = x + sx;
      growY = y;
      growDir = sx < 0 ? 0 : 2;
      return true;
    }
  }
  return false;
}

/** Put a new plant cell at (tx,ty) as the live tip of its shoot. Moisture is
 *  handed on as if wicked one hop, so a fresh tip starts with what the gradient
 *  would give it anyway. */
function sprout(
  tx: number,
  ty: number,
  sim: SimContext,
  m: number,
  dir: number,
  seg: number,
  gen: number,
): void {
  sim.spawn(tx, ty, PLANT.id); // marks moved → the new cell waits for next tick
  sim.setAux(tx, ty, pack(m - WICK_STEP, true, dir, seg, gen));
}

/** Reservoir-sample one empty neighbour of (x,y) that foliage may take — looser
 *  than canGrowInto, so a bud can bunch leaves where a branch couldn't go. */
function pickLeafSpot(x: number, y: number, sim: SimContext): boolean {
  let count = 0;
  let found = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny) || !sim.isEmpty(nx, ny)) continue;
    if (plantNeighbours(nx, ny, sim) > LEAF_CROWD) continue;
    count++;
    if (sim.randInt(count) === 0) {
      growX = nx;
      growY = ny;
      found = true;
    }
  }
  return found;
}

/** Reservoir-sample one random empty neighbour of (x,y) into growX/growY. */
function pickEmpty(x: number, y: number, sim: SimContext): boolean {
  let count = 0;
  let found = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny) || !sim.isEmpty(nx, ny)) continue;
    count++;
    if (sim.randInt(count) === 0) {
      growX = nx;
      growY = ny;
      found = true;
    }
  }
  return found;
}

/**
 * Give a structure-less cell a role. Hand-painted plant (or a cell cloned/pasted
 * in) arrives with a zeroed aux: the cells along the top of what was painted
 * become tips and everything under them plain stem, so a painted patch sprouts
 * from its surface instead of every cell of it erupting at once.
 */
function initCell(x: number, y: number, sim: SimContext, m: number): number {
  let tip = true;
  for (let dx = -1; dx <= 1; dx++) {
    if (sim.inBounds(x + dx, y - 1) && sim.get(x + dx, y - 1) === PLANT.id) {
      tip = false;
      break;
    }
  }
  return pack(m, tip, 1, randSeg(sim), MAX_GEN);
}

/** Take a source cell's moisture: Water is absorbed outright (the pool visibly
 *  shrinks), Mud is drawn dry and firms back up into plain Dirt. */
function swallow(nx: number, ny: number, sim: SimContext): void {
  if (sim.get(nx, ny) === MUD.id) sim.spawn(nx, ny, DIRT.id);
  else sim.set(nx, ny, EMPTY);
}

/**
 * Roots. Standing fresh Water or Mud anywhere around the cell is drunk outright
 * and fills it; failing that the roots reach *down* through the soil for the
 * water table (soil.ts) — the poured bucket that has already drained out of
 * sight. A deep pocket of standing water is drunk the same way; ground that has
 * merely soaked water into its pores is a trickle rather than a source, so it
 * tops the cell up only to SOIL_MOISTURE and is left where it is.
 * Only runs once the cell is genuinely thirsty (see THIRST), so a root sips a
 * pond down over a long while instead of swallowing a cell every few ticks.
 */
function drink(x: number, y: number, sim: SimContext, a: number): number {
  if (moistOf(a) > THIRST) return a;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id && sim.chance(DRINK_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      return withMoist(a, MAX_MOISTURE);
    }
    if (nid === MUD.id && sim.chance(MUD_DRINK_CHANCE)) {
      sim.spawn(nx, ny, DIRT.id);
      return withMoist(a, MAX_MOISTURE);
    }
  }

  if (!sim.chance(DRINK_CHANCE)) return a;
  const wy = findMoisture(x, y, sim, ROOT_REACH);
  if (wy < 0) return a;
  if (moistDrinkable) {
    swallow(x, wy, sim);
    return withMoist(a, MAX_MOISTURE);
  }
  return moistOf(a) < SOIL_MOISTURE ? withMoist(a, SOIL_MOISTURE) : a;
}

/** Wick: pull moisture up from the wettest plant neighbour, losing WICK_STEP per
 *  hop, so moisture climbs outward from the roots as a decaying gradient. */
function wick(x: number, y: number, sim: SimContext, a: number): number {
  let best = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === PLANT.id) {
      const nm = moistOf(sim.getAux(nx, ny));
      if (nm > best) best = nm;
    }
  }
  return best - WICK_STEP > moistOf(a) ? withMoist(a, best - WICK_STEP) : a;
}

/** A tip advances, forks, or — out of vigour — sits as a bud that may set seed. */
function growTip(x: number, y: number, sim: SimContext, a: number): number {
  const m = moistOf(a);
  const seg = segOf(a);
  const gen = genOf(a);

  if (seg > 0) {
    // Extend the shoot by one cell; this cell settles into stem behind it.
    if (m < GROW_COST || !findGrowth(x, y, sim, dirOf(a))) return a;
    sprout(growX, growY, sim, m - GROW_COST, growDir, seg - 1, gen);
    return withMoist(a & ~TIP_BIT, m - GROW_COST);
  }

  if (gen > 0) {
    // Fork: two shoots that diverge as widely as the open space allows.
    if (m < BRANCH_COST) return a;
    const okL = canGrowInto(x - 1, y - 1, sim);
    const okU = canGrowInto(x, y - 1, sim);
    const okR = canGrowInto(x + 1, y - 1, sim);
    let d1 = -1;
    let d2 = -1;
    if (okL && okR) {
      d1 = 0;
      d2 = 2; // the widest fork available
    } else if (okL && okU) {
      d1 = 0;
      d2 = 1;
    } else if (okU && okR) {
      d1 = 1;
      d2 = 2;
    } else if (okL) d1 = 0;
    else if (okU) d1 = 1;
    else if (okR) d1 = 2;
    if (d1 < 0) return a; // boxed in — hold the tip and try again later

    const left = m - BRANCH_COST;
    sprout(x + d1 - 1, y - 1, sim, left, d1, randSeg(sim), gen - 1);
    if (d2 >= 0) sprout(x + d2 - 1, y - 1, sim, left, d2, randSeg(sim), gen - 1);
    return withMoist(a & ~TIP_BIT, left);
  }

  // Out of vigour: this tip is a bud. Well fed, it now and then sets a seed that
  // falls clear and can start a plant of its own somewhere else (see seed.ts).
  // SEED's id is read here rather than at module level: seed.ts imports this
  // module back, so at the moment this module's body runs that binding may still
  // be in its temporal dead zone (the deferred read obsidian.ts/stone.ts use).
  if (m >= SEED_COST && sim.chance(SEED_CHANCE) && pickEmpty(x, y, sim)) {
    sim.spawn(growX, growY, SEED.id);
    return withMoist(a, m - SEED_COST);
  }

  // Otherwise it leafs, filling the space around itself with foliage. A leaf is
  // spent growth: no vigour, no segment, never a tip, so it neither grows nor
  // shoots — it just sits there being green. The crowd rule stops the cluster
  // when the bud is properly surrounded.
  if (m >= LEAF_COST && sim.chance(LEAF_CHANCE) && pickLeafSpot(x, y, sim)) {
    sim.spawn(growX, growY, PLANT.id);
    sim.setAux(growX, growY, pack(m - WICK_STEP, false, dirOf(a), 0, 0));
    return withMoist(a, m - LEAF_COST);
  }
  return a;
}

/**
 * A stem that has lost whatever grew above it — a cut, a burn, a blast — and
 * still has water and vigour to spare breaks out a fresh shoot of its own,
 * spending one generation of that vigour. So a plant mown back re-sprouts from
 * the stump instead of standing there dead, and a plant only has so many of
 * those in it.
 *
 * The "nothing planted above me" test is what keeps this to actual regrowth: a
 * stem in the middle of a living stem has its own shoot overhead and never fires,
 * so a plant doesn't quietly burn its vigour on side shoots while it's still
 * growing normally.
 */
function lateralShoot(x: number, y: number, sim: SimContext, a: number): number {
  const gen = genOf(a);
  if (gen === 0 || moistOf(a) < BRANCH_COST || !sim.chance(SHOOT_CHANCE)) return a;
  let open = false;
  for (let dx = -1; dx <= 1; dx++) {
    if (sim.inBounds(x + dx, y - 1) && sim.get(x + dx, y - 1) === PLANT.id) return a;
    if (canGrowInto(x + dx, y - 1, sim)) open = true;
  }
  if (!open) return a;
  return pack(moistOf(a), true, sim.randInt(3), randSeg(sim), gen - 1);
}

// 발화점 — named because growth is halted by it as well as ignition driven by it:
// a plant already hot enough to catch must not spend the tick sprouting.
const AUTO_IGNITE_TEMP = 400;

function updatePlant(x: number, y: number, sim: SimContext): void {
  // Combustion first: a burning plant (once consumed → Fire) stops here, and it
  // doesn't grow while alight.
  if (tryBurn(x, y, sim)) return;
  if (sim.getTemp(x, y) >= AUTO_IGNITE_TEMP) return;

  let a = sim.getAux(x, y);
  if ((a & INIT_BIT) === 0) a = initCell(x, y, sim, moistOf(a));

  a = drink(x, y, sim, a);
  a = wick(x, y, sim, a);
  // Decay: bleed a little each tick, so a plant cut off from water dries out and
  // stops growing instead of climbing forever on stale moisture.
  if (moistOf(a) > 0 && sim.chance(DECAY_CHANCE)) a = withMoist(a, moistOf(a) - 1);

  if (isTip(a)) {
    if (sim.chance(GROW_CHANCE)) a = growTip(x, y, sim, a);
  } else {
    a = lateralShoot(x, y, sim, a);
  }

  sim.setAux(x, y, a);
}

export const PLANT = register({
  id: 47,
  name: 'Plant',
  phase: Phase.Solid,
  color: rgb(74, 122, 52),
  // Leaves are never one flat green — a per-cell brightness spread makes a stand
  // of growth read as foliage rather than a painted rectangle.
  colorVary: 16,
  density: 1000,
  // Burns via the shared combustion model (see updatePlant / combustion.ts), so
  // it's tagged `combustion`, not `flammable` — the two ignition paths are
  // mutually exclusive by design (combustion.ts) to keep the per-fuel burn rate.
  combustion: { burnChance: 0.1, autoIgniteTemp: AUTO_IGNITE_TEMP },
  category: 'life',
  // 피폭사 — radiation from anything in the 방사능 tab kills a cell outright and it
  // crumbles to Ash (see engine/radiation.ts). Ash rather than nothing because a
  // stand of growth beside a waste drum should visibly *collapse* into a grey
  // heap, and because Ash is a seed bed (seed.ts) — clear the source away and the
  // dead ground can be replanted.
  radiationDeath: ASH.id,
  thermal: { conductivity: 0.3 },
  update: updatePlant,
});
