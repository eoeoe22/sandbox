// Headless behavioural harness for the FLAT FACES the drums and the wooden crate
// collide with (engine/objects.ts bodyCore / gridContacts / resolvePair), and for
// the smash-on-impact rules now reaching object↔object collisions.
//
// Two things this guards, and one control:
//   - 쌓기: a barrel's lid and a crate's every face are flat, so another body set
//     on top of one STAYS on top of it — a two- and three-high stack holds still
//     instead of the load rolling off the dome/disc these used to collide as. The
//     control that keeps this honest is the rubber ball, which is still a disc and
//     must still roll off.
//   - 오브젝트끼리 충돌 파괴: a crate hurled into another crate bursts on the same
//     closing-speed threshold that bursts it against a wall, and so does the crate
//     it hit; a molotov breaks against another body at its own much lower one. The
//     control is the drum, which explosives alone open.
//
// Run: `node test/run-stacking.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import {
  createDrum,
  createMolotov,
  createRubberBall,
  createWoodBox,
  MOLOTOV_SMASH_SPEED,
  WOOD_BOX_SMASH_SPEED,
} from '../src/game/engine/objects';
import type { SimBody } from '../src/game/engine/objects';
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

const FLOOR_Y = 90;

function makeWorld(w = 140, h = 120): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  const sim = new Simulation(grid);
  for (let y = FLOOR_Y; y < h; y++)
    for (let x = 0; x < w; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  return { grid, sim };
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

/** Vertical half-extent of a body — where its own underside is. Boxy bodies carry
 *  it as `halfH`; a ball is its radius. (`bodyReach` is the radius of the circle
 *  around the WHOLE box, i.e. out to a corner, so it is the wrong figure here.) */
const halfHeight = (b: SimBody): number => ('halfH' in b ? b.halfH : (b as { r: number }).r);

/** Set `b` down with its underside `gap` cells above `topOf`'s upper face. */
function stackOn(b: SimBody, topOf: SimBody, gap = 1): void {
  b.x = topOf.x;
  b.y = topOf.y - halfHeight(topOf) - halfHeight(b) - gap;
}

// ─────────────────────────── 1. Stacking holds ──────────────────────────────
// A crate set on a crate set on the floor: the top one must still be up there,
// still over the one below it, and everything must have gone to sleep.
{
  const { grid, sim } = makeWorld();
  const bottom = createWoodBox(50, FLOOR_Y - 6);
  grid.objects.push(bottom);
  run(sim, 40);
  const top = createWoodBox(0, 0);
  stackOn(top, bottom);
  grid.objects.push(top);
  run(sim, 300);
  const seatedOn = bottom.y - top.y;
  check(
    'a crate stacked on a crate stays on it',
    Math.abs(top.x - bottom.x) < 0.5 && Math.abs(seatedOn - (top.halfH + bottom.halfH)) < 0.6,
    `dx=${(top.x - bottom.x).toFixed(2)}, seated ${seatedOn.toFixed(2)} vs ${(top.halfH + bottom.halfH).toFixed(1)}`,
  );
  check(
    'and the stack comes to a dead stop',
    Math.hypot(top.vx, top.vy) < 0.05 && Math.abs(top.angularVelocity) < 0.01,
    `|v|=${Math.hypot(top.vx, top.vy).toFixed(4)} |w|=${Math.abs(top.angularVelocity).toFixed(4)}`,
  );
  check('neither crate is destroyed by being stacked', grid.objects.length === 2);
}

// Three barrels: the lid of a drum is a flat face too (위 아랫면을 평면처럼), so a
// column of them holds exactly the way the crates do.
{
  const { grid, sim } = makeWorld();
  const a = createDrum(50, FLOOR_Y - 8);
  grid.objects.push(a);
  run(sim, 40);
  const b = createDrum(0, 0);
  stackOn(b, a);
  grid.objects.push(b);
  run(sim, 60);
  const c = createDrum(0, 0);
  stackOn(c, b);
  grid.objects.push(c);
  run(sim, 400);
  const heights = [a, b, c].map((d) => d.y).sort((p, q) => q - p);
  check(
    'three drums stack into a column',
    grid.objects.length === 3 &&
      Math.abs(heights[0] - heights[1] - 2 * a.halfH) < 0.8 &&
      Math.abs(heights[1] - heights[2] - 2 * a.halfH) < 0.8,
    `y = ${heights.map((h) => h.toFixed(1)).join(', ')}, drum is ${(2 * a.halfH).toFixed(0)} tall`,
  );
  check(
    'and the column is upright and still',
    [a, b, c].every((d) => Math.abs(d.x - 50) < 1 && Math.abs(d.angle) < 0.05),
    [a, b, c].map((d) => `x=${d.x.toFixed(1)} ang=${d.angle.toFixed(3)}`).join(' '),
  );
}

// Mixed load: a crate on a barrel. The two shapes have to agree about what a flat
// face is, or the crate slides off the lid.
{
  const { grid, sim } = makeWorld();
  const drum = createDrum(50, FLOOR_Y - 8);
  grid.objects.push(drum);
  run(sim, 40);
  const crate = createWoodBox(0, 0);
  stackOn(crate, drum);
  grid.objects.push(crate);
  run(sim, 300);
  check(
    'a crate rides on a drum lid',
    crate.y < drum.y - 1 && Math.abs(crate.x - drum.x) < 1,
    `crate (${crate.x.toFixed(1)}, ${crate.y.toFixed(1)}) drum (${drum.x.toFixed(1)}, ${drum.y.toFixed(1)})`,
  );
}

// The CONTROL. A rubber ball is still a plain disc, and a disc has no flat face:
// a ball set on a ball has to roll off, exactly as everything used to.
{
  const { grid, sim } = makeWorld();
  const under = createRubberBall(50, FLOOR_Y - 4, 4);
  grid.objects.push(under);
  run(sim, 40);
  const over = createRubberBall(50.4, under.y - 9, 4);
  grid.objects.push(over);
  run(sim, 300);
  check(
    'a ball still rolls off a ball (the round control)',
    Math.abs(over.x - under.x) > 4,
    `apart by ${Math.abs(over.x - under.x).toFixed(1)} cells`,
  );
}

// ───────────── 2. A stacked body is carried, not merely balanced ─────────────
// Drag the bottom crate of a stack along and the top one has to come with it —
// that is friction across a real face rather than a point touch. The bottom is
// driven at a walking pace each tick (ground friction would otherwise stop it in a
// few, and a yank faster than μ·g can accelerate the load would simply be pulled
// out from under it, like a tablecloth), so what is measured is the carry.
{
  const { grid, sim } = makeWorld();
  const bottom = createWoodBox(40, FLOOR_Y - 6);
  grid.objects.push(bottom);
  run(sim, 40);
  const top = createWoodBox(0, 0);
  stackOn(top, bottom);
  grid.objects.push(top);
  run(sim, 200);
  const x0 = top.x;
  for (let t = 0; t < 25; t++) {
    bottom.vx = 0.4;
    sim.step();
  }
  check(
    'dragging the bottom crate carries the stacked one along',
    top.x > x0 + 5,
    `top x ${x0.toFixed(1)} → ${top.x.toFixed(1)}, bottom at ${bottom.x.toFixed(1)}`,
  );
  check('and it is still riding on it', top.y < bottom.y - 1,
    `top y=${top.y.toFixed(1)}, bottom y=${bottom.y.toFixed(1)}`);
}

// ──────────── 3. Smash thresholds now fire on object↔object hits ─────────────
// A crate flung into a parked crate at over the smash speed: both burst, and each
// leaves the same three shards a wall would have left.
{
  const { grid, sim } = makeWorld();
  const parked = createWoodBox(100, FLOOR_Y - 6);
  const flung = createWoodBox(40, FLOOR_Y - 6);
  grid.objects.push(parked, flung);
  run(sim, 20);
  flung.vx = WOOD_BOX_SMASH_SPEED + 4;
  let broke = -1;
  for (let t = 1; t <= 60; t++) {
    sim.step();
    if (broke < 0 && !grid.objects.includes(flung)) broke = t;
  }
  check('a crate hurled into another crate bursts', broke > 0, `tick ${broke}`);
  check('and so does the crate it hit', !grid.objects.includes(parked));
  const parts = grid.objects
    .filter((o): o is SimBody & { part: string } => 'part' in o)
    .map((o) => o.part);
  check(
    'both leave the usual three shards each',
    parts.filter((p) => p === 'piece1').length === 2 && parts.length === 6,
    `${parts.length} shards`,
  );
}

// The same collision under the threshold is just a knock: nothing breaks.
{
  const { grid, sim } = makeWorld();
  const parked = createWoodBox(100, FLOOR_Y - 6);
  const rolled = createWoodBox(40, FLOOR_Y - 6);
  grid.objects.push(parked, rolled);
  run(sim, 20);
  rolled.vx = WOOD_BOX_SMASH_SPEED - 4;
  run(sim, 80);
  check(
    'a gentle nudge between crates breaks nothing',
    grid.objects.length === 2,
    `${grid.objects.length} bodies left`,
  );
  check('and it does push the parked crate along', parked.x > 100, `x=${parked.x.toFixed(1)}`);
}

// Glass gives way at a fraction of the crate's speed — against another body just
// as against a wall. Dropped onto a crate's flat top from high enough to clear
// MOLOTOV_SMASH_SPEED, the bottle is the one that breaks and the crate — far under
// ITS threshold at that speed — is not.
{
  const { grid, sim } = makeWorld();
  const crate = createWoodBox(50, FLOOR_Y - 6);
  grid.objects.push(crate);
  run(sim, 40);
  const bottle = createMolotov(50, 30); // ~45 cells of fall onto the crate's lid
  grid.objects.push(bottle);
  let broke = -1;
  let hitSpeed = 0;
  for (let t = 1; t <= 120; t++) {
    if (grid.objects.includes(bottle)) hitSpeed = Math.hypot(bottle.vx, bottle.vy);
    sim.step();
    if (broke < 0 && !grid.objects.includes(bottle)) broke = t;
  }
  check(
    'a molotov dropped onto a crate shatters on it',
    broke > 0 && hitSpeed >= MOLOTOV_SMASH_SPEED,
    `tick ${broke}, arrived at ~${hitSpeed.toFixed(1)} cells/tick`,
  );
  check(
    'and the crate it landed on — well under ITS threshold — survives',
    grid.objects.includes(crate),
    `${grid.objects.length} bodies left`,
  );
}

// The CONTROL for the whole rule: steel. The drum takes the identical hurl and
// only dents (충돌 충격에는 파괴되지 않고 폭발물에만 파괴).
{
  const { grid, sim } = makeWorld();
  const parked = createDrum(100, FLOOR_Y - 8);
  const flung = createDrum(40, FLOOR_Y - 8);
  grid.objects.push(parked, flung);
  run(sim, 20);
  flung.vx = WOOD_BOX_SMASH_SPEED + 4;
  run(sim, 80);
  check(
    'two drums slammed together at the same speed both survive',
    grid.objects.length === 2 && grid.objects.every((o) => o.kind === 'drum'),
    `${grid.objects.length} bodies left`,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
