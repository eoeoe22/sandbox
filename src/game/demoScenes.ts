// 어떤 물질 카드가 **맞춤 연출**을 받는가, 그리고 그 연출에 누가 함께 서는가.
//
// `guideDemo.ts` 는 장면을 **어떻게** 도는지만 안다(대본·박자·손놀림). 그 대본이
// 어떤 물질에 붙는지는 여기가 정한다. 둘을 가른 것은 취향이 아니라 **번들 경계**다:
//
//   - `guideDemo.ts` 는 basics 탭(`/guide?tab=basics`)의 여섯 캔버스도 쓰므로
//     경량 물질 배럴(`materials/demo`, 9종)만 본다. 거기서 산·화약·질산암모늄을
//     이름으로 집으면 가이드 문서를 여는 사람이 폭발·부식 계통을 통째로 받는다.
//   - 이 파일은 반대로 **전체 배럴을 이미 들고 있는 쪽**에서만 로드된다. 물질
//     카드의 데모는 어차피 카드의 실제 물질을 그려야 해서 전체 배럴을 동적으로
//     끌어오고(docs/CODEX.md §14.3), 이 표는 그 청크에 얹힌다.
//
// 그래서 장면 코드가 모르는 물질은 `DemoCast` 라는 배역표로 건너간다. 표를 채우는
// 것은 여기 한 곳뿐이라, 새 맞춤 연출을 붙이는 일은 대본 하나와 이 표 한 줄이다.
//
// **배정하지 않은 물질은 지금까지 그대로** 상태별 기본 데모(고체·가루·액체·기체)를
// 받는다. 맞춤 연출은 「이 물질만 할 수 있는 이야기가 있는가」로 고른 것이고,
// 폭약이라는 이유만으로 붙이지는 않았다.

import type { DemoCast, DemoTrigger, GuideDemoKind } from './guideDemo';

import { ACID } from './materials/acid';
import { ALCOHOL } from './materials/alcohol';
import { ALUMINUM_POWDER } from './materials/aluminumpowder';
import { AMBER } from './materials/amber';
import { AMMONAL } from './materials/ammonal';
import { AMMONIUM_NITRATE } from './materials/ammoniumnitrate';
import { ANFO } from './materials/anfo';
import { BROKEN_GLASS } from './materials/brokenglass';
import { COAL } from './materials/coal';
import { COAL_POWDER } from './materials/coalpowder';
import { DIESEL } from './materials/diesel';
import { DIAMOND } from './materials/diamond';
import { FIREWORKS } from './materials/fireworks';
import { FLASH_POWDER } from './materials/flashpowder';
import { GASOLINE } from './materials/gasoline';
import { GLASS } from './materials/glass';
import { GUNPOWDER } from './materials/gunpowder';
import { HYDROGEN } from './materials/hydrogen';
import { IRON } from './materials/iron';
import { KEROSENE } from './materials/kerosene';
import { LPG } from './materials/lpg';
import { METHANE } from './materials/methane';
import { NITRO } from './materials/nitro';
import { OIL } from './materials/oil';
import { OXYGEN } from './materials/oxygen';
import { RESIN } from './materials/resin';
import { ROCKET_CANDY } from './materials/rocketcandy';
import { SALTPETER } from './materials/saltpeter';
import { SAWDUST } from './materials/sawdust';
import { SULFUR } from './materials/sulfur';
import { HEATPIPE } from './materials/heatpipe';
import { SOAP } from './materials/soap';
import { SOAPY_WATER } from './materials/soapywater';
import { VIRUS } from './materials/virus';
import { WOOD } from './materials/wood';

/** 한 물질에 배정된 연출: 어떤 대본을, 누구와 함께, 무엇으로 격발해서. */
export interface GuideDemoScene {
  readonly kind: GuideDemoKind;
  readonly cast: DemoCast;
  readonly trigger: DemoTrigger;
}

/**
 * 배역표는 **한 벌**이다. 장면마다 쓰는 칸이 다르지만(산은 `floor` 만, 화약은
 * `recipe` 만) 표를 장면 수만큼 두면 같은 물질 id 가 여러 곳에 적히고, 그중
 * 하나만 고쳐지는 날이 온다. 어차피 이 파일은 전체 배럴을 들고 있으므로 다 채워
 * 두고 장면이 자기 칸만 읽는 편이 싸다.
 *
 * 모듈 스코프에서 `.id` 를 읽는 것이 안전한 이유: 이 모듈은 **잎**이다(아무도
 * import 하지 않는다). 물질 파일들끼리의 순환 import 함정(coalpowder.ts 의
 * `mixIds` 주석)은 서로 물고 있는 모듈 사이의 이야기이고, 여기는 그 그래프가 전부
 * 평가된 뒤에야 평가된다.
 */
const CAST: DemoCast = {
  // 산이 갉을 바닥. 철은 수소를 내며 녹는 금속이라(`acidHydrogen`) 구멍이 뚫리는
  // 동안 기포가 같이 올라온다 — 돌이었으면 그냥 조용히 사라진다.
  floor: IRON.id,
  // 흑색화약 조합의 세 재료. 왼쪽부터 떨어지는 순서다.
  recipe: [COAL_POWDER.id, SULFUR.id, SALTPETER.id],
  // 질산암모늄에 먹일 두 연료 — 가운데 칸이 암모날, 오른쪽 칸이 ANFO 가 된다.
  fuels: [ALUMINUM_POWDER.id, KEROSENE.id],
  // 비눗물 웅덩이에 부을 세척 대상 둘 — 바이러스·휘발유.
  soapyCleaners: [VIRUS.id, GASOLINE.id],
};

/**
 * 물질 id → 대본.
 */
const SCENES: ReadonlyMap<number, GuideDemoKind> = new Map<number, GuideDemoKind>([
  [ACID.id, 'acid'],
  [GUNPOWDER.id, 'gunpowder'],
  [AMMONIUM_NITRATE.id, 'ammoniumnitrate'],
  [FLASH_POWDER.id, 'ignite'],
  [FIREWORKS.id, 'ignite'],
  [SULFUR.id, 'gunpowder'],
  [NITRO.id, 'ignite'],

  // Group 1: 암모날, ANFO, 로켓캔디, 메탄
  [AMMONAL.id, 'ignite'],
  [ANFO.id, 'ignite'],
  [ROCKET_CANDY.id, 'ignite'],
  [METHANE.id, 'ignite'],

  // Group 2: 원유, 휘발유, 경유, 등유, LPG, 톱밥, 레진
  [OIL.id, 'open_ignite'],
  [GASOLINE.id, 'open_ignite'],
  [DIESEL.id, 'open_ignite'],
  [KEROSENE.id, 'open_ignite'],
  [LPG.id, 'open_ignite'],
  [SAWDUST.id, 'open_ignite'],
  [RESIN.id, 'open_ignite'],

  // Group 3: 석탄, 나무, 호박
  [COAL.id, 'brush_ignite'],
  [WOOD.id, 'brush_ignite'],
  [AMBER.id, 'brush_ignite'],

  // Group 4: 유리, 깨진 유리
  [GLASS.id, 'glass_shockwave'],
  [BROKEN_GLASS.id, 'glass_shockwave'],

  // Group 5: 산소, 수소
  [OXYGEN.id, 'hydrogen_oxygen'],
  [HYDROGEN.id, 'hydrogen_oxygen'],

  // Group 6: 다이아몬드, 히트파이프, 비누, 비눗물
  [DIAMOND.id, 'wall'],
  [HEATPIPE.id, 'heat'],
  [SOAP.id, 'saltwater'],
  [SOAPY_WATER.id, 'soapywater'],
  [SALTPETER.id, 'saltpeter'],
  [ALCOHOL.id, 'alcohol'],
]);

/**
 * 기본(불)이 아닌 격발 방식을 쓰는 물질. 적히지 않은 물질은 전부 불이다.
 *
 * **섬광화약만 전기다.** 이 물질이 보여 줄 것은 순백색 섬광 한 장인데, 앞에 1초짜리
 * 주황색 불꽃이 서 있으면 눈이 그걸 먼저 먹고 정작 섬광은 「그 불이 밝아진 것」으로
 * 읽힌다. 전기로 찌르면 아크가 곁에 불씨 한 칸을 앉히고 다음 틱에 터지므로
 * (spark.ts 의 `tryArcExplosive`) 화면에 남는 주황색이 한 틱짜리 한 칸뿐이다.
 *
 * 나머지 여섯이 불인 것도 이유가 있다. 황은 전기로 안 붙고(전기는 평범한 연료를
 * 점화하지 않는다 — 같은 함수의 주석), 불꽃놀이 화약·니트로는 불꽃이 터지기 전의
 * **도화선 그림**으로 읽혀 오히려 어울린다.
 */
const TRIGGERS: ReadonlyMap<number, DemoTrigger> = new Map<number, DemoTrigger>([
  [FLASH_POWDER.id, 'spark'],
]);

/**
 * 이 물질에 배정된 맞춤 연출, 없으면 `null`.
 *
 * `null` 은 실패가 아니라 **기본값으로 가라**는 뜻이다 — 호출자(`Codex.svelte`)는
 * 그때 물질의 상(phase)으로 상태 4종 데모를 고른다.
 */
export function demoSceneFor(id: number): GuideDemoScene | null {
  const kind = SCENES.get(id);
  return kind === undefined ? null : { kind, cast: CAST, trigger: TRIGGERS.get(id) ?? 'fire' };
}

/** 맞춤 연출이 배정된 물질 id 전부. 검사가 표를 전수로 훑는 창구다. */
export function customDemoMaterials(): readonly number[] {
  return [...SCENES.keys()];
}
