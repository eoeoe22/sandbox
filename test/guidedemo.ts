// 가이드 문서(`/guide?tab=basics`)의 예시 장면 하네스 — `src/game/guideDemo.ts`.
//
// 이 여섯 캔버스는 **아무도 안 볼 때 조용히 망가지는 종류**의 것이다. 물리를
// 고치면 그릇이 안 차고, 물질 기본값을 건드리면 파이프가 안 달아오르고, 대본
// 상수를 잘못 만지면 선이 그어지기 전에 초기화된다. 셋 다 예외를 안 던지고
// 페이지도 멀쩡히 뜬다 — 그냥 아무 일도 안 일어나는 네모가 남는다.
//
// 그래서 검사는 "예외 없이 돌았는가" 가 아니라 **장면이 실제로 그 일을 했는가**를
// 본다: 선이 끝에서 끝까지 그어졌는가, 그릇이 넘쳤는가, 물이 모래에 스몄는가,
// 파이프 반대쪽 끝까지 열이 갔는가, 그리고 여섯이 전부 대본대로 초기화되고
// 반복하는가.
//
// Run: `node test/run-guidedemo.mjs`.

import {
  GuideDemoWorld,
  GUIDE_DEMO_KINDS,
  GUIDE_DEMO_SPECS,
  DEMO_TPS,
  DEMO_STEP_MS,
  type GuideDemoKind,
} from '../src/game/guideDemo';
import { EMPTY } from '../src/game/engine/types';
import { AMBIENT_TEMP } from '../src/game/config';
import {
  DEMO_WALL,
  DEMO_STONE,
  DEMO_SAND,
  DEMO_WATER,
  DEMO_SMOKE,
  DEMO_HEATPIPE,
  DEMO_CLONE,
} from '../src/game/materials/demo';

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 컴포넌트가 캔버스 크기에서 격자를 얻는 것과 같은 식. 폭은 spec 의 칸 수로
 *  고정이고 높이만 화면비에서 따라 나온다. */
function dims(kind: GuideDemoKind): { w: number; h: number } {
  const spec = GUIDE_DEMO_SPECS[kind];
  return { w: spec.cols, h: Math.round(spec.cols / spec.aspect) };
}

function make(kind: GuideDemoKind): GuideDemoWorld {
  const { w, h } = dims(kind);
  return new GuideDemoWorld(kind, w, h);
}

function count(w: GuideDemoWorld, id: number): number {
  let n = 0;
  for (let i = 0; i < w.grid.cells.length; i++) if (w.grid.cells[i] === id) n++;
  return n;
}

function occupied(w: GuideDemoWorld): number {
  let n = 0;
  for (let i = 0; i < w.grid.cells.length; i++) if (w.grid.cells[i] !== EMPTY) n++;
  return n;
}

function run(w: GuideDemoWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.tick();
}

console.log('== 박자 ==');
check(DEMO_TPS === 30, '초당 30틱', `STEP_MS=${DEMO_STEP_MS.toFixed(2)}`);

console.log('\n== 여섯 장면이 전부 세워진다 ==');
for (const kind of GUIDE_DEMO_KINDS) {
  const { w, h } = dims(kind);
  let ok = true;
  let err = '';
  try {
    const world = make(kind);
    run(world, 40);
    ok = world.grid.width === w && world.grid.height === h;
  } catch (e) {
    ok = false;
    err = String(e);
  }
  check(ok, `${kind} ${w}×${h}`, err);
}

// --- 고체 --------------------------------------------------------------------
console.log('\n== 고체: 브러시가 선을 긋고, 지웠다가 다시 긋는다 ==');
{
  const w = make('solid');
  const mid = Math.round(w.grid.height * 0.5);

  run(w, 5);
  check(w.brush !== null, '대기 구간에도 브러시가 보인다');
  check(count(w, DEMO_STONE.id) === 0, '대기 구간에는 아직 아무것도 안 그려졌다');

  const startX = w.brush!.x;
  run(w, DEMO_TPS * 0.5 + DEMO_TPS - 5); // 대기 + 드래그가 끝난 시점
  const endX = w.brush!.x;
  check(endX > startX + w.grid.width * 0.5, '브러시가 화면을 가로질렀다', `${startX} → ${endX}`);

  // 선은 가운데 줄에 놓이고, 브러시 반지름만큼 굵다.
  let lineCells = 0;
  for (let x = 0; x < w.grid.width; x++) if (w.grid.get(x, mid) === DEMO_STONE.id) lineCells++;
  check(lineCells > w.grid.width * 0.6, '가운데 줄이 돌로 이어졌다', `${lineCells}/${w.grid.width}칸`);

  const drawn = count(w, DEMO_STONE.id);
  check(drawn > 0, '돌이 그려졌다', `${drawn}칸`);
  // 「고체」 카드가 보여 주는 것은 상태이지 벽이라는 예외적인 물질이 아니다.
  check(count(w, DEMO_WALL.id) === 0, '벽은 한 칸도 안 쓴다');

  // 마지막 대기 구간이 지나면 초기화된다.
  run(w, DEMO_TPS + 2);
  check(w.loops === 1, '한 바퀴 돌고 초기화됐다', `loops=${w.loops}`);
  check(count(w, DEMO_STONE.id) < drawn * 0.5, '초기화로 선이 지워졌다', `${count(w, DEMO_STONE.id)}칸`);

  // 그리고 다시 긋는다.
  run(w, DEMO_TPS * 2);
  check(count(w, DEMO_STONE.id) > 0, '두 번째 바퀴에서 다시 그린다');
}

// --- 가루 --------------------------------------------------------------------
console.log('\n== 가루: 모래가 더미를 쌓고, 초기화 없이 계속 돈다 ==');
{
  const w = make('powder');
  run(w, DEMO_TPS * 4);
  const sand = count(w, DEMO_SAND.id);
  check(sand > 40, '모래가 쌓였다', `${sand}칸`);

  // 더미가 자란다 = 바닥에 붙어 있다(공중에 떠 있는 낱알만 세는 게 아니다).
  let floorRow = 0;
  for (let x = 0; x < w.grid.width; x++) {
    if (w.grid.get(x, w.grid.height - 1) === DEMO_SAND.id) floorRow++;
  }
  check(floorRow > 3, '바닥에 더미가 앉았다', `바닥 ${floorRow}칸`);

  // 오래 돌려도 화면이 꽉 차 굳지 않는다(바닥 배수).
  run(w, DEMO_TPS * 60);
  const fill = occupied(w) / w.grid.cells.length;
  check(fill < 0.6, '오래 돌려도 화면이 안 찬다', `점유율 ${(fill * 100).toFixed(1)}%`);
  check(w.loops === 0, '초기화 없이 계속된다', `loops=${w.loops}`);
  check(w.brush === null, '가루 데모에는 브러시가 없다');
}

// --- 액체 --------------------------------------------------------------------
console.log('\n== 액체: 그릇이 넘칠 때까지 차고, 초기화 후 반복 ==');
{
  const w = make('liquid');
  const wallsAtStart = count(w, DEMO_WALL.id);
  check(wallsAtStart > 20, '그릇이 벽으로 세워졌다', `${wallsAtStart}칸`);

  // 넘쳐서 한 바퀴가 끝날 때까지 돌린다. 상한(20초)에 걸리면 그건 실패다.
  let ticks = 0;
  const cap = DEMO_TPS * 25;
  while (w.loops === 0 && ticks < cap) {
    w.tick();
    ticks++;
  }
  check(w.loops === 1, '한 바퀴가 끝났다', `${(ticks / DEMO_TPS).toFixed(1)}초`);
  check(ticks < DEMO_TPS * 20, '상한이 아니라 넘침으로 끝났다', `${ticks}틱 < ${DEMO_TPS * 20}틱`);
  check(count(w, DEMO_WATER.id) === 0, '초기화로 물이 사라졌다');
  check(count(w, DEMO_WALL.id) === wallsAtStart, '초기화 후에도 그릇은 그대로', `${count(w, DEMO_WALL.id)}칸`);

  // 두 번째 바퀴도 같은 식으로 찬다.
  run(w, DEMO_TPS * 3);
  check(count(w, DEMO_WATER.id) > 20, '두 번째 바퀴에서 다시 찬다', `${count(w, DEMO_WATER.id)}칸`);
}

// --- 기체 --------------------------------------------------------------------
console.log('\n== 기체: 연기가 아래에서 계속 올라온다 ==');
{
  const w = make('gas');
  run(w, DEMO_TPS * 3);
  const smoke = count(w, DEMO_SMOKE.id);
  check(smoke > 10, '연기가 떠 있다', `${smoke}칸`);

  // 아래에서 나서 위로 간다 — 화면 위쪽 절반에도 연기가 있어야 한다.
  let upper = 0;
  const half = Math.floor(w.grid.height / 2);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < w.grid.width; x++) if (w.grid.get(x, y) === DEMO_SMOKE.id) upper++;
  }
  check(upper > 0, '연기가 위쪽 절반까지 올라갔다', `${upper}칸`);

  // 스스로 사라지므로 초기화 없이도 쌓이지 않는다.
  run(w, DEMO_TPS * 40);
  const later = count(w, DEMO_SMOKE.id);
  check(later < w.grid.cells.length * 0.5, '연기가 화면을 채우지 않는다', `${later}칸`);
  check(w.loops === 0, '초기화 없이 계속된다', `loops=${w.loops}`);
}

// --- 겹침 --------------------------------------------------------------------
console.log('\n== 겹침: 모래 더미에 물이 스민다 ==');
{
  const w = make('overlap');
  run(w, DEMO_TPS * 4); // 모래 4초
  const sand = count(w, DEMO_SAND.id);
  check(sand > 40, '모래 더미가 생겼다', `${sand}칸`);

  let soaked = 0;
  for (let i = 0; i < w.grid.overlay.length; i++) if (w.grid.overlay[i] !== 0) soaked++;
  check(soaked === 0, '아직 스며든 것은 없다', `${soaked}칸`);

  run(w, DEMO_TPS * 6); // 대기 1초 + 물 4초 + 여유
  soaked = 0;
  for (let i = 0; i < w.grid.overlay.length; i++) if (w.grid.overlay[i] === DEMO_WATER.id) soaked++;
  check(soaked > 0, '물이 모래에 스몄다', `겹침 ${soaked}칸`);

  // 12초 대본이 끝나면 초기화된다. 초기화된 **그 틱**을 봐야 한다 — 다음 바퀴의
  // 모래가 곧바로 떨어지기 시작하므로 몇 틱만 더 돌려도 격자는 이미 비어 있지 않다.
  let spun = 0;
  while (w.loops === 0 && spun < DEMO_TPS * 20) {
    w.tick();
    spun++;
  }
  check(w.loops === 1, '한 바퀴 돌고 초기화됐다', `${(spun / DEMO_TPS).toFixed(1)}초`);
  check(occupied(w) === 0, '초기화로 격자가 비었다', `${occupied(w)}칸`);
}

// --- 열전도 -------------------------------------------------------------------
console.log('\n== 열전도: 파이프 띠가 아래의 불에서부터 달아오른다 ==');
{
  const w = make('heat');

  // 파이프가 놓인 줄을 격자에서 직접 찾는다. 대본 상수(PIPE_Y·PIPE_THICK)를 여기
  // 한 벌 더 적으면 배치를 옮겼을 때 검사가 **엉뚱한 빈 줄을 재고도 통과**한다.
  const pipeRows: number[] = [];
  for (let y = 0; y < w.grid.height; y++) {
    let n = 0;
    for (let x = 0; x < w.grid.width; x++) if (w.grid.get(x, y) === DEMO_HEATPIPE.id) n++;
    if (n > w.grid.width * 0.7) pipeRows.push(y);
  }
  check(pipeRows.length >= 3, '파이프가 여러 줄 두께의 띠로 놓였다', `${pipeRows.length}줄`);
  check(
    pipeRows.length === 0 || pipeRows[pipeRows.length - 1] - pipeRows[0] === pipeRows.length - 1,
    '띠가 끊기지 않고 붙어 있다',
    `y=${pipeRows[0]}..${pipeRows[pipeRows.length - 1]}`,
  );
  const pipeTop = pipeRows[0];
  const pipeBottom = pipeRows[pipeRows.length - 1];

  // 불 Clone 은 파이프 **아래**에 있어야 한다(불은 위로 오른다). 그리고 파이프에
  // 딱 붙어 있으면 위로는 뱉을 자리가 없어 불이 옆구리로만 샌다 — 사이에 빈 줄이
  // 있는지까지 본다.
  let cloneTop = -1;
  let cloneCells = 0;
  for (let y = 0; y < w.grid.height; y++) {
    for (let x = 0; x < w.grid.width; x++) {
      if (w.grid.get(x, y) !== DEMO_CLONE.id) continue;
      cloneCells++;
      if (cloneTop < 0) cloneTop = y;
    }
  }
  check(cloneCells >= 9, '불 Clone 이 덩어리로 놓였다', `${cloneCells}칸`);
  check(cloneTop > pipeBottom, 'Clone 이 파이프 아래에 있다', `clone y=${cloneTop} > pipe y=${pipeBottom}`);
  check(cloneTop - pipeBottom >= 2, '파이프와 Clone 사이가 비어 있다', `${cloneTop - pipeBottom - 1}줄`);

  // 2초분(60틱)을 돌린 동안은 t=0..59라 전부 일반 뷰이고, t=60인 다음 틱이
  // 열 뷰로 넘어간다.
  run(w, DEMO_TPS * 2);
  check(!w.heatView, '2초까지는 일반 뷰');
  w.tick();
  check(w.heatView, '2초에 열 뷰로 전환됐다');

  run(w, DEMO_TPS * 4);

  // 파이프를 따라 왼쪽(불) → 오른쪽으로 온도가 내려가는 기울기가 있어야 한다.
  // 재는 줄은 불에서 가장 먼 **맨 윗줄**이다: 아랫줄만 달아오르고 위까지 배어
  // 나오지 않으면 열지도에서 띠가 한 줄짜리로 보인다.
  const temps: number[] = [];
  for (let x = 0; x < w.grid.width; x++) {
    if (w.grid.get(x, pipeTop) === DEMO_HEATPIPE.id) temps.push(w.grid.getTemp(x, pipeTop));
  }
  const near = temps[0];
  const far = temps[temps.length - 1];
  check(near > AMBIENT_TEMP + 100, '불이 닿은 끝이 달아올랐다', `${near.toFixed(0)}℃`);
  // 열지도가 절반만 칠해진 채로 초기화되면 「열전도」 데모가 아니다. 반대쪽 끝이
  // 눈에 띄게 데워졌는지를 본다(파이프를 늘리거나 두껍게 하면 여기서 먼저 걸린다).
  check(far > AMBIENT_TEMP + 40, '반대쪽 끝까지 열이 갔다', `${far.toFixed(0)}℃`);
  check(near > far, '가까운 쪽이 더 뜨겁다', `${near.toFixed(0)}℃ > ${far.toFixed(0)}℃`);

  // 7초 대본이 끝나면 초기화되고 뷰도 일반으로 돌아온다.
  run(w, DEMO_TPS * 2);
  check(w.loops === 1, '한 바퀴 돌고 초기화됐다', `loops=${w.loops}`);
  check(!w.heatView, '초기화하면 일반 뷰로 돌아온다');
  const backToAmbient = w.grid.getTemp(w.grid.width - 8, pipeTop);
  check(Math.abs(backToAmbient - AMBIENT_TEMP) < 1, '초기화로 온도도 되돌아온다', `${backToAmbient.toFixed(0)}℃`);
}

// --- 정지 화면 ----------------------------------------------------------------
console.log('\n== 움직임 최소화: 감아 둔 한 프레임이 빈 화면이 아니다 ==');
{
  // 움직임 최소화에서는 대본을 안 돌리고 `windToStill()`로 한 번 감은 결과만
  // 그린다. 그 한 장이 **초기화 직후**로 떨어지면 데모 자리에 빈 네모가 남는데,
  // 화면에서는 그냥 "아무것도 없는 칸"으로 보이므로 아무도 눈치채지 못한다.
  for (const kind of GUIDE_DEMO_KINDS) {
    const w = make(kind);
    w.windToStill();
    check(
      w.loops === 0 && occupied(w) > 10,
      `${kind}: 정지 화면에 볼 것이 남아 있다`,
      `loops=${w.loops}, ${occupied(w)}칸`,
    );
  }

  // 액체는 대본 길이가 물줄기의 확률 굴림에 따라 흔들리므로(넘침이 정한다) 고정
  // 틱으로 감으면 이른 판에서 초기화를 지나친다. 굴림을 여러 번 돌려 **매번**
  // 가득 찬 그릇에서 멈추는지 본다 — 이 절이 없으면 드물게 빈 그릇이 나온다.
  let worst = Infinity;
  for (let trial = 0; trial < 40; trial++) {
    const w = make('liquid');
    w.windToStill();
    const water = count(w, DEMO_WATER.id);
    if (water < worst) worst = water;
    if (w.loops !== 0) worst = -1;
  }
  check(worst > 100, '액체는 40번 굴려도 늘 가득 찬 그릇에서 멈춘다', `최악의 판 ${worst}칸`);
}

// --- 리사이즈 -----------------------------------------------------------------
console.log('\n== 창 크기가 바뀌면 장면을 다시 세운다 ==');
{
  const w = make('liquid');
  run(w, DEMO_TPS * 2);
  w.resize(60, 44);
  check(w.grid.width === 60 && w.grid.height === 44, '격자가 새 크기가 됐다');
  check(count(w, DEMO_WATER.id) === 0, '다시 세우면서 물이 비워졌다');
  const walls = count(w, DEMO_WALL.id);
  check(walls > 20, '새 크기에 맞춰 그릇이 다시 세워졌다', `${walls}칸`);
  run(w, DEMO_TPS * 3);
  check(count(w, DEMO_WATER.id) > 10, '새 크기에서도 물이 찬다');
}

console.log(failures === 0 ? '\n전부 통과' : `\n${failures}건 실패`);
if (failures > 0) process.exit(1);
