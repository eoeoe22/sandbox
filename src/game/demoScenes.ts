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

import type { DemoCast, GuideDemoKind } from './guideDemo';

import { ACID } from './materials/acid';
import { ALUMINUM_POWDER } from './materials/aluminumpowder';
import { AMMONIUM_NITRATE } from './materials/ammoniumnitrate';
import { COAL_POWDER } from './materials/coalpowder';
import { FIREWORKS } from './materials/fireworks';
import { FLASH_POWDER } from './materials/flashpowder';
import { GUNPOWDER } from './materials/gunpowder';
import { IRON } from './materials/iron';
import { KEROSENE } from './materials/kerosene';
import { NITRO } from './materials/nitro';
import { SALTPETER } from './materials/saltpeter';
import { SULFUR } from './materials/sulfur';

/** 한 물질에 배정된 연출: 어떤 대본을, 누구와 함께. */
export interface GuideDemoScene {
  readonly kind: GuideDemoKind;
  readonly cast: DemoCast;
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
};

/**
 * 물질 id → 대본.
 *
 * 넷뿐이고 그중 `ignite` 하나가 넷을 겸한다. 「3초 붓고 1초 뒤 불을 댄다」는
 * 대본이 섬광화약·불꽃놀이 화약·황·니트로에 그대로 맞는 것은 이 넷이 **혼자서
 * 완결되는** 물질이기 때문이다 — 쌓아 놓고 불만 대면 각자의 성격(백색 섬광 /
 * 별이 흩어지는 소이 / 낮게 번지는 유황불 / 한 틱에 통째로 가는 액체)이 그대로
 * 나온다. 준비물이 필요한 물질(화약의 조합, 질산암모늄의 연료)만 자기 대본을 갖는다.
 */
const SCENES: ReadonlyMap<number, GuideDemoKind> = new Map<number, GuideDemoKind>([
  [ACID.id, 'acid'],
  [GUNPOWDER.id, 'gunpowder'],
  [AMMONIUM_NITRATE.id, 'ammoniumnitrate'],
  [FLASH_POWDER.id, 'ignite'],
  [FIREWORKS.id, 'ignite'],
  [SULFUR.id, 'ignite'],
  [NITRO.id, 'ignite'],
]);

/**
 * 이 물질에 배정된 맞춤 연출, 없으면 `null`.
 *
 * `null` 은 실패가 아니라 **기본값으로 가라**는 뜻이다 — 호출자(`Codex.svelte`)는
 * 그때 물질의 상(phase)으로 상태 4종 데모를 고른다.
 */
export function demoSceneFor(id: number): GuideDemoScene | null {
  const kind = SCENES.get(id);
  return kind === undefined ? null : { kind, cast: CAST };
}

/** 맞춤 연출이 배정된 물질 id 전부. 검사가 표를 전수로 훑는 창구다. */
export function customDemoMaterials(): readonly number[] {
  return [...SCENES.keys()];
}
