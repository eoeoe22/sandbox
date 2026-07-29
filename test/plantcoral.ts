// Headless behavioural harness for the two growing life materials —
// Plant/Seed (materials/plant.ts, materials/seed.ts) and Coral/Bleached Coral
// (materials/coral.ts, materials/bleachedcoral.ts).
//
// What it pins down:
//   • Plant grows as a *branching stem*, not a blob: it climbs, it stays thin,
//     and no cell ends up walled in by plant on every side.
//   • Growth is water-limited: fresh Water feeds it, Mud is drawn dry into Dirt,
//     Saltwater feeds it nothing, and cut off from water it stops.
//   • A cut-back plant re-sprouts from an exposed, watered stem.
//   • Seed germinates on any loose ground (Dirt/Mud/Sand/Ash) that has fresh
//     water in reach, shows its progress in `aux` while it waits, never loses
//     that progress when conditions lapse, and never germinates dry, in brine,
//     frozen, or with nowhere to sprout.
//   • Coral only builds inside Saltwater, does it slowly, and comes out thin and
//     branched rather than as a filled lump.
//   • 백화: heat over its tolerance bleaches it, and so does losing the brine
//     around it; a healthy cool reef does not bleach; a bleached skeleton in cool
//     brine eventually recolonises.
//
// Run: `node test/run-plantcoral.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
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
/** Each block runs on its own seeded stream, so a change to one scene can't
 *  shift every later scene's randomness (and one flaky-looking result can't
 *  cascade). Call it first thing in every block.
 *
 *  None of the checks below are tuned to one lucky stream: set SEED_BASE to any
 *  number to re-run the whole harness on a different one (`SEED_BASE=7 node
 *  test/run-plantcoral.mjs`) and it should still pass. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x51ed);
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
const EMPTY = 0;
const PLANT = ID('Plant');
const SEED = ID('Seed');
const WATER = ID('Water');
const SALTWATER = ID('Saltwater');
const DIRT = ID('Dirt');
const MUD = ID('Mud');
const SAND = ID('Sand');
const ASH = ID('Ash');
const STONE = ID('Stone');
const CORAL = ID('Coral');
const BLEACHED = ID('Bleached Coral');

function makeWorld(w = 60, h = 60): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
/** Paint a rectangle straight into the buffers (the harness's "brush"). */
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
const put = (grid: Grid, x: number, y: number, id: number): void => {
  fill(grid, x, y, x, y, id);
};
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Cells of `id`, their bounding box, and the densest neighbourhood in it —
 *  enough to tell a branched growth from a filled-in lump. */
function shapeOf(grid: Grid, id: number) {
  let n = 0;
  let minX = grid.width;
  let maxX = -1;
  let minY = grid.height;
  let maxY = -1;
  let worstNeighbours = 0;
  let enclosed = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.cells[grid.idx(x, y)] !== id) continue;
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      let nb = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
          if (grid.cells[grid.idx(nx, ny)] === id) nb++;
        }
      if (nb > worstNeighbours) worstNeighbours = nb;
      if (nb === 8) enclosed++;
    }
  }
  const w = maxX < 0 ? 0 : maxX - minX + 1;
  const h = maxY < 0 ? 0 : maxY - minY + 1;
  return {
    n,
    minX,
    maxX,
    minY,
    maxY,
    w,
    h,
    worstNeighbours,
    enclosed,
    fill: n / Math.max(1, w * h),
  };
}
/** A watered plot as a player would build one: a stone pan, a shallow bed of soil
 *  on it, and water poured over the top. The pour soaks into the ground and
 *  drains within seconds — the pan is what keeps that water table in root reach,
 *  which is the whole point of soil.ts. Rows: stone 55+, soil 51-54, surface 50.
 *
 *  The bed is SAND rather than Dirt on purpose: wet Dirt becomes Mud, and Mud is
 *  a liquid that oozes, so the cell under a plant can slump away and leave it
 *  standing over an air gap with no root path at all. That's a real thing to know
 *  about mud, but here it turns "does this plant have water?" into a dice roll.
 *  Sand holds its shape and holds the water in its pores. (Dirt and Mud beds get
 *  their own coverage in the germination and mud-drinking checks below.) */
function bed(grid: Grid): void {
  fill(grid, 0, 55, grid.width - 1, grid.height - 1, STONE);
  fill(grid, 0, 51, grid.width - 1, 54, SAND);
  // Pour enough to wet the whole bed: a stingy pour soaks in unevenly and leaves
  // dry columns, and then whether a given plant has anything to drink comes down
  // to where the water happened to drain — which is a property of the scene, not
  // of the thing under test.
  fill(grid, 0, 48, grid.width - 1, 50, WATER);
}
/** Hold a rectangle at a temperature every tick (a hot plate under the tank). */
function heat(grid: Grid, x0: number, y0: number, x1: number, y1: number, t: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) grid.temp[grid.idx(x, y)] = t;
}

// --- Plant ------------------------------------------------------------------

// 1. A sprout in a watered bed climbs, branches, and stays thin — the whole
//    point of the growth rewrite. A blob would fill its bounding box and leave
//    cells with all 8 neighbours planted.
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  bed(grid);
  for (const x of [15, 30, 45]) put(grid, x, 50, PLANT); // three sprouts on the soil
  for (let t = 0; t < 3000; t++) sim.step();
  const s = shapeOf(grid, PLANT);
  check('a watered plant grows', s.n > 20, `${s.n} cells from 3 sprouts`);
  check('and climbs upward', s.minY <= 44, `top row ${s.minY} (sprouted at 50)`);
  // Branches stay thin; foliage is *meant* to bunch (a bud fills the space around
  // itself), so the test isn't "no cell is enclosed" — a canopy has a few of
  // those. It's that the plant is mostly open space and only a sliver of it is
  // walled-in interior, which is exactly what a solid blob would fail.
  check(
    'growth is an open branching plant, not a blob',
    s.fill < 0.45 && s.enclosed / s.n < 0.1,
    `fill=${s.fill.toFixed(2)} of ${s.w}x${s.h}, ${s.enclosed}/${s.n} cells fully enclosed`,
  );
}

// 2. No water, no growth: the same painted sprout on dry dirt goes nowhere.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 30, 39, 39, DIRT);
  put(grid, 20, 29, PLANT);
  for (let t = 0; t < 2000; t++) sim.step();
  check('a dry plant does not grow', count(grid, PLANT) === 1, `${count(grid, PLANT)} cells`);
}

// 3. Saltwater is not drinkable — brine is Coral's element, not a plant's.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 30, 39, 39, DIRT);
  fill(grid, 0, 28, 39, 29, SALTWATER);
  put(grid, 20, 27, PLANT);
  for (let t = 0; t < 2000; t++) sim.step();
  check('a plant in brine does not grow', count(grid, PLANT) === 1, `${count(grid, PLANT)} cells`);
}

// 4. Roots drink: the puddle they sit in visibly goes down, and damp Mud is
//    drawn dry into plain Dirt.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 34, 39, 39, STONE);
  fill(grid, 10, 32, 29, 33, WATER); // a walled puddle that can't run away
  fill(grid, 0, 32, 9, 33, STONE);
  fill(grid, 30, 32, 39, 33, STONE);
  put(grid, 20, 31, PLANT);
  const before = count(grid, WATER);
  for (let t = 0; t < 1500; t++) sim.step();
  check('a plant drinks its puddle down', count(grid, WATER) < before, `${before} → ${count(grid, WATER)} water`);
}
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 34, 39, 39, STONE);
  fill(grid, 10, 32, 29, 33, MUD);
  fill(grid, 0, 32, 9, 33, STONE);
  fill(grid, 30, 32, 39, 33, STONE);
  put(grid, 20, 31, PLANT);
  for (let t = 0; t < 1500; t++) sim.step();
  check(
    'roots draw mud dry, leaving dirt',
    count(grid, DIRT) > 0 && count(grid, PLANT) > 1,
    `${count(grid, DIRT)} dirt, ${count(grid, PLANT)} plant`,
  );
}

// 5. Cut a plant back and the stump puts out a fresh shoot. The stump is built
//    the way the material itself builds one — paint two stacked cells, let them
//    take their roles (the lower one has plant above it, so it initialises as
//    stem), then cut the top one away — rather than by growing a whole plant and
//    mowing it. A grown plant's base may legitimately have spent its vigour on
//    the way up (each shoot costs a generation, and that's the bound on
//    regrowth), so mowing one tests the stump's history as much as the rule.
{
  reseed();
  const { grid, sim } = makeWorld(40, 60);
  bed(grid);
  put(grid, 20, 50, PLANT);
  put(grid, 20, 49, PLANT);
  sim.step(); // both cells take their structural role
  put(grid, 20, 49, EMPTY); // …and the top is cut away, leaving a bare stump
  const stump = count(grid, PLANT);
  for (let t = 0; t < 4000; t++) sim.step();
  check(
    'a cut-back stump puts out a new shoot',
    count(grid, PLANT) > stump,
    `stump of ${stump} → ${count(grid, PLANT)} cells`,
  );
}

// 5c. Ground moves: wet Dirt becomes Mud and Mud oozes, so a plant can end up
//     standing over the cavity its own soil left behind. Roots bridge one cell of
//     that (soil.ts), so a plant on a soaking bed doesn't starve for a reason
//     nothing on screen explains.
{
  reseed();
  const { grid, sim } = makeWorld(40, 60);
  bed(grid);
  put(grid, 20, 51, EMPTY); // the cell under the sprout slumps away
  put(grid, 20, 50, PLANT);
  for (let t = 0; t < 2500; t++) sim.step();
  check(
    'a plant left standing over a cavity still reaches the water table',
    count(grid, PLANT) > 1,
    `${count(grid, PLANT)} cells`,
  );
}

// 5b. A world saved before the growth rework stored a bare 0..250 moisture value
//     in a plant cell's aux. Such a cell has to read as "no structure yet" and be
//     re-initialised, not decode as an already-spent stem that can never grow.
//
//     Every value here is >= 128 on purpose, and each gets its own world: those
//     are exactly the bytes that set bit 7, so under the old layout (init at
//     bit 7, vigour at bits 14-15) every one of them decoded as an initialised,
//     vigour-0, non-tip cell and was frozen for good. A value under 128 would
//     grow either way and would quietly make this check meaningless — as would
//     pooling several sprouts into one count, where the ones that decode fine
//     cover for the ones that don't.
for (const legacy of [128, 160, 200, 250]) {
  reseed();
  const { grid, sim } = makeWorld(40, 60);
  bed(grid);
  put(grid, 20, 50, PLANT);
  grid.aux[grid.idx(20, 50)] = legacy; // an old save's moisture byte, verbatim
  for (let t = 0; t < 2500; t++) sim.step();
  check(
    `a plant loaded from a pre-rework save (aux ${legacy}) still grows`,
    count(grid, PLANT) > 1,
    `${count(grid, PLANT)} cells`,
  );
}

// --- Seed -------------------------------------------------------------------

/** Drop one seed on a bed of `soil` with `wet` alongside it and run. */
function plantSeed(soil: number, wet: number, ticks: number): { grid: Grid; sprouted: boolean } {
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 34, 39, 39, STONE); // a pan, so the water table stays in reach
  fill(grid, 0, 30, 39, 33, soil);
  if (wet !== EMPTY) fill(grid, 0, 28, 39, 29, wet);
  for (const x of [8, 14, 20, 26, 32]) put(grid, x, 29, SEED); // sow a row
  for (let t = 0; t < ticks; t++) sim.step();
  return { grid, sprouted: count(grid, PLANT) > 0 };
}

for (const [name, soil] of [
  ['dirt', DIRT],
  ['sand', SAND],
  ['mud', MUD],
] as const) {
  const { sprouted } = plantSeed(soil, soil === MUD ? EMPTY : WATER, 900);
  check(`a seed on wet ${name} germinates`, sprouted);
}
{
  // The case that used to look broken: water the bed, let it drain out of sight
  // (it soaks into the ground within seconds), THEN sow. The seed has to feel
  // the water table under it — here through a layer of ash, a burnt-out field.
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 32, 39, 39, DIRT);
  fill(grid, 0, 30, 39, 31, WATER);
  for (let t = 0; t < 200; t++) sim.step(); // the pour drains away
  for (const x of [10, 15, 20, 25, 30]) {
    put(grid, x, 31, ASH);
    put(grid, x, 30, SEED);
  }
  for (let t = 0; t < 1200; t++) sim.step();
  check('a seed sown on ash over a drained bed still germinates', count(grid, PLANT) > 0);
}
{
  const { sprouted } = plantSeed(DIRT, EMPTY, 1200);
  check('a seed on dry ground does not germinate', !sprouted);
}
{
  const { sprouted } = plantSeed(DIRT, SALTWATER, 1200);
  check('a seed in brine does not germinate', !sprouted);
}
{
  // Progress is visible: it *is* the aux the palette ramp draws, so a planted
  // seed greens as it matures. Read wherever the grain ends up, since a seed
  // dropped in water settles before it takes root.
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 34, 39, 39, STONE);
  fill(grid, 0, 30, 39, 33, DIRT);
  fill(grid, 0, 28, 39, 29, WATER);
  for (const x of [8, 14, 20, 26, 32]) put(grid, x, 29, SEED); // sow a row
  let best = 0;
  for (let t = 0; t < 400; t++) {
    sim.step();
    for (let i = 0; i < grid.cells.length; i++)
      if (grid.cells[i] === SEED && grid.aux[i] > best) best = grid.aux[i];
  }
  check('germination progress is visible in aux', best > 0, `reached step ${best}/15`);
}
{
  // Progress only ever pauses: a half-germinated seed moved onto bone-dry ground
  // keeps exactly the count it had, ready to carry on if it is watered again.
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 32, 39, 39, DIRT);
  put(grid, 20, 31, SEED);
  const held = 7;
  grid.aux[grid.idx(20, 31)] = held;
  for (let t = 0; t < 600; t++) sim.step();
  const i = grid.idx(20, 31);
  check(
    'a dried-out seed holds its progress instead of losing it',
    grid.cells[i] === SEED && grid.aux[i] === held,
    `aux ${held} → ${grid.aux[i]}`,
  );
}
{
  // Ripe but buried: it waits for room rather than germinating into a cell the
  // sprout could never leave.
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 20, 39, 39, STONE);
  put(grid, 20, 31, SAND); // damp ground right under it (a soaked grain)…
  grid.overlay[grid.idx(20, 31)] = WATER;
  put(grid, 20, 30, SEED); // …but stone on every other side: nowhere to sprout
  grid.aux[grid.idx(20, 30)] = 15; // fully ripe
  for (let t = 0; t < 300; t++) sim.step();
  check('a ripe but buried seed waits for room', grid.cells[grid.idx(20, 30)] === SEED);
}

// --- Coral ------------------------------------------------------------------

// 6. Coral builds through brine — slowly — and comes out branched and thin.
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 55, 59, 59, STONE);
  fill(grid, 0, 5, 59, 54, SALTWATER);
  put(grid, 30, 54, CORAL);
  for (let t = 0; t < 200; t++) sim.step();
  const early = count(grid, CORAL);
  for (let t = 0; t < 6000; t++) sim.step();
  const s = shapeOf(grid, CORAL);
  check('coral grows inside salt water', s.n > 10, `${s.n} cells`);
  // "Slow" is a rate, not a magic number: after 200 ticks the colony must still
  // be a small fraction of what it ends up as (a plant would be most of the way
  // there by then), and small in absolute terms too.
  check(
    'and grows slowly',
    early <= 15 && early * 3 <= s.n,
    `${early} cells after 200 ticks, ${s.n} after 6200`,
  );
  check('it builds upward off the seabed', s.minY < 50, `top row ${s.minY} (seeded at 54)`);
  check(
    'the colony is a thin branching fan, not a lump',
    s.fill < 0.5 && s.worstNeighbours <= 4,
    `fill=${s.fill.toFixed(2)} of ${s.w}x${s.h}, densest cell has ${s.worstNeighbours}/8 coral neighbours`,
  );
  check('and it eats the brine it builds into', count(grid, SALTWATER) < 60 * 50, 'brine consumed');
}

// 7. Fresh water is not brine: no growth there, and it bleaches instead.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 35, 39, 39, STONE);
  fill(grid, 0, 5, 39, 34, WATER);
  put(grid, 20, 34, CORAL);
  for (let t = 0; t < 1000; t++) sim.step();
  check(
    'coral neither grows nor survives in fresh water',
    count(grid, CORAL) === 0 && count(grid, BLEACHED) === 1,
    `${count(grid, CORAL)} coral, ${count(grid, BLEACHED)} bleached`,
  );
}

// 7b. A reef that is fully submerged does NOT bleach from the inside. The cells
//     walled in by their own colony touch no brine at all, so the health check
//     has to reach through the colony (hydration, coral.ts) rather than only at
//     each cell's own eight neighbours.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 35, 39, 39, STONE);
  fill(grid, 0, 5, 39, 34, SALTWATER);
  fill(grid, 16, 28, 22, 34, CORAL); // a solid 7x7 head, brine all around it
  const painted = 7 * 7;
  for (let t = 0; t < 3000; t++) sim.step();
  check(
    'a submerged reef does not bleach from the inside',
    count(grid, BLEACHED) === 0 && count(grid, CORAL) >= painted,
    `${count(grid, CORAL)} coral (painted ${painted}), ${count(grid, BLEACHED)} bleached`,
  );
}

// 8. 백화 by drought: brine gone, colour gone.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 35, 39, 39, STONE);
  fill(grid, 18, 30, 22, 34, CORAL); // a reef left high and dry
  for (let t = 0; t < 1000; t++) sim.step();
  check(
    'coral out of the water bleaches',
    count(grid, CORAL) === 0 && count(grid, BLEACHED) === 25,
    `${count(grid, CORAL)} coral, ${count(grid, BLEACHED)} bleached`,
  );
}

// 9. 백화 by heat: a reef held above its tolerance dies even fully submerged.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 35, 39, 39, STONE);
  fill(grid, 0, 5, 39, 34, SALTWATER);
  fill(grid, 18, 32, 21, 34, CORAL);
  for (let t = 0; t < 1500; t++) {
    heat(grid, 0, 5, 39, 39, 80); // a hot tank, still well under boiling
    sim.step();
  }
  check(
    'a reef cooked above its tolerance bleaches',
    count(grid, BLEACHED) > 0 && count(grid, CORAL) === 0,
    `${count(grid, CORAL)} coral, ${count(grid, BLEACHED)} bleached`,
  );
}

// 10. …and a cool, brine-covered reef does NOT bleach.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 35, 39, 39, STONE);
  fill(grid, 0, 5, 39, 34, SALTWATER);
  fill(grid, 18, 34, 21, 34, CORAL); // a thin reef on the seabed, brine over it
  for (let t = 0; t < 3000; t++) sim.step();
  check('a healthy submerged reef keeps its colour', count(grid, BLEACHED) === 0,
    `${count(grid, BLEACHED)} bleached`);
}

// 11. Recolonisation: white skeleton put back in cool brine eventually lives again.
{
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 35, 39, 39, STONE);
  fill(grid, 0, 5, 39, 34, SALTWATER);
  fill(grid, 14, 32, 25, 33, BLEACHED);
  let revived = false;
  for (let t = 0; t < 6000 && !revived; t++) {
    sim.step();
    revived = count(grid, CORAL) > 0;
  }
  check('bleached coral recolonises in cool brine', revived);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
