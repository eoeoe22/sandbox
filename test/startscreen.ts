// Headless harness for the start screen's world (`src/game/startScreen.ts`) —
// the lightweight engine that runs behind the menu on `/`. Nothing here touches
// a canvas: the component only maps pointer coordinates and drives `tick()`, so
// everything that can actually be wrong lives in the module this file exercises.
//
// What it pins:
//   · the three fixed settings (속도 ×1 / 벽·바닥 / 연기 중간) that the start
//     screen has no UI to change and must not inherit from a drifting default;
//   · the streams — every lite material actually falls, each in its own column,
//     from the top rather than the bottom (the grid's y=0 is the ceiling, and an
//     earlier landing page had this upside down), onto an empty board (the start
//     screen begins bare — nothing is pre-piled on the floor);
//   · the floor: material lands and stays, and nothing leaks out the walls;
//   · the drain that keeps a walled world from filling up solid and freezing;
//   · the auto events: one goes off every second — not every tick, not once —
//     and the roulette behind them never repeats a kind until every kind has
//     been used (the shuffle-bag rule);
//   · where an event lands: on the surface of whatever has piled up in that
//     column, so it has something to burn or shove, and *above* it rather than
//     on top of it (an event must not erase the pile it fires at);
//   · what an event actually makes — real Fire (hot, and it spreads to the
//     gasoline it lands on) and a real Woofer shockwave that shoves loose
//     powder without creating or destroying matter.
//
// Run: `node test/run-startscreen.mjs`.

import { Grid } from '../src/game/engine/Grid';
import { EMPTY } from '../src/game/engine/types';
import { TICK_HZ } from '../src/game/config';
import { LITE_MATERIALS, LITE_FIRE } from '../src/game/materials/lite';
import { getMaterial, allMaterials } from '../src/game/materials/registry';
import {
  StartScreenWorld,
  START_KINDS,
  START_STEP_MS,
  START_BORDER_MODE,
  START_SMOKE_LEVEL,
  START_SIM_SPEED,
  AUTO_EVENT_TICKS,
  type SpawnKind,
} from '../src/game/startScreen';

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
Math.random = mulberry32(1907);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
function occupied(grid: Grid): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] !== EMPTY) n++;
  return n;
}
const kindName = (k: SpawnKind): string => (k === null ? '충격파' : k.name);

// A world the size of the real thing on a 1080p screen at START_CELL_SCALE.
const W = 360;
const H = 202;

// 1. 고정 설정 — the start screen has no settings UI, so these are the whole
//    contract. Speed is checked as the step interval Game.ts derives, since that
//    is the number the component's frame loop actually uses.
{
  const world = new StartScreenWorld(W, H);
  check('속도 ×1 (본 게임 기본값과 같은 박자)', START_SIM_SPEED === 1 && START_STEP_MS === 2000 / TICK_HZ, `${START_STEP_MS.toFixed(2)}ms/step`);
  check('테두리 = 벽/바닥', START_BORDER_MODE === 'wall' && world.sim.context.borderMode === 'wall');
  check('연기 = 중간 고정', START_SMOKE_LEVEL === 'medium' && world.sim.context.smokeLevel === 'medium');
}

// 2. 경량 로드 — the whole point of `materials/lite`: the start screen must not
//    register the full 138-material palette. The engine core (objects.ts →
//    spark/blast/…) legitimately drags a chunk of it in, so this is an upper
//    bound rather than an exact list; it fails loudly if someone re-points the
//    start screen at the full barrel.
{
  const n = allMaterials().length;
  check('경량 배럴만 등록됐다 (전체 팔레트가 아님)', n < 120, `${n} materials registered`);
  check('떨어지는 줄의 물질이 모두 등록됐다', LITE_MATERIALS.every((m) => getMaterial(m.id) === m), LITE_MATERIALS.map((m) => m.name).join(', '));
  // 소금은 후보에서 뺐다 — 물과 만나면 소금물이 되고 녹으면 Molten Salt가 되니,
  // 배경 화면이 매 틱 이웃을 훑을 이유가 없다. 다만 **모듈은 그대로 실린다**:
  // Fire → Salt Water → Salt 사슬이라 불을 넣는 한 배럴에서 뺄 수가 없다. 그래서
  // 지킬 수 있는 것은 "안 실린다"가 아니라 **"한 칸도 안 놓인다"** 쪽이고,
  // 반응 로직이 실제로 안 도는 조건도 그쪽이다(소금 칸이 없으면 update가 안 불린다).
  // 이름으로 찾는 이유는 배럴에서 뺀 물질이라 import할 수 없어서다.
  const saltId = allMaterials().find((m) => m.name === 'Salt')?.id ?? -1;
  check(
    '소금이 후보에서 빠졌다',
    !LITE_MATERIALS.some((m) => m.id === saltId) && !START_KINDS.some((k) => k !== null && k.id === saltId),
    `Salt id ${saltId}`,
  );
  {
    const world = new StartScreenWorld(W, H, { rand: mulberry32(3) });
    for (let i = 0; i < 400; i++) world.tick();
    check('돌려 봐도 소금이 한 칸도 안 생긴다', saltId < 0 || count(world.grid, saltId) === 0, `${saltId < 0 ? 'n/a' : count(world.grid, saltId)}칸`);
  }
}

// 3. 떨어지는 줄 — every lite material falls, each from its own column, and from
//    the *top* (y=0 is the ceiling; gravity is +y). The landing page this
//    replaced seeded its floor at y=0, so the orientation is worth pinning. The
//    board it falls onto is bare: a fresh world has nothing in it at all.
{
  const world = new StartScreenWorld(W, H, { rand: mulberry32(7) });
  check('시작할 때 화면이 비어 있다 (바닥에 쌓아 두지 않는다)', occupied(world.grid) === 0, `${occupied(world.grid)}칸`);

  // Long enough for every stream to have fired, short enough that nothing has
  // reached the floor yet (fall speed ≈ 1 cell/tick over H rows). Stopping one
  // tick short of AUTO_EVENT_TICKS also keeps the first auto event out of this
  // scene, so what is on the board came from the streams and nothing else.
  for (let i = 0; i < AUTO_EVENT_TICKS - 1; i++) world.tick();
  check('그동안 자동 이벤트는 아직 안 터졌다', world.eventCount === 0, `${world.eventCount}회`);

  const missing = LITE_MATERIALS.filter((m) => count(world.grid, m.id) === 0);
  check('물질이 모두 떨어지고 있다', missing.length === 0, missing.map((m) => m.name).join(', ') || `all ${LITE_MATERIALS.length} present`);

  // Each stream stays near its own column: everything of material i sits within
  // a few cells of streamX(i), and the columns are distinct.
  let strayed = '';
  LITE_MATERIALS.forEach((m, i) => {
    const cx = world.streamX(i);
    for (let k = 0; k < world.grid.cells.length; k++) {
      if (world.grid.cells[k] !== m.id) continue;
      const x = k % W;
      if (Math.abs(x - cx) > 4) strayed += `${m.name}@${x} (기대 ${cx}) `;
    }
  });
  check('각 줄이 자기 열에 머문다', strayed === '', strayed || `${LITE_MATERIALS.length} columns`);
  const xs = LITE_MATERIALS.map((_, i) => world.streamX(i));
  check('열이 서로 떨어져 있다', new Set(xs).size === LITE_MATERIALS.length, xs.join(', '));

  // Everything is still in the upper half — it fell *down* from the ceiling.
  let lowest = 0;
  for (let k = 0; k < world.grid.cells.length; k++) {
    if (world.grid.cells[k] !== EMPTY) lowest = Math.max(lowest, (k / W) | 0);
  }
  check('위에서 아래로 떨어진다 (y=0이 천장)', lowest < H / 2, `가장 아래 y=${lowest}`);
}

// 4. 벽/바닥 — a walled sandbox: what pours in piles up on the floor, and the
//    side walls hold. Motion off so the count is a closed system.
{
  const world = new StartScreenWorld(W, H, { motion: false, rand: mulberry32(11) });
  const sand = LITE_MATERIALS[0];
  // A bar spanning the full width, one row down: with open edges the spreading
  // pile would walk off both sides; with walls every grain is still here.
  for (let x = 0; x < W; x++) world.grid.set(x, 1, sand.id);
  const before = count(world.grid, sand.id);
  for (let i = 0; i < 200; i++) world.tick();
  check('벽이 있어 옆으로 새지 않는다', count(world.grid, sand.id) === before, `${before} → ${count(world.grid, sand.id)}`);
  let onFloor = 0;
  for (let x = 0; x < W; x++) if (world.grid.get(x, H - 1) !== EMPTY) onFloor++;
  check('바닥이 있어 그 위에 쌓인다', onFloor > W * 0.8, `바닥 줄 ${onFloor}/${W}칸`);
}

// 5. 배수 — the counterweight to those walls. Left alone, endless streams would
//    fill a closed box solid and the screen would freeze; the floor leaks
//    just enough to hold the level. Start from a world already past the hard
//    threshold and check it comes back down instead of climbing to full.
{
  const world = new StartScreenWorld(W, H, { rand: mulberry32(29) });
  const sand = LITE_MATERIALS[0];
  for (let y = (H * 0.4) | 0; y < H; y++) for (let x = 0; x < W; x++) world.grid.set(x, y, sand.id);
  world.grid.dirty.rebuild(world.grid.cells, world.grid.overlay, world.grid.width, world.grid.height);
  const before = occupied(world.grid) / (W * H);
  for (let i = 0; i < 600; i++) world.tick();
  const after = occupied(world.grid) / (W * H);
  check('꽉 찬 세계가 다시 빠진다', after < before, `점유율 ${(before * 100) | 0}% → ${(after * 100) | 0}%`);
  check('꽉 차서 굳지 않는다', after < 0.9, `${(after * 100) | 0}%`);
}

// 6. 룰렛 — the ordering rule from the brief: random order, and a kind that has
//    been used does not come back until every kind has been used. That is the
//    shuffle-bag invariant: consecutive blocks of START_KINDS.length draws are
//    each a permutation of the full set. With the roulette down to two entries
//    (불·충격파) the rule bites hardest — the bag plus its anti-repeat swap at
//    the block boundary leaves exactly one legal sequence, a strict alternation,
//    so the only thing chance decides is which of the two opens. That is on
//    purpose: on a screen that fires once a second, neither kind can go missing
//    for long.
{
  const world = new StartScreenWorld(W, H, { motion: false, rand: mulberry32(5) });
  const n = START_KINDS.length;
  const drawn: SpawnKind[] = [];
  for (let i = 0; i < n * 8; i++) drawn.push(world.fireEvent().kind);

  let bad = '';
  for (let b = 0; b + n <= drawn.length; b += n) {
    const block = drawn.slice(b, b + n);
    if (new Set(block).size !== n) bad += `[${block.map(kindName).join(',')}] `;
  }
  check('한 바퀴 안에서 같은 종류가 두 번 안 나온다', bad === '', bad || `${drawn.length} draws, ${n}종`);
  check(
    '후보는 불과 충격파 둘뿐이다',
    new Set(START_KINDS).size === 2 && START_KINDS.includes(null) && START_KINDS.includes(LITE_FIRE),
    START_KINDS.map(kindName).join(', '),
  );
  let repeated = '';
  for (let i = 1; i < drawn.length; i++) if (drawn[i] === drawn[i - 1]) repeated += `${i}:${kindName(drawn[i])} `;
  check('같은 것이 연달아 두 번 나오지 않는다', repeated === '', repeated || `${drawn.length}회 연속 교대`);
}

// 7. 1초에 한 번 — the screen's baseline, the half of it that runs whether or
//    not anyone touches anything (the other half is the click, section 12). Not
//    every tick (that would be a wall of fire) and not once at load: exactly one
//    event per second, counted in the same ticks the component's frame loop
//    steps. The position is redrawn each time, so consecutive events do not
//    stack in one spot.
{
  check(
    '이벤트 간격이 정확히 1초',
    Math.abs(AUTO_EVENT_TICKS * START_STEP_MS - 1000) < 1e-6,
    `${AUTO_EVENT_TICKS}틱 × ${START_STEP_MS.toFixed(2)}ms`,
  );

  const world = new StartScreenWorld(W, H, { rand: mulberry32(13) });
  const perSecond: number[] = [];
  const xs: number[] = [];
  for (let s = 0; s < 6; s++) {
    for (let i = 0; i < AUTO_EVENT_TICKS; i++) world.tick();
    perSecond.push(world.eventCount);
    xs.push(world.lastEvent!.x);
  }
  check('1초마다 한 번씩만 터진다', perSecond.join() === '1,2,3,4,5,6', perSecond.join(' → '));
  check('자리가 매번 새로 뽑힌다', new Set(xs).size >= 5, `x = ${xs.join(', ')}`);
  const last = world.lastEvent!;
  check('터진 자리가 화면 안이다', world.grid.inBounds(last.x, last.y), `(${last.x}, ${last.y})`);
}

// 8. 터지는 자리 — a uniformly random cell would be empty air nearly every time
//    and the event would be invisible. It goes to the *surface* of whatever has
//    piled up in the column it picked, straddling it: half the circle in the air
//    above, half inside the pile. Resting it neatly on top instead looks tidier
//    and does nothing — Fire is a gas and floats off before it can catch (see
//    section 9's measurement).
{
  const world = new StartScreenWorld(W, H, { motion: false, rand: mulberry32(31) });
  const sand = LITE_MATERIALS[0];
  const top = H - 40; // flat pile, 40 rows deep, in every column
  for (let y = top; y < H; y++) for (let x = 0; x < W; x++) world.grid.set(x, y, sand.id);
  world.grid.dirty.rebuild(world.grid.cells, world.grid.overlay, world.grid.width, world.grid.height);
  const before = count(world.grid, sand.id);

  world.currentKind = LITE_FIRE;
  const ev = world.fireEvent();
  check('더미 표면에서 터진다', ev.y === top, `표면 y=${top}, 이벤트 중심 y=${ev.y}`);
  let above = 0;
  let inside = 0;
  for (let i = 0; i < world.grid.cells.length; i++) {
    if (world.grid.cells[i] !== LITE_FIRE.id) continue;
    if (((i / W) | 0) < top) above++;
    else inside++;
  }
  check('원이 표면에 걸터앉는다', above > 0 && inside > 0, `공중 ${above}칸 / 더미 속 ${inside}칸`);
  check('덮인 만큼만 줄어든다', count(world.grid, sand.id) === before - inside, `모래 ${before} → ${count(world.grid, sand.id)} (불 ${inside}칸이 덮음)`);

  // The other half of the rule: a column with nothing in it yet (the first
  // seconds after load) has no surface to aim at, so the event goes off in the
  // lower air rather than at the ceiling, where it would be lost behind the
  // title.
  const bare = new StartScreenWorld(W, H, { motion: false, rand: mulberry32(37) });
  let outside = '';
  for (let i = 0; i < 20; i++) {
    const e = bare.fireEvent();
    if (e.y < H * 0.4 || e.y > H * 0.9) outside += `y=${e.y} `;
  }
  check('아직 안 쌓인 열이면 아래쪽 허공에서 터진다', outside === '', outside || '20회 모두 아래쪽');
}

// 9. 불 — the roulette's Fire entry places real, burning Fire (its own initial
//    temperature), not a cold decorative cell, and it actually takes: the pool
//    it straddles burns down. This is the check that decided section 8's
//    geometry — with the circle sitting one row higher, on top of the surface
//    instead of astride it, this same scene ends with the gasoline count
//    untouched at 10800 and every flame burnt out by tick 35.
{
  const world = new StartScreenWorld(W, H, { motion: false, rand: mulberry32(17) });
  const gasoline = LITE_MATERIALS.find((m) => m.name === 'Gasoline')!;
  const top = H - 30;
  for (let y = top; y < H; y++) for (let x = 0; x < W; x++) world.grid.set(x, y, gasoline.id);
  world.grid.dirty.rebuild(world.grid.cells, world.grid.overlay, world.grid.width, world.grid.height);
  const before = count(world.grid, gasoline.id);

  world.currentKind = LITE_FIRE;
  world.fireEvent();
  const n = count(world.grid, LITE_FIRE.id);
  let hottest = -Infinity;
  for (let i = 0; i < world.grid.cells.length; i++) {
    if (world.grid.cells[i] === LITE_FIRE.id) hottest = Math.max(hottest, world.grid.temp[i]);
  }
  check('불이 실제로 놓인다', n > 20, `${n}칸`);
  check('그 불이 뜨겁다', hottest >= 500, `최고 ${hottest}°`);

  for (let i = 0; i < 60; i++) world.tick();
  const after = count(world.grid, gasoline.id);
  check('밑에 깔린 휘발유에 옮겨붙는다', after < before, `휘발유 ${before} → ${after}칸`);
}

// 10. 충격파 — the roulette's non-material entry. It queues a real Woofer wave
//     and shoves loose powder around *without* adding or destroying matter.
{
  const world = new StartScreenWorld(W, H, { motion: false, rand: mulberry32(19) });
  const sand = LITE_MATERIALS[0];
  const top = H - 8; // a shallow bed across the floor, so wherever the event
  for (let y = top; y < H; y++) for (let x = 0; x < W; x++) world.grid.set(x, y, sand.id); // lands it lands on sand
  world.grid.dirty.rebuild(world.grid.cells, world.grid.overlay, world.grid.width, world.grid.height);
  const before = count(world.grid, sand.id);
  const shape = world.grid.cells.slice();

  world.currentKind = null; // 충격파
  world.fireEvent();
  check('충격파가 실제로 발사된다', world.grid.shockwaves.length > 0, `${world.grid.shockwaves.length} wave(s)`);
  for (let i = 0; i < 6; i++) world.tick();
  let moved = 0;
  for (let i = 0; i < shape.length; i++) if (shape[i] !== world.grid.cells[i]) moved++;
  check('가루를 실제로 밀어낸다', moved > 0, `${moved}칸 이동`);
  // The wave flings grains as flying Debris (they read as Debris, not Sand,
  // while airborne — see docs/PHYSICS.md), so the conservation check has to wait
  // for them to land. Long enough here for every fragment to come down and
  // settle back into Sand. Nothing is destroyed: a Woofer wave only shoves.
  for (let i = 0; i < 240; i++) world.tick();
  check('충격파는 물질을 지우지 않는다', count(world.grid, sand.id) === before, `${before} → ${count(world.grid, sand.id)}`);
}

// 11. 움직임 최소화 — `motion: false` stops everything the world does on its
//     own. Both halves are unprompted motion (nothing here is a response to the
//     user), so the streams and the auto events have to go quiet together. The
//     click is deliberately *not* part of that (section 12): it is the one thing
//     on this screen the user asks for.
{
  const world = new StartScreenWorld(W, H, { motion: false, rand: mulberry32(23) });
  for (let i = 0; i < AUTO_EVENT_TICKS * 4; i++) world.tick();
  check('줄이 안 흐른다', occupied(world.grid) === 0, `${occupied(world.grid)}칸`);
  check('자동 이벤트도 안 터진다', world.eventCount === 0, `${world.eventCount}회`);
}

// 12. 클릭 충격파 — the screen's one handle. A press lands a real Woofer wave on
//     the cell that was pressed (not near it, not a fresh random spot like the
//     auto events), it shoves what is there without creating or destroying
//     matter, and it is bookkept apart from the 1-second beat: neither counted
//     with it nor able to shift it.
{
  const world = new StartScreenWorld(W, H, { motion: false, rand: mulberry32(41) });
  const sand = LITE_MATERIALS[0];
  const top = H - 8; // the same shallow bed section 10 thumps
  for (let y = top; y < H; y++) for (let x = 0; x < W; x++) world.grid.set(x, y, sand.id);
  world.grid.dirty.rebuild(world.grid.cells, world.grid.overlay, world.grid.width, world.grid.height);
  const before = count(world.grid, sand.id);
  const shape = world.grid.cells.slice();

  const cx = (W / 2) | 0;
  const ev = world.burstAt(cx, top);
  check('누른 칸에서 터진다', ev !== null && ev.x === cx && ev.y === top, `(${ev?.x}, ${ev?.y}) 요청 (${cx}, ${top})`);
  check('충격파다 (물질을 놓지 않는다)', ev !== null && ev.kind === null, kindName(ev!.kind));
  check('클릭도 진짜 파면을 만든다', world.grid.shockwaves.length > 0, `${world.grid.shockwaves.length} wave(s)`);

  for (let i = 0; i < 6; i++) world.tick();
  let moved = 0;
  for (let i = 0; i < shape.length; i++) if (shape[i] !== world.grid.cells[i]) moved++;
  check('누른 자리의 가루가 밀린다', moved > 0, `${moved}칸 이동`);
  // Same as section 10: grains fly as Debris and only read as Sand again once
  // they land, so conservation is measured after everything has settled.
  for (let i = 0; i < 240; i++) world.tick();
  check('클릭 충격파도 물질을 지우지 않는다', count(world.grid, sand.id) === before, `${before} → ${count(world.grid, sand.id)}`);

  // The bookkeeping split: clicks have their own counter, and the 1-second beat
  // never sees them. `motion: false` here also pins the other half of section
  // 11 — the user's own press still works on a screen that has stopped moving
  // by itself, which is exactly the case prefers-reduced-motion creates.
  check('클릭은 클릭대로 센다', world.burstCount === 1, `${world.burstCount}회`);
  check('움직임 최소화에서도 클릭은 터진다', world.eventCount === 0 && world.burstCount === 1, `자동 ${world.eventCount}회 / 클릭 ${world.burstCount}회`);

  // Out of bounds: the component maps raw screen coordinates, and the sandbox
  // rect is centered in the canvas, so a press in the letterboxed margin maps
  // outside the grid. It has to be a no-op rather than a thrown error or a wave
  // wrapped around to the far edge.
  const waves = world.grid.shockwaves.length;
  const outside = [world.burstAt(-1, 10), world.burstAt(W, 10), world.burstAt(10, -1), world.burstAt(10, H)];
  check('화면 밖 클릭은 아무 일도 안 한다', outside.every((e) => e === null) && world.grid.shockwaves.length === waves && world.burstCount === 1, outside.map((e) => (e === null ? '무시' : '터짐')).join(', '));
}

// 13. 클릭이 배경 박자를 흔들지 않는다 — the auto event is a 1-second metronome
//     the click layer sits on top of, not something a press resets or hurries.
//     Pressed every single tick for a second, exactly one auto event still goes
//     off — and the clicks are all still there in their own counter.
{
  const world = new StartScreenWorld(W, H, { rand: mulberry32(43) });
  for (let i = 0; i < AUTO_EVENT_TICKS; i++) {
    world.burstAt((W / 2) | 0, (H / 2) | 0);
    world.tick();
  }
  check('클릭을 퍼부어도 자동 이벤트는 1초에 한 번', world.eventCount === 1, `${world.eventCount}회`);
  check('그동안의 클릭이 다 셌다', world.burstCount === AUTO_EVENT_TICKS, `${world.burstCount}/${AUTO_EVENT_TICKS}회`);
}

console.log(failures === 0 ? '\nAll start-screen checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
