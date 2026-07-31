// Headless behavioural harness for 염소 + 나트륨 → 불꽃 + 소금
// (materials/chlorine.ts, the SODIUM branch of updateChlorine).
//
// The reaction is 2Na + Cl₂ → 2NaCl: two poisons make table salt. What this
// file pins down:
//   • Contact really produces both halves — Fire where the grain was, Salt where
//     the gas was — and does it without any water, air or ignition source.
//   • Loose grains convert completely and exactly 1:1, so nothing is lost or
//     minted in the exchange.
//   • It's a **burn, not a detonation**: a packed pile crusts over with its own
//     salt and stalls with the core intact and the stone floor whole, where the
//     same pile dropped in water detonates (the control that keeps someone from
//     "unifying" sodium's two reaction paths). The stall is checked to be the
//     crust — survivors sealed in salt with gas still in the room — and not
//     merely a spent cloud.
//   • The product stays **Salt**, never Molten Salt — the flame is deliberately
//     cooler than salt's 800° melting point, so the reaction can't melt its own
//     output.
//   • Both sides are consumed 1:1, so a small cloud can only salt as much sodium
//     as it has cells: chlorine is a finite reagent, not a catalyst.
//   • Sodium alone in air is untouched (the control that says it's the gas doing
//     it), and chlorine still gasses plants (the poison path this branch shares
//     its neighbour loop with must not have been broken).
//
// Run: `node test/run-chlorinesodium.mjs`.
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
 *  shift every later scene's randomness. Set SEED_BASE to re-run the whole
 *  harness on a different stream (`SEED_BASE=7 node test/run-chlorinesodium.mjs`)
 *  — nothing here is tuned to one lucky seed. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0xc12a);
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
const CHLORINE = ID('Chlorine');
const SODIUM = ID('Sodium');
const SALT = ID('Salt');
const MOLTEN_SALT = ID('Molten Salt');
const FIRE = ID('Fire');
const BLAST = ID('Blast');
const WATER = ID('Water');
const STONE = ID('Stone');
const WALL = ID('Wall');
const PLANT = ID('Plant');

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
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Hottest cell of `id` anywhere on the grid (−1 if there are none). */
function hottest(grid: Grid, id: number): number {
  let t = -1;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.get(x, y) === id) t = Math.max(t, grid.getTemp(x, y));
  return t;
}

// 1. The reaction itself: a grain of sodium in a chlorine pocket becomes salt,
//    and the gas that ate it becomes flame. The pocket is sealed in Wall so
//    nothing outside (air, water, an ignition source) can be credited for it.
{
  reseed();
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 10, 10, 20, 20, WALL);
  fill(grid, 11, 11, 19, 19, CHLORINE);
  fill(grid, 15, 15, 15, 15, SODIUM);
  let sawFire = false;
  for (let t = 0; t < 60; t++) {
    sim.step();
    if (count(grid, FIRE) > 0) sawFire = true;
  }
  check('sodium in a sealed chlorine pocket turns to salt', count(grid, SALT) === 1,
    `${count(grid, SALT)} salt, ${count(grid, SODIUM)} sodium left`);
  check('and the chlorine that ate it burns as flame', sawFire);
}

// 2. Control for #1: the identical pocket filled with nothing at all leaves the
//    grain alone. It's the chlorine doing this, not the walls or the fall.
{
  reseed();
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 10, 10, 20, 20, WALL);
  fill(grid, 11, 11, 19, 19, EMPTY);
  fill(grid, 15, 15, 15, 15, SODIUM);
  for (let t = 0; t < 60; t++) sim.step();
  check('sodium alone in air is untouched', count(grid, SODIUM) === 1 && count(grid, SALT) === 0,
    `${count(grid, SODIUM)} sodium, ${count(grid, SALT)} salt`);
}

// 3. Sprinkled loose into a cloud, every grain is converted — and exactly one
//    grain of salt comes back per grain of sodium, so nothing is lost or minted.
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 50, 59, 59, STONE);
  fill(grid, 5, 20, 54, 49, CHLORINE);
  for (let i = 0; i < 30; i++) fill(grid, 10 + i, 25, 10 + i, 25, SODIUM);
  for (let t = 0; t < 400; t++) sim.step();
  check('sprinkled sodium is converted to the last grain', count(grid, SODIUM) === 0,
    `${count(grid, SODIUM)} left`);
  check('…one salt per grain, no more and no less', count(grid, SALT) === 30,
    `${count(grid, SALT)} salt from 30 grains`);
}

// 4. A *packed* pile is the opposite story, and this is the whole point of making
//    it a burn: the surface flares off into salt, that salt buries the pile, and
//    the front stalls against its own crust with the core still metal and the
//    stone floor untouched. Water's answer to the same pile is one crater
//    (sodium.ts's detonate); chlorine's is a salt tomb.
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 45, 59, 59, STONE);
  const stoneBefore = count(grid, STONE);
  fill(grid, 25, 40, 34, 44, SODIUM); // 10x5 packed pile on the floor
  fill(grid, 5, 20, 54, 39, CHLORINE); // a cloud far larger than the pile
  let sawBlast = false;
  for (let t = 0; t < 400; t++) {
    sim.step();
    if (count(grid, BLAST) > 0) sawBlast = true;
  }
  const sodium = count(grid, SODIUM);
  const salt = count(grid, SALT);
  check('a packed pile burns from the surface inward', sodium > 0 && sodium < 40,
    `${sodium} of 50 grains left, ${salt} salt`);
  check('…and never detonates the way water makes it (no blast)', !sawBlast);
  check('…leaving the stone floor whole', count(grid, STONE) === stoneBefore,
    `${stoneBefore} → ${count(grid, STONE)} stone`);
  check('…none of the salt melting to Molten Salt', count(grid, MOLTEN_SALT) === 0);
  check('…and the salt staying well under its 800° melting point',
    hottest(grid, SALT) < 800, `hottest salt ${hottest(grid, SALT).toFixed(0)}°`);
  // What stopped it has to be the crust, not a spent cloud: there is still plenty
  // of gas in the room, it simply can't touch metal any more.
  let sealed = true;
  let crusted = 0;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      if (grid.get(x, y) !== SODIUM) continue;
      let touchesSalt = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
          const n = grid.get(nx, ny);
          if (n === CHLORINE) sealed = false;
          if (n === SALT) touchesSalt = true;
        }
      if (touchesSalt) crusted++;
    }
  check('…because the survivors are sealed under salt, not out of gas',
    sealed && crusted > 0 && count(grid, CHLORINE) > 100,
    `${crusted} crusted grains, ${count(grid, CHLORINE)} chlorine still in the room`);
}

// 5. The detonation control for #4: the same pile, same floor, put in water
//    instead — that path really does go off (sodium.ts), so "no blast under
//    chlorine" can't be read as "this pile could never have exploded".
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 45, 59, 59, STONE);
  fill(grid, 25, 40, 34, 44, SODIUM);
  fill(grid, 5, 20, 54, 39, WATER);
  let sawBlast = false;
  for (let t = 0; t < 400; t++) {
    sim.step();
    if (count(grid, BLAST) > 0) sawBlast = true;
  }
  check('control: the same pile in water does detonate', sawBlast && count(grid, SODIUM) === 0,
    `${count(grid, SODIUM)} sodium left`);
}

// 6. Chlorine is consumed 1:1, so a small cloud can only salt as much sodium as
//    it had cells — it is a reagent, not a catalyst. (Some of the cloud also
//    drifts off / dissipates, so the bound is one-sided: salt ≤ chlorine.)
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 50, 59, 59, STONE);
  fill(grid, 20, 30, 39, 49, SODIUM); // 20x20 = 400 grains, far more than the gas
  const gas = 60;
  fill(grid, 25, 25, 34, 30, CHLORINE); // 10x6 = 60 cells
  for (let t = 0; t < 1200; t++) sim.step();
  const salt = count(grid, SALT);
  check('a small cloud cannot salt an unlimited pile (1:1 consumption)',
    salt > 0 && salt <= gas, `${salt} salt from ${gas} chlorine`);
  check('…and most of the pile survives it', count(grid, SODIUM) >= 300,
    `${count(grid, SODIUM)} sodium left of 400`);
}

// 7. Regression pin: the sodium branch shares updateChlorine's neighbour loop
//    with the poison path, so gassing a garden must still kill it.
{
  reseed();
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 0, 25, 29, 29, STONE);
  fill(grid, 10, 22, 19, 24, PLANT);
  fill(grid, 5, 15, 24, 21, CHLORINE);
  for (let t = 0; t < 300; t++) sim.step();
  check('chlorine still gasses plants', count(grid, PLANT) === 0,
    `${count(grid, PLANT)} plant left`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
