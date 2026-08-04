// Headless harness for the **열전도 로그 스케일** — the exponential conductivity
// curve (config.effectiveConductivity) and the inert-tile skip that pays for the
// substep count it needs.
//
// The retune has one promise and one goal, and both are easy to break by tuning:
//
//   **약속** — 앵커(모래 0.35)의 절대 열전도 속도는 그대로다. The whole mid-range of
//   the roster (powders, stone, glass, concrete) was balanced by feel against
//   sand's spread rate. HEAT_DIFFUSION_SUBSTEPS went 3 → 9 to buy headroom for
//   the top end, and the curve exists to give that headroom back at the anchor.
//   If someone edits the substep count without re-deriving the curve base, or
//   edits the base by hand, sand silently speeds up or slows down and every
//   powder in the game drifts with it. Scene A measures that against a
//   from-scratch reimplementation of the OLD model (3 substeps, raw
//   conductivity) and demands the two agree.
//
//   **목표** — 금속은 극적으로 빨라야 한다. The reported complaint was that a
//   Heatpipe felt like slightly damp sand, because on the raw 0..1 dial it only
//   ever conducted 2.9× as fast. Scene B races the three bars against each other
//   and pins the gap that widening produced (target ≈8.6× at the extremes), so
//   flattening the curve back toward linear fails here.
//
// Scene C is the safety net under both: the diffusion pass now skips 16×16 tiles
// that hold nothing but zero-conductivity cells, which is a *claim* about the
// kernel (an all-inert tile is a no-op) rather than an approximation. The WASM
// golden test proves it at kernel level; this proves it through the real engine,
// against an independent full-grid reference, with the CA scan and the radiative
// pass running alongside. Scene D pins the invariants the kernel itself depends
// on — f(0)=0 for the insulator early-out, f(1)=1 for the stability budget,
// monotonicity so the authored ordering survives.
//
// The authoring surface is deliberately untouched: `thermal.conductivity` is
// still the plain 0..1 dial material files declare and the codex prints. The
// curve lives entirely in the LUT the kernel reads. Scene D checks that too —
// it is what keeps docs/CODEX.md honest.
//
// Run: `node test/run-heatcurve.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { allMaterials, getMaterial } from '../src/game/materials/registry';
import {
  AMBIENT_TEMP,
  DEFAULT_CONDUCTIVITY,
  HEAT_CURVE_ANCHOR,
  HEAT_DIFFUSION_RATE,
  HEAT_DIFFUSION_SUBSTEPS,
  RADIANT_HEAT_MIN_TEMP,
  effectiveConductivity,
} from '../src/game/config';
import { SAND } from '../src/game/materials/sand';
import { IRON } from '../src/game/materials/iron';
import { HEATPIPE } from '../src/game/materials/heatpipe';
import { WALL } from '../src/game/materials/wall';
import { WATER } from '../src/game/materials/water';
import { EMPTY } from '../src/game/engine/types';
import '../src/game/materials';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// The model as it stood before this change: no curve, three substeps. Scene A's
// only job is to prove the anchor still conducts like this.
const OLD_SUBSTEPS = 3;
const oldConductivity = (c: number): number => c;

// ---------------------------------------------------------------------------
// A 1-D conduction bench. A single-cell-tall bar of one material, walled in on
// every side (Wall is conductivity 0, so no heat leaks out and the bar is a
// clean 1-D rod), with its left end pinned hot every tick. Kept well under
// RADIANT_HEAT_MIN_TEMP so the radiative pass contributes nothing and what we
// measure is conduction alone.
// ---------------------------------------------------------------------------
const BAR_W = 60;
const BAR_H = 9;
const BAR_Y = 4; // the bar's row
const SOURCE_TEMP = RADIANT_HEAT_MIN_TEMP - 100; // 400°: hot, but never radiant

/** Wall everywhere, a horizontal bar of `id` at BAR_Y, everything at ambient. */
function buildBar(id: number): { grid: Grid; sim: Simulation } {
  const grid = new Grid(BAR_W, BAR_H);
  for (let y = 0; y < BAR_H; y++) {
    for (let x = 0; x < BAR_W; x++) {
      const i = grid.idx(x, y);
      grid.cells[i] = y === BAR_Y ? id : WALL.id;
      grid.temp[i] = AMBIENT_TEMP;
    }
  }
  return { grid, sim: new Simulation(grid) };
}

/** The bar's temperature profile after `ticks` ticks of the real engine. */
function runBar(id: number, ticks: number): Float32Array {
  const { grid, sim } = buildBar(id);
  for (let t = 0; t < ticks; t++) {
    grid.temp[grid.idx(0, BAR_Y)] = SOURCE_TEMP; // re-pin the source each tick
    sim.step();
  }
  const out = new Float32Array(BAR_W);
  for (let x = 0; x < BAR_W; x++) out[x] = grid.temp[grid.idx(x, BAR_Y)];
  return out;
}

/**
 * The same bench, computed from scratch — a full-grid, no-tiles, no-engine
 * reference diffusion, parameterized by substep count and conductivity map so
 * it can reproduce either the old model or the new one. Deliberately written
 * out rather than calling into the engine: agreeing with the code under test by
 * construction would prove nothing.
 */
function referenceBar(
  id: number,
  ticks: number,
  substeps: number,
  map: (c: number) => number,
): Float32Array {
  const n = BAR_W * BAR_H;
  const cells = new Uint8Array(n);
  const cond = new Float32Array(256).fill(map(DEFAULT_CONDUCTIVITY));
  for (const m of allMaterials()) cond[m.id] = map(m.thermal?.conductivity ?? DEFAULT_CONDUCTIVITY);
  let cur = new Float32Array(n).fill(AMBIENT_TEMP);
  let next = new Float32Array(n);
  for (let y = 0; y < BAR_H; y++) {
    for (let x = 0; x < BAR_W; x++) cells[y * BAR_W + x] = y === BAR_Y ? id : WALL.id;
  }
  for (let t = 0; t < ticks; t++) {
    cur[BAR_Y * BAR_W] = SOURCE_TEMP;
    for (let s = 0; s < substeps; s++) {
      for (let y = 0; y < BAR_H; y++) {
        for (let x = 0; x < BAR_W; x++) {
          const i = y * BAR_W + x;
          const ci = cond[cells[i]];
          const ti = cur[i];
          if (ci === 0) {
            next[i] = ti;
            continue;
          }
          let acc = ti;
          if (x > 0) {
            const cj = cond[cells[i - 1]];
            acc += HEAT_DIFFUSION_RATE * (ci < cj ? ci : cj) * (cur[i - 1] - ti);
          }
          if (x < BAR_W - 1) {
            const cj = cond[cells[i + 1]];
            acc += HEAT_DIFFUSION_RATE * (ci < cj ? ci : cj) * (cur[i + 1] - ti);
          }
          if (y > 0) {
            const cj = cond[cells[i - BAR_W]];
            acc += HEAT_DIFFUSION_RATE * (ci < cj ? ci : cj) * (cur[i - BAR_W] - ti);
          }
          if (y < BAR_H - 1) {
            const cj = cond[cells[i + BAR_W]];
            acc += HEAT_DIFFUSION_RATE * (ci < cj ? ci : cj) * (cur[i + BAR_W] - ti);
          }
          next[i] = acc;
        }
      }
      const swap = cur;
      cur = next;
      next = swap;
    }
  }
  return cur.slice(BAR_Y * BAR_W, BAR_Y * BAR_W + BAR_W);
}

/** How far the heat front travelled: cells warmed at least `rise` above ambient. */
function frontReach(profile: Float32Array, rise = 5): number {
  let n = 0;
  for (let x = 0; x < profile.length; x++) if (profile[x] - AMBIENT_TEMP >= rise) n = x;
  return n;
}

/** Total heat delivered into the bar (sum of the rise above ambient). */
function heatDelivered(profile: Float32Array): number {
  let s = 0;
  for (let x = 1; x < profile.length; x++) s += profile[x] - AMBIENT_TEMP;
  return s;
}

const TICKS = 40;

// ---------------------------------------------------------------------------
// Scene A — 앵커 불변: 모래는 예전 그대로다.
//
// The engine (9 substeps, curved) vs. a reimplementation of the model as it was
// (3 substeps, raw conductivity). Same scene, same source, same tick count. The
// two discretizations are not identical step-for-step — nine small steps和 three
// large ones only converge to the same continuum diffusion — so this asserts
// agreement to a few percent, not bit equality. Anything sloppier than that and
// the "sand is unchanged" promise stops meaning anything.
// ---------------------------------------------------------------------------
{
  const now = runBar(SAND.id, TICKS);
  const before = referenceBar(SAND.id, TICKS, OLD_SUBSTEPS, oldConductivity);

  const reachNow = frontReach(now);
  const reachBefore = frontReach(before);
  check(
    'A1 모래 열 전선 도달거리가 개편 전과 같다',
    Math.abs(reachNow - reachBefore) <= 1,
    `now ${reachNow}칸 vs before ${reachBefore}칸`,
  );

  const qNow = heatDelivered(now);
  const qBefore = heatDelivered(before);
  const ratio = qNow / qBefore;
  check(
    'A2 모래가 실어 나른 총 열량이 개편 전 대비 ±5% 안',
    ratio > 0.95 && ratio < 1.05,
    `${(ratio * 100).toFixed(1)}%`,
  );

  // The identity the curve base is derived from, stated directly: at the anchor,
  // substeps × conductivity is conserved across the retune. This is the thing a
  // careless edit to HEAT_DIFFUSION_SUBSTEPS breaks, and it breaks it silently.
  const speedNow = HEAT_DIFFUSION_SUBSTEPS * effectiveConductivity(HEAT_CURVE_ANCHOR);
  const speedBefore = OLD_SUBSTEPS * HEAT_CURVE_ANCHOR;
  check(
    'A3 앵커의 틱당 전도 계수가 정확히 보존된다 (substeps × f(anchor))',
    Math.abs(speedNow - speedBefore) < 1e-12,
    `${speedNow.toFixed(6)} vs ${speedBefore.toFixed(6)}`,
  );

  // Sand is the anchor by declaration — if someone reauthors it, A1/A2 stop
  // testing what they claim to, so say so out loud rather than quietly passing.
  check(
    'A4 모래의 저작 전도율이 앵커 값 그대로다',
    getMaterial(SAND.id).thermal?.conductivity === HEAT_CURVE_ANCHOR,
    `sand ${getMaterial(SAND.id).thermal?.conductivity} vs anchor ${HEAT_CURVE_ANCHOR}`,
  );
}

// ---------------------------------------------------------------------------
// Scene B — 금속은 극적으로 빨라졌다.
//
// The point of the whole change. Three bars, one scene, same ticks: the gap
// between the best conductor and the anchor has to be wide, and wider than the
// old model's, or the complaint that started this ("히트파이프가 모래랑 비슷하다")
// is still true.
// ---------------------------------------------------------------------------
{
  const sand = runBar(SAND.id, TICKS);
  const iron = runBar(IRON.id, TICKS);
  const pipe = runBar(HEATPIPE.id, TICKS);

  const qSand = heatDelivered(sand);
  const qIron = heatDelivered(iron);
  const qPipe = heatDelivered(pipe);

  check(
    'B1 서열이 유지된다 (Heatpipe > Iron > Sand)',
    qPipe > qIron && qIron > qSand,
    `pipe ${qPipe.toFixed(0)} > iron ${qIron.toFixed(0)} > sand ${qSand.toFixed(0)}`,
  );

  // The design number: the ratio of per-tick conduction *coefficients* between
  // the top of the dial and the anchor. That is what the curve base was solved
  // for (2.9× → 8.6×) and the honest thing to assert, because it is stated in
  // the same units the tuning was done in.
  const coeff = (c: number) => HEAT_DIFFUSION_SUBSTEPS * effectiveConductivity(c);
  const spreadNow = coeff(1.0) / coeff(HEAT_CURVE_ANCHOR);
  const spreadBefore = (OLD_SUBSTEPS * 1.0) / (OLD_SUBSTEPS * HEAT_CURVE_ANCHOR);
  check(
    'B2 히트파이프:모래 전도계수 격차가 3배 이상 벌어졌다',
    spreadNow >= spreadBefore * 2.9,
    `${spreadBefore.toFixed(2)}× → ${spreadNow.toFixed(2)}×`,
  );

  // What that buys on the grid. Diffusion length goes as √(coefficient·time), so
  // an 8.6× coefficient gap shows up as ≈√8.6 ≈ 2.9× in distance — don't read
  // the two numbers as if they were the same quantity. The old model's √2.9 ≈
  // 1.7× is the "히트파이프가 모래랑 비슷하다" everyone was complaining about.
  const oldSand = referenceBar(SAND.id, TICKS, OLD_SUBSTEPS, oldConductivity);
  const oldPipe = referenceBar(HEATPIPE.id, TICKS, OLD_SUBSTEPS, oldConductivity);
  const reachSand = frontReach(sand);
  const reachPipe = frontReach(pipe);
  const gapNow = reachPipe / reachSand;
  const gapBefore = frontReach(oldPipe) / frontReach(oldSand);
  check(
    'B3 히트파이프의 열 전선이 모래보다 2.5배 이상 멀리 간다',
    gapNow >= 2.5,
    `pipe ${reachPipe}칸 vs sand ${reachSand}칸 (${gapNow.toFixed(2)}×)`,
  );
  check(
    'B3b 그 거리 격차가 개편 전보다 1.5배 이상 벌어졌다',
    gapNow >= gapBefore * 1.5,
    `${gapBefore.toFixed(2)}× → ${gapNow.toFixed(2)}×`,
  );

  // Absolute speedup at the top end, not just relative to sand: the substep
  // headroom has to actually reach the material it was bought for.
  const pipeReachBefore = frontReach(oldPipe);
  check(
    'B4 히트파이프 자체도 개편 전보다 확실히 빨라졌다',
    reachPipe >= pipeReachBefore * 1.5,
    `${pipeReachBefore}칸 → ${reachPipe}칸`,
  );

  // Iron sits between them and must move too — the complaint named "금속 종류",
  // not just the one showcase material.
  const oldIron = referenceBar(IRON.id, TICKS, OLD_SUBSTEPS, oldConductivity);
  check(
    'B5 철도 개편 전보다 빨라졌다',
    heatDelivered(iron) > heatDelivered(oldIron) * 1.2,
    `${heatDelivered(oldIron).toFixed(0)} → ${qIron.toFixed(0)}`,
  );
}

// ---------------------------------------------------------------------------
// Scene C — 비활성 타일 스킵이 결과를 바꾸지 않는다.
//
// A mixed scene with big empty regions (so tiles really are skipped), driven
// through the real Simulation, compared cell-for-cell against the independent
// full-grid reference. Bit-identical is the bar: the skip is justified by a
// proof (a zero-conductivity tile is a no-op both for itself and for anyone
// looking into it), so any difference at all means the proof does not hold.
// ---------------------------------------------------------------------------
{
  const W = 48;
  const H = 40;
  const grid = new Grid(W, H);
  // A walled tank on the bottom rows, air above, with a hot metal slab and a
  // cold water pocket inside — so conducting cells cluster in a few tiles and
  // most of the upper grid is genuinely inert.
  for (let x = 0; x < W; x++) {
    for (let y = H - 12; y < H; y++) grid.cells[grid.idx(x, y)] = WALL.id;
  }
  for (let x = 4; x < 20; x++) {
    for (let y = H - 10; y < H - 6; y++) {
      const i = grid.idx(x, y);
      grid.cells[i] = HEATPIPE.id;
      grid.temp[i] = 450;
    }
  }
  for (let x = 20; x < 34; x++) {
    for (let y = H - 10; y < H - 6; y++) {
      const i = grid.idx(x, y);
      grid.cells[i] = IRON.id;
      grid.temp[i] = AMBIENT_TEMP;
    }
  }
  for (let x = 34; x < 44; x++) {
    for (let y = H - 10; y < H - 6; y++) {
      const i = grid.idx(x, y);
      grid.cells[i] = WATER.id;
      grid.temp[i] = AMBIENT_TEMP;
    }
  }
  // Snapshot the exact starting state for the reference to replay.
  const cells0 = grid.cells.slice();
  const temp0 = grid.temp.slice();

  // How much of this scene the skip is actually dropping — a scene where every
  // tile conducts would pass C1 without exercising anything.
  const inertTiles = (() => {
    const TILE = 16;
    const tx = Math.ceil(W / TILE);
    const ty = Math.ceil(H / TILE);
    const live = new Uint8Array(tx * ty);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const id = cells0[y * W + x];
        if (id !== EMPTY && id !== WALL.id) live[((y / TILE) | 0) * tx + ((x / TILE) | 0)] = 1;
      }
    }
    let n = 0;
    for (const v of live) if (v === 0) n++;
    return { inert: n, total: live.length };
  })();
  check(
    'C0 이 장면에 실제로 건너뛸 비활성 타일이 있다',
    inertTiles.inert > 0,
    `${inertTiles.inert}/${inertTiles.total} 타일`,
  );

  const TICKS_C = 25;
  const sim = new Simulation(grid);
  for (let t = 0; t < TICKS_C; t++) sim.step();

  // Reference: same field, same substeps, same curved LUT, no tiles, no engine.
  const n = W * H;
  const cond = new Float32Array(256).fill(effectiveConductivity(DEFAULT_CONDUCTIVITY));
  for (const m of allMaterials()) {
    cond[m.id] = effectiveConductivity(m.thermal?.conductivity ?? DEFAULT_CONDUCTIVITY);
  }
  let cur = temp0.slice();
  let next = new Float32Array(n);
  for (let t = 0; t < TICKS_C; t++) {
    for (let s = 0; s < HEAT_DIFFUSION_SUBSTEPS; s++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const ci = cond[cells0[i]];
          const ti = cur[i];
          if (ci === 0) {
            next[i] = ti;
            continue;
          }
          let acc = ti;
          if (x > 0) {
            const cj = cond[cells0[i - 1]];
            acc += HEAT_DIFFUSION_RATE * (ci < cj ? ci : cj) * (cur[i - 1] - ti);
          }
          if (x < W - 1) {
            const cj = cond[cells0[i + 1]];
            acc += HEAT_DIFFUSION_RATE * (ci < cj ? ci : cj) * (cur[i + 1] - ti);
          }
          if (y > 0) {
            const cj = cond[cells0[i - W]];
            acc += HEAT_DIFFUSION_RATE * (ci < cj ? ci : cj) * (cur[i - W] - ti);
          }
          if (y < H - 1) {
            const cj = cond[cells0[i + W]];
            acc += HEAT_DIFFUSION_RATE * (ci < cj ? ci : cj) * (cur[i + W] - ti);
          }
          next[i] = acc;
        }
      }
      const swap = cur;
      cur = next;
      next = swap;
    }
  }

  // The engine may have moved matter (the water pocket spreads), which would
  // legitimately move heat with it. Compare only where the scene is still what
  // the reference assumed — the metal slabs, which never move.
  let worst = 0;
  let compared = 0;
  for (let i = 0; i < n; i++) {
    const id = cells0[i];
    if (id !== HEATPIPE.id && id !== IRON.id) continue;
    if (grid.cells[i] !== id) continue;
    worst = Math.max(worst, Math.abs(grid.temp[i] - cur[i]));
    compared++;
  }
  check(
    'C1 타일 스킵이 켜진 엔진의 온도장이 전면 스캔 레퍼런스와 비트 동일',
    worst === 0 && compared > 0,
    `${compared}칸 비교, 최대 오차 ${worst}`,
  );
}

// ---------------------------------------------------------------------------
// Scene E — 건너뛴 타일 안의 온도가 살아남는다.
//
// The one thing the inert-tile skip could quietly destroy. A conductivity-0 cell
// used to be *written* every substep — `next[i] = ti`, the copy-through — which
// is what carried its temperature across the ping-pong buffer swap. Skipped
// tiles are no longer written at all, so that copy has to happen somewhere else:
// `step` seeds the back buffer once per tick before the substep loop (and the
// WASM kernel does the same memcpy internally).
//
// This is not a hypothetical. `temp` on a zero-conductivity cell is not dead
// storage — Grid.ts documents it as the real-valued state slot for exactly those
// materials, and Blast, Ember, Debris, Bomblet, Firework Star, Napalm Gel, Heat
// Ray and Nuclear Ray all store their flight/lifetime state there while sitting
// in mid-air, which is to say inside a tile of nothing but Empty and themselves.
// Lose the seed and every one of them has its state stomped on the first swap.
//
// Aerogel is the probe because it is the inert material with no update rule of
// its own: a static solid whose temperature nothing but the heat pass can move,
// so if the reading drifts, the heat pass is what drifted it.
// ---------------------------------------------------------------------------
{
  const W = 40;
  const H = 40;
  const MARK = 777.25; // distinctive, and exactly representable as f32
  const grid = new Grid(W, H);
  // An aerogel block floating alone in empty air — its whole 16×16 tile holds
  // nothing that conducts, so the diffusion pass never visits it.
  for (let y = 4; y < 9; y++) {
    for (let x = 4; x < 9; x++) {
      const i = grid.idx(x, y);
      grid.cells[i] = 98; // AEROGEL
      grid.temp[i] = MARK;
    }
  }
  const probe = grid.idx(6, 6);
  check('E0 프로브가 진짜 단열재다', grid.cells[probe] === 98 && effectiveConductivity(0) === 0);

  // Checked after EVERY tick, not just at the end. An odd substep count leaves
  // the field in the other buffer, so a lost copy-through makes the reading
  // oscillate — right on even ticks, wrong on odd ones. Sampling once at the end
  // has a coin-flip chance of landing on a good tick and calling it a pass; this
  // scene passed with the seed deleted until it was rewritten to sample all of
  // them. Don't "simplify" it back to a single check at the end.
  const sim = new Simulation(grid);
  let firstBad = -1;
  for (let t = 0; t < 12; t++) {
    sim.step();
    for (let y = 4; y < 9 && firstBad < 0; y++) {
      for (let x = 4; x < 9; x++) {
        if (grid.temp[grid.idx(x, y)] !== MARK) {
          firstBad = t;
          break;
        }
      }
    }
  }
  check(
    'E1 건너뛴 타일 안 전도율 0 셀의 온도가 매 틱 그대로 살아남는다',
    firstBad < 0,
    firstBad < 0 ? `12틱 전부 ${MARK}` : `틱 ${firstBad}에서 깨짐 (probe ${grid.temp[probe]})`,
  );
}

// ---------------------------------------------------------------------------
// Scene D — 커널이 의존하는 커브 불변식.
//
// Not simulation behaviour but the three properties the kernel and the
// authoring surface are built on. Each has a specific failure it prevents.
// ---------------------------------------------------------------------------
{
  // The diffusion kernel's insulator early-out is `cond === 0`, an exact float
  // comparison. A curve with a nonzero floor (a bare BASE^(c-1), say) would let
  // air conduct and every sealed build in the game would start leaking heat.
  check('D1 f(0) = 0 정확히 (공기·Wall 완전 단열 유지)', effectiveConductivity(0) === 0);
  check(
    'D2 EMPTY와 Wall이 여전히 전도율 0',
    effectiveConductivity(getMaterial(EMPTY).thermal?.conductivity ?? 1) === 0 &&
      effectiveConductivity(getMaterial(WALL.id).thermal?.conductivity ?? 1) === 0,
  );

  // f(1) = 1 keeps the stability budget HEAT_DIFFUSION_RATE was chosen against:
  // four maximally conductive neighbors must exchange ≤ 1.0 of the gap in one
  // substep or the explicit scheme oscillates instead of diffusing.
  check('D3 f(1) = 1 정확히 (안정 예산 상한 불변)', effectiveConductivity(1) === 1);
  let maxF = 0;
  for (const m of allMaterials()) {
    maxF = Math.max(maxF, effectiveConductivity(m.thermal?.conductivity ?? DEFAULT_CONDUCTIVITY));
  }
  const worstExchange = 4 * HEAT_DIFFUSION_RATE * maxF;
  check(
    'D4 4-이웃 최대 교환량이 안정 한계(≤1) 안',
    worstExchange <= 1,
    `${worstExchange.toFixed(3)} (max f = ${maxF.toFixed(3)})`,
  );

  // Strictly increasing: authoring a higher conductivity must never conduct
  // slower. Sampled densely rather than only at the roster's values, since the
  // next material added can land anywhere on the dial.
  let monotone = true;
  let prev = -1;
  for (let i = 0; i <= 1000; i++) {
    const f = effectiveConductivity(i / 1000);
    if (f <= prev) monotone = false;
    prev = f;
  }
  check('D5 커브가 0..1 전 구간에서 순증가 (저작 서열 보존)', monotone);

  // The curve is engine-internal. Material files and the codex still see the
  // plain dial — see docs/CODEX.md; the codex stat reads `thermal.conductivity`
  // straight off the material.
  check(
    'D6 저작 전도율은 원본 그대로 (도감이 읽는 값은 커브를 타지 않는다)',
    getMaterial(HEATPIPE.id).thermal?.conductivity === 1.0 &&
      getMaterial(IRON.id).thermal?.conductivity === 0.85 &&
      getMaterial(SAND.id).thermal?.conductivity === 0.35,
  );

  // And the shape of the result, printed for whoever retunes this next.
  const table = [1.0, 0.9, 0.85, 0.6, 0.5, 0.35, 0.3, 0.15]
    .map((c) => {
      const speedup =
        (HEAT_DIFFUSION_SUBSTEPS * effectiveConductivity(c)) / (OLD_SUBSTEPS * c);
      return `${c}→${speedup.toFixed(2)}×`;
    })
    .join('  ');
  console.log(`      개편 전 대비 속도: ${table}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
