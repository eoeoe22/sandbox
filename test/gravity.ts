// Headless behavioural harness for the gravity control (설정 모달의 방향 D-패드 +
// 세기 슬라이더 → SimContext.setGravity). What it pins is the one property the
// whole feature rests on and that nothing else in the suite checks:
//
//   **모든 중력 구동 운동은 중력 벡터를 따르고 중력 세기 게이트를 통과한다.**
//
// Everything that moves *because things weigh something* has to (a) point along
// the world's gravity vector rather than toward the bottom of the screen, and
// (b) roll SimContext.gravityPass, so it slows with the strength slider and
// stops dead at 0. A rule that quietly opts out of either is invisible at the
// default down-100% setting — which is why all five holes this file was written
// for shipped unnoticed — and then reads as a bug the moment the slider moves:
// at zero gravity the world is supposed to hold still, so the ONE thing that
// keeps marching is the thing the player's eye goes to.
//
// The five (see docs/FEATURES.md "중력 방향/세기"):
//   • 뜨는 가루 뗏목의 부력 평형 (behaviors.ts tryFloatLightPowderStack) — moved a
//     whole powder column at once through shiftPowderColumnUp/Down, and neither
//     that nor the load-bearing swap rolled the gate. **This is the reported bug**:
//     a sawdust raft on water sank to its density-ratio depth and then churned
//     there in weightlessness, with the weightless water around it standing still.
//   • 무거운 기체 (updateHeavyGas) — never got the (1 − strength) isotropic
//     diffusion term updateGas has, so Chlorine and CO₂ were the only fluids in
//     the game that froze into solid blocks at zero gravity.
//   • 탄도 입자 5종 (ballistic.ts + ember/debris/bomblet/napalmgel/fireworkstar) —
//     integrate their own velocity instead of calling a movement primitive, and
//     every one of them wrote `vyQ + GRAVITY_Q`: a fixed pull toward the bottom
//     of the screen at full strength no matter what the world's gravity was.
//   • 겹침 스며듦의 입구 (SimContext.soakDown) — its sibling updateOverlay gates,
//     it didn't, so weightless water still wicked into a sand bed it could then
//     never move inside of.
//   • 용탕 교반 지름길 (coalpowder.ts mixIntoMelt) — a drag-free sink shortcut that
//     skipped the gate as well as the drag it meant to skip.
//
// The controls carry the weight here: every scene also runs at full gravity, so a
// fix that "works" by freezing the behavior everywhere fails, and the rotation
// scenes assert the four directions agree with each other rather than asserting
// screen coordinates, which is the actual invariant.
//
// Run: `node test/run-gravity.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import type { GravityDir } from '../src/game/config';
import { EMBER } from '../src/game/materials/ember';
import { DEBRIS, launchDebris } from '../src/game/materials/debris';
import { applyFlightGravity, encodeFlight, V_MAX_Q } from '../src/game/materials/ballistic';
import { SAWDUST } from '../src/game/materials/sawdust';
import { WATER } from '../src/game/materials/water';
import { SAND } from '../src/game/materials/sand';
import { CHLORINE } from '../src/game/materials/chlorine';
import { SMOKE } from '../src/game/materials/smoke';
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
Math.random = mulberry32(20260804);

/** The four "down" vectors, restated here rather than imported: SimContext keeps
 *  its own copy module-private, and a harness that checks rotation should carry
 *  its own idea of what the four directions mean instead of agreeing with the
 *  code under test by construction. */
const GRAVITY_VECTORS: Record<GravityDir, readonly [number, number]> = {
  down: [0, 1],
  up: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const W = 40;
const H = 40;

function world(): { grid: Grid; sim: Simulation } {
  const grid = new Grid(W, H);
  return { grid, sim: new Simulation(grid) };
}

/** Cell count of `id`, counting a 겹침 occupant as one cell of its own material —
 *  so a raft that soaks water still shows the pond's full mass. */
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === id) n++;
    if (grid.overlay[i] === id) n++;
  }
  return n;
}

/** Centroid of every cell of `id` (겹침 occupants included, same as count). */
function centroid(grid: Grid, id: number): { x: number; y: number; n: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = grid.idx(x, y);
      const hits = (grid.cells[i] === id ? 1 : 0) + (grid.overlay[i] === id ? 1 : 0);
      if (hits === 0) continue;
      sx += x * hits;
      sy += y * hits;
      n += hits;
    }
  return { x: n ? sx / n : NaN, y: n ? sy / n : NaN, n };
}

/** How far a body of `id` has travelled ALONG the gravity vector since (x0,y0) —
 *  positive means "downhill". The one number every rotation scene compares, so a
 *  scene can be written once and run in all four directions. */
function fallDistance(
  grid: Grid,
  id: number,
  from: { x: number; y: number },
  dir: GravityDir,
): number {
  const [gx, gy] = GRAVITY_VECTORS[dir];
  const c = centroid(grid, id);
  return (c.x - from.x) * gx + (c.y - from.y) * gy;
}

/** RMS distance of `id`'s cells from their own centroid — how far a cloud has
 *  spread, independent of which way (if anywhere) it drifted. */
function spread(grid: Grid, id: number): number {
  const c = centroid(grid, id);
  if (!c.n) return 0;
  let s = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (grid.get(x, y) === id) s += (x - c.x) ** 2 + (y - c.y) ** 2;
  return Math.sqrt(s / c.n);
}

/** Paint the axis-aligned rectangle whose two corners are given in "gravity
 *  space" and rotate it into screen space for `dir`, so one scene description
 *  builds the same physical world facing any of the four directions. `across` is
 *  the perpendicular-to-gravity axis and `down` is the gravity axis, both
 *  measured from the world's center. */
function paintRotated(
  grid: Grid,
  dir: GravityDir,
  id: number,
  across0: number,
  down0: number,
  across1: number,
  down1: number,
): void {
  const [gx, gy] = GRAVITY_VECTORS[dir];
  const px = -gy;
  const py = gx;
  const cx = W >> 1;
  const cy = H >> 1;
  for (let a = across0; a <= across1; a++)
    for (let d = down0; d <= down1; d++) {
      const x = cx + px * a + gx * d;
      const y = cy + py * a + gy * d;
      if (x >= 0 && x < W && y >= 0 && y < H) grid.set(x, y, id);
    }
}

// ---------------------------------------------------------------------------
// 1. 뜨는 가루 뗏목 (the reported bug). A Sawdust column (density 2) resting on a
//    Water pool (density 3) equilibrates by shifting the WHOLE column at once —
//    the only bulk motion in the engine that isn't a movement primitive. At full
//    gravity it must settle to its buoyant depth; at zero gravity it must not
//    move at all, because there is no weight to displace any water with. Mass is
//    checked on both, since the shift hands overlays back and forth across the
//    waterline and a leak there would look like "it held still" too.
// ---------------------------------------------------------------------------
{
  const results: Record<number, { fall: number; sawdust: number; water: number }> = {};
  for (const strength of [1, 0]) {
    const { grid, sim } = world();
    for (let y = 24; y < H; y++) for (let x = 0; x < W; x++) grid.set(x, y, WATER.id);
    for (let y = 20; y < 24; y++) for (let x = 14; x < 26; x++) grid.set(x, y, SAWDUST.id);
    sim.setGravity('down', strength);
    const before = centroid(grid, SAWDUST.id);
    for (let t = 0; t < 120; t++) sim.step();
    results[strength] = {
      fall: fallDistance(grid, SAWDUST.id, before, 'down'),
      sawdust: count(grid, SAWDUST.id),
      water: count(grid, WATER.id),
    };
  }
  check(
    '뗏목: 중력 100%에선 부력 평형까지 가라앉는다',
    results[1].fall > 0.5,
    `가라앉은 거리 ${results[1].fall.toFixed(2)}칸`,
  );
  check(
    '뗏목: 무중력에선 한 칸도 움직이지 않는다 (신고된 버그)',
    Math.abs(results[0].fall) < 0.001,
    `이동 ${results[0].fall.toFixed(3)}칸`,
  );
  check(
    '뗏목: 두 세기 모두 질량 보존 (톱밥 48 / 물 640)',
    results[1].sawdust === 48 &&
      results[0].sawdust === 48 &&
      results[1].water === 640 &&
      results[0].water === 640,
    `g=1 ${results[1].sawdust}/${results[1].water}, g=0 ${results[0].sawdust}/${results[0].water}`,
  );
}

// ---------------------------------------------------------------------------
// 2. 무중력 정지 대조군. The three powder/liquid arrangements that were ALREADY
//    right (they move only through the gated primitives) must stay right, or a
//    fix to scene 1 that reached too far would go unnoticed: a sand pile in air,
//    sand sunk in water, and a Sawdust raft that is not floating on anything.
// ---------------------------------------------------------------------------
{
  const { grid, sim } = world();
  for (let y = 12; y < 16; y++) for (let x = 16; x < 24; x++) grid.set(x, y, SAND.id);
  sim.setGravity('down', 0);
  const b = centroid(grid, SAND.id);
  for (let t = 0; t < 120; t++) sim.step();
  check(
    '무중력: 공중의 모래 더미는 그대로 떠 있다',
    Math.abs(fallDistance(grid, SAND.id, b, 'down')) < 0.001,
  );
}
{
  const { grid, sim } = world();
  for (let y = 16; y < H; y++) for (let x = 0; x < W; x++) grid.set(x, y, WATER.id);
  for (let y = 20; y < 23; y++) for (let x = 17; x < 23; x++) grid.set(x, y, SAND.id);
  sim.setGravity('down', 0);
  const b = centroid(grid, SAND.id);
  for (let t = 0; t < 120; t++) sim.step();
  check(
    '무중력: 물속에 잠긴 모래도 더 가라앉지 않는다',
    Math.abs(fallDistance(grid, SAND.id, b, 'down')) < 0.001,
  );
}

// ---------------------------------------------------------------------------
// 3. 무거운 기체. Buoyancy needs gravity; molecular jitter does not. Chlorine must
//    slump at full gravity (net travel along the gravity vector) and, at zero
//    gravity, must stop slumping but keep SPREADING — comparably to Smoke, which
//    already had the diffusion term. "Comparable to Smoke" rather than an
//    absolute number, so the pair can be retuned together without this breaking.
// ---------------------------------------------------------------------------
{
  function gasRun(id: number, strength: number): { fall: number; spread: number } {
    const { grid, sim } = world();
    for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) grid.set(x, y, id);
    sim.setGravity('down', strength);
    const b = centroid(grid, id);
    for (let t = 0; t < 60; t++) sim.step();
    return { fall: fallDistance(grid, id, b, 'down'), spread: spread(grid, id) };
  }
  const clFull = gasRun(CHLORINE.id, 1);
  const clZero = gasRun(CHLORINE.id, 0);
  const smokeZero = gasRun(SMOKE.id, 0);
  check(
    '무거운 기체: 중력 100%에선 바닥으로 가라앉는다',
    clFull.fall > 1,
    `염소가 중력 방향으로 ${clFull.fall.toFixed(2)}칸 이동`,
  );
  check(
    '무거운 기체: 무중력에선 가라앉지 않는다',
    Math.abs(clZero.fall) < 1,
    `염소 순이동 ${clZero.fall.toFixed(2)}칸`,
  );
  check(
    '무거운 기체: 무중력에서도 굳지 않고 가벼운 기체만큼 퍼진다',
    clZero.spread > smokeZero.spread * 0.5,
    `염소 rms ${clZero.spread.toFixed(2)} vs 연기 rms ${smokeZero.spread.toFixed(2)}`,
  );
}

// ---------------------------------------------------------------------------
// 4. 탄도 입자의 중력, 산술 수준. applyFlightGravity is the single seam every
//    ballistic particle now goes through, so the exact arithmetic is worth
//    pinning directly: the pull lands on the gravity axis (not the screen's y),
//    with the sign of the gravity vector, and strength 0 leaves the velocity
//    untouched. Cheaper and sharper than inferring it from a flight, and it
//    covers the four directions exhaustively.
// ---------------------------------------------------------------------------
{
  const { sim } = world();
  const pulls: Record<string, [number, number]> = {};
  for (const d of ['down', 'up', 'left', 'right'] as const) {
    sim.setGravity(d, 1);
    const [vx, vy] = applyFlightGravity(sim.context, 3, -5, 2, V_MAX_Q);
    pulls[d] = [vx, vy];
  }
  check(
    '탄도 산술: 당김이 중력축에, 중력 부호로 실린다',
    pulls.down[0] === 3 &&
      pulls.down[1] === -3 &&
      pulls.up[0] === 3 &&
      pulls.up[1] === -7 &&
      pulls.left[0] === 1 &&
      pulls.left[1] === -5 &&
      pulls.right[0] === 5 &&
      pulls.right[1] === -5,
    JSON.stringify(pulls),
  );
  sim.setGravity('down', 0);
  const weightless = applyFlightGravity(sim.context, 3, -5, 2, V_MAX_Q);
  check(
    '탄도 산술: 무중력에선 속도가 그대로다',
    weightless[0] === 3 && weightless[1] === -5,
    `(${weightless[0]}, ${weightless[1]})`,
  );
  sim.setGravity('down', 1);
  const saturated = applyFlightGravity(sim.context, 0, V_MAX_Q, 2, V_MAX_Q);
  check('탄도 산술: 종단 속도는 클램프에서 포화한다', saturated[1] === V_MAX_Q, `${saturated[1]}`);
}

// ---------------------------------------------------------------------------
// 5. 같은 것을 실제 비행으로. One Ember launched straight ACROSS gravity must arc
//    toward whichever way gravity points, by the SAME amount in all four
//    directions, and must fly perfectly straight at strength 0. Asserting the
//    four agree with each other (rather than asserting screen coordinates) is
//    what catches a leftover screen axis anywhere along the path — the flight
//    integration, the walk, the arrival.
//
//    Math.random is pinned to a constant for this scene so the sub-cell speed
//    roll (cellsThisTick) resolves identically in all four runs and the four
//    numbers are comparable exactly, not statistically. The ember is stamped by
//    hand rather than launched, so its velocity is purely across gravity with no
//    launch loft mixed in — the arc measured here is gravity's doing alone.
// ---------------------------------------------------------------------------
{
  const rolled = Math.random;
  Math.random = () => 0;
  function emberArc(dir: GravityDir, strength: number): { along: number; across: number } {
    const [gx, gy] = GRAVITY_VECTORS[dir];
    const px = -gy;
    const py = gx;
    const { grid, sim } = world();
    sim.setGravity(dir, strength);
    const sx = (W >> 1) - px * 8;
    const sy = (H >> 1) - py * 8;
    // 4 quarter-cells = exactly 1 cell/tick across gravity, and nothing along it.
    grid.set(sx, sy, EMBER.id);
    grid.setTemp(sx, sy, encodeFlight(20, px * 4, py * 4));
    for (let t = 0; t < 10; t++) sim.step();
    const c = centroid(grid, EMBER.id);
    return {
      along: (c.x - sx) * gx + (c.y - sy) * gy,
      across: (c.x - sx) * px + (c.y - sy) * py,
    };
  }
  const arcs = (['down', 'up', 'left', 'right'] as const).map((d) => ({ d, a: emberArc(d, 1) }));
  check(
    '탄도 비행: 불똥은 네 방향 모두에서 중력 쪽으로 휜다',
    arcs.every((r) => r.a.along > 0),
    arcs.map((r) => `${r.d} ${r.a.along}`).join(', '),
  );
  check(
    '탄도 비행: 네 방향의 궤적이 완전히 같다 (화면축 잔재 없음)',
    arcs.every((r) => r.a.along === arcs[0].a.along && r.a.across === arcs[0].a.across),
    arcs.map((r) => `${r.d} (${r.a.along},${r.a.across})`).join(', '),
  );
  const zero = emberArc('down', 0);
  check(
    '탄도 비행: 무중력에선 완전한 직선으로 날아간다',
    zero.along === 0 && zero.across > 0,
    `중력축 ${zero.along}, 진행축 ${zero.across}`,
  );
  Math.random = rolled;
}

// ---------------------------------------------------------------------------
// 6. 파편(Debris)의 분수. A blast's fragment fountain launches AGAINST gravity and
//    falls back along it. Both halves have to rotate together, or a plume would
//    launch toward the top of the screen and then curve toward the world's floor.
//    Measured as: fragments end up on the against-gravity side of where they were
//    flung from, in every direction; and in weightlessness the launch still
//    fountains (a blast is blast energy, not gravity) but nothing pulls it back.
// ---------------------------------------------------------------------------
{
  function fountainRise(dir: GravityDir, strength: number): number {
    const { grid, sim } = world();
    sim.setGravity(dir, strength);
    // A slab of sand with the burst along its gravity-ward face.
    paintRotated(grid, dir, SAND.id, -6, -2, 6, 6);
    const [gx, gy] = GRAVITY_VECTORS[dir];
    const px = -gy;
    const py = gx;
    const cx = W >> 1;
    const cy = H >> 1;
    for (let a = -6; a <= 6; a++) {
      const x = cx + px * a;
      const y = cy + py * a;
      launchDebris(sim.context, x, y, SAND.id, px * Math.sign(a), py * Math.sign(a), 2);
    }
    const from = { x: cx, y: cy };
    for (let t = 0; t < 4; t++) sim.step();
    // Negative fall = travelled AGAINST gravity = the plume rose.
    return -fallDistance(grid, DEBRIS.id, from, dir);
  }
  const rises = (['down', 'up', 'left', 'right'] as const).map((d) => ({
    d,
    v: fountainRise(d, 1),
  }));
  check(
    '파편: 분수는 네 방향 모두에서 중력 반대로 솟는다',
    rises.every((r) => r.v > 0.5),
    rises.map((r) => `${r.d} ${r.v.toFixed(2)}`).join(', '),
  );
}

// ---------------------------------------------------------------------------
// 7. 겹침 스며듦(soakDown). A pool over a sand bed wicks in because it weighs on
//    it. At zero gravity not a single cell may enter the bed — and it especially
//    must not enter a layer it could then never percolate through, since
//    updateOverlay stalls at the same gate.
// ---------------------------------------------------------------------------
{
  function soaked(strength: number): number {
    const { grid, sim } = world();
    for (let y = 24; y < 32; y++) for (let x = 12; x < 28; x++) grid.set(x, y, SAND.id);
    for (let y = 20; y < 24; y++) for (let x = 12; x < 28; x++) grid.set(x, y, WATER.id);
    sim.setGravity('down', strength);
    for (let t = 0; t < 100; t++) sim.step();
    let n = 0;
    for (let i = 0; i < grid.cells.length; i++) if (grid.overlay[i] === WATER.id) n++;
    return n;
  }
  const full = soaked(1);
  const zero = soaked(0);
  check('겹침: 중력 100%에선 모래층으로 스며든다', full > 5, `${full}칸`);
  check('겹침: 무중력에선 한 칸도 스며들지 않는다', zero === 0, `${zero}칸`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
