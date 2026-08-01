// Headless behavioural harness for the drum's destruction chain (engine/objects.ts
// SimCapsule / breakDrum): 드럼통 3종도 나무 상자처럼 부서진다 — a barrel bursts into
// its three shards, pours out whatever it held, and a shard shatters into Iron
// Powder. Plus the two rules the drum does NOT share with the crate: an impact
// never breaks it (폭발물에만 파괴), and heat melts it in two stages, barrel →
// shards → Molten Iron, with the shard's melt point a notch above the barrel's.
// Run: `node test/run-drumbreak.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import {
  createDrum,
  createDrumPiece,
  createWoodBox,
  DRUM_MELT_TEMP,
  DRUM_MELT_TICKS,
  DRUM_PIECE_MELT_TEMP,
  WOOD_BOX_SMASH_SPEED,
} from '../src/game/engine/objects';
import type { SimBody, SimCapsule } from '../src/game/engine/objects';
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
Math.random = mulberry32(11);

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
const IRON_POWDER = ID('Iron Powder');
const MOLTEN_IRON = ID('Molten Iron');
const CRUDE_OIL = ID('Crude Oil');
const ACID = ID('Acid');

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
const drums = (grid: Grid): SimCapsule[] =>
  grid.objects.filter((o): o is SimCapsule => o.kind === 'drum');
const partsOf = (grid: Grid): string => JSON.stringify(drums(grid).map((d) => d.part).sort());
const THREE_SHARDS = JSON.stringify(['piece1', 'piece2', 'piece3']);
/** Hold a square block of AIR at `t`° around (cx,cy). Empty cells are perfect
 *  insulators in the heat kernel (conductivity 0 — Simulation.diffuseHeat), so
 *  this heats exactly the bodies standing in it and leaks into nothing else: no
 *  lava pool melting the stone floor out from under the scene, and the reading a
 *  body takes is the number written here rather than that number minus whatever
 *  its reservoir bled off toward a cold room. */
function holdAirHeat(grid: Grid, cx: number, cy: number, r: number, t: number): void {
  for (let y = Math.max(0, cy - r); y <= Math.min(grid.height - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(grid.width - 1, cx + r); x++) {
      const i = grid.idx(x, y);
      if (grid.cells[i] === 0) grid.temp[i] = t;
    }
}

// ─────────────────────────── 1. Blown open ────────────────────────────────────
// An explosion is the ONE thing that opens a drum, and what it leaves is no longer
// a heap of powder: it is the three shards of the barrel, with the contents pouring
// out through them.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 60, 'oil');
  grid.objects.push(drum);
  for (let t = 0; t < 60; t++) sim.step(); // let it settle on the floor
  const oilBefore = count(grid, CRUDE_OIL);
  detonate(sim.context, 50, drum.y, 0, { reach: 20 });
  sim.step();
  check('a blasted drum breaks into its 3 shards', partsOf(grid) === THREE_SHARDS, partsOf(grid));
  check('the barrel itself is gone', !grid.objects.includes(drum as SimBody));
  check('and its contents pour out (내용물이 쏟아진다)',
    count(grid, CRUDE_OIL) > oilBefore, `${oilBefore} → ${count(grid, CRUDE_OIL)} Crude Oil cells`);
  check('the shards carry the barrel\'s fill for their tint',
    drums(grid).every((d) => d.fill === 'oil'));
  check('breaking the barrel alone leaves no Iron Powder yet (that is the shards\' job)',
    count(grid, IRON_POWDER) === 0, `${count(grid, IRON_POWDER)} cells`);
}
{
  // The wreckage has to OUTLIVE the fireball that made it, or the feature is
  // invisible: the shards are spawned inside a flash that lives another 3–6 ticks,
  // and without the newborn grace (DRUM_PIECE_BLAST_GRACE) they were measured
  // lasting exactly one tick before being pulverized into powder. A second charge,
  // dropped once the grace has run out, must still shatter them.
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 60);
  grid.objects.push(drum);
  for (let t = 0; t < 60; t++) sim.step();
  detonate(sim.context, 50, drum.y, 0, { reach: 20 });
  let alive = 0;
  for (let t = 0; t < 20; t++) {
    sim.step();
    if (drums(grid).length === 3) alive = t + 1;
  }
  check('the shards outlive the blast that made them', alive >= 12 && partsOf(grid) === THREE_SHARDS,
    `still 3 shards ${alive} ticks after the blast`);
  check('and the blast really did fling them across the scene',
    drums(grid).some((d) => Math.hypot(d.x - 50, d.y - 60) > 20),
    drums(grid).map((d) => `(${d.x.toFixed(0)},${d.y.toFixed(0)})`).join(' '));
  // The window is a window, not immunity: it has run out by now, so a fresh charge
  // on each piece of wreckage shatters it as any other body.
  check('the grace has expired', drums(grid).every((d) => d.blastGraceTicks === 0));
  for (let i = 0; i < 3; i++) {
    const shard = drums(grid)[0];
    if (!shard) break;
    detonate(sim.context, Math.round(shard.x), Math.round(shard.y), 0, { reach: 20 });
    for (let t = 0; t < 3; t++) sim.step();
  }
  check('but a fresh charge on the wreckage shatters it', grid.objects.length === 0,
    `${grid.objects.length} left`);
  for (let t = 0; t < 200; t++) sim.step();
  check('into Iron Powder', count(grid, IRON_POWDER) > 0, `${count(grid, IRON_POWDER)} cells`);
}
{
  // The acid drum pours acid, and the empty one pours nothing — the control that
  // says the spill really is the fill and not something the blast does.
  const spill = (fill: 'empty' | 'oil' | 'acid', id: number): number => {
    const { grid, sim } = makeWorld();
    floor(grid, 70);
    const drum = createDrum(50, 60, fill);
    grid.objects.push(drum);
    for (let t = 0; t < 60; t++) sim.step();
    detonate(sim.context, 50, drum.y, 0, { reach: 20 });
    sim.step();
    return count(grid, id);
  };
  check('an acid drum bursts into acid', spill('acid', ACID) > 0);
  check('an empty drum spills nothing', spill('empty', CRUDE_OIL) === 0 && spill('empty', ACID) === 0);
}

// ─────────────────── 2. The shard is the end of the chain ─────────────────────
// A shard has nothing left to break into, so it shatters into Iron Powder — and
// it does NOT spill a second drum's worth of contents (the barrel already did).
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  for (const part of ['piece1', 'piece2', 'piece3'] as const)
    grid.objects.push(createDrumPiece(45 + 5 * Number(part.slice(-1)), 64, 'oil', part));
  for (let t = 0; t < 40; t++) sim.step(); // let them settle
  check('shards of a burst drum survive on their own', drums(grid).length === 3,
    `${drums(grid).length} left`);
  const oilBefore = count(grid, CRUDE_OIL);
  detonate(sim.context, 50, 64, 0, { reach: 24 });
  for (let t = 0; t < 5; t++) sim.step();
  check('blasting the shards leaves no bodies at all', grid.objects.length === 0,
    `${grid.objects.length} left`);
  for (let t = 0; t < 200; t++) sim.step(); // let the flung grains arc and land
  check('a shattered shard leaves Iron Powder', count(grid, IRON_POWDER) > 0,
    `${count(grid, IRON_POWDER)} cells`);
  check('and an already-emptied shard spills no more oil',
    count(grid, CRUDE_OIL) === oilBefore, `${oilBefore} → ${count(grid, CRUDE_OIL)}`);
}

// ───────────────── 3. Impact does NOT break a drum (폭발물에만) ─────────────────
// The one place the drum parts ways with the crate it otherwise breaks exactly
// like: a hurl that bursts a wooden box only dents steel.
{
  // Straight down a tall world — the same drop that smashes a crate.
  const fall = (make: () => SimBody): { alive: boolean; peak: number } => {
    const { grid, sim } = makeWorld(100, 400);
    floor(grid, 380);
    const body = make();
    grid.objects.push(body);
    let peak = 0;
    for (let t = 0; t < 400; t++) {
      peak = Math.max(peak, Math.hypot(body.vx, body.vy));
      sim.step();
    }
    return { alive: grid.objects.includes(body), peak };
  };
  const drum = fall(() => createDrum(50, 20));
  const crate = fall(() => createWoodBox(50, 20));
  check('the drop really is a smashing one', drum.peak >= WOOD_BOX_SMASH_SPEED,
    `arrived at ~${drum.peak.toFixed(1)} cells/tick (smash gate ${WOOD_BOX_SMASH_SPEED})`);
  check('a wooden crate bursts on that arrival (control)', !crate.alive);
  check('but a drum survives it', drum.alive);
}
{
  // Hurled sideways into a stone wall at the same speed that bursts a crate.
  const hurl = (make: () => SimBody): boolean => {
    const { grid, sim } = makeWorld();
    floor(grid, 70);
    for (let y = 0; y < 70; y++)
      for (let x = 80; x < 84; x++) grid.cells[grid.idx(x, y)] = STONE;
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    const body = make();
    body.vx = 14;
    grid.objects.push(body);
    for (let t = 0; t < 60; t++) sim.step();
    return grid.objects.includes(body);
  };
  check('a crate flung into a wall bursts (control)', !hurl(() => createWoodBox(40, 40)));
  check('a drum flung into a wall at the same speed does not', hurl(() => createDrum(40, 40)));
  check('nor does one of its shards', hurl(() => createDrumPiece(40, 40, 'empty', 'piece2')));
}

// ────────────────── 4. Melting runs barrel → shards → puddle ──────────────────
// 가열로 녹을 때도 조각 단계를 거친다: the barrel sags open into its three shards
// first, and it is the shards that run to Molten Iron.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 60, 'oil');
  grid.objects.push(drum);
  for (let t = 0; t < 40; t++) sim.step();
  let shardsAt = -1;
  let moltenAt = -1;
  let emptyAt = -1;
  let moltenPeak = 0;
  let shardsSeen = '';
  for (let t = 1; t <= 400; t++) {
    holdAirHeat(grid, 50, 60, 14, 1600); // a furnace around whatever is left of it
    sim.step();
    moltenPeak = Math.max(moltenPeak, count(grid, MOLTEN_IRON));
    if (shardsAt < 0 && !grid.objects.includes(drum as SimBody)) {
      shardsAt = t;
      shardsSeen = partsOf(grid);
    }
    if (moltenAt < 0 && count(grid, MOLTEN_IRON) > 0) moltenAt = t;
    if (emptyAt < 0 && grid.objects.length === 0) emptyAt = t;
  }
  check('sustained heat melts the barrel open', shardsAt > 0, `tick ${shardsAt}`);
  check('into exactly its 3 shards', shardsSeen === THREE_SHARDS, shardsSeen);
  check('no Molten Iron until the shards themselves go', moltenAt > shardsAt,
    `shards at ${shardsAt}, molten at ${moltenAt}`);
  check('the shards then melt away', emptyAt > 0 && emptyAt > shardsAt, `tick ${emptyAt}`);
  check('leaving a Molten Iron puddle', moltenPeak > 0, `${moltenPeak} cells at its peak`);
  // The barrel needs DRUM_MELT_TICKS (24) of held heat to open; the shards give way
  // in a fraction of that, which is what makes the middle stage a beat rather than
  // a second wait (조각 단계를 빠르게 거치도록).
  check('the shard stage is a quick beat, not a second wait',
    moltenAt - shardsAt <= DRUM_MELT_TICKS / 2,
    `${moltenAt - shardsAt} ticks from the barrel opening to the first puddle, vs ${DRUM_MELT_TICKS} to open it`);
}
{
  // A melt is not a blow: the shards slump where the barrel stood, carrying only
  // the motion it already had (녹아서 부서질 땐 튀지 않음).
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 60);
  grid.objects.push(drum);
  for (let t = 0; t < 40; t++) sim.step();
  drum.heatTicks = 1000; // one tick from melting through
  drum.temp = 1600;
  sim.step();
  check('a melted barrel does NOT fling its shards',
    drums(grid).length === 3 &&
      drums(grid).every((d) => Math.hypot(d.vx - drum.vx, d.vy - drum.vy) < 1e-9),
    drums(grid).map((d) => Math.hypot(d.vx - drum.vx, d.vy - drum.vy).toFixed(3)).join(' '));
  check('and they inherit its heat', drums(grid).every((d) => d.temp === drum.temp),
    drums(grid).map((d) => d.temp.toFixed(0)).join(' '));
}
{
  // The blast case, the same census: THAT wreckage really is thrown, each shard
  // outward with its own spin.
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 60);
  grid.objects.push(drum);
  for (let t = 0; t < 60; t++) sim.step();
  detonate(sim.context, 50, drum.y, 0, { reach: 20 });
  sim.step();
  check('a blasted barrel DOES fling its shards',
    drums(grid).some((d) => Math.hypot(d.vx - drum.vx, d.vy - drum.vy) > 0.5),
    drums(grid).map((d) => Math.hypot(d.vx - drum.vx, d.vy - drum.vy).toFixed(3)).join(' '));
  check('and they tumble (each gets its own spin)',
    drums(grid).every((d) => d.angularVelocity !== 0) &&
      new Set(drums(grid).map((d) => d.angularVelocity)).size === 3,
    drums(grid).map((d) => d.angularVelocity.toFixed(4)).join(' '));
}

// ───────────── 5. The shard's melt point really is the higher one ─────────────
// Held in the band BETWEEN the two thresholds, a drum melts open and then the
// wreckage just lies there — the whole point of nudging the shard's point up.
{
  const BAND = (DRUM_MELT_TEMP + DRUM_PIECE_MELT_TEMP) / 2; // 1250°: opens it, won't melt it
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 60);
  grid.objects.push(drum);
  for (let t = 0; t < 40; t++) sim.step();
  let shardsAt = -1;
  let moltenPeak = 0;
  for (let t = 1; t <= 400; t++) {
    holdAirHeat(grid, 50, 60, 14, BAND);
    sim.step();
    moltenPeak = Math.max(moltenPeak, count(grid, MOLTEN_IRON));
    if (shardsAt < 0 && !grid.objects.includes(drum as SimBody)) shardsAt = t;
  }
  check(`${BAND}° melts the barrel open`, shardsAt > 0, `tick ${shardsAt}`);
  check('but leaves the shards standing', partsOf(grid) === THREE_SHARDS, partsOf(grid));
  check('and makes no Molten Iron', moltenPeak === 0, `${moltenPeak} cells`);
}

// ────────────────────────── 6. Crushed (끼임) ─────────────────────────────────
// Entombed in solid with nowhere to go, a drum gives way the same as a crate —
// three shards, dropped in place rather than thrown.
{
  const { grid, sim } = makeWorld();
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  grid.objects.push(createDrum(50, 50));
  sim.step();
  check('a crushed drum breaks into its 3 shards too', partsOf(grid) === THREE_SHARDS, partsOf(grid));
  check('a crushed drum does NOT fling its shards',
    drums(grid).every((d) => Math.hypot(d.vx, d.vy) < 0.5),
    drums(grid).map((d) => Math.hypot(d.vx, d.vy).toFixed(3)).join(' '));
}

// ──────────────────────── 7. A shard is scrap steel ───────────────────────────
// The sealed barrel floats because it is full of air. Burst it and that is gone:
// the shards are torn plate, and plate sinks.
{
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  for (let y = 50; y < 90; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = WATER;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const drum = createDrum(30, 30);
  const shard = createDrumPiece(70, 30, 'empty', 'piece2');
  grid.objects.push(drum, shard);
  for (let t = 0; t < 500; t++) sim.step();
  check('a sealed drum still floats', drum.y + drum.radius < 90 && drum.y - drum.radius < 50,
    `y=${drum.y.toFixed(1)}, waterline 50`);
  check('but a shard sinks to the bottom', shard.y + shard.radius > 85,
    `y=${shard.y.toFixed(1)}, floor 90`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
