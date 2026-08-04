// Headless behavioural harness for the 산성 슬라임 레시피 — the two-way recipe that
// makes Acid Slime out of Slime and takes it back again.
//
//   산 + 슬라임 → 산성 슬라임         (acid.ts, declarative `reactions` table)
//   물 + 산성 슬라임 → 일반 슬라임     (acidslime.ts, on the feed path)
//
// Both halves are cheap to write and easy to get subtly wrong, and the two failure
// modes are opposite: a recipe that doesn't consume its reagent turns one drop into
// a world-eating catalyst, and one that consumes too much never visibly fires at
// all. So what this file pins is the *bookkeeping* as much as the outcome:
//
//   • **Acid poured on Slime acidifies it, one cell per acid cell.** Acid Slime
//     appears at the boundary, and the acid consumed exactly equals the slime
//     converted (`produce: EMPTY`). The goo itself is conserved — every cell of
//     Slime that stops being Slime is now Acid Slime, none of it vanishes.
//   • **Acid alone doesn't evaporate.** The control: the same box with no slime
//     in it keeps every acid cell, so the loss measured above is the recipe's and
//     not some other pass eating the puddle.
//   • **Water takes it back.** An Acid Slime blob dropped in a pool ends up
//     ordinary Slime — the acidity is gone — while the goo as a whole *grows*,
//     because the blob is still feeding the whole time. Both halves of the
//     dilution show up here: the water it drinks comes back plain half the time,
//     and the cell doing the drinking gets rinsed clean.
//   • **Water is spent doing it.** The pool shrinks; a blob can't be neutralised
//     by a cell of water acting as a catalyst.
//   • **Plain Slime is untouched by the same scene** — no path turns Slime acidic
//     without acid, which is what makes the recipe the only source.
//
// Run: `node test/run-acidslime.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { SPARK, packSpark, conductorClass } from '../src/game/materials/spark';
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
 *  every later scene's randomness. `SEED_BASE=7 node test/run-acidslime.mjs`
 *  re-runs the whole harness on a different stream — nothing here is tuned to one
 *  lucky seed. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0xac1d);
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
const ACID = ID('Acid');
const SLIME = ID('Slime');
const ACID_SLIME = ID('Acid Slime');

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

// A sealed, completely full box (wall border, no empty cell inside), the same
// shape test/miscible.ts uses: with nowhere to flow, the only thing that can
// change a cell is a reaction or a swap, so a scene's outcome is about the pair
// and nothing else. Acid is lighter than either goo (3 vs 4), so it starts on top
// and the two meet along one flat seam.
const BOX = { x0: 1, y0: 1, x1: 24, y1: 24 };
const MID = (BOX.y0 + BOX.y1 - 1) >> 1;
function layered(topId: number, botId: number): { grid: Grid; sim: Simulation } {
  const grid = new Grid(26, 26);
  const sim = new Simulation(grid);
  fill(grid, 0, 0, 25, 25, WALL);
  fill(grid, BOX.x0, BOX.y0, BOX.x1, MID, topId);
  fill(grid, BOX.x0, MID + 1, BOX.x1, BOX.y1, botId);
  return { grid, sim };
}

const TICKS = 600;

// 1. The recipe. Acid over Slime: the seam turns to Acid Slime, and it keeps
//    turning as fresh acid works into the goo it hasn't reached.
//
//    The accounting here is what pins the *shape* of the reaction, and that shape
//    is Acid's own corrosion (acid.ts): it converts on contact and spends the acid
//    cell only occasionally, so the acid outlasts a single bite but still runs
//    down. Both halves get a check, because each failure is silent in its own way
//    — never spending the acid makes one drop a world-eating catalyst, and always
//    spending it is where this started and was far too weak to read as an effect.
{
  reseed();
  const { grid, sim } = layered(ACID, SLIME);
  const acid0 = count(grid, ACID);
  const goo0 = count(grid, SLIME);
  for (let t = 0; t < TICKS; t++) sim.step();
  const acidSlime = count(grid, ACID_SLIME);
  const slime = count(grid, SLIME);
  const acidSpent = acid0 - count(grid, ACID);
  // 40%, and the ceiling is geometry rather than the rule: this box is sealed and
  // full, so the acid meets the goo along one flat seam and can never get under or
  // around it — the far side of the slime is only ever reached by the two goos
  // interdiffusing. (Poured over a blob on open ground, where the acid can run
  // down its flanks, the same rule takes ~82% of a 144-cell blob.) What the bar
  // is really separating is "works through the blob" from the old strict-1:1
  // behaviour, which managed a quarter of this scene.
  check('acid poured on slime works well into the blob', acidSlime > goo0 * 0.4,
    `${acidSlime} acid slime out of ${goo0} goo`);
  check('…outlasting a single bite, so a splash works rather than stains',
    acidSpent < acidSlime, `${acidSpent} acid spent for ${acidSlime} cells converted`);
  check('…while still being spent by the work (no free catalyst)', acidSpent > 0,
    `${acidSpent} acid spent`);
  check('…and converting, not creating or destroying, the goo',
    slime + acidSlime === goo0, `${slime} slime + ${acidSlime} acid slime vs ${goo0}`);
}

// 2. The control for #1: the same box with Water underneath instead of Slime.
//    Acid neither corrodes the wall nor consumes itself with nothing to eat, so
//    every cell is still there — which is what makes #1's acid loss the recipe's.
{
  reseed();
  const { grid, sim } = layered(ACID, WATER);
  const acid0 = count(grid, ACID);
  for (let t = 0; t < TICKS; t++) sim.step();
  check('acid with no slime to acidify keeps every cell',
    count(grid, ACID) === acid0, `${count(grid, ACID)}/${acid0}`);
  check('…and no acid slime appears out of nowhere', count(grid, ACID_SLIME) === 0);
}

// 3. The undo. An Acid Slime blob in a pool of water: it feeds the whole time, so
//    the goo *grows*, but what it grows into is plain Slime — half of every cell
//    it drinks, plus the cells rinsed clean by the water they were drinking.
//
//    Scored as a *share* rather than a count, because this box is the harshest
//    case for the dilution and deliberately so: the blob starts as a packed
//    square, so only its face is ever wet, and the plain Slime it grows there
//    drinks the pool alongside it — the buried middle can go a long time without
//    ever touching water. What water does reliably is decide what the blob turns
//    into, and by the time the pool is drunk the mound reads green with an acidic
//    core, not acidic throughout.
{
  reseed();
  const grid = new Grid(26, 26);
  const sim = new Simulation(grid);
  fill(grid, 0, 0, 25, 25, WALL);
  fill(grid, BOX.x0, BOX.y0, BOX.x1, BOX.y1, WATER);
  fill(grid, 9, 9, 16, 16, ACID_SLIME); // a blob suspended in the middle of it
  const goo0 = count(grid, ACID_SLIME);
  const water0 = count(grid, WATER);
  for (let t = 0; t < TICKS; t++) sim.step();
  const acidSlime = count(grid, ACID_SLIME);
  const slime = count(grid, SLIME);
  const acidShare = acidSlime / (slime + acidSlime);
  check('a quenched acid slime blob ends up mostly plain slime', acidShare < 0.15,
    `${(acidShare * 100).toFixed(0)}% of the goo is still acidic`);
  check('…with a good part of the original blob rinsed clean outright',
    acidSlime < goo0 * 0.75, `${acidSlime} acid slime left of the ${goo0} poured`);
  check('…while still feeding, so the goo grows overall', slime + acidSlime > goo0,
    `${slime + acidSlime} goo vs ${goo0} to start`);
  check('…and the water is spent doing it', count(grid, WATER) < water0,
    `${count(grid, WATER)}/${water0} water left`);
}

// 4. The control for #3: plain Slime in the same pool never turns acidic. Nothing
//    but acid makes Acid Slime, which is what keeps the recipe the only source.
{
  reseed();
  const grid = new Grid(26, 26);
  const sim = new Simulation(grid);
  fill(grid, 0, 0, 25, 25, WALL);
  fill(grid, BOX.x0, BOX.y0, BOX.x1, BOX.y1, WATER);
  fill(grid, 9, 9, 16, 16, SLIME);
  const goo0 = count(grid, SLIME);
  for (let t = 0; t < TICKS; t++) sim.step();
  check('plain slime in water stays plain slime', count(grid, ACID_SLIME) === 0);
  check('…and still feeds', count(grid, SLIME) > goo0,
    `${count(grid, SLIME)} vs ${goo0} to start`);
}

// 5. The two halves meeting in one tick — the regression this file exists to
//    catch as much as anything. A rinsed cell becomes plain Slime, and Slime is
//    now a reaction-table partner, so an Acid cell that has not had its turn yet
//    can pick the fresh Slime up and convert it straight back inside the same
//    tick: a water cell and an acid cell spent for no visible change, with the
//    "water undoes the recipe" mechanic quietly cancelled wherever all three
//    happen to touch. `tryReact`'s hasMoved partner guard is what stops it, and
//    the rinsed cell has to opt in by marking itself moved.
//
//    Forced rolls (every `chance` succeeds) and three hand-placed cells resting
//    on the floor, because this is about scan order rather than probability: the
//    scan runs bottom-up, so the Acid a row higher is guaranteed to take its turn
//    *after* the goo, and it is diagonally adjacent so the rinsed cell is inside
//    its reaction scan. Without the moved mark this ends as Acid Slime with both
//    the water and the acid consumed — verified by removing it.
{
  const grid = new Grid(12, 12);
  const sim = new Simulation(grid);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++)
      grid.cells[grid.idx(x, y)] = x === 0 || y === 0 || x === 11 || y === 11 ? WALL : 0;
  grid.cells[grid.idx(5, 10)] = ACID_SLIME; // on the floor
  grid.cells[grid.idx(5, 9)] = WATER; // …the water it rinses itself with, above it
  grid.cells[grid.idx(4, 9)] = ACID; // …and an acid cell that acts later this tick
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const rolled = Math.random;
  Math.random = () => 0; // every chance() fires: dilution is certain, so is the recipe
  sim.step();
  Math.random = rolled;
  check('a cell rinsed clean is not re-acidified by acid in the same tick',
    grid.get(5, 10) === SLIME, `cell is ${getMaterial(grid.get(5, 10)).name}`);
}

// 6. The same hazard from the other direction, and the reason it is worth a
//    second check: a Spark travelling through a Slime blob reverts its cell to
//    Slime at the end of its turn (spark.ts), which is another bare write of a
//    material that only became a reaction partner when the recipe landed. Left
//    unmarked it chains Spark → Slime → Acid Slime inside one tick — a same-tick
//    cascade, which engine/reactions.ts's design note rules out outright.
//
//    Built with the packing helpers rather than a battery so it is exact: one
//    energized cell at strength 1 (so it dies here instead of handing the pulse
//    to the acid, which would give that cell a turn as a Spark and hide the
//    thing being measured), and every roll forced to succeed.
{
  const grid = new Grid(12, 12);
  const sim = new Simulation(grid);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++)
      grid.cells[grid.idx(x, y)] = x === 0 || y === 0 || x === 11 || y === 11 ? WALL : 0;
  grid.cells[grid.idx(5, 10)] = SPARK.id; // a slime cell carrying a pulse…
  grid.aux[grid.idx(5, 10)] = packSpark(1, conductorClass(SLIME));
  grid.cells[grid.idx(4, 9)] = ACID; // …with acid diagonally above it, acting later
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const rolled = Math.random;
  Math.random = () => 0;
  sim.step();
  Math.random = rolled;
  check('a spark collapsing back to slime is not acidified in the same tick',
    grid.get(5, 10) === SLIME, `cell is ${getMaterial(grid.get(5, 10)).name}`);
}

console.log(failures === 0 ? '\nAll acid slime checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
