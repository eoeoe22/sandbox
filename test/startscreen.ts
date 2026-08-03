// Headless harness for the start screen's world (`src/game/startScreen.ts`) —
// the lightweight engine that runs behind the menu on `/`. Nothing here touches
// a canvas: the component only maps pointer coordinates and drives `tick()`, so
// everything that can actually be wrong lives in the module this file exercises.
//
// What it pins:
//   · the three fixed settings (속도 ×1 / 벽·바닥 / 연기 중간) that the start
//     screen has no UI to change and must not inherit from a drifting default;
//   · the five streams — all five materials actually fall, in five separate
//     columns, from the top rather than the bottom (the grid's y=0 is the
//     ceiling, and an earlier landing page had this upside down);
//   · the floor: material lands and stays, and nothing leaks out the walls;
//   · the drain that keeps a walled world from filling up solid and freezing;
//   · the click roulette: hold keeps one kind, release advances, and no kind
//     repeats until every kind has been used once (the shuffle-bag rule);
//   · what a held click actually makes — real material, real Fire (hot), and a
//     real Woofer shockwave that shoves loose powder without creating matter.
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
const W = 240;
const H = 135;

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
  check('다섯 줄의 물질이 모두 등록됐다', LITE_MATERIALS.every((m) => getMaterial(m.id) === m), LITE_MATERIALS.map((m) => m.name).join(', '));
}

// 3. 다섯 줄 — every one of the five falls, each from its own column, and from
//    the *top* (y=0 is the ceiling; gravity is +y). The landing page this
//    replaced seeded its floor at y=0, so the orientation is worth pinning.
{
  const world = new StartScreenWorld(W, H, { rand: mulberry32(7) });
  world.grid.cells.fill(EMPTY); // drop the decorative seed bed; watch only the streams
  const before = LITE_MATERIALS.map((m) => count(world.grid, m.id));
  check('시작 시 바닥 띠를 지운 상태', before.every((n) => n === 0));

  // 30 ticks: long enough for every stream to have fired, short enough that
  // nothing has reached the floor yet (fall speed ≈ 1 cell/tick over 135 rows).
  for (let i = 0; i < 30; i++) world.tick();

  const missing = LITE_MATERIALS.filter((m) => count(world.grid, m.id) === 0);
  check('다섯 물질이 모두 떨어지고 있다', missing.length === 0, missing.map((m) => m.name).join(', ') || 'all five present');

  // Each stream stays near its own column: everything of material i sits within
  // a few cells of streamX(i), and the five columns are distinct.
  let strayed = '';
  LITE_MATERIALS.forEach((m, i) => {
    const cx = world.streamX(i);
    for (let k = 0; k < world.grid.cells.length; k++) {
      if (world.grid.cells[k] !== m.id) continue;
      const x = k % W;
      if (Math.abs(x - cx) > 4) strayed += `${m.name}@${x} (기대 ${cx}) `;
    }
  });
  check('각 줄이 자기 열에 머문다', strayed === '', strayed || '5 columns');
  const xs = LITE_MATERIALS.map((_, i) => world.streamX(i));
  check('다섯 열이 서로 떨어져 있다', new Set(xs).size === 5, xs.join(', '));

  // Everything is still in the upper half — it fell *down* from the ceiling.
  let lowest = 0;
  for (let k = 0; k < world.grid.cells.length; k++) {
    if (world.grid.cells[k] !== EMPTY) lowest = Math.max(lowest, (k / W) | 0);
  }
  check('위에서 아래로 떨어진다 (y=0이 천장)', lowest < H / 2, `가장 아래 y=${lowest}`);
}

// 4. 벽/바닥 — a walled sandbox: what pours in piles up on the floor, and the
//    side walls hold. Streams off so the count is a closed system.
{
  const world = new StartScreenWorld(W, H, { streams: false, rand: mulberry32(11) });
  world.grid.cells.fill(EMPTY);
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

// 5. 배수 — the counterweight to those walls. Left alone, five endless streams
//    would fill a closed box solid and the screen would freeze; the floor leaks
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
//    each a permutation of the full set.
{
  const world = new StartScreenWorld(W, H, { streams: false, rand: mulberry32(5) });
  const n = START_KINDS.length;
  const drawn: SpawnKind[] = [world.currentKind];
  for (let i = 0; i < n * 6; i++) {
    world.press(20, 20);
    drawn.push(world.release());
  }
  let bad = '';
  for (let b = 0; b + n <= drawn.length; b += n) {
    const block = drawn.slice(b, b + n);
    if (new Set(block).size !== n) bad += `[${block.map(kindName).join(',')}] `;
  }
  check('한 바퀴 안에서 같은 종류가 두 번 안 나온다', bad === '', bad || `${drawn.length} draws, ${n}종`);
  check('충격파·불·다섯 물질이 모두 후보다', new Set(START_KINDS).size === 7 && START_KINDS.includes(null) && START_KINDS.includes(LITE_FIRE), START_KINDS.map(kindName).join(', '));
  check('순서가 고정돼 있지 않다', new Set(drawn.slice(0, n).map(kindName)).size === n && drawn.slice(0, n).map(kindName).join() !== START_KINDS.map(kindName).join(), drawn.slice(0, n).map(kindName).join(', '));
}

// 7. 클릭-홀드 — one kind for the whole press however long it is held, and the
//    swap happens on release, not on the next stamp.
{
  const world = new StartScreenWorld(W, H, { streams: false, rand: mulberry32(13) });
  world.grid.cells.fill(EMPTY);
  // Force a material (not the shockwave) so the count below means something.
  while (world.currentKind === null) {
    world.press(20, 20);
    world.release();
  }
  const held = world.currentKind!;
  world.press(W >> 1, 30);
  for (let i = 0; i < 12; i++) world.tick();
  check('누르고 있으면 계속 나온다', count(world.grid, held.id) > 20, `${held.name} ${count(world.grid, held.id)}칸`);
  check('누르는 동안에는 종류가 안 바뀐다', world.currentKind === held, kindName(world.currentKind));
  const next = world.release();
  check('손을 떼면 그때 바뀐다', next !== held, `${held.name} → ${kindName(next)}`);
}

// 8. 불 — the roulette's Fire entry places real, burning Fire (its own
//    initial temperature), not a cold decorative cell.
{
  const world = new StartScreenWorld(W, H, { streams: false, rand: mulberry32(17) });
  world.grid.cells.fill(EMPTY);
  world.currentKind = LITE_FIRE;
  world.press(W >> 1, 40);
  const n = count(world.grid, LITE_FIRE.id);
  let hottest = -Infinity;
  for (let i = 0; i < world.grid.cells.length; i++) {
    if (world.grid.cells[i] === LITE_FIRE.id) hottest = Math.max(hottest, world.grid.temp[i]);
  }
  check('불이 실제로 놓인다', n > 20, `${n}칸`);
  check('그 불이 뜨겁다', hottest >= 500, `최고 ${hottest}°`);
}

// 9. 충격파 — the roulette's non-material entry. It queues a real Woofer wave
//    and shoves loose powder around *without* adding or destroying matter.
{
  const world = new StartScreenWorld(W, H, { streams: false, rand: mulberry32(19) });
  world.grid.cells.fill(EMPTY);
  const sand = LITE_MATERIALS[0];
  const cx = W >> 1;
  const cy = H >> 1;
  for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) world.grid.set(x, y, sand.id);
  world.grid.dirty.rebuild(world.grid.cells, world.grid.overlay, world.grid.width, world.grid.height);
  const before = count(world.grid, sand.id);
  const shape = world.grid.cells.slice();

  world.currentKind = null; // 충격파
  world.press(cx, cy);
  check('충격파가 실제로 발사된다', world.grid.shockwaves.length > 0, `${world.grid.shockwaves.length} wave(s)`);
  for (let i = 0; i < 6; i++) world.tick();
  let moved = 0;
  for (let i = 0; i < shape.length; i++) if (shape[i] !== world.grid.cells[i]) moved++;
  check('가루를 실제로 밀어낸다', moved > 0, `${moved}칸 이동`);
  // The wave flings grains as flying Debris (they read as Debris, not Sand,
  // while airborne — see docs/PHYSICS.md), so the conservation check has to wait
  // for them to land. Long enough here for every fragment to come down and
  // settle back into Sand. Nothing is destroyed: a Woofer wave only shoves.
  world.release();
  for (let i = 0; i < 240; i++) world.tick();
  check('충격파는 물질을 지우지 않는다', count(world.grid, sand.id) === before, `${before} → ${count(world.grid, sand.id)}`);
}

// 10. 움직임 최소화 — with `streams: false` the world does not pour by itself,
//     but a click still works (the user's own motion is not suppressed).
{
  const world = new StartScreenWorld(W, H, { streams: false, rand: mulberry32(23) });
  world.grid.cells.fill(EMPTY);
  for (let i = 0; i < 40; i++) world.tick();
  check('움직임 최소화에서는 다섯 줄이 안 흐른다', occupied(world.grid) === 0, `${occupied(world.grid)}칸`);
  world.currentKind = LITE_MATERIALS[0];
  world.press(W >> 1, 40);
  check('그래도 클릭은 받는다', occupied(world.grid) > 0, `${occupied(world.grid)}칸`);
}

console.log(failures === 0 ? '\nAll start-screen checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
