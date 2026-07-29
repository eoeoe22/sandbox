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
//   bits 3-5   segment cells left before this branch forks
//   bits 6-7   generations of vigour left (forks remaining)
//   bit  8     tip (only a tip grows)
//   bit  9     initialised (this cell has been given a structural role)
//   bits 10-14 bleaching stress 0..MAX_STRESS
const DIR_MASK = 0b111;
const SEG_SHIFT = 3;
const GEN_SHIFT = 6;
const TIP_BIT = 1 << 8;
const INIT_BIT = 1 << 9;
const STRESS_SHIFT = 10;
const MAX_STRESS = 31;
const MAX_GEN = 3; // fork depth — a colony tops out at ~8 branch tips

/** The five directions coral will build in — everything but straight down and
 *  the two down-diagonals, so a head climbs and spreads but never drills into
 *  the seabed. Ordered by angle (left → up → right) so a heading can wander one
 *  step by ±1 and turning stays gradual. */
const CORAL_DX: readonly number[] = [-1, -1, 0, 1, 1];
const CORAL_DY: readonly number[] = [0, -1, -1, -1, 0];
const DIR_UP = 2; // index of straight up in the table above

const GROW_CHANCE = 0.012; // ~a tenth of a plant's pace: a reef takes its time
const TURN_CHANCE = 0.35; // chance a tip's heading wanders one step
const SINGLE_FORK_CHANCE = 0.3; // a fork that puts out one shoot, not two (asymmetry)
const CROWD_LIMIT = 1; // coral neighbours a target may already have (keeps fans thin)

const BLEACH_TEMP = 40; // above this the polyp cooks — 백화 by heat
const HEAT_STRESS_CHANCE = 0.12; // stress gained per tick while too hot
const DRY_STRESS_CHANCE = 0.25; // …and faster with no brine left around it at all
const HEAL_CHANCE = 0.03; // stress shed per tick while healthy — recovery is slow

const dirOf = (a: number): number => a & DIR_MASK;
const segOf = (a: number): number => (a >> SEG_SHIFT) & 0b111;
const genOf = (a: number): number => (a >> GEN_SHIFT) & 0b11;
const stressOf = (a: number): number => (a >> STRESS_SHIFT) & MAX_STRESS;
const isTip = (a: number): boolean => (a & TIP_BIT) !== 0;

function pack(dir: number, seg: number, gen: number, tip: boolean, stress: number): number {
  return (
    (dir & DIR_MASK) |
    ((seg & 0b111) << SEG_SHIFT) |
    ((gen & 0b11) << GEN_SHIFT) |
    (tip ? TIP_BIT : 0) |
    INIT_BIT |
    ((stress & MAX_STRESS) << STRESS_SHIFT)
  );
}

function withStress(a: number, s: number): number {
  const c = s < 0 ? 0 : s > MAX_STRESS ? MAX_STRESS : s;
  return (a & ~(MAX_STRESS << STRESS_SHIFT)) | (c << STRESS_SHIFT);
}

/** Headings a tip tries, as offsets from its own: itself first, then one step to
 *  either side. Forking wants the *widest* opening first, so it walks the same
 *  neighbourhood outside-in. Module-level so neither path allocates per call. */
const EXTEND_OFFSETS: readonly number[] = [0, -1, 1, -2, 2];
const FORK_OFFSETS: readonly number[] = [-2, -1, 1, 2, 0];

/** Cells a branch runs before forking. Later generations run shorter than the
 *  ones they came off — the self-similar taper that makes the fan read as coral. */
const randSeg = (sim: SimContext, gen: number): number => 2 + gen + sim.randInt(3);

/** How many of the 8 neighbours of (x,y) are Saltwater — the polyp's food, its
 *  building material, and (at zero) the thing whose absence bleaches it. */
function brineAround(x: number, y: number, sim: SimContext): number {
  let n = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === SALTWATER.id) n++;
  }
  return n;
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
function canGrowInto(x: number, y: number, sim: SimContext): boolean {
  return (
    sim.inBounds(x, y) &&
    sim.get(x, y) === SALTWATER.id &&
    coralNeighbours(x, y, sim) <= CROWD_LIMIT
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
  if (sim.chance(TURN_CHANCE)) d = sim.chance(0.5) ? d - 1 : d + 1;
  if (d < 0) d = 0;
  else if (d > 4) d = 4;

  const seg = segOf(a);
  const gen = genOf(a);
  for (const off of EXTEND_OFFSETS) {
    const c = d + off;
    if (c < 0 || c > 4) continue;
    const tx = x + CORAL_DX[c];
    const ty = y + CORAL_DY[c];
    if (!canGrowInto(tx, ty, sim)) continue;
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
  // Widest-first: two steps out to either side, then one, so a fork opens up.
  let first = -1;
  let second = -1;
  for (const off of FORK_OFFSETS) {
    const c = d + off;
    if (c < 0 || c > 4) continue;
    if (!canGrowInto(x + CORAL_DX[c], y + CORAL_DY[c], sim)) continue;
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
 * in) arrives with a zeroed aux: a cell with brine touching it is a live polyp
 * heading upward, one walled inside the colony is plain skeleton.
 */
function initCell(x: number, y: number, sim: SimContext): number {
  const tip = brineAround(x, y, sim) > 0;
  return pack(DIR_UP, randSeg(sim, MAX_GEN), MAX_GEN, tip, 0);
}

function updateCoral(x: number, y: number, sim: SimContext): void {
  let a = sim.getAux(x, y);
  if ((a & INIT_BIT) === 0) a = initCell(x, y, sim);

  // 백화 — too hot, or no brine left around it, and the polyp starts dying. The
  // stress it has built up is what decides, so damage has to be sustained.
  const brine = brineAround(x, y, sim);
  const hot = sim.getTemp(x, y) >= BLEACH_TEMP;
  let stress = stressOf(a);
  if (brine === 0 && sim.chance(DRY_STRESS_CHANCE)) stress++;
  else if (hot && sim.chance(HEAT_STRESS_CHANCE)) stress++;
  else if (!hot && brine > 0 && stress > 0 && sim.chance(HEAL_CHANCE)) stress--;

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
