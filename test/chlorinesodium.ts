// Headless behavioural harness for 염소 + 나트륨 → 불꽃 + 소금
// (materials/chlorine.ts, the SODIUM branch of updateChlorine).
//
// The reaction is 2Na + Cl₂ → 2NaCl: two poisons make table salt. What this
// file pins down:
//   • Contact really produces both halves — Fire where the grain was, Salt where
//     the gas was — and does it without any water, air or ignition source.
//   • Loose grains convert completely and exactly 1:1, so nothing is lost or
//     minted in the exchange.
//   • A packed pile burns all the way down as well, because a reaction inside a
//     pile thumps out an invisible shockwave that keeps the grit stirred
//     (stirShock) — without it the salt settles into a lid and the burn stalls
//     after one layer.
//   • That thump moves loose matter and touches no solid whatsoever: sand nearby
//     is thrown around (the positive control that the wave arrives at all), a
//     stone pillar at the same distance is untouched, a `shockLoose` solid — the
//     one kind a shockwave normally carries off, and kills — is left alone
//     (Nanobot probe, plus the general "no Debris ever carries a solid" scan),
//     glass touching the burn doesn't craze, and no Blast is ever painted, which
//     is also what proves it never flashes an `explosive`, sodium included.
//   • It stays a **burn, not a detonation**: the same pile dropped in water
//     detonates instead (the control that keeps someone from "unifying" sodium's
//     two reaction paths).
//   • A lone grain doesn't thump — only a pile-buried one does, so sprinkling
//     stays the clean, quiet rain of salt it should be.
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
const SAND = ID('Sand');
const GLASS = ID('Glass');
const BROKEN_GLASS = ID('Broken Glass');
const PLANT = ID('Plant');
const NANOBOT = ID('Nanobot');
const DEBRIS = ID('Debris');
/** Phase.Solid — read off a known solid rather than importing the engine enum. */
const SOLID_PHASE = getMaterial(ID('Stone')).phase;

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

// 4. A *packed* pile burns all the way down too, and that is the stirring thump's
//    doing (stirShock): without it the salt made at the surface settles into a lid
//    over the metal and the reaction dies after one layer with the core intact.
//    It still has to end as a burn, not a blast — the same pile in water craters
//    (test 5), here the stone floor comes out whole and no Blast is ever painted.
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
  // Without the thump this stalls at ~26 of 50 left (the crust), so the bar is set
  // far below that but not at a flat zero: a grain thrown clear by the shove can
  // land alone under falling salt, and one grain on its own has no pile to stir
  // itself out of — measured across seeds, 0 or occasionally 1 survivor.
  check('a packed pile burns all the way down (the thump keeps it stirred)',
    sodium <= 2, `${sodium} of 50 grains left`);
  check('…still exactly one salt per grain consumed', salt === 50 - sodium,
    `${salt} salt, ${sodium} sodium left`);
  check('…and never detonates the way water makes it (no blast)', !sawBlast);
  check('…leaving the stone floor whole', count(grid, STONE) === stoneBefore,
    `${stoneBefore} → ${count(grid, STONE)} stone`);
  check('…none of the salt melting to Molten Salt', count(grid, MOLTEN_SALT) === 0);
  check('…and the salt staying well under its 800° melting point',
    hottest(grid, SALT) < 800, `hottest salt ${hottest(grid, SALT).toFixed(0)}°`);
}

// 4b. What the thump is allowed to do: shove loose grit, break nothing. A sand
//     column and a stone pillar stand the same distance from a burning pile — the
//     sand is thrown around (the positive control that the wave really is reaching
//     that far, so "the pillar survived" can't mean "nothing arrived") while the
//     pillar is untouched, because the pulse carries POWER 0 exactly like a
//     Woofer's. Sodium being `explosive` is the third probe and the important one:
//     it sits at ground zero of every thump for the whole burn, so if the wave
//     could flash an explosive there would be Blast cells and fewer than one salt
//     per grain — test 4 checks both.
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 45, 59, 59, STONE);
  fill(grid, 26, 42, 33, 44, SODIUM); // the pile that will be burning
  fill(grid, 36, 42, 36, 44, STONE); // a pillar 2 cells clear of it
  fill(grid, 23, 42, 23, 44, SAND); // loose grit, same 2-cell gap on the other side
  const stoneBefore = count(grid, STONE);
  const sandBefore: number[] = [];
  for (let y = 42; y <= 44; y++) sandBefore.push(grid.get(23, y));
  fill(grid, 5, 25, 54, 41, CHLORINE);
  let sawBlast = false;
  for (let t = 0; t < 300; t++) {
    sim.step();
    if (count(grid, BLAST) > 0) sawBlast = true;
  }
  let sandMoved = false;
  for (let y = 42, i = 0; y <= 44; y++, i++) if (grid.get(23, y) !== sandBefore[i]) sandMoved = true;
  check('the thump reaches loose grit nearby and throws it around', sandMoved);
  check('…but breaks no structure — the stone pillar in the same reach is whole',
    count(grid, STONE) === stoneBefore, `${stoneBefore} → ${count(grid, STONE)} stone`);
  check('…and paints no Blast anywhere in the whole burn (invisible, and it never '
    + 'flashes an explosive)', !sawBlast);
}

// 4c-2. "Breaks no structure" is stronger than it sounds: a POWER 0 front is
//     already shadowed by ordinary solids, but a `shockLoose` solid — a crawling
//     Termite/Nanobot — is matter a shockwave *carries*, so a Woofer flings those
//     like powder (and its shockDeathChance crushes a termite outright). This
//     thump touches no solid of any kind. Nanobot is the probe that can prove it:
//     chlorine doesn't gas it (it's a machine, not life), it has no heat death and
//     no shockDeathChance, so the only thing that could ever remove it from the
//     grid here is the wave picking it up as Debris.
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 45, 59, 59, STONE);
  fill(grid, 26, 42, 33, 44, SODIUM);
  fill(grid, 23, 43, 24, 44, NANOBOT); // right up against the pile
  const bots = count(grid, NANOBOT);
  fill(grid, 5, 25, 54, 41, CHLORINE);
  let minBots = bots;
  let debrisCarriedSolid = false;
  for (let t = 0; t < 300; t++) {
    sim.step();
    minBots = Math.min(minBots, count(grid, NANOBOT));
    // The general form of the same claim, for every solid at once rather than one
    // probe: a fragment in flight carries its origin material in `aux`, so if the
    // wave ever picked a solid up it shows up here.
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== DEBRIS) continue;
      const carried = grid.aux[i];
      if (carried !== 0 && getMaterial(carried)?.phase === SOLID_PHASE) debrisCarriedSolid = true;
    }
  }
  check('a shockLoose solid (Nanobot) is never picked up or crushed by the thump',
    minBots >= bots, `${bots} bots, dipped to ${minBots}`);
  check('…and no Debris fragment ever carries a solid at all', !debrisCarriedSolid);
  check('…while the pile beside it still burned down', count(grid, SODIUM) <= 2,
    `${count(grid, SODIUM)} sodium left`);
}

// 4d. Glass is the one thing a shockwave normally *does* mark: any real blast, and
//     the Woofer's pulse too, crazes a fragile solid it washes over (blast.ts's
//     shatterFragile). This thump opts out (`shatters: false`), because it fires
//     for as long as the pile burns and would otherwise take apart the very vessel
//     the player built to hold the reaction. A pane flush against the burn — well
//     inside the reach the sand probe in 4b measured — has to come out whole.
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 45, 59, 59, STONE);
  fill(grid, 26, 42, 33, 44, SODIUM);
  fill(grid, 34, 42, 34, 44, GLASS); // touching the pile
  const glassBefore = count(grid, GLASS);
  fill(grid, 5, 25, 54, 41, CHLORINE);
  for (let t = 0; t < 300; t++) sim.step();
  check('glass touching the burn is not broken by the thump',
    count(grid, GLASS) === glassBefore && count(grid, BROKEN_GLASS) === 0,
    `${glassBefore} → ${count(grid, GLASS)} glass, ${count(grid, BROKEN_GLASS)} broken`);
  check('…and the pile it was standing against still burned', count(grid, SODIUM) <= 2,
    `${count(grid, SODIUM)} sodium left`);
}

// 4c. A lone grain has nothing to stir, so it doesn't thump — otherwise every
//     sprinkled grain would fling the scenery around it. Sand resting on the floor
//     of a sealed pocket, two cells from a single-grain reaction, stays put.
{
  reseed();
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 10, 10, 20, 20, WALL);
  fill(grid, 11, 11, 19, 19, CHLORINE);
  // A single grain resting on the pocket floor: it can neither fall nor slump on
  // its own, so if it isn't exactly where it was put, something shoved it.
  fill(grid, 13, 19, 13, 19, SAND);
  fill(grid, 16, 19, 16, 19, SODIUM); // one grain on the floor, nothing burying it
  for (let t = 0; t < 60; t++) sim.step();
  check('a lone grain reacts without thumping (nothing nearby is shoved)',
    grid.get(13, 19) === SAND && count(grid, SAND) === 1 && count(grid, SALT) === 1,
    `sand at (13,19)=${grid.get(13, 19) === SAND}, ${count(grid, SALT)} salt`);
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
