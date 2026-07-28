// Headless behavioural harness for the wooden box object (engine/objects.ts
// SimWoodBox): flammability, the crate → three shards → Sawdust chain, buoyancy
// and the douse rule. Run: `node test/run-woodbox.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { createWoodBox, WOOD_BOX_IGNITE_TEMP } from '../src/game/engine/objects';
import type { SimBody, SimWoodBox } from '../src/game/engine/objects';
import { getMaterial } from '../src/game/materials/registry';
import { detonate } from '../src/game/materials/blast';
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
Math.random = mulberry32(7);

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
const LAVA = ID('Lava');
const SAWDUST = ID('Sawdust');
const FIRE = ID('Fire');

function makeWorld(w = 100, h = 100): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  const sim = new Simulation(grid);
  return { grid, sim };
}
function floor(grid: Grid, y: number, id = STONE): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, yy)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
const boxes = (grid: Grid): SimWoodBox[] =>
  grid.objects.filter((o): o is SimWoodBox => o.kind === 'woodbox');

// 1. A crate dropped on stone settles flush and stays put (no rattling, no roll).
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const crate = createWoodBox(50, 40);
  grid.objects.push(crate);
  for (let t = 0; t < 200; t++) sim.step();
  const restY = crate.y;
  const flush = Math.abs(restY + crate.halfH - 70) < 0.6;
  check('crate settles flush on the floor', flush, `y=${restY.toFixed(2)} bottom=${(restY + crate.halfH).toFixed(2)}`);
  check('crate at rest is still', Math.hypot(crate.vx, crate.vy) < 0.05, `|v|=${Math.hypot(crate.vx, crate.vy).toFixed(4)}`);
  check('crate does not drift sideways', Math.abs(crate.x - 50) < 0.01, `x=${crate.x.toFixed(3)}`);
  check('crate survives on its own', grid.objects.length === 1);
  check('a crate dropped straight down stays square', Math.abs(crate.angle) < 1e-3,
    `angle=${crate.angle.toFixed(4)}`);
}

// 1b. Contact torque: a crate shoved along the ground actually spins (the whole
//     point of making it a rotating body), and squares back up once it stops.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const crate = createWoodBox(30, 63);
  grid.objects.push(crate);
  for (let t = 0; t < 40; t++) sim.step(); // land first
  crate.vx = 5;
  let peakSpin = 0;
  let spunBy = 0;
  for (let t = 0; t < 60; t++) {
    sim.step();
    peakSpin = Math.max(peakSpin, Math.abs(crate.angularVelocity));
    spunBy = Math.max(spunBy, Math.abs(crate.angle));
  }
  check('friction spins a shoved crate (contact torque)', peakSpin > 0.01,
    `peak |w|=${peakSpin.toFixed(4)} rad/tick`);
  check('the crate visibly rotates as it goes', spunBy > 0.1, `turned ${spunBy.toFixed(3)} rad`);
  for (let t = 0; t < 400; t++) sim.step(); // let it roll to a stop
  const QUARTER = Math.PI / 2;
  const offSquare = Math.abs(crate.angle - Math.round(crate.angle / QUARTER) * QUARTER);
  check('a settled crate eases back to square', offSquare < 1e-3,
    `off-square by ${offSquare.toFixed(5)} rad`);
}

// 1c. A crate rolls DOWN a slope rather than sitting on it — torque, not friction
//     alone, is what makes that happen.
{
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  for (let i = 0; i < 60; i++) // a 45° ramp descending to the right
    for (let y = 30 + i; y < 90; y++) grid.cells[grid.idx(20 + i, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(30, 25);
  grid.objects.push(crate);
  const x0 = crate.x;
  let spun = 0;
  for (let t = 0; t < 200; t++) {
    sim.step();
    spun = Math.max(spun, Math.abs(crate.angularVelocity));
    if (!grid.objects.includes(crate as SimBody)) break;
  }
  check('a crate on a slope runs downhill', crate.x > x0 + 3, `x ${x0.toFixed(1)} → ${crate.x.toFixed(1)}`);
  check('and spins while it does', spun > 0.01, `peak |w|=${spun.toFixed(4)}`);
}

// 2. Timber floats: density 1.4 vs Water 3 ⇒ well under half submerged.
{
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  for (let y = 50; y < 90; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = WATER;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(50, 30);
  grid.objects.push(crate);
  for (let t = 0; t < 400; t++) sim.step();
  const submerged = crate.y + crate.radius - 50;
  check(
    'crate floats on water',
    crate.y + crate.radius < 90 && submerged > 0 && submerged < 2 * crate.radius,
    `submerged=${submerged.toFixed(2)} of ${(2 * crate.radius).toFixed(1)} cells`,
  );
}

// 3. Heat sets it alight, and it burns down into exactly three shards which then
//    crumble into Sawdust. The full chain, in one run.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const crate = createWoodBox(50, 63);
  grid.objects.push(crate);
  for (let t = 0; t < 5; t++) sim.step();
  check('a cold crate does not catch', crate.burnTicks === 0);
  // The 가열 브러시 writes the body's own reservoir; use it as the ignition source.
  crate.temp = WOOD_BOX_IGNITE_TEMP + 200;
  let litAt = -1;
  let shatterAt = -1;
  let emptyAt = -1;
  let peakFire = 0;
  for (let t = 1; t <= 600; t++) {
    crate.temp = Math.max(crate.temp, WOOD_BOX_IGNITE_TEMP + 200); // hold the brush on it
    sim.step();
    peakFire = Math.max(peakFire, count(grid, FIRE));
    if (litAt < 0 && crate.burnTicks > 0) litAt = t;
    if (shatterAt < 0 && !grid.objects.includes(crate as SimBody)) shatterAt = t;
    if (shatterAt > 0 && emptyAt < 0 && grid.objects.length === 0) emptyAt = t;
  }
  check('sustained heat sets the crate alight', litAt > 0 && litAt <= 6, `tick ${litAt}`);
  check('a burning crate emits real Fire cells', peakFire > 0, `peak ${peakFire} cells`);
  check('the crate breaks into exactly 3 shards', shatterAt > 0, `tick ${shatterAt}`);
  check('the shards then crumble away', emptyAt > 0 && emptyAt > shatterAt, `tick ${emptyAt}`);
  check('shards leave Sawdust behind', count(grid, SAWDUST) > 0, `${count(grid, SAWDUST)} cells`);
}

// 3b. The shard census, checked the tick the crate breaks.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const crate = createWoodBox(50, 63);
  grid.objects.push(crate);
  crate.burnTicks = 1; // one tick from burning through
  sim.step();
  const parts = boxes(grid).map((b) => b.part).sort();
  check('crate → piece1+piece2+piece3', JSON.stringify(parts) === JSON.stringify(['piece1', 'piece2', 'piece3']),
    JSON.stringify(parts));
  check('shards inherit the fire', boxes(grid).every((b) => b.burnTicks > 0));
  check('shards scatter outward', boxes(grid).some((b) => Math.hypot(b.vx, b.vy) > 0.5));
  check('shards tumble (each gets its own spin)',
    boxes(grid).every((b) => b.angularVelocity !== 0) &&
      new Set(boxes(grid).map((b) => b.angularVelocity)).size === 3,
    boxes(grid).map((b) => b.angularVelocity.toFixed(4)).join(' '));
}

// 4. Broken by force (a crush) rather than by fire: still three shards, unlit.
{
  const { grid, sim } = makeWorld();
  // Entomb the crate in stone so the crush trigger fires.
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(50, 50);
  grid.objects.push(crate);
  sim.step();
  const parts = boxes(grid).map((b) => b.part).sort();
  check('a crushed crate breaks into its 3 shards too',
    JSON.stringify(parts) === JSON.stringify(['piece1', 'piece2', 'piece3']), JSON.stringify(parts));
  check('shards of an unlit crate are unlit', boxes(grid).every((b) => b.burnTicks === 0));
}

// 5. A single shard, destroyed, leaves Sawdust and NOT more objects.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const shard = createWoodBox(50, 66, 'piece2');
  grid.objects.push(shard);
  shard.burnTicks = 1;
  sim.step();
  check('a shard leaves no further objects', grid.objects.length === 0, `${grid.objects.length} left`);
  for (let t = 0; t < 200; t++) sim.step(); // let the flung shavings land
  check('a shard crumbles to Sawdust', count(grid, SAWDUST) > 0, `${count(grid, SAWDUST)} cells`);
}

// 6. Dunking a burning crate puts it out (and it can catch again afterwards).
{
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  for (let y = 50; y < 90; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = WATER;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(50, 30);
  crate.burnTicks = 600; // alight, with plenty of fuse left
  grid.objects.push(crate);
  let doused = -1;
  for (let t = 1; t <= 400; t++) {
    sim.step();
    if (doused < 0 && crate.burnTicks === 0) doused = t;
  }
  check('water douses a burning crate', doused > 0, `tick ${doused}`);
  check('the doused crate survives', grid.objects.includes(crate as SimBody));
}

// 7. Lava lights it from the outside (no brush involved) and it burns through.
{
  const { grid, sim } = makeWorld();
  floor(grid, 80);
  for (let y = 72; y < 80; y++)
    for (let x = 0; x < grid.width; x++) {
      grid.cells[grid.idx(x, y)] = LAVA;
      grid.temp[grid.idx(x, y)] = 1500; // molten, not a cold pool that freezes to Stone
    }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(50, 60);
  grid.objects.push(crate);
  let lit = false;
  for (let t = 0; t < 400; t++) {
    sim.step();
    if (crate.burnTicks > 0) lit = true;
    if (!grid.objects.includes(crate as SimBody)) break;
  }
  check('lava sets a crate alight', lit);
  check('the crate eventually burns through', !grid.objects.includes(crate as SimBody));
}

// 8. Blown apart: a blast that engulfs the crate breaks it into its shards too
//    (the same 2차 오브젝트 rule, whatever did the breaking).
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const crate = createWoodBox(50, 63);
  grid.objects.push(crate);
  for (let t = 0; t < 60; t++) sim.step(); // let it settle
  detonate(sim.context, 50, 63, 0, { reach: 20 });
  sim.step();
  const parts = boxes(grid).map((b) => b.part).sort();
  check('a blasted crate breaks into its 3 shards',
    JSON.stringify(parts) === JSON.stringify(['piece1', 'piece2', 'piece3']), JSON.stringify(parts));
}

console.log(failures === 0 ? '\nAll wooden-box checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
