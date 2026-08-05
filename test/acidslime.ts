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
//   • **Acid poured on Slime acidifies it, and is drunk by it.** Acid Slime
//     appears at the boundary, the pool is spent doing it, and the blob *grows* —
//     because the goo drinks acid the way it drinks water — but it can only grow
//     by as many cells as the pool lost, so nothing is conjured.
//   • **Both liquids are drunk at the same rate.** The goo empties a pool of acid
//     in about the time it empties a pool of water. This is the sharpest check
//     here, and the one whose absence let the absorb rate ship 2.5× too slow.
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
//    The accounting here is what pins the *shape* of the reaction, and it is the
//    same shape the undo (#3) has, because the goo drinks both liquids: some of
//    the pool is absorbed and comes back as goo (the blob grows), and the rest is
//    spent acidifying the goo already there. So the two halves that get checked
//    are the two silent failure modes — a pool that is never spent turns one drop
//    into a world-eating catalyst, and goo appearing out of nowhere would mean
//    the growth is not paid for by the pool.
{
  reseed();
  const { grid, sim } = layered(ACID, SLIME);
  const acid0 = count(grid, ACID);
  const goo0 = count(grid, SLIME);
  for (let t = 0; t < TICKS; t++) sim.step();
  const acidSlime = count(grid, ACID_SLIME);
  const slime = count(grid, SLIME);
  const acidSpent = acid0 - count(grid, ACID);
  // 40% of the *starting* goo, and the ceiling on the acidified-in-place part is
  // geometry rather than the rule: this box is sealed and full, so the acid meets
  // the goo along one flat seam and can never get under or around it — the far
  // side of the slime is only ever reached by the two goos interdiffusing. What
  // clears the bar comfortably is that the pool itself becomes acidic goo as the
  // blob drinks it (acid.ts's SLIME_ABSORB_CHANCE), which is also what advances
  // the seam. The old strict-1:1 behaviour managed a quarter of this scene.
  check('acid poured on slime works well into the blob', acidSlime > goo0 * 0.4,
    `${acidSlime} acid slime out of ${goo0} goo`);
  check('…while still being spent by the work (no free catalyst)', acidSpent > 0,
    `${acidSpent} acid spent`);
  // The goo grows because the acid is drunk — the same feeding that makes #3's
  // blob swell in water, pointed at the other liquid (슬라임은 산도 마신다).
  check('…and the goo grows, because the acid is drunk into it',
    slime + acidSlime > goo0, `${slime + acidSlime} goo vs ${goo0} to start`);
  // …but every cell of that growth came out of the pool. Acid spent on the
  // acidify-in-place row leaves nothing behind, so the gain can only be smaller.
  check('…paying for every new cell out of the pool',
    slime + acidSlime - goo0 <= acidSpent,
    `${slime + acidSlime - goo0} goo gained for ${acidSpent} acid spent`);
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
  // Scored against the blob's *starting* size, which is the strong form: the blob
  // roughly octuples over these 600 ticks (measured 528–551 cells from 64) and half
  // of every water cell it drinks comes back acidic (ABSORB_ACID_CHANCE), so acidic
  // goo is being *manufactured* the whole time. Ending below where it started means
  // the rinse outran that.
  //
  // The bar used to be `goo0 * 0.75` (48), which sat inside the healthy spread —
  // measured over 24 seed streams the count lands at 31–50, so seeds 12/15/21 hit
  // 48/50/48 and went red on a working build. With the rinse disabled the count is
  // 90–110, so `< goo0` separates those two populations with room on both sides
  // instead of splitting one of them.
  //
  // Know what this does NOT catch, because the scene has a ceiling on sensitivity
  // that no choice of bar fixes: measured by sweeping DILUTE_CHANCE, it goes red at
  // 0.02 and below (a quarter of normal) and reliably at 0, but a *halving* to 0.04
  // passes the whole file. The reason is structural — the blob turns mostly plain
  // Slime early, and from then on it is plain Slime's feeding that drinks the pool,
  // which grows the goo without any rinse involved. So the rinse only shapes a brief
  // early window here, and the end state can't resolve a factor of two in it. Even
  // the sharper statistic this scene admits — rinses = water spent that did *not*
  // grow the goo — only separates 0.08 (≈37) from 0.04 (≈29) by less than the seed
  // spread. Pinning DILUTE_CHANCE itself needs a scene where the water runs out
  // while the blob is still acidic (a pool sized near the blob rather than 8× it),
  // which is not this one.
  check('…with a good part of the original blob rinsed clean outright',
    acidSlime < goo0, `${acidSlime} acid slime left of the ${goo0} poured`);
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

// 5. **The goo drinks acid as fast as it drinks water.** 슬라임은 유체를 마셔 몸집을
//    키우는데, 그 유체가 산일 때만 굼떴다 — 산성 슬라임이 산을 제대로 침식하지 않는
//    문제로 보고된 자리다.
//
//    This is the sharpest check in the file because it needs no mirror scene and no
//    ratio of unlike things: the *same* goo, the *same* sealed box, the *same*
//    pool size, and only the liquid differs. Tuned only against the conversion
//    count the absorb rate had landed at 0.01, where the goo needed 353–392 ticks
//    to drink an acid pool against water's 153.
//
//    The two iterations are not equally clean, and the acid slime one is the point.
//    Against **Acid Slime** the absorb row is genuinely the only rule that can fire
//    — there is nothing left to acidify, so this run isolates that row and nothing
//    else. Against **plain Slime** the acidify rows are live too and spend acid of
//    their own (`SLIME_ACIDIFY_SELF_CONSUME`), so that run is a broader "the pool
//    drains at a sane rate" check rather than an isolation of the absorb row. Both
//    are worth having; only the first one pins the constant.
//
//    Scored as "did the pool go" rather than a rate curve, and with a generous
//    band (±60%), because the point is parity of feel, not a tuned constant: what
//    fails here is a regression that puts the two liquids in different leagues.
//    (The two runs deliberately draw from different streams — `reseed()` per run —
//    since a drain time is an aggregate over hundreds of ticks, not a seed-matched
//    duel like #6. Measured spread across seed streams is 0.66–1.16×.)
{
  const POOL = 288; // 24×12 of reagent over 24×12 of goo
  const CAP = 900; // ~6× the passing time; a stuck scene ends the loop, not the run
  /** Ticks until the goo has drunk the whole pool (CAP if it never does). */
  function drainTicks(gooId: number, liquidId: number): number {
    reseed();
    const { grid, sim } = layered(liquidId, gooId); // the liquid is lighter, so on top
    for (let t = 1; t <= CAP; t++) {
      sim.step();
      if (count(grid, liquidId) === 0) return t;
    }
    return CAP;
  }
  for (const [label, gooId] of [
    ['acid slime', ACID_SLIME],
    ['plain slime', SLIME],
  ] as [string, number][]) {
    const onWater = drainTicks(gooId, WATER);
    const onAcid = drainTicks(gooId, ACID);
    const ratio = onAcid / onWater;
    check(`${label} drinks a pool of acid as fast as one of water`,
      ratio > 0.4 && ratio < 1.6,
      `${POOL} cells gone in ${onAcid} ticks of acid vs ${onWater} of water (${ratio.toFixed(2)}×)`);
  }
}

// 6. The other half of the pace: 산이 슬라임을 침식하는 속도가 물이 산성 슬라임을
//    씻어 내는 속도와 같아야 한다 — the complaint that put the absorb row here.
//
//    Run on the mirror-image scene a player actually makes: a goo blob on open
//    ground with a pool of the other liquid poured over it, so (unlike the sealed
//    boxes above) the pool runs down the blob's flanks and drains. Same geometry,
//    same seed, same tick count; only the recipe differs.
//
//    Scored as the **share of the goo that has changed**, not a raw product count.
//    The counts are not comparable between the directions: 100% of a drunk acid
//    cell comes back acidic, while only 50% of a drunk water cell comes back plain
//    (ABSORB_ACID_CHANCE), so a raw count flatters the acid side for free — it was
//    what made a 1.20 read as 1.60. Both shares start at 0%, which is what makes
//    them a fair pair.
//
//    The bar is deliberately two-sided. A floor is the regression this exists for
//    (the acid direction was ~0.3× water and read as broken), but a ceiling matters
//    just as much, because the fix is a *growth* rule: overshoot it and a splash of
//    acid is a goo explosion rather than an erosion. Measured over 8 seeds the
//    ratio sits at 1.20–1.29, so [0.7, 1.9] clears the noise either way.
{
  const W = 60;
  const H = 40;
  /** A 12×12 goo blob resting on the floor with a wider pool of `liquid` suspended
   *  above it, so the pool falls onto the mound and runs off its sides. */
  function poured(gooId: number, liquidId: number): { grid: Grid; sim: Simulation } {
    const grid = new Grid(W, H);
    const sim = new Simulation(grid);
    for (let x = 0; x < W; x++) grid.cells[grid.idx(x, H - 1)] = WALL;
    for (let y = 0; y < H; y++) {
      grid.cells[grid.idx(0, y)] = WALL;
      grid.cells[grid.idx(W - 1, y)] = WALL;
    }
    fill(grid, 24, H - 13, 35, H - 2, gooId); // 12×12 = 144 goo
    fill(grid, 20, H - 25, 39, H - 14, liquidId); // 20×12 = 240 of the other liquid
    return { grid, sim };
  }
  const PACE_TICKS = 200; // before either direction saturates (water levels off ~300)
  reseed();
  const seed = (Math.random() * 0xffffffff) >>> 0;
  /** Share of all goo — both kinds — now reading as `productId`. */
  const share = (gooId: number, liquidId: number, productId: number): number => {
    Math.random = mulberry32(seed);
    const { grid, sim } = poured(gooId, liquidId);
    for (let t = 0; t < PACE_TICKS; t++) sim.step();
    return count(grid, productId) / (count(grid, SLIME) + count(grid, ACID_SLIME));
  };
  const acidified = share(SLIME, ACID, ACID_SLIME);
  const rinsed = share(ACID_SLIME, WATER, SLIME);
  const ratio = acidified / rinsed;
  const detail =
    `${(acidified * 100).toFixed(0)}% acidic vs ${(rinsed * 100).toFixed(0)}% ` +
    `rinsed in ${PACE_TICKS} ticks (${ratio.toFixed(2)}×)`;
  check('acid erodes slime at water\'s pace, not slower', ratio > 0.7, detail);
  check('…and not by exploding into goo either', ratio < 1.9, `${ratio.toFixed(2)}×`);
}

// 7. The two halves meeting in one tick — the regression this file exists to
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

// 8. The same hazard from the other direction, and the reason it is worth a
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
  // Two steps, because a Spark's life is two turns: the first is its LIVE turn
  // (hand the pulse on, arc, power appliances) and the collapse back to Slime — the
  // bare write this check is about — happens on the second (see spark.ts's two-turn
  // note). The hazard itself is unchanged: the collapse is still a bare mid-tick
  // write of a reaction partner, with the acid scanned later in that same tick
  // (rows run bottom-to-top, so row 10 collapses before row 9 acts).
  //
  // NOTE: this check does not currently fail if the `markMoved` it describes is
  // removed — measured, and measured on the pre-change code too, so it is a gap
  // this scene always had rather than one the two-turn split introduced. Test 7
  // above (the rinse case) is the one carrying real weight on this invariant.
  sim.step();
  sim.step();
  Math.random = rolled;
  check('a spark collapsing back to slime is not acidified in the same tick',
    grid.get(5, 10) === SLIME, `cell is ${getMaterial(grid.get(5, 10)).name}`);
}

console.log(failures === 0 ? '\nAll acid slime checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
