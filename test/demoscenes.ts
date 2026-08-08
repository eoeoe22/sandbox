// 물질 카드의 **맞춤 연출** 하네스 — `src/game/demoScenes.ts` 의 배정표와
// `src/game/guideDemo.ts` 의 네 대본(acid · ignite · gunpowder · ammoniumnitrate).
//
// basics 의 여섯 장면과 고장 방식이 같다(test/guidedemo.ts 머리말): 예외는 안 나고
// 페이지도 멀쩡히 뜨는데 **아무 일도 안 일어나는 네모**가 남는다. 여기는 그 위에
// 두 가지가 더 얹힌다.
//
//  1. **배역표가 조용히 어긋난다.** 대본 파일은 경량 배럴만 보므로 산·철·등유를
//     이름으로 못 집고, 그 물질들은 `DemoCast` 로 건너온다. 표의 칸 하나를 빠뜨리면
//     타입은 통과하고 장면만 아무것도 안 한다.
//  2. **화학이 안 걸린다.** 세 재료를 부었는데 흑색화약이 한 칸도 안 생기거나,
//     연료를 부었는데 암모날이 안 되거나, 불을 댔는데 안 터지는 판. 셋 다 대본은
//     정상으로 끝나고 화면만 밋밋해진다.
//
// 그래서 검사는 대본의 박자만이 아니라 **격자에 실제로 그 물질이 생겼는가**를 본다.
// 확률이 끼는 자리(조합·부식·점화)는 여러 판을 돌려 최악의 판으로 판정한다.
//
// Run: `node test/run-demoscenes.mjs`.

import {
  GuideDemoWorld,
  GUIDE_DEMO_SPECS,
  CUSTOM_DEMO_KINDS,
  DEMO_TPS,
  type GuideDemoKind,
} from '../src/game/guideDemo';
import { demoSceneFor, customDemoMaterials } from '../src/game/demoScenes';
import { EMPTY } from '../src/game/engine/types';
import { getMaterial } from '../src/game/materials/registry';
// 전체 배럴. 카드 데모가 마운트 뒤 끌어오는 것과 같은 것으로, 이게 없으면 주인공
// 물질이 색도 동작도 없는 칸이 된다(docs/CODEX.md §14.3).
import '../src/game/materials';
import { ACID } from '../src/game/materials/acid';
import { ALUMINUM_POWDER } from '../src/game/materials/aluminumpowder';
import { AMMONAL } from '../src/game/materials/ammonal';
import { AMMONIUM_NITRATE } from '../src/game/materials/ammoniumnitrate';
import { ANFO } from '../src/game/materials/anfo';
import { COAL_POWDER } from '../src/game/materials/coalpowder';
import { FIRE } from '../src/game/materials/fire';
import { FIREWORKS } from '../src/game/materials/fireworks';
import { FLASH_POWDER } from '../src/game/materials/flashpowder';
import { GUNPOWDER } from '../src/game/materials/gunpowder';
import { HYDROGEN } from '../src/game/materials/hydrogen';
import { IRON } from '../src/game/materials/iron';
import { KEROSENE } from '../src/game/materials/kerosene';
import { NITRO } from '../src/game/materials/nitro';
import { SALTPETER } from '../src/game/materials/saltpeter';
import { SAND } from '../src/game/materials/sand';
import { SULFUR } from '../src/game/materials/sulfur';
import { WALL } from '../src/game/materials/wall';
import { WATER } from '../src/game/materials/water';

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 카드가 세우는 것과 같은 세계 — 배정표에서 대본과 배역을 그대로 받아 온다. */
function make(id: number): GuideDemoWorld {
  const scene = demoSceneFor(id);
  if (scene === null) throw new Error(`맞춤 연출이 배정되지 않은 물질: ${id}`);
  const spec = GUIDE_DEMO_SPECS[scene.kind];
  return new GuideDemoWorld(
    scene.kind,
    spec.cols,
    Math.round(spec.cols / spec.aspect),
    Math.random,
    id,
    scene.cast,
  );
}

function run(w: GuideDemoWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.tick();
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

/** `x0..x1` 칸 구간 안의 `id` 개수. 3등분 장면이 칸별로 세는 데 쓴다. */
function countIn(w: GuideDemoWorld, id: number, x0: number, x1: number): number {
  let n = 0;
  for (let y = 0; y < w.grid.height; y++) {
    for (let x = x0; x <= x1; x++) if (w.grid.get(x, y) === id) n++;
  }
  return n;
}

/** `id` 가 놓인 줄 중 가장 위/아래. 없으면 둘 다 -1. */
function rowSpan(w: GuideDemoWorld, id: number): { top: number; bottom: number } {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < w.grid.height; y++) {
    for (let x = 0; x < w.grid.width; x++) {
      if (w.grid.get(x, y) !== id) continue;
      if (top < 0) top = y;
      bottom = y;
      break;
    }
  }
  return { top, bottom };
}

/** 한 바퀴가 돌 때까지 돌린다. 걸린 틱 수를 돌려주고, 상한에 걸리면 -1. */
function spinToLoop(w: GuideDemoWorld, capTicks: number): number {
  for (let i = 0; i < capTicks; i++) {
    w.tick();
    if (w.loops > 0) return i + 1;
  }
  return -1;
}

// --- 배정표 ---------------------------------------------------------------------

console.log('== 배정표: 누가 맞춤 연출을 받는가 ==');
{
  const want: [string, number, GuideDemoKind][] = [
    ['산', ACID.id, 'acid'],
    ['화약', GUNPOWDER.id, 'gunpowder'],
    ['질산암모늄', AMMONIUM_NITRATE.id, 'ammoniumnitrate'],
    ['섬광화약', FLASH_POWDER.id, 'ignite'],
    ['불꽃놀이 화약', FIREWORKS.id, 'ignite'],
    ['황', SULFUR.id, 'ignite'],
    ['니트로', NITRO.id, 'ignite'],
  ];
  for (const [label, id, kind] of want) {
    check(demoSceneFor(id)?.kind === kind, `${label} → ${kind}`, `실제 ${demoSceneFor(id)?.kind}`);
  }
  check(
    customDemoMaterials().length === want.length,
    '표에 그 일곱뿐이다',
    `${customDemoMaterials().length}종`,
  );
  // 배정 안 된 물질은 **기본 데모로 가라**는 뜻의 null 이어야 한다. 여기서 무언가를
  // 돌려주기 시작하면 물·모래 카드가 남의 대본을 돈다.
  check(demoSceneFor(WATER.id) === null, '물은 배정이 없다(상태 데모로 간다)');
  check(demoSceneFor(SAND.id) === null, '모래는 배정이 없다');

  // 배역표의 물질이 실제로 등록된 것인가. 대본은 이 id 들을 그냥 격자에 쓰므로,
  // 표가 틀리면 장면이 「검은 칸을 붓는」 그림이 된다.
  const cast = demoSceneFor(ACID.id)!.cast;
  check(cast.floor === IRON.id, '산 장면의 바닥은 철', getMaterial(cast.floor).name);
  check(
    cast.recipe.length === 3 &&
      cast.recipe.includes(COAL_POWDER.id) &&
      cast.recipe.includes(SULFUR.id) &&
      cast.recipe.includes(SALTPETER.id),
    '화약 2막의 재료는 석탄가루·황·초석',
    cast.recipe.map((id) => getMaterial(id).name).join('+'),
  );
  check(
    cast.fuels[0] === ALUMINUM_POWDER.id && cast.fuels[1] === KEROSENE.id,
    '질산암모늄의 연료는 알루미늄 가루·등유',
    cast.fuels.map((id) => getMaterial(id).name).join('+'),
  );
}

console.log('\n== 네 대본이 전부 세워진다 ==');
for (const kind of CUSTOM_DEMO_KINDS) {
  const spec = GUIDE_DEMO_SPECS[kind];
  check(spec !== undefined && spec.cols > 0, `${kind} 에 장면 규격이 있다`, `${spec?.cols}칸`);
}

// --- 산 ---------------------------------------------------------------------------
console.log('\n== 산: 금속 바닥 한 줄을 갉아 뚫고 아래로 샌다 ==');
{
  const w = make(ACID.id);
  const floorRow = rowSpan(w, IRON.id).top;
  check(floorRow > 0, '금속 바닥이 한 줄 놓였다', `y=${floorRow}`);

  // 바닥은 **끝에서 끝까지** 막고 있어야 한다. 한 칸이라도 비면 산은 갉는 대신
  // 그리로 흘러내리고, 장면이 「부식」에서 「틈으로 샌다」가 된다.
  let gaps = 0;
  for (let x = 0; x < w.grid.width; x++) if (w.grid.get(x, floorRow) !== IRON.id) gaps++;
  check(gaps === 0, '바닥이 격자를 가로로 완전히 막는다', `빈 칸 ${gaps}`);
  const floorAtStart = count(w, IRON.id);

  run(w, DEMO_TPS * 2);
  check(count(w, ACID.id) > 20, '산이 부어지고 있다', `${count(w, ACID.id)}칸`);

  // 붓기 6초 + 구경 5초. 이 사이에 바닥이 뚫려야 한다.
  run(w, DEMO_TPS * 8);
  const eaten = floorAtStart - count(w, IRON.id);
  check(eaten >= 3, '바닥이 갉여 나갔다', `${eaten}칸`);
  let below = 0;
  for (let y = floorRow + 1; y < w.grid.height; y++) {
    for (let x = 0; x < w.grid.width; x++) if (w.grid.get(x, y) === ACID.id) below++;
  }
  check(below > 0, '뚫린 자리로 산이 아래까지 내려갔다', `${below}칸`);

  // 철은 이온화 경향이 수소보다 커서 **기포를 내며** 녹는다(`acidHydrogen`). 이게
  // 안 보이면 바닥을 아무 금속으로나 바꿔도 티가 안 난다는 뜻이라 배역이 헛돈다.
  // 기포는 떠올라 사라지므로 한 틱만 재면 놓친다 — 한 바퀴 내내 지켜본다.
  {
    let sawFizz = false;
    for (let trial = 0; trial < 5 && !sawFizz; trial++) {
      const s = make(ACID.id);
      for (let i = 0; i < DEMO_TPS * 11; i++) {
        s.tick();
        if (count(s, HYDROGEN.id) > 0) {
          sawFizz = true;
          break;
        }
      }
    }
    check(sawFizz, '녹는 동안 수소 기포가 올라온다');
  }

  const ticks = spinToLoop(w, DEMO_TPS * 20);
  check(ticks > 0, '한 바퀴가 끝났다', `${((DEMO_TPS * 10 + ticks) / DEMO_TPS).toFixed(1)}초`);
  check(count(w, IRON.id) === floorAtStart, '초기화하면 바닥이 다시 온전하다', `${count(w, IRON.id)}칸`);
  check(count(w, ACID.id) === 0, '초기화로 산이 사라졌다');
}

// --- 격발 ---------------------------------------------------------------------------
console.log('\n== 격발: 3초 붓고 1초 쉰 뒤 불을 댄다 (섬광화약·불꽃놀이 화약·황·니트로) ==');
for (const [label, id] of [
  ['섬광화약', FLASH_POWDER.id],
  ['불꽃놀이 화약', FIREWORKS.id],
  ['황', SULFUR.id],
  ['니트로', NITRO.id],
] as [string, number][]) {
  const w = make(id);
  run(w, DEMO_TPS * 3);
  const piled = count(w, id);
  check(piled > 30, `${label}: 3초어치 더미가 쌓였다`, `${piled}칸`);
  check(count(w, FIRE.id) === 0, `${label}: 아직 불은 없다`);
  check(w.brush === null, `${label}: 브러시가 없는 장면이다`);

  // 4초에 불이 붙는다. 「불이 났는가」가 아니라 **더미가 사라졌는가**로 본다 —
  // 불 한 점만 나고 아무 일도 안 일어나는 판이 정확히 이 검사가 노리는 고장이다.
  // 폭약 셋은 한 틱에 터지고 황은 번져 타므로, 둘 다 「줄어든다」로 잡힌다.
  run(w, DEMO_TPS * 3);
  const left = count(w, id);
  check(left < piled * 0.5, `${label}: 불을 댄 뒤 더미가 사라졌다`, `${piled} → ${left}칸`);

  const ticks = spinToLoop(w, DEMO_TPS * 10);
  check(ticks > 0, `${label}: 한 바퀴 돌고 초기화됐다`);
  run(w, DEMO_TPS * 2);
  check(count(w, id) > 10, `${label}: 두 번째 바퀴에서 다시 쌓는다`, `${count(w, id)}칸`);
}

// --- 화약 -----------------------------------------------------------------------------
console.log('\n== 화약 1막: 모래 둔덕 사이에 쌓아 터뜨린다 ==');
{
  const w = make(GUNPOWDER.id);
  run(w, DEMO_TPS * 2);
  const sandAt2s = count(w, SAND.id);
  check(sandAt2s > 40, '좌우로 모래 둔덕이 쌓였다', `${sandAt2s}칸`);
  check(count(w, GUNPOWDER.id) > 20, '가운데에는 화약이 쌓인다', `${count(w, GUNPOWDER.id)}칸`);

  // 모래는 2초에 멈추고 화약만 2초 더 떨어진다 — 가운데 더미가 둔덕보다 솟아야
  // 「가운데 것이 터졌다」가 읽힌다.
  const gpAt2s = count(w, GUNPOWDER.id);
  run(w, DEMO_TPS * 2);
  check(count(w, SAND.id) <= sandAt2s, '모래는 2초에 멎었다', `${sandAt2s} → ${count(w, SAND.id)}칸`);
  const gpAt4s = count(w, GUNPOWDER.id);
  check(gpAt4s > gpAt2s, '화약은 4초까지 계속 떨어진다', `${gpAt2s} → ${gpAt4s}칸`);
  check(w.brush === null, '1막에는 브러시가 없다');

  // 5초에 점화. 1막이 7초이므로 그 안에 화약이 없어져야 한다.
  run(w, DEMO_TPS * 2);
  check(count(w, GUNPOWDER.id) < gpAt4s * 0.3, '점화하면 화약이 터진다', `${count(w, GUNPOWDER.id)}칸`);
}

console.log('\n== 화약 2막: 세 재료를 휘저어 흑색화약을 만든 뒤 터뜨린다 ==');
{
  const w = make(GUNPOWDER.id);
  // 1막 7초를 지나 2막의 첫 틱으로. 무대가 치워지고 새 줄기가 시작된다.
  run(w, DEMO_TPS * 7 + 1);
  check(w.loops === 0, '막이 바뀌는 것은 초기화가 아니다', `loops=${w.loops}`);
  check(count(w, SAND.id) === 0, '1막의 모래는 치워졌다');
  check(occupied(w) < 10, '2막은 빈 무대에서 시작한다', `${occupied(w)}칸`);

  run(w, DEMO_TPS * 2);
  for (const [label, id] of [
    ['석탄가루', COAL_POWDER.id],
    ['황', SULFUR.id],
    ['초석', SALTPETER.id],
  ] as [string, number][]) {
    check(count(w, id) > 20, `${label} 줄기가 떨어졌다`, `${count(w, id)}칸`);
  }
  check(count(w, GUNPOWDER.id) === 0, '아직 흑색화약은 없다 — 섞기 전이다');

  // 섞기 브러시. 아이콘이 붙어 있어야 「휘젓는 중」으로 읽힌다.
  w.tick();
  check(w.brush !== null && w.brush.icon === 'mix', '섞기 브러시가 나온다', `icon=${w.brush?.icon}`);
  let minX = w.grid.width;
  let maxX = 0;
  for (let i = 0; i < DEMO_TPS * 3 - 1; i++) {
    w.tick();
    if (w.brush === null) continue;
    minX = Math.min(minX, w.brush.x);
    maxX = Math.max(maxX, w.brush.x);
  }
  check(
    minX < w.grid.width * 0.15 && maxX > w.grid.width * 0.85,
    '브러시가 캔버스를 끝에서 끝까지 훑는다',
    `x=${minX}..${maxX}`,
  );

  // 휘젓기가 끝나고 격발까지 1초. **그 1초 안에서** 재야 한다 — 격발 틱을 한 번만
  // 넘겨도 만들어진 화약이 이미 터지기 시작해서, 「조합이 안 걸렸다」와 「조합은
  // 걸렸는데 이미 날아갔다」가 같은 숫자로 보인다(첫 판이 정확히 이 실수였다).
  run(w, DEMO_TPS - 2);
  check(w.brush === null, '휘젓기가 끝나면 브러시가 사라진다');
  const made = count(w, GUNPOWDER.id);
  check(made > 10, '휘저은 자리에서 흑색화약이 만들어졌다', `${made}칸`);

  // 격발. 만들어진 화약이 실제로 터진다.
  const fuelBefore = count(w, COAL_POWDER.id) + count(w, SULFUR.id) + count(w, SALTPETER.id) + made;
  run(w, DEMO_TPS * 2);
  const fuelAfter =
    count(w, COAL_POWDER.id) +
    count(w, SULFUR.id) +
    count(w, SALTPETER.id) +
    count(w, GUNPOWDER.id);
  check(fuelAfter < fuelBefore * 0.8, '격발하면 더미가 날아간다', `${fuelBefore} → ${fuelAfter}칸`);

  const ticks = spinToLoop(w, DEMO_TPS * 4);
  check(ticks > 0, '15초짜리 한 바퀴가 끝났다');
  run(w, DEMO_TPS * 2);
  check(count(w, SAND.id) > 20, '다음 바퀴는 다시 1막(모래 둔덕)부터', `${count(w, SAND.id)}칸`);
}

// 조합은 굴림이 낀다(성립 확률 0.25, 게다가 브러시가 어디를 지나느냐에 달렸다).
// 한 판만 보면 운 좋은 판을 통과로 읽으므로 여러 판의 **최악**을 본다.
console.log('\n== 화약 2막: 조합이 굴림에 관계없이 걸린다 ==');
{
  let worst = Infinity;
  for (let trial = 0; trial < 8; trial++) {
    const w = make(GUNPOWDER.id);
    run(w, DEMO_TPS * 13); // 1막 7초 + 2막의 붓기 2초 + 휘젓기 3초 + 대기 1초
    worst = Math.min(worst, count(w, GUNPOWDER.id));
  }
  check(worst > 10, '8판을 굴려도 늘 흑색화약이 생긴다', `최악의 판 ${worst}칸`);
}

// --- 질산암모늄 -------------------------------------------------------------------------
console.log('\n== 질산암모늄: 3등분한 칸에서 맨 프릴 · 암모날 · ANFO ==');
{
  const w = make(AMMONIUM_NITRATE.id);
  const gw = w.grid.width;
  const a = Math.round(gw / 3);
  const b = Math.round((gw * 2) / 3);

  // 칸막이 두 줄이 격자를 **세로로 완전히** 갈라야 한다. 한 칸이라도 뚫려 있으면
  // 프릴도 연료도 옆 칸으로 새고, 「셋을 나란히 놓고 비교한다」가 성립하지 않는다.
  let holes = 0;
  for (const x of [a, b]) {
    for (let y = 0; y < w.grid.height; y++) if (w.grid.get(x, y) !== WALL.id) holes++;
  }
  check(holes === 0, '칸막이 두 줄이 격자를 세로로 완전히 가른다', `뚫린 칸 ${holes}`);
  const wallsAtStart = count(w, WALL.id);

  run(w, DEMO_TPS * 3);
  const left = countIn(w, AMMONIUM_NITRATE.id, 0, a - 1);
  const mid = countIn(w, AMMONIUM_NITRATE.id, a + 1, b - 1);
  const right = countIn(w, AMMONIUM_NITRATE.id, b + 1, gw - 1);
  check(left > 30 && mid > 30 && right > 30, '세 칸에 같은 프릴이 쌓였다', `${left}/${mid}/${right}칸`);

  // 1초 대기 뒤 연료 2초 — 가운데엔 알루미늄 가루, 오른쪽엔 등유. 왼쪽은 그대로.
  run(w, DEMO_TPS * 3);
  check(
    countIn(w, ALUMINUM_POWDER.id, a + 1, b - 1) + countIn(w, AMMONAL.id, a + 1, b - 1) > 0,
    '가운데 칸에만 알루미늄 가루가 들어갔다',
    `왼쪽 ${countIn(w, ALUMINUM_POWDER.id, 0, a - 1)}칸`,
  );
  check(
    countIn(w, KEROSENE.id, b + 1, gw - 1) + countIn(w, ANFO.id, b + 1, gw - 1) > 0,
    '오른쪽 칸에만 등유가 들어갔다',
    `왼쪽 ${countIn(w, KEROSENE.id, 0, a - 1)}칸`,
  );

  // 휘젓기 2초. 브러시는 **아래쪽 절반**에만 있어야 한다.
  let above = 0;
  let sawBrush = false;
  for (let i = 0; i < DEMO_TPS * 2; i++) {
    w.tick();
    if (w.brush === null) continue;
    sawBrush = true;
    if (w.brush.icon !== 'mix') above = -1;
    if (w.brush.y < w.grid.height * 0.5) above++;
  }
  check(sawBrush && above === 0, '섞기 브러시가 아래쪽 절반만 훑는다', `벗어난 틱 ${above}`);

  // 연료가 더미 속으로 들어가 두 물질이 실제로 만들어진다.
  const ammonal = countIn(w, AMMONAL.id, a + 1, b - 1);
  const anfo = countIn(w, ANFO.id, b + 1, gw - 1);
  check(ammonal > 10, '가운데 칸이 암모날이 됐다', `${ammonal}칸`);
  check(anfo > 5, '오른쪽 칸이 ANFO 가 됐다', `${anfo}칸`);

  // **왼쪽 칸은 맨 프릴 그대로다.** 이게 이 장면의 대조군이고, 칸막이가 휘젓기를
  // 막아 준다는 증거이기도 하다(`mixCells` 는 고체를 못 넘는다).
  check(
    countIn(w, AMMONAL.id, 0, a - 1) === 0 && countIn(w, ANFO.id, 0, a - 1) === 0,
    '왼쪽 칸에는 아무것도 안 섞였다',
    `프릴 ${countIn(w, AMMONIUM_NITRATE.id, 0, a - 1)}칸`,
  );

  // 1초 대기 뒤 셋 동시 격발. 세 칸이 다 비워져야 한다 — 한 칸만 남으면 불이
  // 엉뚱한 데(칸막이 꼭대기)에 붙었다는 뜻이다.
  run(w, DEMO_TPS * 3);
  const rest = [
    countIn(w, AMMONIUM_NITRATE.id, 0, a - 1),
    countIn(w, AMMONAL.id, a + 1, b - 1) + countIn(w, AMMONIUM_NITRATE.id, a + 1, b - 1),
    countIn(w, ANFO.id, b + 1, gw - 1) + countIn(w, AMMONIUM_NITRATE.id, b + 1, gw - 1),
  ];
  check(rest.every((n) => n < 10), '세 칸이 같이 터졌다', `남은 것 ${rest.join('/')}칸`);
  check(count(w, WALL.id) === wallsAtStart, '칸막이는 폭발을 견딘다', `${count(w, WALL.id)}칸`);

  const ticks = spinToLoop(w, DEMO_TPS * 4);
  check(ticks > 0, '한 바퀴 돌고 초기화됐다');
  check(count(w, WALL.id) === wallsAtStart, '초기화 후에도 칸막이는 그대로');
}

// --- 정지 화면 -------------------------------------------------------------------------
console.log('\n== 움직임 최소화: 감아 둔 한 프레임이 빈 화면이 아니다 ==');
{
  // basics 의 여섯과 같은 이유(test/guidedemo.ts) — 다만 여기서는 한 가지가 더
  // 걸린다. 이 넷은 **폭발로 끝나는** 장면이라, 정지 지점을 잘못 잡으면 크레이터가
  // 남은 빈 칸을 한 장 그리게 된다. 전부 터지기 직전에 멈추도록 잡아 뒀다.
  for (const id of customDemoMaterials()) {
    const w = make(id);
    w.windToStill();
    check(
      w.loops === 0 && occupied(w) > 20 && count(w, FIRE.id) === 0,
      `${getMaterial(id).name}: 정지 화면이 터지기 직전의 더미다`,
      `loops=${w.loops}, ${occupied(w)}칸, 불 ${count(w, FIRE.id)}칸`,
    );
  }
}

// --- 리사이즈 ---------------------------------------------------------------------------
console.log('\n== 창 크기가 바뀌면 장면을 다시 세운다 ==');
{
  const w = make(AMMONIUM_NITRATE.id);
  run(w, DEMO_TPS * 3);
  w.resize(60, 40);
  check(w.grid.width === 60 && w.grid.height === 40, '격자가 새 크기가 됐다');
  check(count(w, AMMONIUM_NITRATE.id) === 0, '다시 세우면서 프릴이 비워졌다');
  check(count(w, WALL.id) === 80, '새 크기에 맞춰 칸막이가 다시 세워졌다', `${count(w, WALL.id)}칸`);
  run(w, DEMO_TPS * 3);
  check(count(w, AMMONIUM_NITRATE.id) > 30, '새 크기에서도 세 칸이 찬다');
}

console.log(failures === 0 ? '\n전부 통과' : `\n${failures}건 실패`);
if (failures > 0) process.exit(1);
