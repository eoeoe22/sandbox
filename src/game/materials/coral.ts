import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { SALTWATER } from './saltwater';
import { BLEACHED_CORAL } from './bleachedcoral';

// Coral (산호) — the reef builder: the one living thing that grows *inside* salt
// water. Where Plant drinks fresh water and climbs into the air (plant.ts), a
// coral head stays submerged and lays down skeleton through the brine around it,
// branching as it goes into the thin, self-similar fans a real reef makes.
//
// Three rules carry the whole material:
//
//   1. 소금물 안에서만, 천천히 — a growing tip only ever converts an adjacent
//      SALTWATER cell into new coral, at GROW_CHANCE per tick, which is roughly
//      a tenth of a plant's pace. So a reef takes real time to fill a tank, and
//      it can only ever grow as far as the brine reaches: the water level is the
//      colony's outline. The brine it builds into is consumed, exactly the way a
//      plant drinks a puddle down, so a small pool eventually limits its own reef.
//   2. 유사 프렉탈 — growth is a branching L-system like the plant's (see
//      plant.ts for the shared shape of it), tuned for a reef: a tip carries a
//      heading through the five non-downward directions, runs a segment, then
//      FORKS into two diverging tips with one less generation of vigour, and each
//      generation's segments are SHORTER than its parent's (`randSeg`) — the
//      self-similar taper that makes a fan read as coral rather than as a shrub.
//      A tip may only take a cell with at most one coral neighbour, so branches
//      stay one cell thin and two fans that drift together never fuse into a slab.
//   3. 백화 (bleaching) — a coral cell that is too hot, or that no longer has
//      brine around it, accumulates STRESS in its `aux`; when the stress maxes
//      out the polyp dies and the cell becomes Bleached Coral, a white skeleton
//      (bleachedcoral.ts). Both triggers are the real thing: warm the tank past
//      BLEACH_TEMP, or drain it / flood it with fresh water, and the colour goes
//      out of the reef from wherever the damage started. Stress recovers far more
//      slowly than it builds, so a brief scare heals and a sustained one doesn't;
//      put the brine back and cool it down and even bleached skeleton can be
//      recolonised in time (see bleachedcoral.ts).
//
// A stressed polyp also stops growing, so a reef that is losing colour is visibly
// a reef that has stopped building.

// --- aux layout (16 bits, see Grid.aux) -------------------------------------
//   bits 0-2   heading, an index into CORAL_DX/CORAL_DY (0..4)
//   bits 3-4   segment cells left before this branch forks
//   bits 5-7   generations of vigour left (forks remaining)
//   bit  8     tip (only a tip grows)
//   bit  9     initialised (this cell has been given a structural role)
//   bits 10-12 bleaching stress 0..MAX_STRESS
//   bits 13-15 hydration 0..MAX_HYDRATION (how near brine this cell is — see below)
const DIR_MASK = 0b111;
const SEG_SHIFT = 3;
const SEG_MASK = 0b11;
const GEN_SHIFT = 5;
const GEN_MASK = 0b111;
const TIP_BIT = 1 << 8;
const INIT_BIT = 1 << 9;
const STRESS_SHIFT = 10;
const MAX_STRESS = 7;
const HYD_SHIFT = 13;
const MAX_HYDRATION = 7;
const MAX_GEN = 5; // fork depth — a colony fans out to ~30 branch tips

/** The five directions coral will build in — everything but straight down and
 *  the two down-diagonals, so a head climbs and spreads but never drills into
 *  the seabed. Ordered by angle (left → up → right) so a heading can wander one
 *  step by ±1 and turning stays gradual. */
const CORAL_DX: readonly number[] = [-1, -1, 0, 1, 1];
const CORAL_DY: readonly number[] = [0, -1, -1, -1, 0];
const DIR_UP = 2; // index of straight up in the table above

const GROW_CHANCE = 0.012; // ~a tenth of a plant's pace: a reef takes its time
const TURN_CHANCE = 0.12; // chance a tip's heading wanders one step
const RIGHTING_CHANCE = 0.5; // chance a flat-running tip turns back upward
const SINGLE_FORK_CHANCE = 0.12; // a fork that puts out one shoot, not two (asymmetry)

const BLEACH_TEMP = 40; // above this the polyp cooks — 백화 by heat
const HEAT_STRESS_CHANCE = 0.03; // stress gained per tick while too hot
const DRY_STRESS_CHANCE = 0.06; // …and faster once the brine is gone entirely
const HEAL_CHANCE = 0.007; // stress shed per tick while healthy — recovery is slow

const dirOf = (a: number): number => a & DIR_MASK;
const segOf = (a: number): number => (a >> SEG_SHIFT) & SEG_MASK;
const genOf = (a: number): number => (a >> GEN_SHIFT) & GEN_MASK;
const stressOf = (a: number): number => (a >> STRESS_SHIFT) & MAX_STRESS;
const hydOf = (a: number): number => (a >> HYD_SHIFT) & MAX_HYDRATION;
const isTip = (a: number): boolean => (a & TIP_BIT) !== 0;

function pack(dir: number, seg: number, gen: number, tip: boolean, hyd: number): number {
  return (
    (dir & DIR_MASK) |
    ((seg & SEG_MASK) << SEG_SHIFT) |
    ((gen & GEN_MASK) << GEN_SHIFT) |
    (tip ? TIP_BIT : 0) |
    INIT_BIT |
    ((hyd & MAX_HYDRATION) << HYD_SHIFT)
  );
}

function withStress(a: number, s: number): number {
  const c = s < 0 ? 0 : s > MAX_STRESS ? MAX_STRESS : s;
  return (a & ~(MAX_STRESS << STRESS_SHIFT)) | (c << STRESS_SHIFT);
}

function withHydration(a: number, h: number): number {
  const c = h < 0 ? 0 : h > MAX_HYDRATION ? MAX_HYDRATION : h;
  return (a & ~(MAX_HYDRATION << HYD_SHIFT)) | (c << HYD_SHIFT);
}

/** Headings a tip tries, as offsets from its own: itself first, then one step to
 *  either side. A fork wants to open a **Y**, so it reaches for the one-step
 *  headings first and only takes the flat sideways ones when nothing else is
 *  free — reaching outside-in instead made colonies throw long horizontal limbs
 *  that read as legs, not coral. Module-level so neither path allocates. */
const EXTEND_OFFSETS: readonly number[] = [0, -1, 1, -2, 2];
const FORK_OFFSETS: readonly number[] = [-1, 1, -2, 2, 0];

/** Cells a branch runs before forking — short, and shorter still in the later
 *  generations. Short runs between forks are what makes a colony read as a dense
 *  twiggy reef rather than a few long wandering arms. */
const randSeg = (sim: SimContext, gen: number): number =>
  1 + sim.randInt(gen >= MAX_GEN - 1 ? 3 : 2);

/** Coral neighbours a target may already have. The trunk end of a colony (the
 *  generations nearest the base) is allowed one more than the twigs, so a reef
 *  thickens where it is anchored and stays fine at the tips — a branch that is
 *  one cell wide from seabed to crown is the other half of the "spindly legs"
 *  look. */
const crowdLimit = (gen: number): number => (gen >= MAX_GEN - 1 ? 2 : 1);

/**
 * Hydration — how near this polyp is to open brine, counted *through the colony*
 * rather than only in its own eight neighbours.
 *
 * This is what stops a reef bleaching from the inside out. A cell walled in by
 * its own colony touches no saltwater at all, so a plain neighbour check called
 * a fully submerged reef "dry" and killed its core while the outside stayed
 * healthy. Instead a cell in contact with brine sits at MAX_HYDRATION and every
 * other cell takes its wettest coral neighbour's value minus one, so hydration
 * seeps inward one cell per tick and a colony up to MAX_HYDRATION cells thick is
 * wet throughout. (The same decaying-gradient trick as a plant's moisture — see
 * plant.ts.) Drain the tank and the whole gradient collapses within a few ticks,
 * so 백화 by drought still works exactly as before.
 */
function hydrate(x: number, y: number, sim: SimContext, a: number): number {
  let best = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (id === SALTWATER.id) return withHydration(a, MAX_HYDRATION);
    if (id === CORAL.id) {
      const h = hydOf(sim.getAux(nx, ny));
      if (h > best) best = h;
    }
  }
  return withHydration(a, best - 1);
}

function coralNeighbours(x: number, y: number, sim: SimContext): number {
  let n = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === CORAL.id) n++;
  }
  return n;
}

/** Somewhere a tip may build: a brine cell that isn't already crowded by coral. */
function canGrowInto(x: number, y: number, sim: SimContext, gen: number): boolean {
  return (
    sim.inBounds(x, y) &&
    sim.get(x, y) === SALTWATER.id &&
    coralNeighbours(x, y, sim) <= crowdLimit(gen)
  );
}

/** Lay down one new coral cell as the live tip of its branch, consuming the
 *  brine cell it grows into. */
function build(x: number, y: number, sim: SimContext, dir: number, seg: number, gen: number): void {
  sim.spawn(x, y, CORAL.id); // marks moved → the new cell waits for next tick
  sim.setAux(x, y, pack(dir, seg, gen, true, 0));
}

/** A tip builds one cell along its heading, wandering a step now and then and
 *  falling back to its neighbouring headings when the brine ahead is taken. */
function extend(x: number, y: number, sim: SimContext, a: number): number {
  let d = dirOf(a);
  if (d === 0 || d === 4) {
    // A branch that ended up running dead flat rights itself: left/right are in
    // the table so a colony can spread, but a tip that *keeps* one of them lays
    // a long horizontal bar, and bars are what made reefs read as legs.
    if (sim.chance(RIGHTING_CHANCE)) d = d === 0 ? 1 : 3;
  } else if (sim.chance(TURN_CHANCE)) {
    d = sim.chance(0.5) ? d - 1 : d + 1;
  }
  if (d < 0) d = 0;
  else if (d > 4) d = 4;

  const seg = segOf(a);
  const gen = genOf(a);
  for (const off of EXTEND_OFFSETS) {
    const c = d + off;
    if (c < 0 || c > 4) continue;
    const tx = x + CORAL_DX[c];
    const ty = y + CORAL_DY[c];
    if (!canGrowInto(tx, ty, sim, gen)) continue;
    build(tx, ty, sim, c, seg - 1, gen);
    return a & ~TIP_BIT;
  }
  return a; // walled in by rock, air or its own colony — hold and retry later
}

/** A branch that has run its length forks into two diverging tips (sometimes
 *  one, for asymmetry), each a generation weaker and shorter-lived. */
function fork(x: number, y: number, sim: SimContext, a: number): number {
  const d = dirOf(a);
  const gen = genOf(a) - 1;
  // A Y first (one step out to either side), flat sideways only as a fallback.
  let first = -1;
  let second = -1;
  for (const off of FORK_OFFSETS) {
    const c = d + off;
    if (c < 0 || c > 4) continue;
    if (!canGrowInto(x + CORAL_DX[c], y + CORAL_DY[c], sim, gen)) continue;
    if (first < 0) first = c;
    else if (second < 0 || Math.abs(c - first) > Math.abs(second - first)) second = c;
  }
  if (first < 0) return a; // nowhere to open up — hold the tip
  build(x + CORAL_DX[first], y + CORAL_DY[first], sim, first, randSeg(sim, gen), gen);
  if (second >= 0 && !sim.chance(SINGLE_FORK_CHANCE)) {
    build(x + CORAL_DX[second], y + CORAL_DY[second], sim, second, randSeg(sim, gen), gen);
  }
  return a & ~TIP_BIT;
}

/**
 * Give a structure-less cell a role. Hand-painted coral (or a cell cloned/pasted
 * in) arrives with a zeroed aux: a cell the brine reaches is a live polyp heading
 * upward, one walled deep inside the colony is plain skeleton.
 */
function initCell(sim: SimContext, wet: boolean): number {
  return pack(DIR_UP, randSeg(sim, MAX_GEN), MAX_GEN, wet, 0);
}

function updateCoral(x: number, y: number, sim: SimContext): void {
  let a = sim.getAux(x, y);
  // Hydration first: it decides both whether this cell is drying out and, for a
  // freshly painted cell, whether it starts as a live polyp or plain skeleton.
  a = hydrate(x, y, sim, a);
  const wet = hydOf(a) > 0;
  if ((a & INIT_BIT) === 0) a = withHydration(initCell(sim, wet), hydOf(a));

  // 백화 — too hot, or cut off from the brine, and the polyp starts dying. The
  // stress it has built up is what decides, so damage has to be sustained.
  const hot = sim.getTemp(x, y) >= BLEACH_TEMP;
  let stress = stressOf(a);
  if (!wet && sim.chance(DRY_STRESS_CHANCE)) stress++;
  else if (hot && sim.chance(HEAT_STRESS_CHANCE)) stress++;
  else if (!hot && wet && stress > 0 && sim.chance(HEAL_CHANCE)) stress--;

  if (stress >= MAX_STRESS) {
    // Dead: what's left is the white skeleton. In-place `set` keeps the cell's
    // temperature (a reef bleached by heat stays hot); its aux is coral state
    // that means nothing to a skeleton, so clear it. BLEACHED_CORAL's id is read
    // here rather than at module level because bleachedcoral.ts imports this
    // module back (the deferred read obsidian.ts/stone.ts use).
    sim.set(x, y, BLEACHED_CORAL.id);
    sim.setAux(x, y, 0);
    return;
  }
  a = withStress(a, stress);

  // A stressed polyp stops building — a reef losing its colour visibly stops
  // growing too. Only tips build, and only into brine.
  if (isTip(a) && stress === 0 && sim.chance(GROW_CHANCE)) {
    a = segOf(a) > 0 ? extend(x, y, sim, a) : genOf(a) > 0 ? fork(x, y, sim, a) : a;
  }

  sim.setAux(x, y, a);
}

export const CORAL = register({
  id: 134,
  name: 'Coral',
  phase: Phase.Solid,
  // Reef pink with a warm cast — deliberately the loudest thing in the water, so
  // losing it to bleaching reads instantly.
  color: rgb(214, 96, 118),
  // A colony is never one flat tone; the spread makes a fan read as living tissue.
  colorVary: 20,
  density: 1000,
  category: 'life',
  // Calcium carbonate skeleton — it conducts about like the limestone it is.
  thermal: { conductivity: 0.4 },
  update: updateCoral,
});
