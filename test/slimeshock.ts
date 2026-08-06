// Headless behavioural harness for 슬라임 전기분해 — "전기 브러시로 웅덩이를 한 번
// 훑으면 슬라임이 정리되는가", and the reason the answer used to be no.
//
// The reported bug was not that the sweep did nothing: most of the goo dissolved.
// It was that it all came back. A dissolved cell used to revert to Water, and
// slime *drinks water and grows without bound*, so the current handed its own
// kill straight back as feedstock — a swept 722-cell pool bottomed out at ~190
// cells and was whole again a few seconds later. That loop cannot be tuned out,
// which is the point this file exists to hold: it is a *conversion* between two
// things both still on the board, so any survivor at all rebuilds everything. The
// fix is that the goo now leaves as gas (Hydrogen, plus the Oxygen that goes with
// it) exactly like the water it is made of does under a spark, so what the current
// takes stays taken.
//
// What this pins, in the order it matters:
//
//   • **A sweep clears the pool and it stays cleared.** Measured long after the
//     sweep, not at the moment of it — a rebound is the failure mode, and the
//     low-water mark cannot see one.
//   • **Nothing is left to grow back from.** A swept pool ends with *zero* water
//     in it. This is the whole design in one number: revert this to Water and the
//     scene above regrows no matter what the other constants say.
//   • **It is the sweep that does it.** The control — the same pool, never sparked
//     — keeps every cell.
//   • **One shock is still one shock.** A single front seeded in a large blob
//     takes its bounded bite and stops, so 지속적인 전류가 필요하다 survives the
//     raised seeding rate.
//   • **Current reaches the body of a pool, not just its skin.** Painting only the
//     top two rows still clears it, because the goo conducts ~31 cells (spark.ts
//     CONDUCTOR_LOSS). If Slime's `sparkLoss` is ever raised, this is what tells
//     you the brush stopped being a weapon.
//
// Run: `node test/run-slimeshock.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { packSpark, conductorClass, FULL_STRENGTH, SPARK } from '../src/game/materials/spark';
import { SLIME_DISSOLVE_BUDGET } from '../src/game/materials/slime';
import '../src/game/materials';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Each block runs on its own seeded stream, so a change to one scene can't shift
 *  every later scene's randomness. `SEED_BASE=7 node test/run-slimeshock.mjs`
 *  re-runs the whole harness on a different stream — nothing here is tuned to one
 *  lucky seed. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x5117);
let reseeds = 0;
function reseed(): void {
  Math.random = mulberry32(SEED_BASE + ++reseeds * 0x9e37);
}
reseed();

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const ID = (name: string): number => {
  for (let i = 1; i < 256; i++) {
    const m = getMaterial(i);
    if (m && m.name === name) return i;
  }
  throw new Error('no material ' + name);
};
const WALL = ID('Wall');
const WATER = ID('Water');
const SLIME = ID('Slime');
const ACID_SLIME = ID('Acid Slime');
const HYDROGEN = ID('Hydrogen');

function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = grid.idx(x, y);
      grid.cells[i] = id;
      grid.aux[i] = 0;
      grid.tint[i] = (Math.random() * 256) | 0;
    }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Goo cells of either kind — Acid Slime is rinsed to plain Slime by water it
 *  drinks (acidslime.ts DILUTE_CHANCE), so counting only the id a scene started
 *  with would score a *conversion* as a kill. */
function goo(grid: Grid): number {
  return count(grid, SLIME) + count(grid, ACID_SLIME);
}

const W = 40;
const H = 40;
/** A walled box with a goo pool on the floor and open air above it — the scene
 *  from the report. The air matters: the gas the goo splits into needs somewhere
 *  to go, and a sealed-solid box would measure something else. */
function pool(gooId: number, topRow: number): { grid: Grid; sim: Simulation } {
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  fill(grid, 0, 0, W - 1, H - 1, WALL);
  fill(grid, 1, 1, W - 2, H - 2, 0);
  fill(grid, 1, topRow, W - 2, H - 2, gooId);
  return { grid, sim };
}

/** The 전기 브러시 across rows y0..y1, in one pass. This is `pulseCell`'s effect
 *  written straight into the grid (brushTools.sparkCells is a loop over it): a
 *  ready conductor becomes a full-strength Spark carrying its own class. The one
 *  thing not reproduced is the frontier queue, which only decides how many cells a
 *  pulse crosses *within* a tick — spark.ts's two-turn split pins every per-cell
 *  consequence to the pulse rather than to the clock, so what is measured here is
 *  the brush's. */
function sweep(grid: Grid, y0: number, y1: number): number {
  let painted = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = 1; x <= W - 2; x++) {
      const i = grid.idx(x, y);
      const id = grid.cells[i];
      if (id !== SLIME && id !== ACID_SLIME) continue;
      if (grid.aux[i] !== 0) continue; // refractory / carrying state — pulseCell skips it
      grid.cells[i] = SPARK.id;
      grid.aux[i] = packSpark(FULL_STRENGTH, conductorClass(id));
      painted++;
    }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  return painted;
}

const TICKS = 400;
/** Run, reporting both the low-water mark and where it ended up. The gap between
 *  the two *is* the bug: before the change they were ~190 and ~722. */
function sweptRun(gooId: number, topRow: number, from: number): { start: number; low: number; final: number; grid: Grid } {
  const { grid, sim } = pool(gooId, topRow);
  const start = goo(grid);
  sweep(grid, from, H - 2);
  let low = start;
  for (let t = 0; t < TICKS; t++) {
    sim.step();
    // From tick 4 on: for the first few ticks every painted cell *is* a Spark, so
    // the goo count is trivially zero and would score as a clearance.
    const n = goo(grid);
    if (t >= 4 && n < low) low = n;
  }
  return { start, low, final: goo(grid), grid };
}

// 1. The reported scene, for both goos: a pool on the floor, one full pass of the
//    brush, then four hundred ticks — long past anything that could still be
//    settling. The bar is on `final`, because `low` was never the problem.
for (const [label, gooId, topRow] of [
  ['slime', SLIME, 20],
  ['acid slime', ACID_SLIME, 20],
] as const) {
  reseed();
  const r = sweptRun(gooId, topRow, topRow);
  check(`one sweep clears a ${label} pool`, r.final <= r.start * 0.1,
    `${r.final} of ${r.start} left after ${TICKS} ticks`);
  check(`…and the ${label} does not grow back`, r.final <= r.low + 2,
    `low ${r.low}, final ${r.final}`);
  // The invariant the whole design rests on. A dissolved cell that left Water
  // behind would show up here, and scene 1 above would regrow off it no matter
  // what any other constant says.
  check(`…because a dissolved ${label} leaves gas, not a puddle`,
    count(r.grid, WATER) === 0 && count(r.grid, HYDROGEN) > 0,
    `${count(r.grid, WATER)} water, ${count(r.grid, HYDROGEN)} hydrogen`);
}

// 2. The control. The same pool, never sparked: nothing in the scene can remove a
//    cell of goo, which is what makes #1 a measurement of the current rather than
//    of some other pass quietly eating the pool.
for (const [label, gooId] of [
  ['slime', SLIME],
  ['acid slime', ACID_SLIME],
] as const) {
  reseed();
  const { grid, sim } = pool(gooId, 24);
  const start = goo(grid);
  for (let t = 0; t < TICKS; t++) sim.step();
  check(`unsparked ${label} keeps every cell`, goo(grid) === start, `${goo(grid)} of ${start}`);
}

// 3. One shock is still one shock. A single dissolve front seeded dead centre of a
//    deep pool eats its worm and stops: nothing about the front refreshes itself,
//    so the bite is the budget and not a chain reaction. This is the check that
//    keeps 지속적인 전류가 필요하다 true after the seeding rate went up 4×.
{
  reseed();
  const { grid, sim } = pool(SLIME, 20);
  const start = goo(grid);
  grid.aux[grid.idx(W >> 1, H - 10)] = SLIME_DISSOLVE_BUDGET; // what one shocked cell is stamped with
  for (let t = 0; t < 300; t++) sim.step();
  const lost = start - goo(grid);
  check('a single dissolve front takes a bounded bite', lost <= start * 0.06,
    `${lost} of ${start} cells lost`);
  check('…and it is a real bite, not a no-op', lost >= 10, `${lost} cells`);
}

// 4. Reach. Painting only the top two rows of a deep pool still clears it, because
//    a pulse carries ~31 cells through the goo and seeds fronts the whole way down
//    (spark.ts CONDUCTOR_LOSS / Slime's `sparkLoss`). Without that the brush would
//    only ever skin the surface, and the player would have to paint every cell of a
//    body of goo by hand.
{
  reseed();
  const { grid, sim } = pool(SLIME, 20);
  const start = goo(grid);
  const painted = sweep(grid, 20, 21);
  for (let t = 0; t < TICKS; t++) sim.step();
  check('a surface-only pass reaches the body of the pool',
    goo(grid) <= start * 0.15,
    `painted ${painted} of ${start}, ${goo(grid)} left`);
}

console.log(failures === 0 ? '\nAll slime shock checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
