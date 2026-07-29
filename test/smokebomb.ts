// Headless behavioural harness for the smoke bomb's underwater discharge
// (engine/objects.ts puffSmoke/displaceLiquidUp): a canister that sinks keeps
// making smoke *inside* the liquid (액체 속에서도 연기 발생) instead of going quiet,
// it does so by shoving the liquid up the column rather than destroying it, and a
// brim-full sealed tank — where the liquid has nowhere to go — is the one place
// that legitimately stays clear. Run: `node test/run-smokebomb.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { createSmokeBomb, SMOKE_BOMB_FUSE_TICKS, SMOKE_BOMB_VENT_TICKS } from '../src/game/engine/objects';
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
Math.random = mulberry32(23);

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
const STONE = ID('Stone');
const WATER = ID('Water');
const SMOKE = ID('Smoke');
const HONEY = ID('Honey');

/** Whole life of a canister: 4s of fuse, then 2.5s of discharge. */
const LIFETIME = SMOKE_BOMB_FUSE_TICKS + SMOKE_BOMB_VENT_TICKS;

function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Cells of `id` strictly below row `y` — "under the waterline". */
function countBelow(grid: Grid, id: number, y: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === id && ((i / grid.width) | 0) > y) n++;
  }
  return n;
}
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid.cells[grid.idx(x, y)] = id;
}

// The pond: a stone basin (walls at x<10 / x>=120, floor at y>=110) holding water
// from y=60 down. Surface at y=60, so anything found below y=70 is genuinely
// submerged, not the plume blooming in the air overhead.
const SURFACE_Y = 60;
function makePond(liquid = WATER): { grid: Grid; sim: Simulation } {
  const grid = new Grid(130, 130);
  const sim = new Simulation(grid);
  sim.setSmokeLevel('high'); // no thinning, so the counts below mean what they say
  fill(grid, 0, 0, 9, 129, STONE);
  fill(grid, 120, 0, 129, 129, STONE);
  fill(grid, 0, 110, 129, 129, STONE);
  fill(grid, 10, SURFACE_Y, 119, 109, liquid);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  return { grid, sim };
}

// 1. The headline: a canister at the bottom of a pond smokes underwater.
{
  const { grid, sim } = makePond();
  grid.objects.push(createSmokeBomb(65, 75));
  // Let the drop settle, then take the water baseline — the entry splash is over.
  for (let i = 0; i < 40; i++) sim.step();
  const waterBefore = count(grid, WATER);
  // Still on the fuse: even the thin wisp stage reaches into the water.
  for (let i = 40; i < 100; i++) sim.step();
  const wisp = countBelow(grid, SMOKE, SURFACE_Y + 10);
  check('the fuse-stage wisp bubbles underwater', wisp > 0, `${wisp} submerged Smoke cells`);
  // Through the discharge.
  for (let i = 100; i < LIFETIME + 20; i++) sim.step();
  const cloud = countBelow(grid, SMOKE, SURFACE_Y + 10);
  check('the discharge fills the water with smoke', cloud > 50, `${cloud} submerged Smoke cells`);
  check('and it surfaces as well', count(grid, SMOKE) > cloud, `${count(grid, SMOKE)} total`);
  // Settle, then check the pond survived intact: every cell of smoke made
  // underwater displaced a cell of water UP the column, never deleted it.
  for (let i = 0; i < 120; i++) sim.step();
  const waterAfter = count(grid, WATER);
  check('the pond is conserved — water is displaced, never destroyed', waterAfter === waterBefore, `${waterBefore} → ${waterAfter}`);
  check('the canister is spent and gone', grid.objects.length === 0);
}

// 2. Any liquid, not just water: the same canister boils an oil slick.
{
  const OIL = ID('Crude Oil');
  const { grid, sim } = makePond(OIL);
  grid.objects.push(createSmokeBomb(65, 75));
  for (let i = 0; i < LIFETIME + 20; i++) sim.step();
  const submerged = countBelow(grid, SMOKE, SURFACE_Y + 10);
  check('crude oil is a liquid too — it smokes in there as well', submerged > 50, `${submerged} submerged Smoke cells`);
}

// 3. A FROZEN liquid is structure, not a pond: it's a block of ice everywhere else
//    in the engine (SimContext.isFrozen) and smoke is no different, so the
//    canister resting on a frozen honey slab smokes into the air over it and not a
//    cell into the slab (언 액체는 벽).
{
  const grid = new Grid(130, 130);
  const sim = new Simulation(grid);
  sim.setSmokeLevel('high');
  fill(grid, 0, 110, 129, 129, STONE);
  fill(grid, 10, 80, 119, 109, HONEY); // freezes at 5°
  grid.temp.fill(0); // …and the whole board is held below that
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  grid.objects.push(createSmokeBomb(65, 70));
  for (let i = 0; i < LIFETIME + 20; i++) sim.step();
  const inSlab = countBelow(grid, SMOKE, 82);
  check('a frozen pond takes no smoke inside it', inSlab === 0, `${inSlab} cells below the surface`);
  check('but the canister still smokes above it', count(grid, SMOKE) > 50, `${count(grid, SMOKE)} total`);
}

// 4. Incompressibility: a canister sealed in a brim-full tank has nowhere to put
//    the water it would have to displace, so it makes no smoke in there — and
//    still doesn't destroy a drop of it.
{
  const grid = new Grid(130, 130);
  const sim = new Simulation(grid);
  sim.setSmokeLevel('high');
  fill(grid, 20, 20, 80, 90, STONE); // solid block…
  fill(grid, 24, 24, 76, 86, WATER); // …hollowed out and filled to the brim
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const waterBefore = count(grid, WATER);
  grid.objects.push(createSmokeBomb(50, 55));
  for (let i = 0; i < LIFETIME + 20; i++) sim.step();
  check('a sealed brim-full tank stays clear', count(grid, SMOKE) === 0, `${count(grid, SMOKE)} Smoke cells`);
  check('and loses no water to the attempt', count(grid, WATER) === waterBefore, `${waterBefore} → ${count(grid, WATER)}`);
}

// 5. Regression: the ordinary above-ground canister is unchanged.
{
  const grid = new Grid(130, 130);
  const sim = new Simulation(grid);
  sim.setSmokeLevel('high');
  fill(grid, 0, 100, 129, 129, STONE);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  grid.objects.push(createSmokeBomb(65, 80));
  for (let i = 0; i < LIFETIME; i++) sim.step();
  check('a canister in open air still blankets it', count(grid, SMOKE) > 200, `${count(grid, SMOKE)} Smoke cells`);
}

console.log(failures === 0 ? '\nAll smoke-bomb checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
