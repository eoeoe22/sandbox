// Headless behavioural harness for the OBJECT layer's heat model
// (engine/objects.ts: scanBodyExposure's contact shell, the conduction step in
// evaluateTriggers, and conductBodyHeatOut). Four claims, none of which the older
// object tests could see because they all judge a body by whether it survived:
//
//   1. 온도 유지 — a body touching nothing holds its temperature indefinitely. Air
//      has zero conductivity in this world (config.ts AMBIENT_TEMP), so an object
//      floating in it is in exactly the position of a lava blob with no cold sink
//      against it: nothing to give its heat to.
//   2. 접촉 전도 — set that same body down on cold ground and it sheds it. The
//      contact test is a shell one cell wider than the body, and it has to be:
//      collision parks a resting body just *clear* of the floor, so on the raw
//      footprint nothing a body stands on would ever count as touched.
//   3. 양방향 — the heat goes the other way too. A red-hot body warms the ground
//      under it; a deep-frozen one chills the water around it.
//   4. 느린 전도 — and all of that happens slowly enough that a body stays visibly
//      hot for seconds rather than snapping to ambient. A Fan is gentler still: it
//      is air, not a contact patch, so it fans a body down over seconds.
//   5. 도화선 불이 스스로를 가열하지 않게 — a body burning its own wick throws a real
//      1000° Fire cell right beside itself every tick, and must not read it (nor
//      the ground that flame is scorching) as heat. This is what lets dynamite's
//      cook-off point be a realistic 220° instead of a number chosen only to sit
//      above Fire's 1000°.
//
// Run: `node test/run-objectheat.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import {
  createDrum,
  createDynamite,
  createMolotov,
  createRubberBall,
  DYNAMITE_AUTOIGNITE_TEMP,
} from '../src/game/engine/objects';
import type { SimBody } from '../src/game/engine/objects';
import { FAN_DOWN, FAN_RIGHT } from '../src/game/materials/fan';
import { getMaterial } from '../src/game/materials/registry';
import { AMBIENT_TEMP } from '../src/game/config';
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
const SAND = ID('Sand');
const WATER = ID('Water');
const FAN = ID('Fan');
const FIRE = ID('Fire');

const W = 100;
const H = 100;

function makeWorld(): { grid: Grid; sim: Simulation } {
  const grid = new Grid(W, H);
  return { grid, sim: new Simulation(grid) };
}

/** Fill rows [y, height) with `id`. */
function floor(grid: Grid, y: number, id = STONE): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, yy)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}

function fillRect(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid.cells[grid.idx(x, y)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}

/** Hottest / coldest cell of material `id` anywhere on the grid. */
function extremes(grid: Grid, id: number): { hot: number; cold: number } {
  let hot = -Infinity;
  let cold = Infinity;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] !== id) continue;
    const t = grid.temp[i];
    if (t > hot) hot = t;
    if (t < cold) cold = t;
  }
  return { hot, cold };
}

/** Drop `body` into `grid` and step until it has come to rest (or `limit` ticks),
 *  so every measurement below starts from a settled body rather than a falling
 *  one. Returns the tick it settled on. */
function settle(sim: Simulation, grid: Grid, body: SimBody, limit = 200): number {
  grid.objects.push(body);
  for (let t = 0; t < limit; t++) {
    sim.step();
    if (Math.abs(body.vx) < 0.01 && Math.abs(body.vy) < 0.01 && t > 20) return t;
  }
  return limit;
}

// ── 1. 온도 유지: nothing touched, nothing lost ───────────────────────────────
//
// The board is a world with NO floor at all. A body falls to the bottom and rests
// against the container's own wall border, which is out of bounds — not a cell, not
// matter, nothing to conduct into. That is the cleanest "touching nothing" a body
// can be in, and it doubles as a check that the world edge itself never became a
// heat sink when the contact shell grew a cell.
{
  const { grid, sim } = makeWorld();
  const drum = createDrum(50, 20);
  settle(sim, grid, drum);
  drum.temp = 500;
  for (let t = 0; t < 600; t++) sim.step();
  check(
    '허공에 뜬 오브젝트는 온도를 유지한다 — a body touching nothing holds its heat',
    Math.abs(drum.temp - 500) < 1,
    `500° → ${drum.temp.toFixed(1)}° after 600 ticks`,
  );
  check(
    'and it really was still there to hold it',
    grid.objects.includes(drum),
    `${grid.objects.length} bodies`,
  );
  // The other direction of the same rule: a chilled body doesn't drift back up to
  // room temperature on its own either.
  drum.temp = -80;
  for (let t = 0; t < 600; t++) sim.step();
  check(
    '…and a chilled one does not thaw on its own',
    Math.abs(drum.temp + 80) < 1,
    `−80° → ${drum.temp.toFixed(1)}°`,
  );
}

// ── 2. 접촉 전도: set it down and it sheds ────────────────────────────────────
//
// Identical body, identical starting temperature, one difference: there is a stone
// floor under it. This is the pair that makes case 1 mean something — without it,
// "held its heat" could just as well have been "the conduction step is dead".
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 20);
  settle(sim, grid, drum);
  drum.temp = 500;
  for (let t = 0; t < 600; t++) sim.step();
  check(
    '땅에 닿으면 식는다 — the same body on cold ground sheds its heat',
    drum.temp < 200,
    `500° → ${drum.temp.toFixed(1)}° after 600 ticks`,
  );
  // The point of the one-cell contact margin: a resting body never actually
  // overlaps the floor it stands on, so without the margin this case behaves
  // exactly like case 1 and the whole feature is invisible.
  check(
    '…which means a body standing on the ground counts as touching it',
    drum.temp < 400,
    `contact margin is what makes this ${drum.temp.toFixed(1)}° instead of 500°`,
  );
}

// ── 3. Fan: the one way still air moves a body's heat ────────────────────────
//
// Same no-floor board as case 1 — the body touches nothing — but with a powered Fan
// aimed at it. The fan is energized by writing its powered countdown straight into
// aux (the same packing a Battery pulse leaves; see materials/fan.ts updateFan), so
// the scene needs no wiring to stay on for the whole run.
{
  const { grid, sim } = makeWorld();
  const drum = createDrum(50, 20);
  settle(sim, grid, drum);
  // A row of Fan cells above the settled body, blowing straight DOWN onto it —
  // downward so the gust pins it in place instead of walking it out of its own
  // beam over six hundred ticks. Placed after it settles for the same reason.
  const fanY = Math.max(1, Math.round(drum.y) - 14);
  for (let dx = -4; dx <= 4; dx++) {
    grid.set(Math.round(drum.x) + dx, fanY, FAN);
    grid.setAux(Math.round(drum.x) + dx, fanY, (4000 << 2) | FAN_DOWN);
  }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  drum.temp = 500;
  const half = AMBIENT_TEMP + (500 - AMBIENT_TEMP) / 2;
  let halfTick = -1;
  for (let t = 0; t < 600; t++) {
    sim.step();
    if (halfTick < 0 && drum.temp <= half) halfTick = t + 1;
  }
  check(
    '선풍기 바람은 허공의 오브젝트도 식힌다 — a fan cools a body air alone cannot',
    drum.temp < 300,
    `500° → ${drum.temp.toFixed(1)}° with the fan running (case 1: unchanged)`,
  );
  // …but as *air*, not as a contact patch. The old rate (a 3× multiplier on top of
  // conduction) flash-cooled a glowing drum in well under a second — 냉각 속도가
  // 너무 빠름 — so the convective channel is now a small rate of its own, and a
  // fanned body is expected to take a couple of seconds (SIM_HZ_AT_1X is 30/s).
  check(
    '…gently: a fan takes seconds, not a moment, to bring it down',
    halfTick > 40,
    `half-life ${halfTick} ticks under the fan (was ~8)`,
  );
}

// ── 4. 양방향 열전도, 발열 쪽 ─────────────────────────────────────────────────
//
// A red-hot drum set down on sand. The sand under it must come up — that heat has
// to go somewhere, and until now it went nowhere: the object layer read the grid's
// temperature every tick and never once wrote it.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70, SAND);
  const drum = createDrum(50, 30);
  settle(sim, grid, drum);
  // Held at temperature rather than stamped once, because the point being measured
  // is the transfer, not how long the drum's own reservoir lasts. This is what a
  // player holding the 가열 브러시 on it does.
  let hottest = -Infinity;
  for (let t = 0; t < 200; t++) {
    drum.temp = 900;
    sim.step();
    const s = extremes(grid, SAND);
    if (s.hot > hottest) hottest = s.hot;
  }
  check(
    '달궈진 오브젝트가 닿은 모래를 데운다 — a hot body heats what it lies on',
    hottest > 300,
    `sand reached ${hottest.toFixed(0)}° under a 900° drum`,
  );
  check(
    '…but never past its own temperature (relaxation cannot overshoot)',
    hottest <= 900,
    `${hottest.toFixed(0)}° vs the drum's 900°`,
  );

  // Control: the identical scene with a room-temperature drum leaves the sand alone.
  const c = makeWorld();
  floor(c.grid, 70, SAND);
  const cold = createDrum(50, 30);
  settle(c.sim, c.grid, cold);
  for (let t = 0; t < 200; t++) c.sim.step();
  const ctl = extremes(c.grid, SAND);
  check(
    '대조군: a room-temperature drum heats nothing',
    ctl.hot < AMBIENT_TEMP + 5,
    `sand at ${ctl.hot.toFixed(0)}°`,
  );
}

// ── 5. 양방향 열전도, 냉각 쪽 ─────────────────────────────────────────────────
//
// The same conduction run backwards: a deep-frozen body in a pond pulls the water
// below room temperature. One formula, both directions — a body that could only
// ever heat its surroundings would be a one-way valve, and the 냉각 브러시 would
// have nothing to show for itself on the grid.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  fillRect(grid, 30, 55, 70, 70, WATER);
  const ball = createRubberBall(50, 40, 4);
  settle(sim, grid, ball);
  let coldest = Infinity;
  for (let t = 0; t < 200; t++) {
    ball.temp = -150;
    sim.step();
    const s = extremes(grid, WATER);
    if (s.cold < coldest) coldest = s.cold;
  }
  check(
    '얼어붙은 오브젝트는 닿은 물을 얼린다 — a frozen body chills what it touches',
    coldest < 0,
    `water reached ${coldest.toFixed(0)}° around a −150° ball`,
  );
  check(
    '…and not past the body either',
    coldest >= -150,
    `${coldest.toFixed(0)}° vs the ball's −150°`,
  );
}

// ── 6. 느린 전도 ─────────────────────────────────────────────────────────────
//
// The rate itself, pinned behaviourally rather than by reading the constant: a body
// dropped onto cold ground must take a good while to give up half its heat. The
// whole reason to lower it is that a body should still be visibly glowing (온도
// 오버레이) a second or two after you pull it out of the fire, and a half-life of a
// handful of ticks would put the wash on screen for barely long enough to notice.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 20);
  settle(sim, grid, drum);
  const start = 1000;
  drum.temp = start;
  const half = AMBIENT_TEMP + (start - AMBIENT_TEMP) / 2;
  let ticks = -1;
  for (let t = 0; t < 400; t++) {
    sim.step();
    if (drum.temp <= half) {
      ticks = t + 1;
      break;
    }
  }
  check(
    '열전도가 느리다 — a body takes seconds, not ticks, to lose half its heat',
    ticks > 15,
    `half-life ${ticks} ticks (was ~8 before the rate was lowered)`,
  );
  check('…and it does eventually get there', ticks > 0, `${ticks} ticks`);
}

// ── 7. 도화선 불이 스스로를 가열하지 않게 (다이너마이트) ───────────────────────
//
// A lit stick throws a real Fire cell (1000°) off its fuse every tick, half a cell
// past the cap — which is inside the contact shell — and that flame scorches the
// ground right under it, which is inside the shell too. So a lit stick used to
// read its own fuse as an external bath: it glowed red in the inspect overlay, and
// once DYNAMITE_AUTOIGNITE_TEMP came down to a realistic 220° it would have blown
// itself up long before its countdown ran out. It must stay at room temperature
// for its whole fuse, on the ground, with its own flame burning beside it.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const stick = createDynamite(50, 60);
  grid.objects.push(stick);
  let hottest = -Infinity;
  let sawFire = false;
  let ticks = 0;
  // The shortest fuse is 3 seconds (DYNAMITE_FUSE_MIN_TICKS, at SIM_HZ_AT_1X = 30),
  // so 70 ticks is safely inside every roll: a stick gone before then went off for
  // some reason other than its countdown, which is exactly the failure being hunted.
  for (; ticks < 70; ticks++) {
    sim.step();
    if (!grid.objects.includes(stick)) break;
    if (stick.temp > hottest) hottest = stick.temp;
    if (!sawFire) {
      for (let i = 0; i < grid.cells.length; i++) {
        if (grid.cells[i] === FIRE) {
          sawFire = true;
          break;
        }
      }
    }
  }
  // Precondition — without this the scene passes for the boring reason that no
  // flame was ever emitted and there was nothing to be heated by.
  check(
    '전제: the lit fuse really is throwing Fire',
    sawFire,
    'Fire cells found on the grid while the stick burned',
  );
  check(
    '도화선 불이 스스로를 가열하지 않는다 — a lit stick stays at room temperature',
    hottest < AMBIENT_TEMP + 10,
    `peaked at ${hottest.toFixed(1)}° over ${ticks} ticks (autoignite is ${DYNAMITE_AUTOIGNITE_TEMP}°)`,
  );
  check(
    '…so it survives to its countdown instead of cooking itself off',
    grid.objects.includes(stick) && stick.lit,
    `${ticks} ticks in, fuse still burning`,
  );
}

// ── 8. 폭발 온도 220° ────────────────────────────────────────────────────────
//
// The other half of the same change. With the self-heating defence moved into
// geometry, the threshold is free to be a material property, and 220° is roughly
// where real nitroglycerin dynamite goes: 불에 던지면 터진다. A dud stick (fuse
// snuffed, countdown paused — so nothing but heat can act on it) is laid on a bed
// held at a temperature that is over the new threshold but far under the old
// 1100°. Under the old number this scene would have run forever.
function cookOff(bathTemp: number, limit = 500): { gone: boolean; ticks: number } {
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const stick = createDynamite(50, 60);
  stick.lit = false; // a dud: fuseTicks frozen, so only heat can end it
  settle(sim, grid, stick, 120);
  stick.lit = false; // …and it stays a dud even if it brushed something on the way down
  for (let t = 0; t < limit; t++) {
    // Hold the bed at temperature — a hot plate, not a one-off stamp, which is what
    // lying in lava or under a held 가열 브러시 actually looks like.
    for (let y = 70; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) grid.temp[grid.idx(x, y)] = bathTemp;
    sim.step();
    if (!grid.objects.includes(stick)) return { gone: true, ticks: t + 1 };
  }
  return { gone: false, ticks: limit };
}
{
  const hot = cookOff(300);
  check(
    '300° 바닥에 놓인 다이너마이트는 터진다 — well under the old 1100° cook-off',
    hot.gone,
    `detonated after ${hot.ticks} ticks on a 300° bed`,
  );
  const warm = cookOff(150);
  check(
    '대조군: 150°에서는 터지지 않는다 — the threshold is a threshold, not a slope',
    !warm.gone,
    `survived ${warm.ticks} ticks on a 150° bed (autoignite ${DYNAMITE_AUTOIGNITE_TEMP}°)`,
  );
}

// ── 9. 도화선 불이 스스로를 가열하지 않게 (화염병) ────────────────────────────
//
// The bottle burns a wick the same way and had the same problem — a lit molotov
// sitting in the overlay glowing like it was already in a furnace. It never
// actually melted itself (MOLOTOV_BURST_TEMP is glass's 1150° melting point, over
// Fire's 1000°), but the reading was a lie, and the overlay now shows it.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const bottle = createMolotov(50, 60);
  grid.objects.push(bottle);
  let hottest = -Infinity;
  for (let t = 0; t < 150; t++) {
    sim.step();
    if (!grid.objects.includes(bottle)) break;
    if (bottle.temp > hottest) hottest = bottle.temp;
  }
  check(
    '불붙은 화염병도 스스로를 데우지 않는다 — a lit bottle reads room temperature',
    hottest < AMBIENT_TEMP + 10,
    `peaked at ${hottest.toFixed(1)}° with its wick burning`,
  );
  check('…and it is still burning, not shattered', grid.objects.includes(bottle) && bottle.lit);
}

// ── 10. 바람에 지나치게 강하게 밀려남 ────────────────────────────────────────
//
// Not heat, but the same Fan: a body caught in a stream used to be launched at the
// matter push's own speed, which for something as chunky as a drum read as being
// fired out of a cannon. It should ride the gust — clearly moving, herdable — and
// still be stopped by a wall or a pile.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(30, 60);
  settle(sim, grid, drum);
  // A column of Fan cells to the drum's left, blowing RIGHT along the floor.
  const fanX = Math.max(1, Math.round(drum.x) - 12);
  for (let dy = -6; dy <= 1; dy++) {
    grid.set(fanX, Math.round(drum.y) + dy, FAN);
    grid.setAux(fanX, Math.round(drum.y) + dy, (4000 << 2) | FAN_RIGHT);
  }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const x0 = drum.x;
  let peak = 0;
  for (let t = 0; t < 200; t++) {
    sim.step();
    if (drum.vx > peak) peak = drum.vx;
  }
  check(
    '바람은 오브젝트를 날려버리지 않는다 — a gust drifts a body rather than firing it',
    peak < 2,
    `peak downwind speed ${peak.toFixed(2)} cells/tick (was up to 3.75)`,
  );
  check(
    '…but it does still push — the fan is not a no-op',
    drum.x > x0 + 2,
    `drifted ${(drum.x - x0).toFixed(1)} cells downwind`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} object-heat check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll object-heat checks passed.');
