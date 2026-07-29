// Headless behavioural harness for the wooden box object (engine/objects.ts
// SimWoodBox): flammability, the crate → three shards → Sawdust chain, buoyancy
// and the douse rule. Run: `node test/run-woodbox.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { createDrum, createWoodBox, WOOD_BOX_IGNITE_TEMP } from '../src/game/engine/objects';
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
const SAND = ID('Sand');
const DEBRIS = ID('Debris');

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
/** Horizontal spread of the Sawdust on the grid, in cells (0 if there is none) —
 *  how far the shavings travelled, which is what tells a fling from a heap. */
function sawdustSpread(grid: Grid): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] !== SAWDUST) continue;
    const x = i % grid.width;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi < lo ? 0 : hi - lo + 1;
}

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

// 2b. Hitting a liquid or a powder surface throws the same one-shot spray the
//     rubber ball has always thrown (액체·가루 충돌 파티클): droplets/grains are
//     relaunched as Debris fragments the tick the surface breaks — once, not every
//     tick the body sits in the pond — and a body set down gently makes none.
{
  // Dropped into a pond from height: a splash on the entry tick.
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  for (let y = 60; y < 90; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = WATER;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(50, 20);
  grid.objects.push(crate);
  let splashAt = -1;
  let peak = 0;
  let afterEntry = 0;
  for (let t = 1; t <= 120; t++) {
    sim.step();
    const d = count(grid, DEBRIS);
    if (splashAt < 0 && d > 0) splashAt = t;
    peak = Math.max(peak, d);
    if (splashAt > 0 && t > splashAt + 60) afterEntry = Math.max(afterEntry, d);
  }
  check('a crate dropped in water throws a splash', splashAt > 0 && peak > 0,
    `tick ${splashAt}, peak ${peak} fragments`);
  check('and the splash is a one-shot, not a per-tick spray',
    afterEntry === 0, `${afterEntry} fragments still flying long after entry`);
  check('the crate still floats after splashing',
    grid.objects.includes(crate as SimBody) && crate.y + crate.radius < 90,
    `y=${crate.y.toFixed(1)}`);
}
{
  // The same drop into sand: a weaker grain scatter (물보다 약하게).
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  for (let y = 60; y < 90; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = SAND;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(50, 20);
  grid.objects.push(crate);
  let scattered = 0;
  for (let t = 1; t <= 60; t++) {
    sim.step();
    scattered = Math.max(scattered, count(grid, DEBRIS));
  }
  check('a crate dropped in sand throws a grain scatter', scattered > 0,
    `peak ${scattered} grains`);
}
{
  // Set down gently onto the surface: below the entry-speed gate, so no spray.
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  for (let y = 60; y < 90; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = WATER;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(50, 53); // rests exactly on the waterline
  grid.objects.push(crate);
  let any = 0;
  for (let t = 1; t <= 120; t++) {
    sim.step();
    any = Math.max(any, count(grid, DEBRIS));
  }
  check('a crate lowered gently onto water does not spray', any === 0, `${any} fragments`);
}
{
  // Shared with the rest of the object layer, not crate-only: a drum splashes too.
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  for (let y = 60; y < 90; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = WATER;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  grid.objects.push(createDrum(50, 20));
  let peak = 0;
  for (let t = 1; t <= 60; t++) {
    sim.step();
    peak = Math.max(peak, count(grid, DEBRIS));
  }
  check('a drum dropped in water splashes too (같은 경로)', peak > 0, `peak ${peak} fragments`);
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

// 3b. The shard census, checked the tick the crate burns through. A fire is not a
//     blow, so the crate SLUMPS: three shards, in place, with no outward throw and
//     no tumble of their own (불타서 부서질 땐 튀지 않음).
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
  // Measured against the crate's OWN velocity: a shard may only carry the motion
  // the box already had, never a kick on top of it.
  check('a burnt-through crate does NOT fling its shards',
    boxes(grid).every((b) => Math.hypot(b.vx - crate.vx, b.vy - crate.vy) < 1e-9),
    boxes(grid).map((b) => Math.hypot(b.vx - crate.vx, b.vy - crate.vy).toFixed(3)).join(' '));
  check('and they get no spin kick either',
    boxes(grid).every((b) => b.angularVelocity === crate.angularVelocity),
    boxes(grid).map((b) => b.angularVelocity.toFixed(4)).join(' '));
}

// 3c. The same census for an IMPACT break: a crate slammed into a wall bursts, and
//     THAT wreckage really is thrown — outward, each shard with its own spin.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  for (let y = 0; y < 70; y++) // a wall down the right-hand side
    for (let x = 80; x < 84; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(40, 40);
  crate.vx = 14;
  grid.objects.push(crate);
  for (let t = 0; t < 30; t++) {
    sim.step();
    if (!grid.objects.includes(crate as SimBody)) break;
  }
  check('a smashed crate DOES fling its shards',
    boxes(grid).some((b) => Math.hypot(b.vx - crate.vx, b.vy - crate.vy) > 0.5),
    boxes(grid).map((b) => Math.hypot(b.vx - crate.vx, b.vy - crate.vy).toFixed(3)).join(' '));
  check('and they tumble (each gets its own spin)',
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
  // 끼임 is not a blow either: the box gives way where it is wedged.
  check('a crushed crate does NOT fling its shards',
    boxes(grid).every((b) => Math.hypot(b.vx, b.vy) < 0.5),
    boxes(grid).map((b) => Math.hypot(b.vx, b.vy).toFixed(3)).join(' '));
  check('nor spin them', boxes(grid).every((b) => b.angularVelocity === 0),
    boxes(grid).map((b) => b.angularVelocity.toFixed(4)).join(' '));
}

// 5. A single shard, destroyed, leaves Sawdust and NOT more objects. Burnt through,
//    the shavings are DEPOSITED where it stood rather than flung: they land in a
//    heap under the shard, not sprayed across the floor.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const shard = createWoodBox(50, 66, 'piece2');
  grid.objects.push(shard);
  shard.burnTicks = 1;
  sim.step();
  check('a shard leaves no further objects', grid.objects.length === 0, `${grid.objects.length} left`);
  const spreadNow = sawdustSpread(grid);
  check('a burnt shard drops its Sawdust in place',
    spreadNow > 0 && spreadNow <= Math.ceil(shard.radius * 2) + 1,
    `${spreadNow} cells wide, shard is ~${(shard.radius * 2).toFixed(1)}`);
  for (let t = 0; t < 200; t++) sim.step(); // let the pile settle
  check('a shard crumbles to Sawdust', count(grid, SAWDUST) > 0, `${count(grid, SAWDUST)} cells`);
}

// 5b. The same shard, smashed instead of burnt: now the shavings really are flung,
//     so they end up spread wider than the shard ever was.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const shard = createWoodBox(50, 60, 'piece2');
  shard.vy = 14; // straight down into the floor, hard
  grid.objects.push(shard);
  for (let t = 0; t < 30; t++) {
    sim.step();
    if (grid.objects.length === 0) break;
  }
  for (let t = 0; t < 200; t++) sim.step(); // let the flung shavings land
  const spread = sawdustSpread(grid);
  check('a smashed shard sprays its Sawdust',
    spread > Math.ceil(shard.radius * 2) + 1,
    `${spread} cells wide, shard is ~${(shard.radius * 2).toFixed(1)}`);
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

// 9. Smashing into solid at speed. A hard enough arrival destroys the box the
//    same way anything else does — but an ordinary drop, and a fast SLIDE along
//    the ground, must not.
{
  const { grid, sim } = makeWorld(100, 400);
  floor(grid, 380);
  const crate = createWoodBox(50, 20);
  grid.objects.push(crate);
  let smashedAt = -1;
  let peakSpeed = 0;
  for (let t = 1; t <= 300; t++) {
    peakSpeed = Math.max(peakSpeed, Math.hypot(crate.vx, crate.vy));
    sim.step();
    if (smashedAt < 0 && !grid.objects.includes(crate as SimBody)) smashedAt = t;
  }
  const parts = boxes(grid).map((b) => b.part).sort();
  check('a long fall onto solid smashes the crate', smashedAt > 0,
    `tick ${smashedAt}, arrived at ~${peakSpeed.toFixed(1)} cells/tick`);
  check('and it leaves the same 3 shards',
    JSON.stringify(parts) === JSON.stringify(['piece1', 'piece2', 'piece3']), JSON.stringify(parts));
}
{
  // A crate hurled sideways into a wall.
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  for (let y = 0; y < 70; y++) // a wall down the right-hand side
    for (let x = 80; x < 84; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(40, 40);
  crate.vx = 14;
  grid.objects.push(crate);
  let smashed = false;
  for (let t = 0; t < 30; t++) {
    sim.step();
    if (!grid.objects.includes(crate as SimBody)) { smashed = true; break; }
  }
  check('a crate hurled into a wall bursts', smashed);
  check('into its 3 shards',
    JSON.stringify(boxes(grid).map((b) => b.part).sort()) ===
      JSON.stringify(['piece1', 'piece2', 'piece3']));
}
{
  // The same hurl, but a shard: nothing left to break into, so Sawdust.
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  for (let y = 0; y < 70; y++)
    for (let x = 80; x < 84; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const shard = createWoodBox(40, 40, 'piece3');
  shard.vx = 14;
  grid.objects.push(shard);
  let smashed = false;
  for (let t = 0; t < 30; t++) {
    sim.step();
    if (!grid.objects.includes(shard as SimBody)) { smashed = true; break; }
  }
  for (let t = 0; t < 200; t++) sim.step(); // let the shavings land
  check('a shard hurled into a wall bursts too', smashed);
  check('and leaves Sawdust, not more objects',
    grid.objects.length === 0 && count(grid, SAWDUST) > 0,
    `${grid.objects.length} objects, ${count(grid, SAWDUST)} sawdust`);
}
{
  // Not a crash: an ordinary drop, and a crate racing along flat ground. The test
  // measures ARRIVAL speed at a surface, not raw velocity — a box tearing along a
  // floor is moving fast but is never closing on it.
  const { grid, sim } = makeWorld(400, 100);
  floor(grid, 70);
  const dropped = createWoodBox(20, 30); // ~34 cells of fall ⇒ well under the threshold
  const raced = createWoodBox(60, 63);
  grid.objects.push(dropped, raced);
  for (let t = 0; t < 60; t++) sim.step();
  raced.vx = 20; // tearing along the floor, but never INTO it
  let travelled = 0;
  for (let t = 0; t < 12; t++) {
    sim.step(); // stops well short of the far wall, which WOULD be a real crash
    travelled = raced.x - 60;
  }
  check('an ordinary drop does not smash', grid.objects.includes(dropped as SimBody));
  check('nor does racing along flat ground',
    grid.objects.includes(raced as SimBody), `travelled ${travelled.toFixed(0)} cells`);
}
{
  // The world's own border counts as the wall it is: a box hurled into the edge
  // of a `wall`-bordered sandbox smashes on it like any other solid.
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const crate = createWoodBox(60, 40);
  crate.vx = 16;
  grid.objects.push(crate);
  let smashed = false;
  for (let t = 0; t < 30; t++) {
    sim.step();
    if (!grid.objects.includes(crate as SimBody)) { smashed = true; break; }
  }
  check('the world border wall smashes it too', smashed);
}

// 10. The non-destructive forces stay non-destructive on their own. Each of these
//     shoves a crate into a wall as hard as it can and the crate must survive —
//     the promise the smash threshold is there to keep (a Woofer in particular
//     documents 완전한 비파괴성). They can still combine past it in one tick, which
//     is deliberate; what must never happen is any one of them doing it alone.
function shoveIntoWall(
  push: (sim: Simulation, x: number, y: number) => void,
): { alive: boolean; peakSpeed: number } {
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  for (let y = 0; y < 70; y++) // wall down the right-hand side
    for (let x = 74; x < 78; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(60, 63);
  grid.objects.push(crate);
  for (let t = 0; t < 40; t++) sim.step(); // settle against the floor
  let peakSpeed = 0;
  for (let t = 0; t < 40; t++) {
    push(sim, 40, 63); // keep shoving it rightwards into the wall
    sim.step();
    if (!grid.objects.includes(crate as SimBody)) return { alive: false, peakSpeed };
    peakSpeed = Math.max(peakSpeed, Math.hypot(crate.vx, crate.vy));
  }
  return { alive: true, peakSpeed };
}
{
  const woofer = shoveIntoWall((sim, _x, y) => {
    // Inside WOOFER_KNOCK_RADIUS + the crate's reach, i.e. as close as a Woofer's
    // shockwave ever gets to hit it — the worst case for the guarantee.
    sim.context.wooferPulseX.push(52);
    sim.context.wooferPulseY.push(y);
  });
  // peakSpeed proves the push actually landed, so "alive" isn't vacuously true.
  check('a Woofer pulse alone never smashes a crate (완전한 비파괴성)',
    woofer.alive && woofer.peakSpeed > 1, `shoved to ${woofer.peakSpeed.toFixed(1)} cells/tick`);
}
{
  const wind = shoveIntoWall((sim, x, y) => {
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = 0; dx < 30; dx++) sim.context.setWind(x + dx, y + dy, 3); // 3 = blow right
    // Simulation.step() wipes last tick's wind field at the top of the tick before
    // the fans repaint it during the CA scan. Clearing the flag here stands in for
    // that repaint, so the stamped gust survives into this step exactly as a real
    // Fan's would.
    sim.context.windStamped = false;
  });
  check('a Fan\'s wind alone never smashes a crate',
    wind.alive && wind.peakSpeed > 1, `shoved to ${wind.peakSpeed.toFixed(1)} cells/tick`);
}
{
  // A near-miss blast: its concussion shoves the crate hard, but the flash never
  // reaches the footprint (a direct hit is the separate, intended destroy path).
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  for (let y = 0; y < 70; y++)
    for (let x = 74; x < 78; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const crate = createWoodBox(60, 63);
  grid.objects.push(crate);
  for (let t = 0; t < 40; t++) sim.step();
  detonate(sim.context, 36, 63, 0, { reach: 15, power: 6 });
  let alive = true;
  let peak = 0;
  for (let t = 0; t < 40; t++) {
    sim.step();
    if (!grid.objects.includes(crate as SimBody)) { alive = false; break; }
    peak = Math.max(peak, Math.hypot(crate.vx, crate.vy));
  }
  check('a near-miss blast alone never smashes a crate', alive && peak > 1,
    `shoved to ${peak.toFixed(1)} cells/tick`);
}

console.log(failures === 0 ? '\nAll wooden-box checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
