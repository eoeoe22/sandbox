// Headless behavioural harness for the OBJECT layer's heat model
// (engine/objects.ts: scanBodyExposure's contact shell, the conduction step in
// evaluateTriggers, and conductBodyHeatOut). Six claims, none of which the older
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
//      1000° Fire cell right beside itself every tick and must not read its own
//      plume as heat. This is what lets dynamite's cook-off point be a realistic
//      220° instead of a number chosen only to sit above Fire's 1000°. The other
//      half of that claim matters just as much and has its own scene: it must
//      still read every fire that ISN'T its own.
//   6. 자기 온도로만 죽는다 — and every heat trigger judges that same reservoir and
//      nothing else. Standing in an 1800° Blue Flame is not being at 1800°: the
//      barrel melts when the barrel is at its melting point, not when the air
//      around it is.
//
// Run: `node test/run-objectheat.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import {
  createDrum,
  createDynamite,
  createMolotov,
  createRubberBall,
  createWoodBox,
  bodyReach,
  DYNAMITE_AUTOIGNITE_TEMP,
  DRUM_MELT_TEMP,
  DRUM_MELT_TICKS,
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
/** Re-seed the shared PRNG at the top of every scene below.
 *
 *  Without this the scenes are coupled through the random stream: adding a scene,
 *  or merely changing how many cells an earlier one stamps, shifts every later
 *  scene's dice and moves its measurements. That bit twice — a new scene in the
 *  middle of the file pushed the molotov's self-heat reading from 21.2° to 24.8°
 *  and failed a bound that had nothing to do with it. Scenes are supposed to be
 *  independent claims; now they actually are, and a number quoted in the docs
 *  stays put when a neighbour is edited. */
const scene = (n: number): void => {
  Math.random = mulberry32(1000 + n);
};
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
/** Fire's own `thermal.init` (materials/fire.ts) — what a Fire cell the CA made
 *  actually reads. Stamping the material without it makes a 20° "fire". */
const FIRE_TEMP = 1000;
const BLUE_FLAME = ID('Blue Flame');
/** Blue Flame's own `thermal.init` (materials/blueflame.ts) — 600° past the drum's
 *  melting point, which is exactly what made the old bug so visible. */
const BLUE_FLAME_TEMP = 1800;

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
  scene(1);
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
  scene(2);
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
  scene(3);
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
  scene(4);
  const { grid, sim } = makeWorld();
  floor(grid, 70, SAND);
  const drum = createDrum(50, 30);
  settle(sim, grid, drum);
  // Held at temperature rather than stamped once, because the point being measured
  // is the transfer, not how long the drum's own reservoir lasts. This is what a
  // player holding the 가열 브러시 on it does.
  let hottest = -Infinity;
  let atTick60 = -Infinity;
  for (let t = 0; t < 200; t++) {
    drum.temp = 900;
    sim.step();
    const s = extremes(grid, SAND);
    if (s.hot > hottest) hottest = s.hot;
    if (t === 59) atTick60 = s.hot;
  }
  check(
    '달궈진 오브젝트가 닿은 모래를 데운다 — a hot body heats what it lies on',
    hottest > 300,
    `sand reached ${hottest.toFixed(0)}° under a 900° drum`,
  );
  // Sampled early as well as at the peak, because the peak alone measures nothing
  // but "the relaxation eventually saturates" — it lands within a few degrees of
  // the drum whatever the rate is. This second reading is the RATE, and it is the
  // one that would move if the outbound leg were ever divided by the body's heat
  // capacity the way the two intake channels are. It must not be: a thermally
  // massive body is slow to change, not stingy about what it gives the sand.
  check(
    '…빠르게: 비열은 물체가 내주는 열을 줄이지 않는다 — heat capacity slows the body, not its output',
    atTick60 > 600,
    `sand already at ${atTick60.toFixed(0)}° by tick 60`,
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
  scene(5);
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
  scene(6);
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

// ── 6b. 드럼통 비열: 같은 자리에 놓아도 강철통은 느리다 ───────────────────────
//
// The scene above is a lower bound on one body's rate, so it would pass just as
// happily with every body sharing one rate — which is exactly what the layer used
// to do, and why a fan cooled a steel drum as fast as a rubber ball. The claim
// here is *relative* and cannot be satisfied that way: same floor, same starting
// temperature, two bodies, and the drum has to be the slow one.
//
// Measured through the FAN, not through the ground, and that choice is the scene.
// Contact conduction is confounded by how big the body is: the return leg warms
// the very cells the intake then reads, so a small body saturates its little
// contact patch and stalls — a rubber ball on stone never even halves in 600 ticks,
// while a drum, spread over far more cells, dumps into a bigger sink and beats it.
// Size, not heat capacity, would be doing the talking.
//
// Forced convection has no such feedback: `windTemp` is the temperature of the air
// the fan is moving, the body never writes to it, and `exp.wind` is a flag rather
// than a cell count. So both bodies relax toward the same fixed 20° at the same
// rate, and `heatCapacity` is the only thing left that can separate them — the
// ratio below should land right on DRUM_HEAT_CAPACITY. (The seed number is just a
// distinct stream id, not a position in the file.)
{
  const halfLife = (make: (x: number, y: number) => SimBody): number => {
    scene(16);
    const { grid, sim } = makeWorld(); // no floor: the body touches nothing (case 1)
    const body = make(50, 20);
    settle(sim, grid, body);
    const fanY = Math.max(1, Math.round(body.y) - 14);
    for (let dx = -4; dx <= 4; dx++) {
      grid.set(Math.round(body.x) + dx, fanY, FAN);
      grid.setAux(Math.round(body.x) + dx, fanY, (4000 << 2) | FAN_DOWN);
    }
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    // Warm, not red-hot: the rubber ball burns away at BALL_BURN_TEMP (300°), and a
    // destroyed body's `temp` simply stops moving — which reads as "never cooled".
    const start = 200;
    body.temp = start;
    const half = AMBIENT_TEMP + (start - AMBIENT_TEMP) / 2;
    for (let t = 0; t < 900; t++) {
      sim.step();
      if (!grid.objects.includes(body)) throw new Error('body was destroyed mid-measurement');
      if (body.temp <= half) return t + 1;
    }
    return 900;
  };
  const ball = halfLife((x, y) => createRubberBall(x, y));
  const drum = halfLife((x, y) => createDrum(x, y));
  check(
    '드럼통은 비열이 커서 천천히 식는다 — the steel drum fans down far slower than a ball',
    drum > ball * 2,
    `drum half-life ${drum} ticks vs ball ${ball} under the same fan (they were equal when every body shared one rate)`,
  );
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
  scene(7);
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

// ── 7b. …but only its OWN flame ──────────────────────────────────────────────
//
// The exclusion above has an obvious way to go wrong, and the first cut went
// wrong in exactly it: dropping *every* Fire cell while lit. That is far too
// broad. A lit stick thrown into a bonfire it had nothing to do with would read
// room temperature the whole way down and quietly finish its countdown — the same
// overlay lie this whole change set out to kill, and the direct opposite of why
// the cook-off point was allowed down to 220° in the first place (불에 던지면
// 터진다). So the exclusion is a *column* rising off the wick, and everything
// outside it is ordinary heat.
//
// The fire bed is laid directly UNDER the stick and no wider than it — squarely
// below the wick, which is what "at or above the wick" in the plume test is there
// to tell apart. A wider bed would spill outside the plume column and let the
// scene pass on the overspill alone.
//
// Deliberately a world with NO floor: the stick rests on the container border,
// which is out of bounds and therefore not thermal contact at all (scene 1). That
// isolates the claim to Fire. With a stone floor the bonfire cooks the stone, the
// stone conducts into the stick, and the scene passes whether or not Fire itself
// was ever read — which is exactly the laundering that would let the over-broad
// version of this exclusion slip through.
{
  scene(8);
  const { grid, sim } = makeWorld();
  const stick = createDynamite(50, 60);
  settle(sim, grid, stick, 120);
  const bx = Math.round(stick.x);
  const by = Math.round(stick.y);
  let ticks = 0;
  let hottest = -Infinity;
  for (; ticks < 70; ticks++) {
    // Re-seed the bonfire every tick — Fire burns out on its own, and the claim
    // is about a body lying IN a fire, not about one flame passing over it. The
    // temperature has to be stamped along with the material: a Fire cell dropped
    // into the grid by hand inherits whatever the cell was at (ambient), and a
    // 20° "fire" heats nothing — which is a way for this scene to pass its
    // sibling checks while proving nothing.
    for (let cy = by; cy < grid.height; cy++)
      for (let cx = bx - 3; cx <= bx + 3; cx++) {
        if (!grid.inBounds(cx, cy) || grid.get(cx, cy) !== 0) continue;
        grid.set(cx, cy, FIRE);
        grid.temp[grid.idx(cx, cy)] = FIRE_TEMP;
      }
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    sim.step();
    if (!grid.objects.includes(stick)) break;
    if (stick.temp > hottest) hottest = stick.temp;
  }
  // Bounded, not just "eventually": lying in a 1000° fire brings a stick's own
  // reservoir up past its 220° cook-off point in a handful of ticks. A version of
  // the exclusion that swallows this fire still ends up detonating it — Fire burns
  // out into hot Smoke, which is not Fire and is read normally — just far later.
  // So the tick count is the discriminator, and a bare "did it die" is not.
  check(
    '불에 던지면 터진다 — a lit stick in a real fire cooks off at once',
    !grid.objects.includes(stick) && ticks <= 20,
    `gone on tick ${ticks} (its own fuse needs at least 90; via leaked smoke alone it takes ~32)`,
  );
  // And it went off because it was actually hot, not because something in its
  // surroundings was: every heat trigger reads the body's own reservoir and
  // nothing else (see the heat note in evaluateTriggers), so the stick cannot
  // detonate until conduction has carried it to its cook-off point.
  check(
    '…and it was the stick that got hot, not just the air around it',
    hottest >= DYNAMITE_AUTOIGNITE_TEMP,
    `reservoir reached ${hottest.toFixed(0)}° (cook-off is ${DYNAMITE_AUTOIGNITE_TEMP}°)`,
  );
}

// ── 7c. 눕혀 놓아도 마찬가지 (the plume, in the hard orientation) ──────────────
//
// Scene 7 leaves the stick UPRIGHT, fuse in the air, and that is the easy case:
// the plume goes straight up, away from everything. Laid flat it is much harder —
// the wick sits at floor level at one end, the body stretches away sideways, and
// the flame drifts along the length of it. That is the orientation that caught a
// fixed-width plume column: at a constant half-width of 3 cells the bottle-length
// drift fell outside it and a lit molotov read 77°. Sizing the column to the
// body's own reach is what fixes it, and this scene is what says so.
{
  scene(9);
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const stick = createDynamite(50, 60);
  stick.angle = Math.PI / 2; // long axis horizontal; the wick tip rests on the floor
  stick.angularVelocity = 0;
  grid.objects.push(stick);
  let hottest = -Infinity;
  let ticks = 0;
  for (; ticks < 80; ticks++) {
    sim.step();
    if (!grid.objects.includes(stick)) break;
    if (ticks > 20 && stick.temp > hottest) hottest = stick.temp; // after it settles
  }
  check(
    '전제: it really did stay flat on the floor',
    Math.abs(Math.cos(stick.angle)) < 0.4 && stick.y > 60,
    `angle ${stick.angle.toFixed(2)}, y ${stick.y.toFixed(1)}`,
  );
  check(
    '눕혀 놔도 자기 불꽃에 안 데워진다 — the plume is still its own when it drifts sideways',
    hottest < AMBIENT_TEMP + 15,
    `peaked at ${hottest.toFixed(1)}° lying flat on stone`,
  );
  check(
    '…and it is still there, counting down',
    grid.objects.includes(stick) && stick.lit,
    `${ticks} ticks`,
  );
}

// ── 7d. 반대쪽 끝의 불은 남의 불이다 ─────────────────────────────────────────
//
// Where the plume column stops. 7c holds a lit stick flat and proves it ignores
// its own flame; this holds the same stick the same way and puts a real fire at
// the FAR tip, outside the column, where it must be read like anyone else's.
//
// It is worth pinning because the design has a known soft edge on the other side:
// fire sitting *only* on top of a lying body's near half IS inside the column and
// gets swallowed (see the engine comment on WICK_PLUME_MARGIN). A rule that keeps
// a body blind to its own rising plume cannot also tell that plume apart from a
// fire someone lit in the exact place the plume goes.
//
// Deliberately generous, not a boundary-precision test: the column actually ends
// around half a cell past the body's centre, and this fire sits some four cells
// beyond that. Measuring the edge to the cell would only pin CA jitter.
{
  scene(10);
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const stick = createDynamite(50, 60);
  stick.angle = Math.PI / 2; // wick to the LEFT (capsuleAxis(π/2) = (1, 0))
  stick.angularVelocity = 0;
  grid.objects.push(stick);
  for (let t = 0; t < 30; t++) sim.step(); // let it settle flat before lighting it up
  const far = Math.round(stick.x + stick.halfLength + stick.radius);
  const fy = Math.round(stick.y);
  let ticks = 0;
  for (; ticks < 60; ticks++) {
    for (let cy = fy - 2; cy <= fy + 2; cy++)
      for (let cx = far; cx <= far + 3; cx++) {
        if (!grid.inBounds(cx, cy) || grid.get(cx, cy) !== 0) continue;
        grid.set(cx, cy, FIRE);
        grid.temp[grid.idx(cx, cy)] = FIRE_TEMP;
      }
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    sim.step();
    if (!grid.objects.includes(stick)) break;
  }
  check(
    '반대쪽 끝에 붙은 불은 그대로 읽는다 — fire past the far tip is not its plume',
    !grid.objects.includes(stick) && ticks < 40,
    `gone on tick ${ticks} (its own fuse needs at least 90)`,
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
  scene(11);
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
//
// Measured against a DOUSED control rather than an absolute bound, because the
// absolute bound was answering the wrong question. A bottle lying on a stone floor
// drifts a couple of degrees off ambient for reasons that have nothing to do with
// its wick, so any fixed ceiling is really two claims wearing one number: "the
// wick contributes nothing" and "nothing else does either". The second is not this
// scene's business, and picking a ceiling loose enough for it made the first one
// slack. The subtraction asks only what the wick added.
{
  const runBottle = (lit: boolean): number => {
    scene(12);
    const { grid, sim } = makeWorld();
    floor(grid, 70);
    const bottle = createMolotov(50, 60);
    bottle.lit = lit; // a doused bottle throws no flame; nothing can re-light it at 20°
    grid.objects.push(bottle);
    let hottest = -Infinity;
    for (let t = 0; t < 150; t++) {
      sim.step();
      if (!grid.objects.includes(bottle)) break;
      if (bottle.temp > hottest) hottest = bottle.temp;
      if (!lit) bottle.lit = false;
    }
    return hottest;
  };
  const wet = runBottle(false);
  const burning = runBottle(true);
  // Not zero — about seven degrees, and that residual is worth naming rather than
  // rounding away. It is what leaks past the column: a flame cell that wanders wide
  // for a tick, and the floor the wick warms just outside it. Both were once
  // covered by a disc drawn around the wick, which was removed because measuring it
  // put its whole worth at ONE of these seven degrees (26.6° → 25.6°). At this size
  // it changes nothing anyone can see — the thermal wash does not start until 200°,
  // and the bottle bursts at 1150° — but a bound of 10 says so out loud, where a
  // bound of 50 would have quietly covered a real regression.
  check(
    '불붙은 화염병은 꺼진 화염병보다 뜨겁지 않다 — its own wick adds next to nothing',
    burning - wet < 10,
    `lit ${burning.toFixed(1)}° vs doused ${wet.toFixed(1)}° — the wick is worth ${(burning - wet).toFixed(1)}° (was ~900° before the exclusion)`,
  );
}

// ── 10. 바람에 지나치게 강하게 밀려남 ────────────────────────────────────────
//
// Not heat, but the same Fan: a body caught in a stream used to be launched at the
// matter push's own speed, which for something as chunky as a drum read as being
// fired out of a cannon. It should ride the gust — clearly moving, herdable — and
// still be stopped by a wall or a pile.
{
  scene(13);
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

// ── 11. 벽을 등지고 바람을 맞아도 중력을 이기지 못한다 ────────────────────────
//
// The bug the acceleration bound exists for. The push used to be a velocity floor
// re-imposed every tick — an unbounded force — so a body blown against a wall fed
// the contact a normal impulse of mass × WIND_PUSH_SPEED. Coulomb friction caps
// the tangential impulse at μ·N, and that N made μ·N several times the body's own
// weight, so the drum hung on the wall instead of sliding down it.
//
// Now the wind accelerates a body exactly as hard as gravity does, so the normal
// impulse it can generate is at most the weight, and μ < 1 settles it. This scene
// is the whole claim in one number: how far a body falls while being blown flat
// against a wall.
//
// Run for a ball as well as a drum, so the claim is about the rule and not about
// one body: the ball is the layer's lightest and rides at the full
// WIND_PUSH_SPEED, which makes it the most demanding case for the bound.
//
// What this scene does and does not pin, measured rather than assumed. A blocked
// body's per-tick gain is min(ceiling − 0, WIND_PUSH_ACCEL), and it is that
// COMBINATION the drum's fall distance is sensitive to — quadrupling
// WIND_PUSH_ACCEL alone changes nothing, because the drum's mass-scaled ceiling
// (~0.5) is already the binding half. Removing both bounds (the historical
// velocity floor) cuts the fall to 30 cells and removing the ceiling alone cuts it
// to 47, so the threshold below sits between those and the real 62. The exact
// value of WIND_PUSH_ACCEL is therefore NOT individually protected here; see
// docs/TESTING.md.
{
  const fell = (make: (x: number, y: number) => SimBody): { drop: number; reached: number } => {
    scene(14);
    const { grid, sim } = makeWorld();
    floor(grid, 90);
    // A tall wall to be pinned against, and a fan column blowing into it.
    fillRect(grid, 62, 0, 68, 90, STONE);
    const body = make(50, 20);
    grid.objects.push(body);
    const y0 = body.y;
    // The fan column runs the FULL height of the drop, not just a band around the
    // start position. With a short column the body simply falls out of the stream
    // after a few ticks and lands for reasons that have nothing to do with
    // friction — the scene passed that way before this was noticed, measuring
    // nothing at all.
    for (let cy = 0; cy < 90; cy++) {
      grid.set(30, cy, FAN);
      grid.setAux(30, cy, (4000 << 2) | FAN_RIGHT);
    }
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    let reached = -Infinity;
    for (let t = 0; t < 300; t++) {
      sim.step();
      const edge = body.x + bodyReach(body);
      if (edge > reached) reached = edge;
    }
    return { drop: body.y - y0, reached };
  };
  const drum = fell((x, y) => createDrum(x, y));
  const ball = fell((x, y) => createRubberBall(x, y));
  check(
    '전제: 바람이 물체를 실제로 벽까지 밀어붙였다 — the gust really does press them to the wall',
    drum.reached > 60 && ball.reached > 60,
    `drum edge reached x ${drum.reached.toFixed(1)}, ball ${ball.reached.toFixed(1)} (wall face at 62)`,
  );
  check(
    '벽을 등지고 바람을 맞아도 중력을 이기지 못한다 (드럼통) — wind cannot pin the drum',
    // 62 is the geometric maximum — the drum simply reaches the floor. Anything
    // less means friction held it up on the way down for a while.
    drum.drop > 55,
    `fell ${drum.drop.toFixed(1)} cells of a possible 62 (it used to hang at its start height)`,
  );
  check(
    '…고무공도 마찬가지 — nor the lightest body in the layer',
    ball.drop > 55,
    `fell ${ball.drop.toFixed(1)} cells`,
  );
}

// ── 11b. 무거울수록 덜 밀린다 ────────────────────────────────────────────────
//
// Measured in free fall through a horizontal stream rather than on the ground: on
// a floor a drum's drift is dominated by whether it happens to be rolling, which
// swamps the thing being measured. In the air there is no other horizontal force,
// so the along-wind speed converges on exactly the mass-scaled ceiling — the
// number this claim is about — within a couple of ticks.
{
  const topSpeed = (make: (x: number, y: number) => SimBody): number => {
    scene(15);
    const { grid, sim } = makeWorld(); // no floor: it falls the whole way
    const body = make(30, 20);
    grid.objects.push(body);
    for (let cy = 0; cy < 60; cy++) {
      grid.set(10, cy, FAN);
      grid.setAux(10, cy, (4000 << 2) | FAN_RIGHT);
    }
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    let peak = 0;
    for (let t = 0; t < 30; t++) {
      sim.step();
      if (body.vx > peak) peak = body.vx;
    }
    return peak;
  };
  const ball = topSpeed((x, y) => createRubberBall(x, y));
  const drum = topSpeed((x, y) => createDrum(x, y));
  check(
    '가벼운 몸통은 바람을 온전히 탄다 — a light body rides the stream at full speed',
    ball > 1.3,
    `ball tops out at ${ball.toFixed(2)} cells/tick (WIND_PUSH_SPEED is 1.4)`,
  );
  check(
    '무거운 드럼통은 절반도 못 낸다 — the heavy drum tops out far below it',
    drum < 0.6,
    `drum tops out at ${drum.toFixed(2)} cells/tick — this is DRUM_DENSITY and the mass-scaled ceiling together`,
  );
}

// ── 11c. 그래도 안 구르는 몸통은 여전히 밀린다 ────────────────────────────────
//
// The other half of the μ < 1 window, and the thing a plain "make the push weaker"
// fix would have broken: a push small enough never to pin is normally also too
// small to overcome ground friction and budge anything. A crate is the case that
// shows it, because unlike a drum it cannot cheat by rolling.
{
  scene(17);
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const crate = createWoodBox(40, 60);
  settle(sim, grid, crate);
  const fanX = Math.max(1, Math.round(crate.x) - 12);
  for (let dy = -6; dy <= 1; dy++) {
    grid.set(fanX, Math.round(crate.y) + dy, FAN);
    grid.setAux(fanX, Math.round(crate.y) + dy, (4000 << 2) | FAN_RIGHT);
  }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const x0 = crate.x;
  for (let t = 0; t < 200; t++) sim.step();
  check(
    '바람은 바닥 마찰을 이기고 상자를 민다 — the gust still slides a non-rolling body',
    grid.objects.includes(crate) && crate.x > x0 + 20,
    `crate drifted ${(crate.x - x0).toFixed(1)} cells`,
  );
}

// ── 18. 물체 자체 온도로만 녹는다 ───────────────────────────────────────────────
//
// The bug a player found by single-stepping the sim: a drum held in a Blue Flame
// melted while the inspector was still reading it at about 200°
// (푸른 불꽃으로 가열 시 약 200도를 넘자마자 녹아버림). The melt trigger used to
// judge on max(hottest footprint cell, reservoir), and Blue Flame is a GAS at
// 1800° — it drifts in among the footprint cells on its own, cleared the drum's
// 1200° bar on the very first tick, and the barrel was gone 24 ticks later having
// absorbed almost none of it. Lava did the same at 390° to any body that sank into
// it rather than floating on top; the puddle cases that looked correct only looked
// correct because the body floated ON them, leaving the footprint full of air.
//
// Two checks, and they are one claim from both ends. The first is the bug: 24
// consecutive ticks of 1800° flame — more than DRUM_MELT_TICKS, so the old code is
// guaranteed to have destroyed it by here — with the barrel still well short of its
// own melting point. The second is that this is a delay and not an immunity: keep
// the flame on it and it does melt, at its melting point, the way the thermite and
// molten-metal puddles the player called correct always did.
//
// The flame is re-stamped every tick because Blue Flame burns out in ~20 ticks and
// rises; a player holding the brush on a barrel is what this imitates. Stamping the
// material without its temperature would make a 20° "flame" that proves nothing, so
// the temp goes in with it.
{
  scene(18);
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const drum = createDrum(50, 60);
  settle(sim, grid, drum);
  const bx = Math.round(drum.x);
  const by = Math.round(drum.y);
  const torch = (): void => {
    for (let cy = by - 9; cy <= by + 9; cy++)
      for (let cx = bx - 9; cx <= bx + 9; cx++) {
        if (!grid.inBounds(cx, cy) || grid.get(cx, cy) !== 0) continue;
        grid.set(cx, cy, BLUE_FLAME);
        grid.setTemp(cx, cy, BLUE_FLAME_TEMP);
      }
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  };
  const HELD = DRUM_MELT_TICKS;
  for (let t = 0; t < HELD; t++) {
    torch();
    sim.step();
  }
  check(
    '푸른 불꽃 속에서도 자기 온도가 녹는점에 닿기 전엔 안 녹는다 — a gas standing in the footprint is not a melt',
    grid.objects.includes(drum) && drum.temp < DRUM_MELT_TEMP,
    `still there after ${HELD} ticks of ${BLUE_FLAME_TEMP}° flame, reading ${drum.temp.toFixed(0)}° of ${DRUM_MELT_TEMP}°`,
  );
  let meltedAt = -1;
  let meltedTemp = 0;
  for (let t = HELD; t < 400; t++) {
    torch();
    sim.step();
    if (!grid.objects.includes(drum)) {
      meltedAt = t;
      break;
    }
    meltedTemp = drum.temp;
  }
  check(
    '…하지만 계속 대고 있으면 녹는점에서 녹는다 — hold it there and it does melt, at its melting point',
    meltedAt > 0 && meltedTemp >= DRUM_MELT_TEMP,
    `gave way on tick ${meltedAt} at ${meltedTemp.toFixed(0)}° (melting point ${DRUM_MELT_TEMP}°)`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} object-heat check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll object-heat checks passed.');
