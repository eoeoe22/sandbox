// Headless behavioural harness for the rubber ball's rotation torque
// (engine/objects.ts SimObject / stepBall / resolveGridCollision): the ball now
// ROLLS. It used to slide friction-free (a disc was the "no-rotation" type); it
// now carries the same 1-axis rotation the capsules do, driven by the contact
// torque r × J, so a nudge spins it and a slope rolls it down — and it rolls to
// a stop via ROLL_RESISTANCE instead of spinning forever.
//
// Three things this guards, and one control:
//   - 굴러감: a ball nudged sideways on a flat floor picks up angularVelocity
//     (the friction torque), and a ball placed on a 45° slope rolls down — its
//     centre descends AND it spins.
//   - 구름 저항: a grounded ball's spin bleeds each tick, converging back toward
//     rest (it does not spin forever like an ideal frictionless wheel).
//   - 제동 대조군: a ball placed at rest with no nudge stays essentially still —
//     the new friction/torque doesn't manufacture motion out of nothing.
//
// Run: `node test/run-ballroll.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { createRubberBall } from '../src/game/engine/objects';
import type { SimObject } from '../src/game/engine/objects';
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
Math.random = mulberry32(29);

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

function fillFloor(grid: Grid, yFloor: number): void {
  // Solid stone from yFloor down, every column.
  for (let y = yFloor; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}

/** A 45° staircase slope: solid from `ceiling(x) = yTop + x` down (one cell step
 *  per column to the right), so a ball dropped on it rolls down-right. The
 *  exposed surface is a diagonal of cell corners — steep enough that gravity
 *  overcomes friction and the ball accelerates down it. */
function fillSlope(grid: Grid, yTop: number): void {
  for (let x = 0; x < grid.width; x++) {
    const surf = yTop + x; // surface row for this column
    for (let y = surf; y < grid.height; y++) grid.cells[grid.idx(x, y)] = STONE;
  }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

const r = 4;
const FLOOR_Y = 90;

// ── 1. A nudge on a flat floor spins the ball (friction → torque → ω) ──────────
//
// The contact point sits directly under the centre on flat ground, so a purely
// horizontal shove is off-centre and the Coulomb friction impulse produces a
// torque r × J that spins the ball up. Before the rolling-torque change this
// ball would have slid forever with ω stuck at 0.
{
  const grid = new Grid(140, 120);
  const sim = new Simulation(grid);
  fillFloor(grid, FLOOR_Y);
  const ball = createRubberBall(70, FLOOR_Y - r - 0.01, r) as SimObject;
  ball.vx = 5; // shoved to the right
  grid.objects.push(ball);
  run(sim, 1);
  check(
    'a sideways nudge on flat ground spins the ball (ω ≠ 0)',
    Math.abs(ball.angularVelocity) > 1e-3,
    `ω=${ball.angularVelocity.toFixed(4)} rad/tick`,
  );
  // Rightward roll ⇒ clockwise visual spin ⇒ ω > 0 (see stepBall's y-down note).
  check(
    'and it spins in the rolling sense (ω > 0 for a rightward roll)',
    ball.angularVelocity > 0,
    `ω=${ball.angularVelocity.toFixed(4)} rad/tick`,
  );
}

// ── 2. A ball placed on a 45° slope rolls DOWN it (descends + spins) ───────────
//
// Gravity along the slope is off-centre against the diagonal contact, so the
// friction torque both spins the ball and the resolved tangential impulse
// accelerates it down the slope. The ball ends lower than it started and has
// accrued real angular velocity — the whole point of "굴러갈 수 있게".
{
  const grid = new Grid(160, 140);
  const sim = new Simulation(grid);
  fillSlope(grid, 30); // surface at y = 30 + x
  // Drop the ball near the top, just above the slope surface so it settles on it.
  const x0 = 12;
  const surfY = 30 + x0;
  const ball = createRubberBall(x0 + 0.5, surfY - r - 2, r) as SimObject;
  grid.objects.push(ball);
  const startY = ball.y;
  run(sim, 80);
  const rolledDown = ball.y > startY + 2; // screen-down = larger y
  const spunUp = Math.abs(ball.angularVelocity) > 0.05;
  check(
    'a ball on a 45° slope rolls down it (descends)',
    rolledDown,
    `y ${startY.toFixed(2)} → ${ball.y.toFixed(2)}`,
  );
  check(
    'and rolls (spins) as it goes',
    spunUp,
    `|ω|=${Math.abs(ball.angularVelocity).toFixed(4)} rad/tick, |vx|=${Math.abs(ball.vx).toFixed(3)}`,
  );
  // Sanity: it moved down-RIGHT along the slope, not up or sideways-off.
  check(
    'down the slope, not parked or flung off',
    ball.x > x0 + 1 && ball.y > startY,
    `(${ball.x.toFixed(2)}, ${ball.y.toFixed(2)})`,
  );
}

// ── 3. Rolling resistance: a grounded rolling ball converges to rest ──────────
//
// ROLL_RESISTANCE bleeds a little ω (and a matching sliver of linear speed)
// every grounded tick, so a ball does not spin forever like an ideal
// frictionless wheel. After a long run on flat ground the ω is well below its
// peak. (Not necessarily exactly zero — gravity keeps nudging — but a small
// fraction of the peak.)
{
  const grid = new Grid(140, 120);
  const sim = new Simulation(grid);
  fillFloor(grid, FLOOR_Y);
  const ball = createRubberBall(20, FLOOR_Y - r - 0.01, r) as SimObject;
  ball.vx = 6;
  grid.objects.push(ball);
  // Capture the peak |ω| during the roll, then settle a long time.
  let peak = 0;
  for (let i = 0; i < 20; i++) {
    sim.step();
    if (Math.abs(ball.angularVelocity) > peak) peak = Math.abs(ball.angularVelocity);
  }
  run(sim, 400);
  const settled = Math.abs(ball.angularVelocity);
  check(
    'rolling resistance bleeds spin toward rest',
    settled < peak * 0.5,
    `peak |ω|=${peak.toFixed(4)} → settled |ω|=${settled.toFixed(4)}`,
  );
  check(
    'and the ball itself slows (no perpetual roll)',
    Math.abs(ball.vx) < 1.0,
    `|vx|=${Math.abs(ball.vx).toFixed(3)}`,
  );
}

// ── 4. Control: a ball placed at rest stays at rest (no manufactured motion) ──
//
// The friction/torque solve must not invent motion where there is none. A ball
// set down gently on flat ground with zero velocity keeps ω ≈ 0 and barely
// moves — the nudge-only effect in check 1 was the shove, not the floor.
{
  const grid = new Grid(140, 120);
  const sim = new Simulation(grid);
  fillFloor(grid, FLOOR_Y);
  const ball = createRubberBall(70, FLOOR_Y - r - 0.01, r) as SimObject;
  grid.objects.push(ball);
  const x0 = ball.x;
  const y0 = ball.y;
  run(sim, 60);
  const drift = Math.hypot(ball.x - x0, ball.y - y0);
  check(
    'a ball placed at rest stays put (no manufactured roll)',
    drift < 0.5 && Math.abs(ball.angularVelocity) < 0.02,
    `drift=${drift.toFixed(3)}, |ω|=${Math.abs(ball.angularVelocity).toFixed(4)}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} ball-roll check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll ball-roll checks passed.');
}
