// Headless behavioural harness for the Laser Heat Ray's grip on the OBJECT layer
// (materials/heatray.ts absorbHeatRayCell ↔ engine/objects.ts footprintHazards): a
// beam that reaches a free rigid body is ABSORBED by it — it stops there instead of
// flying through — and the strike's heat goes into that body's own reservoir, so a
// laser held on a target cooks it (드럼통 용융 / 나무 상자 점화 / 고무공 소각 /
// 다이너마이트 유폭) while a beam that moves on lets it cool back down.
// Run: `node test/run-heatrayobjects.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import {
  bodyReach,
  createDrum,
  createDynamite,
  createRubberBall,
  createWoodBox,
  DRUM_MELT_TEMP,
  WOOD_BOX_IGNITE_TEMP,
} from '../src/game/engine/objects';
import type { SimBody, SimCapsule } from '../src/game/engine/objects';
import { absorbHeatRayCell, emitHeatRay, HEAT_RAY } from '../src/game/materials/heatray';
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
const GLASS = ID('Glass');

// The board: a stone floor with a clear firing lane above it. The muzzle sits at
// the left edge (MUZZLE_X) at the height of a body standing on the floor, so a
// beam fired right travels level into the target — the geometry a Laser bolted to
// a wall gives you. A stone backstop at the far right is what the "the body BLOCKS
// the beam" test watches: with the target gone the lane's beams reach and scorch
// it; with a body in the way they never should.
const W = 120;
const H = 90;
const FLOOR_Y = 60;
const MUZZLE_X = 4;
const TARGET_X = 60;
const BACKSTOP_X = 100;

interface World {
  grid: Grid;
  sim: Simulation;
}

function makeWorld(opts: { backstop?: boolean } = {}): World {
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  for (let y = FLOOR_Y; y < H; y++) for (let x = 0; x < W; x++) grid.cells[grid.idx(x, y)] = STONE;
  if (opts.backstop)
    for (let y = 0; y < FLOOR_Y; y++) grid.cells[grid.idx(BACKSTOP_X, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  return { grid, sim };
}

/** Stand `body` on the floor at TARGET_X and drop it into the world. */
function place(w: World, body: SimBody): SimBody {
  body.x = TARGET_X;
  body.y = FLOOR_Y - bodyReach(body);
  w.grid.objects.push(body);
  return body;
}

/** Run `ticks` steps, firing one Heat Ray per tick from the muzzle straight at the
 *  target's standing height — exactly what a powered Laser does (laser.ts fires one
 *  beam per tick from the cell ahead of it). `fire: false` runs the same world with
 *  the emitter dark, the control every heating test is judged against. */
function run(w: World, ticks: number, aimY: number, fire = true): void {
  for (let i = 0; i < ticks; i++) {
    if (fire && w.grid.cells[w.grid.idx(MUZZLE_X, aimY)] === 0) {
      emitHeatRay(w.sim.context, MUZZLE_X, aimY, 1, 0);
    }
    w.sim.step();
  }
}

/** The height a body standing on the floor is centred at — where to aim. */
const aimAt = (body: SimBody): number => Math.round(body.y);

function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}

/** Beam cells that got PAST the target — the lane between the body and the far
 *  wall. The lane in front of the muzzle is always full of beams in flight (one is
 *  fired every tick and takes ~17 ticks to cross), so a plain grid-wide count says
 *  nothing; what the absorption promises is that none of them come out the far
 *  side. */
function beamsBeyond(grid: Grid, x0: number): number {
  let n = 0;
  for (let y = 0; y < FLOOR_Y; y++)
    for (let x = x0; x < W; x++) if (grid.cells[grid.idx(x, y)] === HEAT_RAY.id) n++;
  return n;
}

/** Ticks a beam needs to fly the lane from the muzzle to the target (3 cells per
 *  tick along an axis — heatray.ts SPEED_ORTH), plus a little slack. Nothing can
 *  be measured on the target before this many ticks have passed. */
const FLIGHT_TICKS = Math.ceil((TARGET_X - MUZZLE_X) / 3) + 4;

/** Hottest cell in the column at `x` above the floor — how hard the backstop was
 *  scorched, which is how a beam that got past the target announces itself. */
function columnHeat(grid: Grid, x: number): number {
  let hot = -Infinity;
  for (let y = 0; y < FLOOR_Y; y++) {
    const t = grid.temp[grid.idx(x, y)];
    if (t > hot) hot = t;
  }
  return hot;
}

// 1. The core of the change: a beam is absorbed by the body it reaches, and its
//    heat lands in that body's reservoir instead of nowhere at all.
{
  const w = makeWorld();
  const drum = place(w, createDrum(TARGET_X, 0)) as SimCapsule;
  const cold = drum.temp;
  run(w, FLIGHT_TICKS + 5, aimAt(drum));
  check('a Heat Ray heats the object it strikes', drum.temp > cold + 100, `${cold.toFixed(0)}° → ${drum.temp.toFixed(0)}°`);
  check('and every beam is consumed at the body', beamsBeyond(w.grid, TARGET_X + 7) === 0, `${beamsBeyond(w.grid, TARGET_X + 7)} beam cells past it`);
}
{
  // Control: the same world with the emitter dark stays at ambient. Without this
  // the test above would pass on any stray heat source in the lane.
  const w = makeWorld();
  const drum = place(w, createDrum(TARGET_X, 0)) as SimCapsule;
  run(w, FLIGHT_TICKS + 5, aimAt(drum), false);
  check('an unlit laser heats nothing', drum.temp < 40, `${drum.temp.toFixed(0)}°`);
}

// 2. The body BLOCKS the beam — it never reaches what stands behind it. Same lane,
//    same backstop, the only difference being whether a drum is in the way.
{
  const w = makeWorld({ backstop: true });
  const drum = place(w, createDrum(TARGET_X, 0)) as SimCapsule;
  run(w, 40, aimAt(drum));
  const shadowed = columnHeat(w.grid, BACKSTOP_X);
  const bare = makeWorld({ backstop: true });
  run(bare, 40, aimAt(drum));
  const lit = columnHeat(bare.grid, BACKSTOP_X);
  check('the beam reaches the backstop with the lane clear', lit > 200, `${lit.toFixed(0)}°`);
  check('but an object in the way shadows it', shadowed < 100, `${shadowed.toFixed(0)}° vs ${lit.toFixed(0)}° unobstructed`);
}

// 3. Sustained fire destroys, one kind at a time — the payoff. Each is checked
//    against a dark-emitter control of the same world so "it died" can't be the
//    world doing it.
{
  // A steel drum melts (DRUM_MELT_TEMP 1200 held for DRUM_MELT_TICKS).
  const w = makeWorld();
  const drum = place(w, createDrum(TARGET_X, 0)) as SimCapsule;
  const aim = aimAt(drum);
  run(w, 120, aim);
  check('a laser held on a drum melts it', !w.grid.objects.includes(drum) || drum.state === 'melted', `state ${drum.state}, ${drum.temp.toFixed(0)}° (melts at ${DRUM_MELT_TEMP}°)`);
  check('and leaves a molten puddle behind', count(w.grid, ID('Molten Iron')) > 0);
}
{
  const w = makeWorld();
  const drum = place(w, createDrum(TARGET_X, 0)) as SimCapsule;
  run(w, 120, aimAt(drum), false);
  check('control: an unlit laser leaves the drum intact', w.grid.objects.includes(drum) && drum.state === 'intact');
}
{
  // A wooden crate catches fire (WOOD_BOX_IGNITE_TEMP 500) and burns to shards.
  const w = makeWorld();
  const box = place(w, createWoodBox(TARGET_X, 0));
  const aim = aimAt(box);
  run(w, 30, aim);
  check('a laser gets a wooden crate over its ignition point', box.temp >= WOOD_BOX_IGNITE_TEMP, `${box.temp.toFixed(0)}° (ignites at ${WOOD_BOX_IGNITE_TEMP}°)`);
  run(w, 220, aim);
  check('and burns it away', !w.grid.objects.includes(box), `${w.grid.objects.length} bodies left`);
  check('leaving real fire/sawdust behind', count(w.grid, ID('Fire')) + count(w.grid, ID('Sawdust')) > 0);
}
{
  // A rubber ball burns away (BALL_BURN_TEMP 300) — no byproduct.
  const w = makeWorld();
  const ball = place(w, createRubberBall(TARGET_X, 0, 4));
  run(w, 60, aimAt(ball));
  check('a laser burns a rubber ball away', !w.grid.objects.includes(ball));
}
{
  // A stick of dynamite cooks off (DYNAMITE_AUTOIGNITE_TEMP 1100) — 유폭.
  const w = makeWorld();
  const stick = place(w, createDynamite(TARGET_X, 0));
  run(w, 200, aimAt(stick));
  check('a laser cooks off a stick of dynamite', !w.grid.objects.includes(stick));
  const crater = count(w.grid, STONE) < W * (H - FLOOR_Y);
  check('and the blast actually cratered the floor', crater);
}

// 4. Pull the beam away and the body cools back down instead of staying doomed —
//    the reservoir relaxes toward its surroundings as it always did.
{
  const w = makeWorld();
  const drum = place(w, createDrum(TARGET_X, 0)) as SimCapsule;
  const aim = aimAt(drum);
  run(w, FLIGHT_TICKS + 5, aim);
  const hot = drum.temp;
  run(w, 80, aim, false);
  check('a body cools once the beam moves off it', drum.temp < hot * 0.5, `${hot.toFixed(0)}° → ${drum.temp.toFixed(0)}°`);
  check('and survives the near miss', w.grid.objects.includes(drum) && drum.state === 'intact');
}

// 5. The absorption seam itself (absorbHeatRayCell), checked directly on the one
//    case the footprint scan above can't stage: a beam resting INSIDE a glass pane.
//    Such a beam carries the pane in its `aux` and must put it back when absorbed
//    (유리는 흐트러지지 않는다) rather than eat it — the same restore the beam does
//    when it moves off on its own. Direct because a body can't come to rest with
//    glass in its footprint (the pane is solid, so collision pushes the body clear),
//    yet the beam's `aux` is exactly the state a careless absorption would drop.
{
  const w = makeWorld();
  const PANE_X = 40;
  for (let y = 20; y < FLOOR_Y; y++) w.grid.cells[w.grid.idx(PANE_X, y)] = GLASS;
  w.grid.dirty.rebuild(w.grid.cells, w.grid.overlay, w.grid.width, w.grid.height);
  const panes = count(w.grid, GLASS);
  const aim = 40;
  // Fly one beam until it comes to rest inside the pane (landings are every 3
  // cells from the muzzle, and the pane is on one of them).
  let rested = false;
  emitHeatRay(w.sim.context, MUZZLE_X, aim, 1, 0);
  for (let i = 0; i < 30 && !rested; i++) {
    w.sim.step();
    rested =
      w.grid.cells[w.grid.idx(PANE_X, aim)] === HEAT_RAY.id &&
      w.grid.aux[w.grid.idx(PANE_X, aim)] === GLASS;
  }
  check('a beam comes to rest inside a glass pane, carrying it in aux', rested);
  const heat = absorbHeatRayCell(w.sim.context, PANE_X, aim);
  check('absorbing it yields the strike heat', heat > 0, `${heat}°`);
  check('and puts the pane back', w.grid.cells[w.grid.idx(PANE_X, aim)] === GLASS && count(w.grid, GLASS) === panes, `${panes} → ${count(w.grid, GLASS)} panes`);
  check('probing a cell with no beam does nothing', absorbHeatRayCell(w.sim.context, PANE_X, aim) === 0 && count(w.grid, GLASS) === panes);
}

// 6. A body being dragged is shielded from its whole physics phase, beams
//    included — same rule as every other hazard (보기 드래그).
{
  const w = makeWorld();
  const drum = place(w, createDrum(TARGET_X, 0)) as SimCapsule;
  drum.held = true;
  run(w, 20, aimAt(drum));
  check('a held body is not heated by the beam', drum.temp < 40, `${drum.temp.toFixed(0)}°`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
