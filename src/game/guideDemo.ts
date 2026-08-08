// 가이드 문서(`/guide?tab=basics`)의 예시 장면들. 스크린샷 자리에 **진짜 엔진**을
// 끼워 넣은 것으로, 시작 화면(`startScreen.ts`)과 같은 구조를 따른다: 세계는 여기,
// 캔버스·RAF·가시성은 `components/GuideDemo.svelte`.
//
// 장면은 열이고, 앞의 여섯이 basics 문서의 여섯 자리에 하나씩 붙는다.
//
//   solid   브러시가 캔버스 가운데에 돌로 선을 하나 긋고, 지웠다가 다시 긋는다.
//   powder  모래가 위에서 한 줄기로 떨어져 더미를 쌓는다. 초기화 없이 계속.
//   liquid  벽으로 만든 그릇에 물이 떨어져 넘칠 때까지 차고, 초기화 후 반복.
//   gas     맨 아래에서 연기가 계속 올라온다. 초기화 없음.
//   overlap 바닥에서 약간 띄운 자리에 체를 한 줄 그은 뒤, 그 위에 모래 더미를
//           쌓는다. 위에서 물을 부으면 물은 모래 사이를 스며내려 체를 통과해
//           아래로 빠져나온다 — 고체(체)와 가루(모래)를 뚫고 액체가 지나간다.
//   heat    가로로 놓인 히트파이프 띠를 그 아래의 불 Clone 이 한쪽 끝부터 달군다.
//
// 나머지 넷은 **특정 물질의 카드에만** 붙는 맞춤 연출이다(§14.4 가 후속으로
// 미뤄 뒀던 것). 어떤 물질이 어떤 연출을 받는지는 여기가 아니라 `demoScenes.ts`
// 가 정한다 — 그 표만 전체 물질 배럴을 알고, 이 파일은 여전히 경량 배럴
// (`materials/demo`)만 본다. 이 파일이 모르는 물질은 `DemoCast` 로 건네받는다.
//
//   acid            아래쪽에 네 줄 두께의 금속 바닥, 위에서 산 줄기. 바닥이 갉여 뚫린다.
//   ignite          3초 줄기 낙하 → 1초 대기 → 점화(불, 섬광화약만 전기).
//                   섬광화약·불꽃놀이 화약·황·니트로가 이 대본을 나눠 쓴다.
//   gunpowder       두 막짜리. 1막은 좌우 모래 둔덕 사이에 화약을 쌓아 터뜨리고,
//                   2막은 석탄가루·황·초석 세 줄기를 섞기 브러시로 휘저어
//                   흑색화약을 만든 뒤 터뜨린다.
//   ammoniumnitrate 벽으로 3등분한 칸에 각각 질산암모늄을 쌓고, 가운데·오른쪽에만
//                   알루미늄 가루·등유를 부어 휘저은 뒤 셋을 동시에 격발한다 —
//                   맨 프릴 / 암모날 / ANFO 의 위력 차이가 한 화면에 나란히 선다.
//
// **여기 있는 것은 브라우저 없이 검증할 수 있는 부분 전부다** — 장면 배치, 틱
// 단위 대본, 넘침 판정, 열 뷰 전환 시점. 컴포넌트에 남는 것은 캔버스 크기에서
// 격자 크기를 얻는 일과 브러시 원을 화면 좌표로 옮기는 일뿐이다.
// 검증은 `npm run test:guidedemo`.

import { Grid } from './engine/Grid';
import { Simulation } from './engine/Simulation';
import { mixCells, sparkCells } from './engine/brushTools';
import { Phase, EMPTY, type BorderMode } from './engine/types';
import { TICK_HZ } from './config';
import { getMaterial } from './materials/registry';
import {
  DEMO_WALL,
  DEMO_STONE,
  DEMO_MESH,
  DEMO_SAND,
  DEMO_WATER,
  DEMO_SMOKE,
  DEMO_HEATPIPE,
  DEMO_FIRE,
  DEMO_CLONE,
  DEMO_TNT,
  DEMO_ACID,
  DEMO_LAVA,
  DEMO_OBSIDIAN,
  DEMO_SALT,
  DEMO_SUGAR,
  DEMO_SODA,
  DEMO_BATTER,
  DEMO_MOLTEN_URANIUM,
  DEMO_SOAP,
  DEMO_SOAPY_WATER,
  DEMO_CARAMEL,
  DEMO_ALCOHOL,
  DEMO_ACID_VAPOR,
} from './materials/demo';
import { GLASS } from './materials/glass';
import { HYDROGEN } from './materials/hydrogen';
import { OXYGEN } from './materials/oxygen';
import { fireShockwave } from './materials/woofer';


// --- 박자 ---------------------------------------------------------------------
// 본 게임 기본 속도(×1)와 같은 스텝 간격. 대본의 "1초" 는 전부 DEMO_TPS 틱이다.

/** ×1에서의 고정 스텝 간격(ms). Game.ts·시작 화면과 같은 식. */
export const DEMO_STEP_MS = 2000 / TICK_HZ;
/** 초당 틱 수(30). 대본의 초 단위 길이를 틱으로 옮길 때 쓴다. */
export const DEMO_TPS = Math.round(1000 / DEMO_STEP_MS);

/** 연기 양은 본 게임 기본값과 같은 중간 단계. */
const DEMO_SMOKE_LEVEL = 'medium' as const;

// --- 장면 목록 -----------------------------------------------------------------

export type GuideDemoKind =
  | 'solid'
  | 'powder'
  | 'liquid'
  | 'gas'
  | 'overlap'
  | 'heat'
  // 물질 카드에만 붙는 맞춤 연출. basics 문서는 이 아홉을 쓰지 않는다.
  // 두 라운드에서 각각 붙었고(§15 / §16) 구조가 다르다 — 아래 다섯은 대본이 놓는
  // 물질을 경량 배럴에서 이름으로 집고, 위 넷은 `DemoCast` 로 건네받는다.
  | 'wall'
  | 'obsidian'
  | 'saltwater'
  | 'sugarwater'
  | 'soda'
  | 'acid'
  | 'ignite'
  | 'gunpowder'
  | 'ammoniumnitrate'
  | 'open_ignite'
  | 'brush_ignite'
  | 'glass_shockwave'
  | 'hydrogen_oxygen'
  | 'soapywater'
  | 'saltpeter'
  | 'alcohol'
  | 'acidvapor';

/** 장면 목록. 문서가 붙이는 순서이자 검사가 훑는 순서다. 뒤의 다섯(wall·obsidian·
 *  saltwater·sugarwater·soda)은 basics 문서에 붙지 않는 **물질별 맞춤 데모**로,
 *  카드가 열릴 때만 보인다. 검사의 세워짐/정지화면 루프가 같은 목록을 훑으므로 여기
 *  있어야 검증도 빠지지 않는다.
 *
 *  `DemoCast` 가 필요한 넷(acid·ignite·gunpowder·ammoniumnitrate)은 여기 **없다** —
 *  배역표 없이 세우면 아무것도 안 하는 장면이 되므로 그 넷은 `CUSTOM_DEMO_KINDS` 와
 *  전용 하네스(`test/demoscenes.ts`)가 맡는다. */
export const GUIDE_DEMO_KINDS: readonly GuideDemoKind[] = [
  'solid',
  'powder',
  'liquid',
  'gas',
  'overlap',
  'heat',
  'wall',
  'obsidian',
  'saltwater',
  'sugarwater',
  'soda',
];

/** 맞춤 연출 목록. 문서에는 안 붙고 `demoScenes.ts` 가 물질에 배정한다. */
export const CUSTOM_DEMO_KINDS: readonly GuideDemoKind[] = [
  'acid',
  'ignite',
  'gunpowder',
  'ammoniumnitrate',
  'open_ignite',
  'brush_ignite',
  'glass_shockwave',
  'hydrogen_oxygen',
  'soapywater',
  'saltpeter',
  'alcohol',
  'acidvapor',
];

/**
 * 맞춤 연출의 **조연 물질 id**.
 *
 * 이 파일은 경량 배럴(`materials/demo`)만 import 한다 — basics 탭이 같은 모듈을
 * 로드하므로(§13.6) 여기서 화약·질산암모늄을 이름으로 집으면 가이드 문서를 여는
 * 사람이 그 반응 그래프를 통째로 내려받게 된다. 그래서 장면 코드는 **주인공
 * (`subjectId`)과 이 배역표에서만** 물질을 얻고, 표를 채우는 것은 전체 배럴을 이미
 * 들고 있는 `demoScenes.ts` 다.
 *
 * 위의 다섯 장면(wall·obsidian·…)은 반대로 쓰는 물질을 그 경량 배럴에 이름으로
 * 들여놓았다 — 두 방식이 나란히 있는 이유는 CODEX.md §16.1 에 적어 뒀다.
 *
 * 값이 없으면 그 장면은 아무것도 하지 않는다(빈 네모). 프로그래밍 실수이지
 * 런타임에 생길 수 있는 상태가 아니라서 검사 쪽에서 잡는다 —
 * `test/demoscenes.ts` 가 네 장면을 모두 배역표와 함께 돌려 본다.
 */
/**
 * 격발 장면이 **무엇으로** 불을 붙이는가.
 *
 * - `'fire'`(기본) — 더미 봉우리에 불을 댄다. 라이터를 갖다 대는 그림이고,
 *   폭약이든 연료든 다 받는다.
 * - `'spark'` — 전기 브러시로 더미를 찌른다(게임의 전기 도구와 같은 `sparkCells`).
 *   **섬광화약**이 이걸 쓴다. 그 물질의 볼거리는 순백색 섬광 한 장인데, 앞에
 *   1초짜리 주황색 불꽃이 서 있으면 그게 눈을 다 먹는다. 전기로 찌르면 아크가
 *   곁에 불씨 한 칸을 앉히고 **다음 틱에** 터지므로(spark.ts 의 `tryArcExplosive`),
 *   화면에 남는 것은 사실상 섬광뿐이다.
 */
export type DemoTrigger = 'fire' | 'spark';

export interface DemoCast {
  /** `acid` — 산이 갉아먹을 바닥 금속(여러 줄 두께, 철). */
  readonly floor: number;
  /** `gunpowder` 2막 — 흑색화약 조합의 세 재료. 배열 순서가 왼쪽부터의 줄기 순서다. */
  readonly recipe: readonly [number, number, number];
  /** `ammoniumnitrate` — 가운데·오른쪽 칸에 부을 연료 둘(알루미늄 가루·등유). */
  readonly fuels: readonly [number, number];
  /** `soapywater` 2막 — 비눗물 웅덩이에 부을 바이러스·휘발유 둘. */
  readonly soapyCleaners?: readonly [number, number];
}

export interface GuideDemoSpec {
  /**
   * 격자 가로 칸 수. 캔버스 폭이 얼마든 **칸 수는 고정**이고 칸 크기가 따라
   * 변한다(컴포넌트가 `cellScale = 폭 / (CELL_PX × cols)` 로 맞춘다). 화면이
   * 넓어질수록 장면이 커지는 대신 대본이 흔들리는 일이 없다.
   */
  cols: number;
  /** 캔버스의 가로:세로. 세로 칸 수는 이 비에서 따라 나온다(대략 `cols / aspect`). */
  aspect: number;
  /** 테두리. 전부 벽이다 — 데모는 좁아서 열린 테두리면 장면이 곧장 빠져나간다. */
  borderMode: BorderMode;
}

export const GUIDE_DEMO_SPECS: Record<GuideDemoKind, GuideDemoSpec> = {
  // 물질 상태 카드 넷은 카드 폭(좁다)에 들어가므로 칸 수를 적게 잡아 알갱이를 굵게.
  solid: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  powder: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  liquid: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  gas: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  // 겹침·열전도는 절 전체 폭을 쓰는 가로로 긴 띠다. 폭이 카드의 네 배쯤 되는데도
  // 칸 수를 비슷하게 두는 것은 **칸을 굵게 보여 주기 위해서다** — 겹침은 한 칸
  // 안에 두 물질이 들어 있다는 이야기이고, 열전도는 칸 하나하나의 색이 곧
  // 온도라서, 알갱이가 점으로 보이면 둘 다 아무것도 안 보인다.
  overlap: { cols: 56, aspect: 2, borderMode: 'wall' },
  // 파이프 길이는 열이 **끝까지 가는 것이 7초 안에 보이는** 선에서 정했다. 40칸
  // 남짓이 그 길이다: 90칸이면 5초 뒤에도 반대쪽 끝이 상온이라 열지도가 절반만
  // 칠해진 채 초기화된다(실측 — 90칸 24℃ / 56칸 142℃).
  //
  // 화면비에는 **아래쪽 여유**라는 조건이 하나 더 붙는다. 파이프 한가운데 아래로
  // `(PIPE_THICK-1)/2 + FIREBOX_GAP + FIREBOX_H` = 1+1+3 = **5줄**이 더 있어야
  // 하고, 모자라면 `buildPipe` 가 불 덩어리를 조용히 잘라 낸다 — 예외도 안 나고
  // **불만 사라진 열전도 데모**가 된다. 지금은 56/3 → 18줄(`layout.ts` 의
  // `deriveGrid` 가 내림한다. 검사 하네스는 반올림해 19줄로 잡지만 여유는 같다)에
  // 한가운데가 0.45 → 8줄이라 9줄이 남는다. 이 여유가 깨지면 검사의 「불 Clone 이
  // 덩어리로 놓였다」가 잡는다.
  heat: { cols: 56, aspect: 3, borderMode: 'wall' },
  // 물질별 맞춤 데모는 다단계 타임라인이라 폭이 넉넉한 가로장면이 낫다. 겹침 데모와
  // 같은 56칸·2:1 비율 — 폭이 충분해야 TNT 폭발·핵광·산 줄기가 한 장면에 들어온다.
  wall: { cols: 56, aspect: 2, borderMode: 'wall' },
  obsidian: { cols: 56, aspect: 2, borderMode: 'wall' },
  saltwater: { cols: 56, aspect: 2, borderMode: 'wall' },
  sugarwater: { cols: 56, aspect: 2, borderMode: 'wall' },
  soda: { cols: 56, aspect: 2, borderMode: 'wall' },

  // 뒤의 넷은 반대로 **상태 4종 카드와 같은 칸**을 쓴다. 이 장면들은 한 자리에서
  // 쌓고 터뜨리는 세로 구도라 가로 폭이 남아돌고, 카드 안에서 데모 자리의 높이가
  // 물질마다 달라지면 카드를 넘겨 볼 때 설명문 아래가 들썩인다.
  //
  // 폭발이 이 칸을 넘치는 것은 사고가 아니라 결론이다 — 암모날·ANFO 는 쌓인
  // 질량만큼 반경이 자라므로(blast.ts 의 √-법칙) 3초어치 더미면 52×34 를 통째로
  // 덮는다. 칸을 키워 크레이터 모양을 담는 대신, 「이 물질은 이만큼 세다」가
  // 화면을 꽉 채우는 쪽을 고른 것이다.
  acid: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  ignite: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  gunpowder: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  ammoniumnitrate: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  open_ignite: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  brush_ignite: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  glass_shockwave: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  hydrogen_oxygen: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  soapywater: { cols: 56, aspect: 2, borderMode: 'wall' },
  saltpeter: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  alcohol: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
  acidvapor: { cols: 52, aspect: 3 / 2, borderMode: 'wall' },
};

/**
 * 움직임 최소화(prefers-reduced-motion)에서 대신 보여 줄 **정지 화면**을 어디까지
 * 감을지. 애니메이션을 아예 안 돌리는 대신, 대본이 할 말을 다 한 시점까지 한 번
 * 돌린 결과를 한 프레임 그리고 멈춘다 — 빈 네모를 남기는 것보다 낫고, 스스로
 * 움직이는 것은 하나도 없다.
 *
 * 다섯은 대본 길이보다 짧게 잡은 **목표 지점**이고, 액체만 성격이 다르다 —
 * 거기서는 이 값이 목표가 아니라 **안전 상한**이고 실제로 멈추는 자리는 넘친
 * 순간이다(`windToStill`).
 */
export const GUIDE_DEMO_STILL_TICKS: Record<GuideDemoKind, number> = {
  solid: 65, // 선을 다 그은 직후 (대본 90틱, 드래그가 60틱에 끝난다)
  powder: 150, // 더미가 앉은 뒤 (초기화 없음)
  liquid: 400, // 상한만. 실제로는 넘친 순간에 멈춘다 — 실측 209~223틱
  gas: 90, // 연기 기둥이 자리를 잡은 뒤 (초기화 없음)
  overlap: 420, // 물이 체를 통과해 아래로 고인 뒤 (대본 450틱, 물 구간이 360틱에 끝난다)
  heat: 200, // 열 뷰로 넘어가 기울기가 다 보이는 무렵 (대본 210틱)
  // 물질별 맞춤 데모 — 각 대본의 첫 액트 결론이 보이는 틱. 대본 상수 정의 아래 참고.
  wall: 200, // U235 울타리 배치 후 임계 폭주가 일어나는 무렵 (대본 wall 9초/270틱)
  obsidian: 240, // 흑요석이 급냉으로 생성되는 액트1 결론 (대본 obsidian 약 13초/390틱)
  saltwater: 150, // 물 그릇에 소금 줄기가 떨어져 섞이는 무렵 (대본 7초/210틱)
  sugarwater: 150, // 소금물과 동일
  soda: 210, // 산 웅덩이에 소다가 떨어져 중화되는 무렵 (대본 10초/300틱)

  // 배역표가 딸린 넷은 전부 **터지기 직전**에 멈춘다. 폭발 뒤의 크레이터가 이
  // 장면들의 결론이기는 해도, 정지 화면 한 장으로는 「무엇이 어떻게 터졌는지」가
  // 아니라 「뭔가 부서진 자리」로만 읽힌다. 쌓인 더미(그리고 그 옆에 뭘 부었는지)가
  // 한 장으로 훨씬 많은 것을 말한다.
  acid: 240, // 산이 바닥을 다 뚫고 아래로 고인 뒤 (대본 270틱)
  ignite: 145, // 3초 생성 + 2초 대기 후 점화(150틱) 직전
  gunpowder: 120, // 1막에서 모래 둔덕 사이에 화약이 다 쌓인 순간 (점화 150틱)
  ammoniumnitrate: 175, // 세 칸에 연료까지 부은 뒤, 휘젓기 직전 (대본 360틱)
  open_ignite: 85, // 3초 생성 후 점화 직전
  brush_ignite: 40, // 브러시 배치 후 점화 직전
  glass_shockwave: 25, // 유리 배치 후 충격파 직전
  hydrogen_oxygen: 145, // 수소+산소 3초 생성 후 2초 대기, 점화 직전
  soapywater: 360, // 비눗물 웅덩이에 바이러스·휘발유가 투입된 2막 무렵
  saltpeter: 140, // 1막 초석 더미가 다 쌓인 직후, 점화 직전
  alcohol: 115, // 알코올 웅덩이에 바이러스 소독 직후, 점화 직전
  acidvapor: 150, // 중앙 철 바닥에 산 증기가 솟구쳐 뚫기 시작하는 무렵
};

// --- 대본 길이(틱) --------------------------------------------------------------

/**
 * 브러시가 한 번 지나가는 대본: 나타나 0.5초 대기 → 1.5초 드래그 → 1초 대기.
 * 고체 데모에서는 이것이 한 바퀴 전부이고, 겹침 데모에서는 모래·물 **앞**에
 * 끼는 한 구간이다(체 선을 깐다). 두 데모가 **같은 손놀림**을 쓰도록 상수도
 * 대본도 한 벌만 둔다.
 *
 * 드래그 길이는 연출이 아니라 **선이 꽉 차는가**가 정한다. 반지름 2 인 원판은
 * 가장자리 줄(`dy = ±2`)이 `dx = 0` 한 칸뿐이라, 그 줄에 칠해지는 것은 브러시
 * 중심이 실제로 밟은 칸들뿐이다. 1초(30틱)에 36칸을 가면 틱마다 1.2칸씩 뛰어
 * 중심이 건너뛴 칸이 생기고, 그 자리가 선의 위아래 가장자리에 **패인 자국**으로
 * 남는다(가운데 줄은 다섯 칸 굵기라 멀쩡해서 더 눈에 띈다).
 *
 * 그래서 한 틱에 **한 칸을 못 넘게** 잡는다 — 45틱에 36칸이면 0.8칸/틱이고,
 * 반올림은 단조라 걸음이 1칸 미만이면 건너뛰는 칸이 없다. 폭이 52칸으로 고정인
 * 덕에(§13.3) 이 여유는 화면 크기와 무관하게 유지된다. 검사는 이 산수가 아니라
 * 결과 — 「모든 줄이 끊김 없이 이어졌는가」 — 를 본다.
 */
const BRUSH_HOLD_IN = Math.round(DEMO_TPS * 0.5);
const BRUSH_DRAG = Math.round(DEMO_TPS * 1.5);
const BRUSH_HOLD_OUT = DEMO_TPS;
const BRUSH_CYCLE = BRUSH_HOLD_IN + BRUSH_DRAG + BRUSH_HOLD_OUT;

/**
 * overlap: 체 선 3초(브러시 대본 그대로) → 모래 6초(체 위에 쌓인다) → 물 3초 →
 * 3초 대기 → 초기화.
 *
 * 순서가 **위에서 아래로** 흐른다 — 이 절이 「스며드는 유체」를 다루기 때문이다.
 * 체를 바닥에서 약간 띄운 자리에 먼저 깔고, 그 위에 모래 더미를 쌓은 뒤 물을
 * 붓는다. 물은 모래 알갱이 사이를 스며내려(`soakDown`, 겹침 슬롯으로) 체에
 * 닿고, 체는 `porous` + `latticeFilter` 로 액체만 통과시키므로 밝은 격자 칸으로
 * 빠져나가 **체 아래**에 고인다. 같은 흐름이 두 겹의 고체(모래·체)를 연달아
 * 뚫고 지나가는 것을 한 장면이 보여 준다 — 모래와 체, 둘 다 고체인데 물은
 * 지나가는 식으로 겹침을 두 번 말한다.
 *
 * 모래가 체 위에 **쌓이는 것**이 이 배치의 전제다. 체는 가루에게는 평범한
 * 고체라 막고, 물에게는 다공성 필터라 통과시킨다. 그래서 모래 더미는 체 위에
 * 남고, 부은 물만 그 아래로 빠진다 — 가루는 못 지나가고 액체는 지나가는 것이
 * 한 흐름 안에서 저절로 드러난다. (이전에는 모래를 바닥에 쌓고 체를 그 위에
 * 걸쳤다. 그러면 물이 체를 통과한 뒤 **모래를 다시 뚫어야** 아래로 갔고,
 * 겹침보다 「채가 뭘 걸러냈나」가 먼저 눈에 들어왔다.)
 *
 * 체를 **바닥에서 띄우는 것**은 물이 어디로 갔는지를 보여 주기 위해서다. 체가
 * 딱 바닥에 붙어 있으면 통과한 물이 보이지 않는다. 한 줄이라도 비워 두면 그
 * 아래에 물이 고이고, 「체를 지나 아래로 샜다」는 한눈에 읽힌다.
 */
const OVERLAP_MESH = BRUSH_CYCLE;
const OVERLAP_SAND = DEMO_TPS * 6;
const OVERLAP_WATER = DEMO_TPS * 3;
const OVERLAP_TAIL = DEMO_TPS * 3;
const OVERLAP_CYCLE = OVERLAP_MESH + OVERLAP_SAND + OVERLAP_WATER + OVERLAP_TAIL;

/** heat: 일반 뷰 2초 → 열 뷰 5초 → 초기화. */
const HEAT_NORMAL = DEMO_TPS * 2;
const HEAT_THERMAL = DEMO_TPS * 5;
const HEAT_CYCLE = HEAT_NORMAL + HEAT_THERMAL;

// --- 물질별 맞춤 데모의 대본 길이 ----------------------------------------------
//
// 여기서부터는 basics 의 여섯 장면이 아니라 **특정 물질 카드**가 열릴 때 보이는
// 다단계 데모다. 모두 tickOverlap 과 같은 구조로 짰다 — 누적 틱 t 를 단계별
// 창으로 쪼개고, 각 창에서 한 동작만 하며 early return, 마지막엔 loop().
//
// 흑요석·소다 는 "액트1(생성/반응) → 장면전환 → 액트2(내성/반응)" 두 액트다.
// 전환 틱에서 격자를 지우고 두 번째 액트의 고정 배치를 직접 놓는다.

/**
 * wall: 벽이 왜 「파괴 불가」인지를 세 가지 위협으로 보여 준다. 가운데 정사각형
 * 벽 블록을 두고, 그 주위에 TNT(폭발) → 산(부식) → 녹은 U235(핵광)를 차례로
 * 들이댄다. 셋 다 벽을 못 뚫는다 — `isWall` 이 폭발(`blocksBlast`)과 핵광
 * (`nuclearray`)의 첫 검사고, `acidResistant` 가 산을 막는다. 한 사이클이 끝나면
 * 격자를 비우고 처음부터(벽 블록은 build 가 다시 놓는다).
 *
 * 단계:
 *  1) 랜덤 자리에 TNT 배치 → WALL_TNT_FUSE(1초) 후 인접 칸에 FIRE 스폰으로 격발.
 *     인접 불이 TNT 의 자연 기폭 경로(updateTNT 의 이웃 검사)를 건드린다.
 *  2) WALL_ACID(2초) 동안 위에서 산 줄기. 벽은 부식되지 않고 줄기는 벽 주변으로
 *     흘러내린다.
 *  3) 랜덤 자리에 녹은 U235 5×5 덩어리 배치 → WALL_U235(3초) 대기. 덩어리가
 *     충분히 커야 중심의 자가발열이 가장자리의 흩어짐을 이기고 임계(2000°)에
 *     다다른다 — 작은 덩어리는 흘러 흩어져 굳어버린다(spawnU235Clump 주석).
 *     배치 후 약 1초에 임계를 넘겨 핵광(Nuclear Ray)을 뿜고 U235 는 연소해 빠지
 *     지만 — **벽 블록은 핵광에도 살아 남는다**(`isWall` 이 빔을 반사).
 *  4) WALL_TAIL(1초) 관찰 → 초기화.
 */
const WALL_TNT_FUSE = DEMO_TPS * 1;
const WALL_BLAST = DEMO_TPS * 2;
const WALL_ACID = DEMO_TPS * 2;
const WALL_U235 = DEMO_TPS * 3;
const WALL_TAIL = DEMO_TPS * 1;
const WALL_CYCLE = WALL_TNT_FUSE + WALL_BLAST + WALL_ACID + WALL_U235 + WALL_TAIL;

/**
 * obsidian: 두 액트. 액트1은 **생성** — 바닥 용암 웅덩이에 위에서 물을 부어
 * 급냉시키면 닿은 면에 흑요석이 생긴다(lava 의 quench). 4초 두고 생성물을
 * 보여 준 뒤, 액트2로 장면 전환 — 이번엔 흑요석 블록을 미리 두고 그 **내성**을
 * 보여 준다. 흑요석은 `explosionProof`라 TNT 두 번을 맞아도 부서지지 않는다.
 * (산·핵광엔 약하지만 이 데모엔 등장하지 않는다.)
 *
 * 액트2 단계: 흑요석 블록 배치 → TNT1(1초 후 격발) → OBS_TNT_BLAST(1.5초
 * 관찰) → TNT2(1초 후 격발) → 테일 → 초기화.
 */
const OBS_WATER = DEMO_TPS * 1.5;
const OBS_FORM = DEMO_TPS * 4;
const OBS_INTERLUDE = DEMO_TPS * 1;
const OBS_TNT_FUSE = DEMO_TPS * 1;
const OBS_TNT_BLAST = DEMO_TPS * 1.5;
const OBS_TAIL = DEMO_TPS * 1;
const OBS_CYCLE =
  OBS_WATER + OBS_FORM + OBS_INTERLUDE + (OBS_TNT_FUSE + OBS_TNT_BLAST) * 2 + OBS_TAIL;

/**
 * saltwater / sugarwater: 같은 대본, 다른 용질. 그릇에 물을 부은 뒤 같은 자리에서
 * 소금/설탕을 떨어뜨리면 가루가 담수 주머니를 녹아든 용액(Saltwater/Sugar Water)으로
 * 바꾼다. 열린 공간에선 가루가 흩어져 반응이 안 보이므로 liquid 데모의 그릇을
 * 빌린다. tickDissolve(soluteId) 하나로 두 종류를 돌린다.
 *
 * 단계: 물 3초(DISSOLVE_WATER) → 용질 1초(DISSOLVE_SOLUTE) → 관찰 3초 → 초기화.
 */
const DISSOLVE_WATER = DEMO_TPS * 3;
const DISSOLVE_SOLUTE = DEMO_TPS * 1;
const DISSOLVE_HOLD = DEMO_TPS * 3;
const DISSOLVE_CYCLE = DISSOLVE_WATER + DISSOLVE_SOLUTE + DISSOLVE_HOLD;

/**
 * soda: 두 액트. 액트1은 산 중화 — 바닥 산 웅덩이에 위에서 소다를 떨어뜨리면
 * 한 알갱이가 산 한 칸을 소금물+가스로 바꾸며 소모된다(건식 중화). 3초 두고
 * 보여 준 뒤, 액트2로 전환 — 이번엔 바닥에 반죽 웅덩이를 두고 같은 소다 줄기를
 * 부어 반죽이 부풀 준비를 하는 것(soda 접촉 플래그)을 보여 준 뒤 완전 초기화.
 *
 * 단계(각 액트): SODA_POUR(2초) 소다 줄기 → SODA_REACT(3초) 관찰.
 */
const SODA_POUR = DEMO_TPS * 2;
const SODA_REACT = DEMO_TPS * 3;
const SODA_INTERLUDE = DEMO_TPS * 1;
const SODA_CYCLE = (SODA_POUR + SODA_REACT) * 2 + SODA_INTERLUDE;

/**
 * soapywater: 두 액트. 액트1은 비누 용해(물 3초 -> 비누 1초 -> 3초 관찰 = 7초),
 * 액트2는 비눗물 웅덩이에 바이러스 1초/3초 대기 -> 휘발유 1초/3초 대기 후 초기화.
 */
const SOAPY_VIRUS_POUR = DEMO_TPS * 1;
const SOAPY_VIRUS_HOLD = DEMO_TPS * 3;
const SOAPY_GAS_POUR = DEMO_TPS * 1;
const SOAPY_GAS_HOLD = DEMO_TPS * 3;
const SOAPY_CYCLE = DISSOLVE_CYCLE + SOAPY_VIRUS_POUR + SOAPY_VIRUS_HOLD + SOAPY_GAS_POUR + SOAPY_GAS_HOLD;

/**
 * liquid: 넘칠 때까지 붓는다 — 길이가 대본이 아니라 **장면이 정한다**. 그릇 크기와
 * 물줄기 굵기는 칸 수에서 따라 나오므로 초를 못 박으면 화면비가 조금만 달라져도
 * "덜 찼는데 멈추는" 장면이 된다. 대신 굳었을 때를 대비한 상한만 둔다.
 */
const LIQUID_POUR_CAP = DEMO_TPS * 20;
/**
 * 넘친 뒤 그대로 두는 시간. 1초는 **넘치는 순간을 보기에만** 충분했다 — 그릇이
 * 가득 찬 그림이 이 장면의 결론인데, 물이 벽을 타고 넘어 바닥에 떨어지는 것을
 * 눈으로 좇고 나면 곧장 화면이 비었다. 4초면 결론을 보고 나서도 한 박자 남는다.
 */
const LIQUID_HOLD = DEMO_TPS * 4;

// --- 맞춤 연출의 박자 ------------------------------------------------------------
// 넷 다 「붓는다 → 한 박 쉰다 → 불을 댄다 → 결과를 보여 준다」는 같은 골격이고,
// 그 사이에 물질마다 다른 한 수가 끼어든다(바닥·둔덕·조합·연료).

/** acid: 금속 바닥의 **윗면** 높이(세로 비율)와, 붓기·구경 시간. */
const ACID_FLOOR_Y = 0.72;
/**
 * 바닥 두께(줄).
 *
 * 한 줄짜리 바닥은 뚫리는 순간이 **너무 싱거웠다** — 표면 한 겹이 사라지면 곧장
 * 관통이라, 「산이 금속을 갉는다」가 아니라 「닿으면 없어진다」로 읽혔다. 네 줄이면
 * 구멍이 위에서부터 파고들어 좁아지는 과정이 보이고, 아래로 새기 시작하는 순간에
 * 무게가 생긴다.
 *
 * 두께가 대본 길이를 늘리지는 않는다. 실측으로 산이 네 줄을 뚫는 데 걸리는 시간은
 * 한 줄일 때와 별로 다르지 않았다(2초 무렵 첫 방울이 아래로 샌다) — 부식이
 * 접촉면마다 굴러가므로, 넓게 고인 웅덩이는 좁은 구멍을 파는 게 아니라 판 전체를
 * 동시에 갉아 내려간다. 두꺼워지면서 달라지는 것은 걸리는 시간이 아니라 **뚫린
 * 자리의 모양**이다.
 */
const ACID_FLOOR_THICK = 4;
const ACID_POUR = DEMO_TPS * 6;
/**
 * 부은 뒤 그대로 두는 시간. 산은 **부으면서** 갉는 게 아니라 고인 뒤에도 계속
 * 갉으므로(부식은 확률이고 자기 소모도 확률이다 — corrosion.ts), 붓기를 멈춘
 * 다음이 오히려 볼거리다: 뚫린 구멍으로 산이 새고 철에서는 수소가 올라온다.
 *
 * 3초다. 5초였을 때 실측으로 **마지막 4초가 정지 화면**이었다 — 7초쯤이면 남은 산이
 * 전부 아래로 빠져 철이 더 줄지 않는다. 볼 것이 끝난 자리에서 기다리느니 다음
 * 바퀴를 시작하는 편이 낫다.
 */
const ACID_HOLD = DEMO_TPS * 3;
const ACID_CYCLE = ACID_POUR + ACID_HOLD;

/** ignite: 3초 생성, 2초 대기, 점화, 3초 대기, 초기화 사이클 (암모날·ANFO·로켓캔디·메탄·섬광화약·불꽃놀이화약·황·니트로). */
const IGNITE_POUR = DEMO_TPS * 3;
const IGNITE_WAIT = DEMO_TPS * 2;
const IGNITE_TAIL = DEMO_TPS * 3;
const IGNITE_AT = IGNITE_POUR + IGNITE_WAIT;
const IGNITE_CYCLE = IGNITE_AT + IGNITE_TAIL;

/** open_ignite: 벽 용기 없이 3초 붓고 점화 → 3초 관찰 → 초기화. (원유·휘발유·경유·등유·LPG·톱밥) */
const OPEN_IGNITE_POUR = DEMO_TPS * 3;
const OPEN_IGNITE_TAIL = DEMO_TPS * 3;
const OPEN_IGNITE_AT = OPEN_IGNITE_POUR;
const OPEN_IGNITE_CYCLE = OPEN_IGNITE_AT + OPEN_IGNITE_TAIL;

/** brush_ignite: 브러시로 선을 긋고 아래에 불 생성으로 점화 → 5초 관찰 → 초기화. (석탄·나무·레진) */
const BRUSH_IGNITE_DRAG = BRUSH_CYCLE;
const BRUSH_IGNITE_TAIL = DEMO_TPS * 5;
const BRUSH_IGNITE_CYCLE = BRUSH_IGNITE_DRAG + BRUSH_IGNITE_TAIL;

/** glass_shockwave: 고체 유리 배치 → 1초 대기 → 아래에 충격파 → 3초 관찰 → 초기화. (유리·깨진 유리) */
const GLASS_WAIT = DEMO_TPS * 1;
const GLASS_TAIL = DEMO_TPS * 3;
const GLASS_CYCLE = GLASS_WAIT + GLASS_TAIL;

/** hydrogen_oxygen: 3초간 수소+산소 생성 후 2초 대기 후 점화 → 연소 물 반응 3초 관찰 → 초기화. (산소·수소) */
const HO_POUR = DEMO_TPS * 3;
const HO_WAIT = DEMO_TPS * 2;
const HO_TAIL = DEMO_TPS * 3;
const HO_AT = HO_POUR + HO_WAIT;
const HO_CYCLE = HO_AT + HO_TAIL;

/**
 * 불을 **한 틱만 대지 않는** 이유. 폭약은 불 이웃을 보면 그 틱에 터지지만
 * (gunpowder.ts 의 id 기반 판정), 황 같은 연료는 `burnChance` 굴림이라 한 번에
 * 안 붙는 편이 정상이다(0.08). 불꽃 한 점만 놓고 마는 대본은 물질에 따라 **아무
 * 일도 안 일어나는 판**을 만든다 — 실측으로 12틱 × 세 칸짜리 불씨는 황 더미에
 * 여섯 판 중 두 판만 붙었고, 나머지 네 판은 불이 몇 틱 반짝하다 꺼진 채 대본이
 * 끝났다. 그래서 점화 순간부터 1초 동안 다섯 칸 폭으로 계속 불을 댄다 — 라이터를
 * 갖다 대고 있는 그림이고, 폭약 쪽은 어차피 첫 틱에 터지므로 손해가 없다.
 */
const IGNITE_FLAME = DEMO_TPS;
/** 불을 대는 폭(봉우리 꼭대기에서 좌우 몇 칸까지). */
const IGNITE_SPREAD = 4;

/**
 * gunpowder 1막 — 좌우 모래 둔덕 사이에 화약을 쌓는다.
 *
 * 모래가 있는 것은 화약의 성격이 **파괴가 아니라 밀어내기**이기 때문이다.
 * 흑색화약은 파괴력이 낮아(gunpowder.ts 의 `destructivePower`) 단단한 것은 못
 * 부수고 헐거운 것을 Debris 로 밀쳐 낸다. 좌우에 모래 둔덕이 있어야 그 「밀쳐
 * 냄」이 보인다 — 빈 화면에서 터뜨리면 반짝하고 끝난다.
 *
 * 모래가 2초에 멈추고 화약이 2초 더 떨어지는 것은 화약 더미가 둔덕보다 높이
 * 솟아 있어야 「가운데 것이 터졌다」가 읽히기 때문이다.
 */
const GP_BERM = DEMO_TPS * 2;
const GP_PILE = DEMO_TPS * 4;
const GP_WAIT = DEMO_TPS;
const GP_TAIL = DEMO_TPS * 2;
const GP_ACT1_FIRE = GP_PILE + GP_WAIT;
const GP_ACT1 = GP_ACT1_FIRE + GP_TAIL;

/**
 * gunpowder 2막 — 화약을 **만든다**. 석탄가루·황·초석 세 줄기를 나란히 떨어뜨린
 * 뒤 섞기 브러시로 휘저으면 세 알갱이가 맞닿은 자리마다 흑색화약이 된다
 * (gunpowdermix.ts 의 3체 레시피). 팔레트에서 꺼내는 것 말고 조합이라는 길이
 * 있다는 것이 이 물질 카드가 할 수 있는 가장 좋은 말이다.
 *
 * 휘젓고 나서 한 박 쉬는 것은 연출이 아니라 **레시피에 시간을 주는 것**이다.
 * 성립 확률이 틱당 0.25 라 접촉 직후가 아니라 몇 틱 뒤에 알갱이가 검게 바뀐다.
 */
const GP_MIX_POUR = DEMO_TPS * 2;
const GP_MIX_STIR = DEMO_TPS * 3;
const GP_MIX_WAIT = DEMO_TPS;
const GP_MIX_TAIL = DEMO_TPS * 2;
const GP_ACT2_FIRE = GP_MIX_POUR + GP_MIX_STIR + GP_MIX_WAIT;
const GP_ACT2 = GP_ACT2_FIRE + GP_MIX_TAIL;
const GP_CYCLE = GP_ACT1 + GP_ACT2;

/** 2막의 세 줄기가 떨어지는 자리(가로 비율). 더미가 서로 맞물릴 만큼 가깝다. */
const GP_MIX_AT: readonly number[] = [0.35, 0.5, 0.65];
/** 1막의 좌우 모래 둔덕과 가운데 화약 줄기 자리(가로 비율). */
const GP_BERM_AT: readonly number[] = [0.25, 0.75];
const GP_PILE_AT = 0.5;

/**
 * ammoniumnitrate — 벽으로 3등분한 칸에 같은 프릴을 쌓아 놓고, 가운데와
 * 오른쪽에만 연료를 붓는다. 왼쪽은 그대로 둔다.
 *
 * 이 물질의 설명문이 하는 말이 「혼자서는 팔레트에서 가장 약한 폭약이고, 연료를
 * 먹이면 달라진다」(ammoniumnitrate.ts)인데, 그건 **나란히 놓고 동시에 터뜨려야만**
 * 보이는 종류의 사실이다. 왼쪽 맨 프릴(반경 6) / 가운데 암모날(17.5) / 오른쪽
 * ANFO(14) 가 한 틱에 같이 간다.
 *
 * 알루미늄 가루는 접촉 레시피(0.25 굴림)이고 등유는 겹침으로 스며드는 것이라,
 * 둘 다 부어 놓고 가만두면 표면만 반응한다. 아래쪽 절반을 휘젓는 한 획이 그
 * 둘을 더미 속으로 밀어 넣는다.
 */
const AN_POUR = DEMO_TPS * 3;
const AN_WAIT1 = DEMO_TPS;
const AN_FUEL = DEMO_TPS * 2;
const AN_STIR = DEMO_TPS * 2;
const AN_WAIT2 = DEMO_TPS;
const AN_TAIL = DEMO_TPS * 3;
const AN_FIRE = AN_POUR + AN_WAIT1 + AN_FUEL + AN_STIR + AN_WAIT2;
const AN_CYCLE = AN_FIRE + AN_TAIL;
/** 세 칸의 한가운데(가로 비율). 칸막이가 1/3·2/3 에 서므로 1/6·1/2·5/6 이다. */
const AN_CELL_AT: readonly number[] = [1 / 6, 0.5, 5 / 6];

/** saltpeter: 두 액트. 1막은 둔덕 사이 초석 더미, 2막은 초석 3초 줄기 + 가운데 캐러멜 생성 3초 -> 4초 대기 -> 점화 → 3초 관찰 → 초기화 (질산칼륨) */
const SP_BERM = DEMO_TPS * 2;
const SP_PILE = DEMO_TPS * 4;
const SP_WAIT1 = DEMO_TPS * 1;
const SP_TAIL1 = DEMO_TPS * 2;
const SP_ACT1_FIRE = SP_PILE + SP_WAIT1;
const SP_ACT1 = SP_ACT1_FIRE + SP_TAIL1;

const SP_POUR2 = DEMO_TPS * 3;
const SP_WAIT2 = DEMO_TPS * 4;
const SP_FIRE2 = SP_POUR2 + SP_WAIT2;
const SP_TAIL2 = DEMO_TPS * 3;
const SP_ACT2 = SP_FIRE2 + SP_TAIL2;
const SP_CYCLE = SP_ACT1 + SP_ACT2;

/** alcohol: 바닥 알코올 웅덩이에 바이러스 1초 붓기 -> 3초 소독 관찰 -> 1초 불 점화 및 연소 3초 관찰 후 초기화 (알코올) */
const ALCOHOL_VIRUS_POUR = DEMO_TPS * 1;
const ALCOHOL_VIRUS_HOLD = DEMO_TPS * 3;
const ALCOHOL_IGNITE = ALCOHOL_VIRUS_POUR + ALCOHOL_VIRUS_HOLD;
const ALCOHOL_TAIL = DEMO_TPS * 3;
const ALCOHOL_CYCLE = ALCOHOL_IGNITE + ALCOHOL_TAIL;

/**
 * 섞기 브러시의 반지름(칸). 굵어야 한다 — 세 재료가 각자의 봉우리로 앉으므로,
 * 발자국이 봉우리 하나보다 좁으면 같은 재료끼리만 섞어 놓고 지나간다.
 */
const STIR_R = 5;

/**
 * 가로 획 수. 장면마다 다르다.
 *
 * - **화약 2막은 왕복 한 번**(2획)이고 높이가 안 변한다. 브러시를 바닥에 붙여 두면
 *   반지름 5가 더미 높이를 통째로 덮으므로 위아래로 움직일 이유가 없고, 획이 적을수록
 *   브러시가 한 칸에 오래 머물러(획당 1.5초에 46칸이면 틱당 한 칸꼴) 같은 자리를
 *   반복해서 섞는다. 여러 번 빨리 지나가는 것보다 이쪽이 조합을 더 잘 건다.
 * - **질산암모늄은 여러 획**이다. 이쪽 브러시는 아래쪽 절반을 훑어 내려갔다 올라오는
 *   모양이라 한 자리에 머무는 시간이 짧고, 대신 칸막이가 획을 세 도막으로 끊는다.
 */
const STIR_SWEEPS_FLAT = 2;
const STIR_SWEEPS_BAND = 8;

// --- 물줄기 --------------------------------------------------------------------

/** 줄기가 태어나는 높이(위에서 몇 번째 줄). y=0이 천장이다. */
const STREAM_Y = 1;
/** 모래 줄기가 한 틱에 한 알갱이를 떨어뜨릴 확률. 1이면 자로 잰 기둥이 된다. */
const SAND_CHANCE = 0.7;
/** 줄기가 좌우로 흔들리는 폭(칸). */
const STREAM_JITTER = 1;

// --- 가루 데모의 배수 -----------------------------------------------------------
// 「초기화 없이 지속」이므로 그냥 두면 화면이 꽉 차서 굳는다. 시작 화면과 같은 수법:
// 일정 점유율을 넘으면 바닥 줄에서 조금씩 새어 나가게 해 더미 높이를 유지한다.

const DRAIN_SAMPLE_TICKS = 30;
const DRAIN_FILL = 0.3;
const DRAIN_CELLS = 2;

// --- 장면 좌표 -----------------------------------------------------------------
// 전부 격자 크기에 대한 비율로 잡는다 — 캔버스가 얼마나 넓든 같은 그림이 나온다.

/** 브러시 반지름(칸). 선 굵기가 이 값의 두 배가 된다. */
const BRUSH_R = 2;
/** 브러시가 지나는 구간(가로 비율). */
const BRUSH_X0 = 0.16;
const BRUSH_X1 = 0.84;

/**
 * 겹침 데모의 체 선 높이(세로 비율). **바닥에서 약간 띄운 자리**다.
 *
 * 체가 딱 바닥에 붙어 있으면 물이 체를 통과한 뒤 **보이지 않는다** — 어디로
 * 갔는지가 이 장면의 요점인데 빈 칸 뒤에 숨는다. 한 줄이라도 비워 두면 체
 * 아래에 물이 고이고 「체를 뚫고 아래로 샜다」가 한눈에 읽힌다.
 *
 * 0.82 면 56×28 에서 띠가 y=23 이고 체 아래로 네 줄(테두리 제외)이 남는다.
 * 모래 6초 더미는 체 **위**에 쌓이므로 봉우리가 체를 넘을 걱정이 없다 — 체가
 * 가루를 막는 평범한 고체이기 때문이다(옛 배치에서는 모래를 체 아래에 쌓아
 * 봉우리가 선을 뚫는 것을 피하려고 체를 위로 올려야 했다).
 */
const MESH_Y = 0.82;
/** 체 선이 걸치는 구간(가로 비율). */
const MESH_X0 = BRUSH_X0;
const MESH_X1 = BRUSH_X1;

/** 액체 데모의 그릇: 좌우 벽의 가로 위치와 바닥·전 높이(세로 비율). */
const BOWL_X0 = 0.3;
const BOWL_X1 = 0.7;
const BOWL_BOTTOM = 0.86;
const BOWL_RIM = 0.42;

/** 기체 데모에서 연기가 태어나는 구간(가로 비율)과 한 틱당 개수. */
const SMOKE_X0 = 0.3;
const SMOKE_X1 = 0.7;
const SMOKE_PER_TICK = 2;

/** 열전도 데모: 파이프 띠의 **한가운데** 높이(세로 비율)와 좌우 여백(칸). */
const PIPE_Y = 0.45;
const PIPE_PAD_LEFT = 5;
const PIPE_PAD_RIGHT = 4;
/** 파이프 두께(칸). 홀수라야 PIPE_Y 가 가리키는 줄이 띠의 한가운데로 떨어진다. */
const PIPE_THICK = 3;
/** 불 Clone 덩어리의 가로·세로(칸)와, 파이프 아랫줄과의 사이에 비워 둘 줄 수. */
const FIREBOX_W = 4;
const FIREBOX_H = 3;
const FIREBOX_GAP = 1;

// --- 물질별 맞춤 데모의 장면 좌표 ----------------------------------------------

/** wall·obsidian 액트2 의 중앙 정사각형 블록: 변의 길이(세로 비율). 56×28 → 약 7칸. */
const BLOCK_SIZE = 0.25;

/** obsidian·soda 액트1 의 바닥 웅덩이: 가로 구간(비율)과 깊이(칸). */
const POOL_X0 = 0.28;
const POOL_X1 = 0.72;
const POOL_DEPTH = 3;

/** 산/소다/소금/설탕 줄기가 떨어지는 가로 비율. 그릇 중앙 또는 웅덩이 중앙. */
const POUR_AT = 0.5;

/** wall·obsidian 데모가 놓는 TNT 블록의 한 변(칸). 단일 칸은 화면에서 점이라서. */
const TNT_BLOCK = 3;

/**
 * 녹은 U235 덩어리의 한 변(칸). 임계(2000°) 폭주를 일으키려면 액체가 흩어지지 않게
 * 서로 붙어 있어야 하는데 — MOLTEN_URANIUM 은 중력으로 흘러내려 이웃이 줄어
 * 자가발열(+3/이웃)이 멎고, 바닥에 닿으면 전도로 열이 빠져 굳어버린다. 5×5(=25칸)면
 * 중심 셀의 이웃이 충분해 배치 후 약 30틱(1초) 안에 임계에 다다른다 — 덩어리가
 * 충분히 커서 가장자리가 흘러내리는 동안 중심은 자리를 지키며 발열이 누적한다.
 * (관측: 1600°→임계 2000°까지 8/8 seed 에서 29틱.) 작은 덩어리(3×3 이하)는
 * 흩어지는 속도가 발열을 이기지 못해 임계에 못 다다른다.
 */
const U235_CLUMP_SIZE = 5;

/**
 * 상태별 **기본 주인공 물질**. basics 탭이 넘기는 여섯 데모는 주인공 id 를 따로
 * 고르지 않으므로 이 값으로 돌아간다 — 가이드 문서의 "고체/가루/액체/기체" 절이
 * 원래 보여 주던 것(돌·모래·물·연기)이 곧 기본값이다.
 *
 * 물질 카드의 데모는 이 표를 거치지 않는다 — 카드가 **자기 물질 id** 를 직접
 * 주므로(철 카드는 철, 모래 카드는 모래), 기본값은 basics 의 여섯 장면에만 쓰인다.
 * overlap·heat 는 복합 세팅이라 주인공이 없다.
 */
function defaultSubject(kind: GuideDemoKind): number {
  switch (kind) {
    case 'solid':
      return DEMO_STONE.id;
    case 'powder':
      return DEMO_SAND.id;
    case 'liquid':
      return DEMO_WATER.id;
    case 'gas':
      return DEMO_SMOKE.id;
    default:
      // overlap·heat·wall·obsidian·saltwater·sugarwater·soda 는 subjectId 를 읽지
      // 않는다 — 각자 자기 물질을 대본 안에서 직접 다룬다. 의미 있는 값 하나만 둔다.
      //
      // 배역표가 딸린 넷(acid·ignite·gunpowder·ammoniumnitrate)은 반대로 **언제나**
      // 주인공을 받는다(물질 카드에서만 켜지므로) — 여기 걸린다면 배선이 잘못된
      // 것이고, 벽이 쏟아지는 그림이 조용한 실패보다 눈에 띈다.
      return DEMO_WALL.id;
  }
}

/**
 * 브러시 커서 안에 그릴 도구 아이콘. `null` 이면 빈 원 — 게임의 재료 브러시
 * 미리보기와 같은 모양이다. `'mix'` 는 섞기 도구(`bi-tornado`)로, 커서가 무엇을
 * 하고 있는지가 그림만으로는 안 읽히기 때문에 붙는다: 빈 원이 더미 위를 지나가면
 * 「무언가를 칠하는 중」으로 읽히지 「휘젓는 중」으로는 읽히지 않는다.
 */
export type DemoBrushIcon = 'mix';

/** 브러시 커서. 커서를 쓰는 장면에서만 값이 있고 나머지는 `null`이다. */
export interface DemoBrush {
  /** 칸 좌표(중심). */
  x: number;
  y: number;
  /** 반지름(칸). */
  r: number;
  /** 원 안에 겹칠 도구 아이콘. 재료 브러시면 `null`. */
  icon: DemoBrushIcon | null;
}

/**
 * 장면 하나를 세우는 데 필요한, 종류(`kind`)와 크기 말고 전부.
 *
 * 셋 다 **물질 카드에서만** 채워진다. basics 탭의 여섯 장면은 이 객체를 통째로
 * 생략하고, 그러면 기본값(상태별 대표 물질 · 배역 없음 · 불로 점화)으로 돌아간다 —
 * §13 의 여섯은 이 라운드 뒤에도 한 줄도 안 바뀐다.
 */
export interface GuideDemoOptions {
  /** 주인공 물질 id. 없으면 `defaultSubject(kind)`. */
  subjectId?: number;
  /** 맞춤 연출의 조연들. `demoScenes.ts` 만 채운다. */
  cast?: DemoCast;
  /** 격발 방식. 기본은 불. */
  trigger?: DemoTrigger;
}

/**
 * 데모 세계 하나. 캔버스도 렌더러도 모르고, `tick()`을 불러 주는 쪽이 박자를 쥔다.
 */
export class GuideDemoWorld {
  readonly grid: Grid;
  readonly sim: Simulation;
  readonly kind: GuideDemoKind;

  /** 지금 그려야 할 브러시 원. 고체 데모 외에는 언제나 `null`. */
  brush: DemoBrush | null = null;

  /** 열 뷰(열지도)로 그려야 하는지. 열전도 데모만 도중에 켠다. */
  heatView = false;

  /**
   * 이 세계의 **주인공 물질 id**. 상태 4종 데모가 칠하고 붓고 떨어뜨리는 것이 이
   * 물질이다. basics 탭이 주지 않으면 `defaultSubject(kind)` 로 정해진다(돌·모래·물·연기).
   * 물질 카드는 자기 물질 id 를 직접 넘긴다. overlap·heat 는 읽지 않는다.
   */
  readonly subjectId: number;

  /**
   * 맞춤 연출의 조연 물질들. 맞춤 연출이 아닌 장면은 읽지 않으므로 `null`이다
   * — basics 탭과 상태 4종 카드는 배역표 없이 그대로 돈다.
   */
  readonly cast: DemoCast | null;

  /** 격발 장면이 무엇으로 불을 붙이는가. 안 주면 불이다. */
  readonly trigger: DemoTrigger;

  /** 대본이 한 바퀴를 돌아 초기화된 횟수. 검사가 반복을 확인하는 창구다. */
  loops = 0;

  /** 이번 바퀴가 시작된 뒤 지난 틱 수. */
  private t = 0;

  /** 액체 데모: 그릇이 넘친 틱(아직이면 -1). 넘친 뒤 LIQUID_HOLD 틱을 세는 기준. */
  private overflowAt = -1;

  private drainSince = DRAIN_SAMPLE_TICKS;
  private draining = false;

  private readonly rand: () => number;

  constructor(
    kind: GuideDemoKind,
    width: number,
    height: number,
    rand: () => number = Math.random,
    opts: GuideDemoOptions = {},
  ) {
    this.kind = kind;
    this.rand = rand;
    this.subjectId = opts.subjectId ?? defaultSubject(kind);
    this.cast = opts.cast ?? null;
    this.trigger = opts.trigger ?? 'fire';
    this.grid = new Grid(width, height);
    this.sim = new Simulation(this.grid);
    this.sim.setBorderMode(GUIDE_DEMO_SPECS[kind].borderMode);
    this.sim.setSmokeLevel(DEMO_SMOKE_LEVEL);
    this.build();
  }

  /** 화면 크기가 바뀌었을 때. 장면 좌표가 전부 격자 크기에서 나오므로 다시
   *  그리는 편이 맞다 — 늘어난 격자에 옛 그릇이 반쯤 걸쳐 있는 것보다 낫다. */
  resize(width: number, height: number): void {
    if (width === this.grid.width && height === this.grid.height) return;
    this.grid.resize(width, height);
    this.reset();
  }

  /** 대본을 처음으로 되돌린다. 격자를 비우고 고정 배치를 다시 놓는다. */
  reset(): void {
    this.t = 0;
    this.overflowAt = -1;
    this.brush = null;
    this.heatView = false;
    this.drainSince = DRAIN_SAMPLE_TICKS;
    this.draining = false;
    this.grid.clear();
    this.build();
  }

  // --- 고정 배치 ---------------------------------------------------------------

  /** 장면의 움직이지 않는 부분(그릇·파이프·불씨·블록·웅덩이·바닥·칸막이)을 놓는다. */
  private build(): void {
    switch (this.kind) {
      case 'liquid':
        this.buildBowl();
        break;
      case 'heat':
        this.buildPipe();
        break;
      case 'wall':
        // 액트1 고정 배치: 중앙 벽/다이아몬드 블록. 위협(TNT·산·U235)은 대본 안에서 놓는다.
        this.buildBlock(this.subjectId);
        break;
      case 'obsidian':
        // 액트1 고정 배치: 바닥 용암 웅덩이(물이 닿으면 흑요석으로 급냉).
        this.buildPool(DEMO_LAVA.id);
        break;
      case 'saltwater':
      case 'sugarwater':
        // 그릇 안에서 물→용질 순서로 부어 섞인다.
        this.buildBowl();
        break;
      case 'soda':
        // 액트1 고정 배치: 바닥 산 웅덩이. 액트2 전환은 대본이 buildBatterPool 로.
        this.buildPool(DEMO_ACID.id);
        break;
      case 'soapywater':
        // 액트1 고정 배치: 그릇. 2막 전환은 대본이 buildSoapyWaterPool 로.
        this.buildBowl();
        break;
      case 'acid':
        // 격자를 가로로 완전히 막는 네 줄 두께의 금속 바닥.
        this.buildFloor();
        break;
      case 'acidvapor':
        // 정 중앙에 위치하는 네 줄 두께의 금속 바닥.
        this.buildCenterFloor();
        break;
      case 'alcohol':
        // 액트1 고정 배치: 바닥 알코올 웅덩이.
        this.buildPool(this.subjectId);
        break;
      case 'ammoniumnitrate':
        // 격자를 세로로 완전히 가르는 칸막이 둘 — 3등분.
        this.buildPartitions();
        break;
      case 'glass_shockwave':
        this.buildGlassBlock();
        break;
    }
    this.grid.randomizeTints();
  }

  /**
   * 산 장면의 금속 바닥: 격자를 가로로 완전히 막는 한 줄.
   *
   * **끝에서 끝까지** 놓는 것이 요점이다. 한 칸이라도 비면 산은 갉는 대신 그리로
   * 흘러내리고, 장면은 「부식」이 아니라 「액체가 틈으로 샌다」가 된다. 아래로
   * 가는 길이 바닥을 뚫는 것뿐이어야 부식이 유일한 사건이 된다.
   */
  private buildFloor(): void {
    const g = this.grid;
    const id = this.cast?.floor;
    if (id === undefined) return;
    const top = Math.round(g.height * ACID_FLOOR_Y);
    for (let dy = 0; dy < ACID_FLOOR_THICK; dy++) {
      const y = top + dy;
      if (y >= g.height) break;
      for (let x = 0; x < g.width; x++) g.set(x, y, id);
    }
  }

  /** 산 증기 데모: 정 중앙에 위치하는 네 줄 두께의 금속 바닥. */
  private buildCenterFloor(): void {
    const g = this.grid;
    const id = this.cast?.floor ?? DEMO_STONE.id;
    const cy = g.height >> 1;
    const top = cy - 2;
    for (let dy = 0; dy < ACID_FLOOR_THICK; dy++) {
      const y = top + dy;
      if (y >= g.height) break;
      for (let x = 0; x < g.width; x++) g.set(x, y, id);
    }
  }

  /** 질산암모늄 장면의 칸막이 둘: 격자를 세로로 완전히 가르는 벽 두 줄. */
  private buildPartitions(): void {
    const g = this.grid;
    for (const x of this.partitions()) {
      for (let y = 0; y < g.height; y++) g.set(x, y, DEMO_WALL.id);
    }
  }

  /** 액체 데모의 그릇: 바닥 한 줄과 좌우 벽 두 줄로 된, 위가 트인 상자. */
  private buildBowl(): { x0: number; x1: number; bottom: number; rim: number } {
    const g = this.grid;
    const x0 = Math.round(g.width * BOWL_X0);
    const x1 = Math.round(g.width * BOWL_X1);
    const bottom = Math.round(g.height * BOWL_BOTTOM);
    const rim = Math.round(g.height * BOWL_RIM);
    for (let x = x0; x <= x1; x++) g.set(x, bottom, DEMO_WALL.id);
    for (let y = rim; y <= bottom; y++) {
      g.set(x0, y, DEMO_WALL.id);
      g.set(x1, y, DEMO_WALL.id);
    }
    return { x0, x1, bottom, rim };
  }

  /** 그릇의 좌표. 대본과 넘침 판정이 같은 값을 읽도록 계산을 한 군데 둔다. */
  private bowl(): { x0: number; x1: number; bottom: number; rim: number } {
    const g = this.grid;
    return {
      x0: Math.round(g.width * BOWL_X0),
      x1: Math.round(g.width * BOWL_X1),
      bottom: Math.round(g.height * BOWL_BOTTOM),
      rim: Math.round(g.height * BOWL_RIM),
    };
  }

  /**
   * 열전도 데모: 가로로 놓인 히트파이프 띠와, 그 **왼쪽 끝 아래**에서 불을 뿜는
   * Clone 덩어리.
   *
   * 셋 다 한 칸이 아니라 덩어리인 데에는 이유가 있다.
   *
   * - **파이프가 세 칸 두께**인 것은 이 장면의 볼거리가 색이기 때문이다. 열지도로
   *   넘어가면 칸 하나하나의 색이 곧 온도인데, 한 줄짜리 파이프는 그 기울기가
   *   1픽셀 두께의 선으로만 보인다.
   * - **불은 파이프 아래**에 둔다. 불은 위로 오르므로 아래에서 달구는 편이 옆에서
   *   대는 것보다 자연스럽고, 열이 파이프 밑면을 따라 들어가 위로 배어 나오는
   *   것까지 보인다.
   * - **사이를 한 줄 비워 둔다.** Clone 은 이웃의 **빈 칸**으로만 복제본을
   *   뱉으므로, 덩어리를 파이프에 딱 붙이면 위쪽으로는 뱉을 자리가 없어 불이
   *   옆구리로만 새어 나간다. 한 줄을 비워 두면 그 줄이 불로 차서 파이프 밑면
   *   전체와 상하좌우로 맞닿는다 — 열 교환은 4이웃이라, 대각선으로만 닿는
   *   배치였다면 파이프가 데워지지 않는다.
   *
   * `aux` 에 불의 id 를 미리 박아 두는 것은 팔레트의 더블클릭 Clone 단축키와 같은
   * 수법이다(clone.ts 의 `canAdopt` 주석). 그냥 두면 Clone 이 처음 닿은 것 —
   * 즉 히트파이프 — 를 물어 버려 불 대신 파이프를 뿜는다.
   */
  private buildPipe(): { y: number; top: number; bottom: number; x0: number; x1: number } {
    const g = this.grid;
    const y = Math.round(g.height * PIPE_Y);
    // 두께가 홀수면 위아래로 똑같이 벌어지고, 짝수면 아래로 한 줄 더 간다.
    const half = (PIPE_THICK - 1) >> 1;
    const top = y - half;
    const bottom = top + PIPE_THICK - 1;
    const x0 = PIPE_PAD_LEFT;
    const x1 = g.width - 1 - PIPE_PAD_RIGHT;
    for (let py = top; py <= bottom; py++) {
      for (let x = x0; x <= x1; x++) {
        if (g.inBounds(x, py)) g.set(x, py, DEMO_HEATPIPE.id);
      }
    }
    // 불 덩어리는 파이프 왼쪽 끝 아래. 가로로는 파이프의 왼쪽 끝과 겹쳐 두어
    // 사이의 빈 줄에 고인 불이 파이프 밑면에 그대로 닿게 한다.
    const fy = bottom + 1 + FIREBOX_GAP;
    for (let dy = 0; dy < FIREBOX_H; dy++) {
      for (let dx = 0; dx < FIREBOX_W; dx++) {
        const cx = x0 + dx;
        const cy = fy + dy;
        if (!g.inBounds(cx, cy)) continue;
        g.set(cx, cy, DEMO_CLONE.id);
        g.setAux(cx, cy, DEMO_FIRE.id);
      }
    }
    return { y, top, bottom, x0, x1 };
  }

  // --- 물질별 데모의 고정 배치 헬퍼 --------------------------------------------

  /**
   * 격자 한가운데에 정사각형 `id` 블록을 놓는다. wall·obsidian 액트2 의 대상.
   * 변 길이는 격자 세로의 BLOCK_SIZE 비율 — 56×28 → 약 7칸짜리 7×7.
   */
  private buildBlock(id: number): { cx: number; cy: number; half: number } {
    const g = this.grid;
    const size = Math.max(3, Math.round(g.height * BLOCK_SIZE));
    const half = size >> 1;
    const cx = g.width >> 1;
    const cy = g.height >> 1;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (g.inBounds(x, y)) g.set(x, y, id);
      }
    }
    return { cx, cy, half };
  }

  /** 블록 좌표(buildBlock 과 같은 공식). 대본이 블록 영역을 피할 때 쓴다. */
  private blockBox(): { cx: number; cy: number; half: number } {
    const g = this.grid;
    const size = Math.max(3, Math.round(g.height * BLOCK_SIZE));
    return { cx: g.width >> 1, cy: g.height >> 1, half: size >> 1 };
  }

  /**
   * 바닥에 가로 웅덩이를 깐다. obsidian 액트1(용암)·soda 액트1(산)이 쓴다. 깊이
   * POOL_DEPTH 칸, 가로는 POOL_X0..POOL_X1 비율. 테두리 바로 안쪽부터 채운다.
   */
  private buildPool(id: number, depth = POOL_DEPTH): void {
    const g = this.grid;
    const x0 = Math.round(g.width * POOL_X0);
    const x1 = Math.round(g.width * POOL_X1);
    const bottom = g.height - 1;
    for (let dy = 0; dy < depth; dy++) {
      const y = bottom - dy;
      if (y < 0) break;
      for (let x = x0; x <= x1; x++) {
        if (g.inBounds(x, y)) {
          g.set(x, y, id);
          // 액체/고온 물질은 init 온도가 안 들어가므로 spawn 경로와 비슷하게 세팅.
          this.sim.context.setTemp(x, y, this.poolInitTemp(id));
        }
      }
    }
  }

  /** 웅덩이 물질의 자연 시작 온도. 용암 1500°, 산은 ambient. */
  private poolInitTemp(id: number): number {
    if (id === DEMO_LAVA.id) return 1500;
    return 20;
  }

  /** obsidian 액트2 전환: 격자를 비우고 흑요석 블록만 놓는다. */
  private buildObsidianBlock(): void {
    this.grid.clear();
    this.buildBlock(DEMO_OBSIDIAN.id);
    this.grid.randomizeTints();
  }

  /** soda 액트2 전환: 격자를 비우고 바닥 반죽 웅덩이를 놓는다. */
  private buildBatterPool(): void {
    this.grid.clear();
    this.buildPool(DEMO_BATTER.id);
    this.grid.randomizeTints();
  }

  // --- 한 틱 -------------------------------------------------------------------

  tick(): void {
    switch (this.kind) {
      case 'solid':
        this.tickSolid();
        break;
      case 'powder':
        this.tickPowder();
        break;
      case 'liquid':
        this.tickLiquid();
        break;
      case 'gas':
        this.tickGas();
        break;
      case 'overlap':
        this.tickOverlap();
        break;
      case 'heat':
        this.tickHeat();
        break;
      case 'wall':
        this.tickWall();
        break;
      case 'obsidian':
        this.tickObsidian();
        break;
      case 'saltwater':
        this.tickDissolve(DEMO_SALT.id);
        break;
      case 'sugarwater':
        this.tickDissolve(DEMO_SUGAR.id);
        break;
      case 'soda':
        this.tickSoda();
        break;
      case 'acid':
        this.tickAcid();
        break;
      case 'ignite':
        this.tickIgnite();
        break;
      case 'gunpowder':
        this.tickGunpowder();
        break;
      case 'ammoniumnitrate':
        this.tickAmmoniumNitrate();
        break;
      case 'open_ignite':
        this.tickOpenIgnite();
        break;
      case 'brush_ignite':
        this.tickBrushIgnite();
        break;
      case 'glass_shockwave':
        this.tickGlassShockwave();
        break;
      case 'hydrogen_oxygen':
        this.tickHydrogenOxygen();
        break;
      case 'soapywater':
        this.tickSoapyWater();
        break;
      case 'saltpeter':
        this.tickSaltpeter();
        break;
      case 'alcohol':
        this.tickAlcohol();
        break;
      case 'acidvapor':
        this.tickAcidVapor();
        break;
    }
    this.sim.step();
    this.t++;
  }

  /**
   * 정지 화면(움직임 최소화)까지 앞으로 감는다.
   *
   * 다섯은 그냥 `GUIDE_DEMO_STILL_TICKS[kind]` 만큼 돌리면 된다 — 대본 길이보다
   * 짧게 잡아 뒀으므로 초기화를 지나칠 일이 없다.
   *
   * **액체만 고정 틱으로는 못 잡는다.** 그 장면은 길이가 대본이 아니라 물이
   * 넘치는 시점이 정하고, 그 시점은 물줄기의 확률 굴림에 따라 매번 조금씩
   * 다르다(실측 209~223틱). 고정 틱을 넘침 근처에 두면 굴림이 이른 판에서는
   * 이미 초기화가 지나가 **막 비워진 빈 그릇**이 정지 화면으로 남는다. 그래서
   * 여기서는 틱을 세지 않고 **넘친 그 순간에 멈춘다** — 그릇이 가장 가득한
   * 자리이고, 굴림과 무관하게 언제나 같은 그림이다. 상한은 장면이 굳었을 때를
   * 위한 것이지 목표가 아니다.
   */
  windToStill(): void {
    const cap = GUIDE_DEMO_STILL_TICKS[this.kind];
    for (let i = 0; i < cap; i++) {
      this.tick();
      if (this.kind === 'liquid' && this.overflowAt >= 0) return;
    }
  }

  /** 대본 한 바퀴가 끝났을 때. 다음 `tick()`은 t=0부터 다시 시작한다. */
  private loop(): void {
    this.loops++;
    this.reset();
    this.t = -1; // 이번 tick() 끝의 `t++`가 0으로 만든다
  }

  // --- 고체: 브러시가 선을 긋는다 ------------------------------------------------

  private tickSolid(): void {
    const t = this.t;
    if (t >= BRUSH_CYCLE) {
      this.loop();
      return;
    }
    // 「고체」 카드가 긋는 것은 벽이 아니라 **돌**이다. 벽은 파괴도 반응도 상변화도
    // 없는 예외적인 물질이라 상태의 대표로 세우면 「고체는 아무것도 안 일어나는
    // 것」으로 읽힌다 — 돌은 그냥 평범한 고체다. 벽은 액체 데모의 그릇처럼
    // 「장면을 담는 틀」로만 남는다.
    //
    // 물질 카드의 데모에서는 주인공이 카드의 실제 물질(철·얼음·…)이므로
    // `subjectId` 로 긋는다. basics 는 이 값이 돌이다(`defaultSubject`).
    this.dragBrush(t, Math.round(this.grid.height * 0.5), this.subjectId);
  }

  /**
   * 브러시가 왼쪽에서 오른쪽으로 한 번 지나가며 높이 `y` 에 `id` 로 선을 긋는다.
   * `t` 는 **이 구간이 시작된 뒤** 지난 틱 수(0..BRUSH_CYCLE).
   *
   * 고체 데모는 이것이 한 바퀴 전부이고, 겹침 데모는 모래와 물 사이에 이 구간을
   * 끼워 체 선을 긋는다. 손놀림이 한 벌이라 한쪽만 고쳐지는 일이 없다.
   */
  private dragBrush(t: number, y: number, id: number, from = BRUSH_X0, to = BRUSH_X1): void {
    const g = this.grid;
    const x0 = Math.round(g.width * from);
    const x1 = Math.round(g.width * to);
    // 드래그 구간에서만 0→1로 흐르는 진행도. 앞뒤 대기 구간에서는 각각 0과 1에
    // 붙어 있으므로 브러시는 계속 보이고 자리만 안 움직인다.
    const p = t < BRUSH_HOLD_IN ? 0 : t < BRUSH_HOLD_IN + BRUSH_DRAG ? (t - BRUSH_HOLD_IN) / BRUSH_DRAG : 1;
    const x = Math.round(x0 + (x1 - x0) * p);
    this.brush = { x, y, r: BRUSH_R, icon: null };
    // 대기 구간에도 계속 찍는다 — 멈춘 브러시가 같은 자리를 덧칠하는 것은
    // 실제 브러시와 같은 동작이고, 드래그 첫 틱에 선이 갑자기 나타나지 않는다.
    if (t >= BRUSH_HOLD_IN) this.paintDisc(x, y, BRUSH_R, id);
  }

  /**
   * (cx,cy) 중심 반지름 r의 원을 `id` 로 칠한다. 브러시가 칸을 직접 쓰는 것은
   * 게임의 브러시와 같다(반응 컨텍스트를 거치지 않는다). 칸마다 tint 를 굴리는
   * 것도 `PointerPainter` 와 같은 식이라, 여기 그어지는 선은 손으로 칠한 것과
   * 같은 알갱이를 갖는다.
   *
   * **빈 칸에만 칠한다.** 겹침 데모가 이미 쌓인 모래 더미 위로 체 선을 긋는데,
   * 더미를 파고들어 칠하면 브러시가 아니라 「지우개 겸 도장」이 된다.
   */
  private paintDisc(cx: number, cy: number, r: number, id: number): void {
    const g = this.grid;
    const initTemp = getMaterial(id).thermal?.init ?? 20;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!g.inBounds(x, y) || g.get(x, y) !== EMPTY) continue;
        g.set(x, y, id);
        g.setTemp(x, y, initTemp);
        g.setTint(x, y, (this.rand() * 256) | 0);
      }
    }
  }

  // --- 가루: 모래 한 줄기 ---------------------------------------------------------

  private tickPowder(): void {
    this.dropStream(this.subjectId, 0.5);
    this.drainFloor();
  }

  /**
   * 가로 비율 `at` 자리에서 한 알갱이를 떨어뜨린다(확률 SAND_CHANCE).
   *
   * **빈 칸에만** 놓는다. 흔들림(`STREAM_JITTER`)이 줄기를 좌우로 한 칸씩 흔드는데,
   * 질산암모늄 장면은 칸막이 벽이 천장까지 서 있어서 그 한 칸이 벽 위에 떨어질 수
   * 있다 — `spawn` 은 있던 것을 덮으므로, 막지 않으면 줄기가 **자기 칸막이에
   * 구멍을 뚫는다.** 더미가 천장까지 차오른 판에서 줄기가 자기 꼭대기를 덮어쓰는
   * 것도 같은 이유로 막힌다.
   */
  private dropStream(id: number, at: number): void {
    if (this.rand() > SAND_CHANCE) return;
    const g = this.grid;
    const jitter = Math.round((this.rand() * 2 - 1) * STREAM_JITTER);
    const x = Math.min(g.width - 1, Math.max(0, Math.round(g.width * at) + jitter));
    if (g.get(x, STREAM_Y) !== EMPTY) return;
    this.sim.context.spawn(x, STREAM_Y, id);
  }

  /**
   * 바닥에서 조금씩 빼낸다. 점유율을 재는 것은 선형 스캔이라 매 틱이 아니라
   * DRAIN_SAMPLE_TICKS 마다이고, 그 사이에는 직전 판정을 그대로 쓴다.
   */
  private drainFloor(): void {
    const g = this.grid;
    if (++this.drainSince >= DRAIN_SAMPLE_TICKS) {
      this.drainSince = 0;
      let filled = 0;
      for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== EMPTY) filled++;
      this.draining = filled / g.cells.length > DRAIN_FILL;
    }
    if (!this.draining) return;
    const floor = g.height - 1;
    for (let k = 0; k < DRAIN_CELLS; k++) {
      const x = Math.floor(this.rand() * g.width);
      if (g.get(x, floor) === EMPTY) continue;
      g.setOverlay(x, floor, 0); // 스며든 액체까지 같이 빠져나간다
      g.set(x, floor, EMPTY);
    }
  }

  // --- 액체: 그릇에 물 붓기 --------------------------------------------------------

  private tickLiquid(): void {
    const { x0, x1, bottom } = this.bowl();
    if (this.overflowAt >= 0) {
      if (this.t - this.overflowAt >= LIQUID_HOLD) this.loop();
      return;
    }
    // 붓는 중. 그릇 밖 바닥에 물이 보이면 넘친 것이다 — 줄기는 그릇 안으로만
    // 떨어지므로, 벽을 타고 넘어오지 않는 한 그 자리에 물이 있을 수 없다.
    if (this.spilled(x0, x1, bottom) || this.t >= LIQUID_POUR_CAP) {
      this.overflowAt = this.t;
      return;
    }
    const g = this.grid;
    const x = Math.round((x0 + x1) / 2);
    this.sim.context.spawn(x, STREAM_Y, this.subjectId);
    // 두 칸씩 부어야 그릇이 볼 만한 시간 안에 찬다. 좌우로 한 칸 벌려 두면
    // 줄기가 한 칸 굵기 그대로 보이면서 유량만 두 배가 된다.
    if (x + 1 < g.width) this.sim.context.spawn(x + 1, STREAM_Y, this.subjectId);
  }

  /** 그릇 밖(바닥 줄 아래)에 붓는 물질이 있는가. */
  private spilled(x0: number, x1: number, bottom: number): boolean {
    const g = this.grid;
    const wid = this.subjectId;
    for (let y = bottom + 1; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (x > x0 && x < x1) continue; // 그릇 바로 아래는 벽에 막혀 있다
        if (g.get(x, y) === wid) return true;
      }
    }
    return false;
  }

  // --- 기체: 연기가 계속 오른다 -----------------------------------------------------

  private tickGas(): void {
    const g = this.grid;
    const floor = g.height - 2;
    const lo = Math.round(g.width * SMOKE_X0);
    const hi = Math.round(g.width * SMOKE_X1);
    for (let k = 0; k < SMOKE_PER_TICK; k++) {
      const x = lo + Math.floor(this.rand() * (hi - lo + 1));
      if (g.get(x, floor) !== EMPTY) continue;
      this.sim.context.spawn(x, floor, this.subjectId);
    }
  }

  // --- 겹침: 체 위에 모래, 그 위로 물 -----------------------------------------------

  private tickOverlap(): void {
    const t = this.t;
    if (t >= OVERLAP_CYCLE) {
      this.loop();
      return;
    }
    // 1) 체 선을 먼저 긋는다. 브러시는 이 구간에만 보인다 — 모래가 떨어지는 동안이나
    // 물이 뿌려지는 동안에도 커서가 떠 있으면 그 손이 그것까지 하는 것으로 읽힌다.
    if (t < OVERLAP_MESH) {
      this.dragBrush(t, Math.round(this.grid.height * MESH_Y), DEMO_MESH.id, MESH_X0, MESH_X1);
      return;
    }
    this.brush = null;
    // 2) 모래 6초. 체가 깔려 있으므로 더미는 체 위에 쌓인다.
    const st = t - OVERLAP_MESH;
    if (st < OVERLAP_SAND) {
      this.dropStream(DEMO_SAND.id, 0.5);
      return;
    }
    // 3) 물 3초. 물은 모래 사이를 스며내려 체를 통과해 아래로 빠진다.
    const wt = st - OVERLAP_SAND;
    if (wt < OVERLAP_WATER) this.dropStream(DEMO_WATER.id, 0.5);
  }

  // --- 열전도: 파이프 한 줄과 불 --------------------------------------------------

  private tickHeat(): void {
    const t = this.t;
    if (t >= HEAT_CYCLE) {
      this.loop();
      return;
    }
    this.heatView = t >= HEAT_NORMAL;
  }

  // --- 물질별 맞춤 데모 ---------------------------------------------------------
  //
  // 모두 tickOverlap 과 같은 구조: 누적 틱 t 를 단계별 창으로 쪼개고, 각 창에서
  // 한 동작만 하며 early return. 마지막 단계가 지나면 loop() 로 격자를 비우고
  // 처음부터(build 가 고정 배치를 다시 놓는다).

  /**
   * wall: 가운데 벽 블록이 TNT → 산 → 녹은 U235 세 위협에 모두 살아남는 것을
   * 보여 준다. 매 사이클마다 위협의 위치가 랜덤으로 바뀐다.
   *
   * 단계(대본 상수 참고):
   *  [0, TNT_FUSE)        TNT 배치는 0틱에 한 번. 이 구간은 도화선 타는 시간.
   *  [TNT_FUSE, +BLAST)   도화선 끝: TNT 인접 칸에 FIRE 스폰 → 다음 틱에 기폭.
   *  [+BLAST, +ACID)      위에서 산 줄기 2초.
   *  [+ACID, +U235)       0틱에 U235 2×2 배치. 이 구간은 임계 도달 대기.
   *  [+U235, +TAIL)       관찰 → 초기화.
   */
  private tickWall(): void {
    const t = this.t;
    if (t >= WALL_CYCLE) {
      this.loop();
      return;
    }
    const box = this.blockBox();

    if (t === 0) {
      // 0틱에 TNT 사각형 블록 배치. 다음 사이클에선 loop()→reset()→build() 로 블록만
      // 다시 놓이고, TNT 자리는 비워지므로 매 사이클 새 위치.
      this.spawnTntBlock(box);
      return;
    }
    if (t < WALL_TNT_FUSE) return; // 도화선 대기

    if (t === WALL_TNT_FUSE) {
      // 도화선 점화: TNT 인접 빈 칸에 FIRE 스폰 → updateTNT 가 이웃 검사로 기폭.
      this.igniteNearestTnt(box);
      return;
    }
    if (t < WALL_TNT_FUSE + WALL_BLAST) return; // 폭발이 지나가도록 관찰

    const acidEnd = WALL_TNT_FUSE + WALL_BLAST + WALL_ACID;
    if (t < acidEnd) {
      // 위에서 산 줄기. 벽은 산에 부식되지 않고 줄기는 벽 주변으로 흘러내린다.
      this.dropStream(DEMO_ACID.id, POUR_AT);
      return;
    }

    const u235Start = acidEnd;
    const u235End = u235Start + WALL_U235;
    if (t === u235Start) {
      // 녹은 U235 5×5 덩어리를 배치. 작은 덩어리는 흘러 흩어져 임계에 못 다다르므로
      // 충분히 크게 놓는다(spawnU235Clump 주석 참고). spawn 으로 놓아 init 온도
      // (1600°)가 보장되게 한다.
      this.spawnU235Clump(box);
      return;
    }
    if (t < u235End) return; // 임계 도달 → 핵광이 화면을 쓸고 벽 블록이 살아남는다
    // WALL_TAIL: 관찰 후 loop() 가 격자를 비운다.
  }

  /** box 근처의 TNT 한 칸을 찾아 그 이웃 빈 칸에 FIRE 를 스폰한다(자연 기폭 경로). */
  private igniteNearestTnt(box: { cx: number; cy: number; half: number }): void {
    const g = this.grid;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (g.get(x, y) !== DEMO_TNT.id) continue;
        // TNT 의 8이웃 중 빈 칸 하나에 불을 올린다.
        for (const [dx, dy] of NEIGHBORS_8) {
          const nx = x + dx;
          const ny = y + dy;
          if (!g.inBounds(nx, ny) || g.get(nx, ny) !== EMPTY) continue;
          this.sim.context.spawn(nx, ny, DEMO_FIRE.id);
          return;
        }
      }
    }
    void box;
  }

  /**
   * TNT 를 `TNT_BLOCK`×`TNT_BLOCK` 블록으로 box(벽/흑요석 블록)에서 떨어진 자리에
   * 놓는다. 단일 칸은 화면에서 점이라 보이지 않으므로 작은 덩어리로 놓는다 — 폭발
   * 규모는 blastRadius 가 정하므로 칸 수가 결과를 바꾸진 않는다.
   */
  private spawnTntBlock(box: { cx: number; cy: number; half: number }): void {
    const g = this.grid;
    const size = TNT_BLOCK;
    const half = size >> 1;
    const minDist = box.half + half + 1;
    for (let i = 0; i < 64; i++) {
      const x0 = 2 + Math.floor(this.rand() * (g.width - size - 3));
      const y0 = 2 + Math.floor(this.rand() * (g.height - size - 3));
      const cx = x0 + half;
      const cy = y0 + half;
      if (Math.abs(cx - box.cx) < minDist) continue;
      if (Math.abs(cy - box.cy) < minDist) continue;
      let clear = true;
      for (let dy = 0; dy < size && clear; dy++) {
        for (let dx = 0; dx < size && clear; dx++) {
          if (g.get(x0 + dx, y0 + dy) !== EMPTY) clear = false;
        }
      }
      if (!clear) continue;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          this.sim.context.spawn(x0 + dx, y0 + dy, DEMO_TNT.id);
        }
      }
      return;
    }
  }

  /**
   * 녹은 U235 를 box(벽 블록)에서 떨어진 자리에 `U235_CLUMP_SIZE`×같 크기 덩어리로
   * 놓는다. **울타리 없이** 순수한 액체 덩어리다.
   *
   * **왜 큰 덩어리인가** — MOLTEN_URANIUM 은 액체라 중력으로 흘러내린다. 작은
   * 덩어리(3×3 이하)는 가장자리가 흘러 흩어지는 속도가 중심의 자가발열(+3/이웃)이
   * 임계(2000°)에 다다르는 속도를 이긴다 — 바닥에 닿아 전도로 열이 빠지면 굳어버린다.
   * 5×5(=25칸)면 중심 셀의 이웃이 충분히 많아 발열이 누적해 약 29틱(1초)에 임계에
   * 다다른다(8/8 seed 관측). 가장자리는 흘러내리지만 중심은 그 사이 임계를 넘겨
   * Nuclear Ray 를 뿜기 시작하고, 광선이 닿은 다른 우라늄을 즉시 녹여 가열하므로
   * 연쇄가 퍼진다(nuclearray 의 URANIUM→MOLTEN 즉변 + 800° 주입).
   *
   * 이전에는 WALL 울타리로 액체를 가뒀지만, 벽 카드에서 **벽으로 U235 를 가둬**
   * 보이는 것은 "벽이 위협에 견딘다"는 결론을 흐린다. 울타리 없는 순수 덩어리가
   * 시각적으로도 솔직하다 — 핵광이 화면을 쓸고 난 뒤 벽 블록이 멀쩡히 남는 것으로
   * 결론이 말해진다.
   *
   * 배치 영역이 box(벽 블록)와 겹치지 않고 전부 빈 칸인 자리를 고른다. 격자 위쪽에
   * 가깝게(아래에 여유) 두어 흘러내릴 공간을 준다.
   */
  private spawnU235Clump(box: { cx: number; cy: number; half: number }): void {
    const g = this.grid;
    const size = U235_CLUMP_SIZE;
    const half = size >> 1;
    const minDist = box.half + half + 1;
    for (let i = 0; i < 64; i++) {
      const isLeft = this.rand() < 0.5;
      const x0 = isLeft ? 3 : g.width - size - 3;
      const y0 = 3;
      const cx = x0 + half;
      const cy = y0 + half;
      // box(중앙 벽 블록)와 겹치지 않게.
      if (Math.abs(cx - box.cx) < minDist) continue;
      if (Math.abs(cy - box.cy) < minDist) continue;
      // 배치 영역이 전부 빈 칸인지 확인.
      let clear = true;
      for (let dy = 0; dy < size && clear; dy++) {
        for (let dx = 0; dx < size && clear; dx++) {
          if (g.get(x0 + dx, y0 + dy) !== EMPTY) clear = false;
        }
      }
      if (!clear) continue;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          this.sim.context.spawn(x0 + dx, y0 + dy, DEMO_MOLTEN_URANIUM.id);
        }
      }
      return;
    }
  }

  /**
   * obsidian: 두 액트. 액트1은 생성(용암+물→흑요석 급냉), 액트2는 내성(TNT×2).
   * 중간에 buildObsidianBlock() 으로 장면을 전환한다.
   *
   * 단계:
   *  [0, OBS_WATER)                위에서 물 1.5초 → 용암에 닿아 흑요석 생성.
   *  [OBS_WATER, +OBS_FORM)        4초 관찰.
   *  [+OBS_FORM, +INTERLUDE)       장면 전환: 격자 비우고 흑요석 블록.
   *  그 뒤 TNT(1초 도화선→격발→1.5초 관찰) ×2, OBS_TAIL 관찰 → 초기화.
   */
  private tickObsidian(): void {
    const t = this.t;
    if (t >= OBS_CYCLE) {
      this.loop();
      return;
    }

    const formEnd = OBS_WATER + OBS_FORM;
    const act2Start = formEnd + OBS_INTERLUDE;

    // --- 액트1: 생성 ---
    if (t < OBS_WATER) {
      this.dropStream(DEMO_WATER.id, POUR_AT);
      return;
    }
    if (t < formEnd) return; // 흑요석이 굳는 것을 관찰

    // --- 장면 전환 ---
    if (t === act2Start) {
      this.buildObsidianBlock();
      return;
    }

    // --- 액트2: 내성 (TNT ×2) ---
    // 전환 틱(act2Start)은 위에서 잡아 return 했으므로, 여기서부턴 t >= act2Start+1.
    // tnt1Fuse 를 act2Start 가 아닌 그 다음 틱으로 두어 같은-틱 충돌을 피한다(soda 의
    // act2Pour 패턴과 같다).
    const box = this.blockBox();
    const tnt1Fuse = act2Start + 1; // 블록 세팅 다음 틱에 TNT1 배치
    const tnt1Blast = tnt1Fuse + OBS_TNT_FUSE;
    const tnt1Hold = tnt1Blast + OBS_TNT_BLAST;
    const tnt2Fuse = tnt1Hold; // 이어서 TNT2 배치
    const tnt2Blast = tnt2Fuse + OBS_TNT_FUSE;
    const tnt2Hold = tnt2Blast + OBS_TNT_BLAST;

    if (t === tnt1Fuse) {
      this.spawnTntBlock(box);
      return;
    }
    if (t === tnt1Blast) {
      this.igniteNearestTnt(box);
      return;
    }
    if (t < tnt1Hold) return;

    if (t === tnt2Fuse) {
      this.spawnTntBlock(box);
      return;
    }
    if (t === tnt2Blast) {
      this.igniteNearestTnt(box);
      return;
    }
    if (t < tnt2Hold) return;
    // OBS_TAIL: 관찰 후 loop()
  }

  /**
   * saltwater·sugarwater 공통: 그릇에 물을 부은 뒤 같은 자리에서 용질(소금/설탕)을
   * 떨어뜨린다. 가루가 담수 주머니를 녹아든 용액으로 바꾼다. 물은 2칸 줄기로 두 배 부어
   * 수심을 넉넉히 잡는다.
   *
   * 단계: 물 3초 → 용질 1초 → 관찰 3초 → 초기화.
   */
  private tickDissolve(soluteId: number): void {
    const solute = this.subjectId === DEMO_SOAP.id ? DEMO_SOAP.id : soluteId;
    const t = this.t;
    if (t >= DISSOLVE_CYCLE) {
      this.loop();
      return;
    }
    if (t < DISSOLVE_WATER) {
      this.dropLiquidStream(DEMO_WATER.id, POUR_AT);
      return;
    }
    if (t < DISSOLVE_WATER + DISSOLVE_SOLUTE) {
      this.dropStream(solute, POUR_AT);
      return;
    }
    // DISSOLVE_HOLD: 섞이는 것을 관찰 후 loop()
  }

  /** 가로 비율 `at` 자리에 2칸 굵기 액체 줄기를 부어 유량을 두 배로 만든다. */
  private dropLiquidStream(id: number, at: number): void {
    const g = this.grid;
    const x = Math.round(g.width * at);
    this.sim.context.spawn(x, STREAM_Y, id);
    if (x + 1 < g.width) this.sim.context.spawn(x + 1, STREAM_Y, id);
  }

  /**
   * soda: 두 액트. 액트1은 산 중화(소다+산→소금물+가스), 액트2는 반죽과 반응.
   * 중간에 buildBatterPool() 로 장면을 전환한다.
   *
   * 단계(각 액트): 소다 2초 → 관찰 3초. 사이에 SODA_INTERLUDE 틱의 전환.
   */
  private tickSoda(): void {
    const t = this.t;
    if (t >= SODA_CYCLE) {
      this.loop();
      return;
    }

    const act1Pour = SODA_POUR;
    const act1End = act1Pour + SODA_REACT;
    const act2Start = act1End + SODA_INTERLUDE;
    const act2Pour = act2Start + SODA_POUR;
    const act2End = act2Pour + SODA_REACT;

    // --- 액트1: 산 중화 ---
    if (t < act1Pour) {
      this.dropStream(DEMO_SODA.id, POUR_AT);
      return;
    }
    if (t < act1End) return; // 중화 반응 관찰

    // --- 장면 전환 ---
    if (t === act2Start) {
      this.buildBatterPool();
      return;
    }

    // --- 액트2: 반죽과 반응 ---
    if (t < act2Pour) {
      this.dropStream(DEMO_SODA.id, POUR_AT);
      return;
    }
    if (t < act2End) return; // 반죽이 부풀 준비를 하는 것을 관찰
    // loop() 가 완전 초기화(격자 비움 → build 가 산 웅덩이를 다시 놓는다)
  }

  // --- 배역표가 딸린 맞춤 연출: 공용 손놀림 ------------------------------------
  //
  // 위의 다섯과 갈리는 지점은 **물질을 어디서 얻는가** 하나다. 저쪽은 경량 배럴에
  // 이름으로 들여놓은 것을 직접 집고, 이쪽은 대본이 모르는 물질을 `DemoCast` 로
  // 건네받는다(CODEX.md §16.1). 박자를 쪼개는 방식은 똑같다.

  /**
   * `x0..x1` 칸 구간에서 **가장 높이 쌓인 자리**를 찾아 그 봉우리에 불을 붙인다.
   * 격발·점화는 전부 이 한 손을 거치고, `trigger` 가 불이냐 전기냐만 가른다.
   *
   * 좌표를 대본에 박지 않고 매번 격자에서 찾는 이유는, 같은 대본이 가루와 액체
   * 모두를 상대하기 때문이다 — 3초어치 니트로는 넓고 얕은 웅덩이가 되고 같은
   * 3초의 섬광화약은 좁고 높은 봉우리가 된다. 「꼭대기」는 둘 다에서 뜻이 통하는
   * 유일한 자리다.
   */
  private ignitePile(x0: number, x1: number): void {
    const g = this.grid;
    const lo = Math.max(0, x0);
    const hi = Math.min(g.width - 1, x1);
    let bestX = -1;
    let bestY = g.height;
    for (let x = lo; x <= hi; x++) {
      const y = this.topOf(x);
      if (y >= 0 && y < bestY) {
        bestY = y;
        bestX = x;
      }
    }
    // 더미가 없으면 아무것도 안 한다 — 이미 터진 뒤라면 크레이터 위에 불만 남는다.
    if (bestX < 0) return;
    // 꼭대기 한 점이 아니라 **봉우리 둘레의 등고선을 따라** 손을 댄다. 한 점만
    // 노리면 그 자리가 튀어나온 알갱이 하나일 때 불이 더미에서 몇 칸 뜬 채로 타다
    // 만다(실측: 여덟 판 중 한 판이 아무것도 안 터진 채 끝났다). 칸마다 그 칸의
    // 꼭대기를 다시 찾으면 손이 더미 표면에 붙어 내려앉는다.
    //
    // 전기는 더미 **자체**를 찌르고(전극을 갖다 대는 그림), 불은 더미 **위 칸**에
    // 놓는다(불은 빈 칸에만 앉는다). 그래서 두 갈래가 겨누는 줄이 한 칸 다르다.
    const spark: number[] = [];
    for (let dx = -IGNITE_SPREAD; dx <= IGNITE_SPREAD; dx++) {
      const x = bestX + dx;
      if (x < lo || x > hi) continue;
      const top = this.topOf(x);
      if (top < 0) continue;
      if (this.trigger === 'spark') {
        spark.push(x, Math.max(0, top));
        continue;
      }
      if (top === 0) {
        if (g.get(x, 0) !== DEMO_WALL.id) {
          this.sim.context.spawn(x, 0, DEMO_FIRE.id);
        }
        continue;
      }
      if (g.get(x, top - 1) !== EMPTY) {
        if (g.get(x, top) !== DEMO_WALL.id) {
          this.sim.context.spawn(x, top, DEMO_FIRE.id);
        }
        continue;
      }
      this.sim.context.spawn(x, top - 1, DEMO_FIRE.id);
    }
    // 게임의 전기 브러시와 같은 호출. 폭약을 만난 펄스는 곁에 불씨 한 칸을 앉히고
    // 그 칸이 **다음 틱에** 기폭시키므로(spark.ts 의 `tryArcExplosive`), 화면에
    // 남는 주황색은 한 틱짜리 한 칸뿐이다.
    if (spark.length > 0) sparkCells(this.sim.context, spark);
  }

  /**
   * `x` 칸에서 가장 위에 있는 **실체**의 줄 번호. 없으면 -1.
   *
   * 불과 연기는 건너뛴다 — 둘 다 **이 손이 방금 만든 것**이라, 세지 않으면 불을
   * 대고 있는 1초 동안 커서가 자기 불꽃을 더미로 착각해 위로 기어오른다. 벽을
   * 만나면 그 칸은 통째로 칸막이라는 뜻이라 없는 것으로 친다(질산암모늄 장면의
   * 칸막이는 천장까지 서 있어서, 안 그러면 언제나 그것이 「가장 높은 것」이 된다).
   */
  private topOf(x: number): number {
    const g = this.grid;
    for (let y = 0; y < g.height; y++) {
      const id = g.get(x, y);
      if (id === EMPTY || id === DEMO_FIRE.id || id === DEMO_SMOKE.id) continue;
      return id === DEMO_WALL.id ? -1 : y;
    }
    return -1;
  }

  /**
   * 섞기 브러시가 `x0..x1` 을 `sweeps` 번의 가로 획으로 훑는다. `p` 는 이 구간의
   * 진행도(0→1)이고, 세로로는 그동안 `y0` 에서 `y1` 까지 **내려갔다 올라온다**.
   * `y0 === y1` 이면 높이 변화 없이 한 줄에서만 오간다.
   *
   * 세로 왕복이 있는 이유는 더미가 앉은 띠를 여러 번 지나가야 하기 때문이다.
   * 훑고 내려가기만 하면 그 띠를 한 번밖에 안 지나가고, 그러면 알갱이가 「지나가면서
   * 조금 흐트러진」 정도로 끝나 서로 다른 세 재료가 맞닿아야 성립하는 조합이 거의
   * 안 걸린다(실측: 세 줄기 130알에 화약 3칸). 브러시를 아예 바닥에 붙여 두면
   * (`y0 === y1`) 반지름이 더미 높이를 통째로 덮으므로 세로로 움직일 이유가 없어진다.
   *
   * 칠하는 게 아니라 `mixCells` 를 부른다. 게임의 섞기 도구가 쓰는 바로 그
   * 함수라, 여기서 일어나는 일은 플레이어가 같은 도구로 하는 일과 같다(고체는
   * 안 섞이고, 벽으로 갈린 칸끼리는 섞이지 않는다 — 질산암모늄 장면의 3등분이
   * 휘젓는 동안에도 유지되는 것이 그 덕이다).
   */
  private stir(
    p: number,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    sweeps: number,
  ): void {
    const g = this.grid;
    const q = Math.min(Math.max(p, 0), 1);
    const u = q * sweeps;
    // 짝수 획은 왼쪽 → 오른쪽, 홀수 획은 되돌아온다. `p === 1` 이면 u 가 정확히
    // sweeps 라 나머지가 0으로 떨어지는데, 그때는 다음 획의 시작이 아니라 **마지막
    // 획의 끝**에 서 있어야 한다.
    const legIndex = Math.min(Math.floor(u), sweeps - 1);
    const legP = u >= sweeps ? 1 : u - legIndex;
    const along = legIndex % 2 === 0 ? legP : 1 - legP;
    const x = Math.round(x0 + (x1 - x0) * along);
    const down = q < 0.5 ? q * 2 : (1 - q) * 2;
    const y = Math.round(y0 + (y1 - y0) * down);
    this.brush = { x, y, r: STIR_R, icon: 'mix' };
    // 브러시 발자국을 평평한 [x,y,x,y,…] 로. mixCells 가 기대하는 모양이고,
    // 게임의 원형 브러시와 같은 원판 마스크다.
    const cells: number[] = [];
    for (let dy = -STIR_R; dy <= STIR_R; dy++) {
      for (let dx = -STIR_R; dx <= STIR_R; dx++) {
        if (dx * dx + dy * dy > STIR_R * STIR_R) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (!g.inBounds(cx, cy)) continue;
        cells.push(cx, cy);
      }
    }
    mixCells(g, cells, this.rand);
  }

  /** 막이 바뀔 때 무대만 치운다 — `loop()` 과 달리 바퀴 수도 시계도 안 건드린다. */
  private clearStage(): void {
    this.brush = null;
    this.grid.clear();
    this.build();
  }

  // --- 산: 금속 바닥을 갉아 뚫는다 ------------------------------------------------

  private tickAcid(): void {
    const t = this.t;
    if (t >= ACID_CYCLE) {
      this.loop();
      return;
    }
    if (t < ACID_POUR) this.dropStream(this.subjectId, 0.5);
  }

  // --- 격발: 붓고, 쉬고, 불을 댄다 -------------------------------------------------

  private tickIgnite(): void {
    const t = this.t;
    if (t >= IGNITE_CYCLE) {
      this.loop();
      return;
    }
    if (t < IGNITE_POUR) {
      this.dropStream(this.subjectId, 0.5);
      return;
    }
    if (t >= IGNITE_AT && t < IGNITE_AT + IGNITE_FLAME) this.ignitePile(0, this.grid.width - 1);
  }

  // --- 화약: 1막 둔덕, 2막 조합 ----------------------------------------------------

  private tickGunpowder(): void {
    const t = this.t;
    if (t >= GP_CYCLE) {
      this.loop();
      return;
    }
    if (t < GP_ACT1) {
      this.tickGunpowderBerm(t);
      return;
    }
    // 막의 첫 틱에 무대를 치운다. `loop()` 이 아니라 `clearStage()` 인 것은 이게
    // 한 바퀴의 끝이 아니라 **같은 바퀴의 2막**이기 때문이다.
    const at = t - GP_ACT1;
    if (at === 0) this.clearStage();
    this.tickGunpowderMix(at);
  }

  /** 1막: 좌우 모래 둔덕 2초, 가운데 화약 4초, 1초 뒤 점화. */
  private tickGunpowderBerm(t: number): void {
    if (t < GP_BERM) for (const at of GP_BERM_AT) this.dropStream(DEMO_SAND.id, at);
    if (t < GP_PILE) {
      this.dropStream(this.subjectId, GP_PILE_AT);
      return;
    }
    if (t >= GP_ACT1_FIRE && t < GP_ACT1_FIRE + IGNITE_FLAME) {
      // 가운데 더미만 겨눈다 — 좌우 모래 둔덕이 화약보다 높은 판에서 「가장 높은
      // 자리」를 화면 전체에서 찾으면 불이 모래 위에 붙어 아무 일도 안 일어난다.
      const g = this.grid;
      const mid = Math.round(g.width * GP_PILE_AT);
      this.ignitePile(mid - 4, mid + 4);
    }
  }

  /** 2막: 세 재료 2초 → 섞기 브러시 3초 → 1초 대기 → 격발. */
  private tickGunpowderMix(t: number): void {
    const recipe = this.cast?.recipe;
    if (recipe === undefined) return;
    if (t < GP_MIX_POUR) {
      for (let i = 0; i < recipe.length; i++) this.dropStream(recipe[i], GP_MIX_AT[i]);
      return;
    }
    const st = t - GP_MIX_POUR;
    if (st < GP_MIX_STIR) {
      const g = this.grid;
      // **맨 아래에서 왕복 한 번.** 높이는 안 변한다 — 반지름 5짜리 발자국이 바닥에
      // 붙어 있으면 더미 높이를 통째로 덮으므로, 위아래로 움직이는 것은 알갱이가
      // 없는 허공을 훑는 시간만 늘린다. 가로로는 여전히 캔버스를 끝에서 끝까지 간다.
      const floor = g.height - 2;
      this.stir(st / GP_MIX_STIR, 2, g.width - 3, floor, floor, STIR_SWEEPS_FLAT);
      return;
    }
    this.brush = null;
    if (t >= GP_ACT2_FIRE && t < GP_ACT2_FIRE + IGNITE_FLAME) {
      this.ignitePile(0, this.grid.width - 1);
    }
  }

  // --- 질산암모늄: 3등분한 칸에서 맨 프릴 · 암모날 · ANFO ------------------------------

  private tickAmmoniumNitrate(): void {
    const t = this.t;
    if (t >= AN_CYCLE) {
      this.loop();
      return;
    }
    const g = this.grid;
    if (t < AN_POUR) {
      for (const at of AN_CELL_AT) this.dropStream(this.subjectId, at);
      return;
    }
    const fuels = this.cast?.fuels;
    const ft = t - AN_POUR - AN_WAIT1;
    // 왼쪽 칸에는 아무것도 안 붓는다 — 그게 이 장면의 대조군이다.
    if (fuels !== undefined && ft >= 0 && ft < AN_FUEL) {
      this.dropStream(fuels[0], AN_CELL_AT[1]);
      this.dropStream(fuels[1], AN_CELL_AT[2]);
      return;
    }
    const st = ft - AN_FUEL;
    if (st >= 0 && st < AN_STIR) {
      // 아래쪽 절반만. 더미가 앉은 자리이고, 칸막이가 획을 세 도막으로 끊어 주므로
      // (`mixCells` 는 고체를 못 넘는다) 한 번 지나가는 것으로 세 칸이 **각자**
      // 섞인다 — 브러시 하나가 세 칸을 한꺼번에 훑는데도 재료가 옆 칸으로 새지 않는다.
      this.stir(
        st / AN_STIR,
        2,
        g.width - 3,
        Math.round(g.height * 0.6),
        g.height - 2,
        STIR_SWEEPS_BAND,
      );
      return;
    }
    this.brush = null;
    if (t >= AN_FIRE && t < AN_FIRE + IGNITE_FLAME) {
      // 세 칸을 **같은 틱에** 겨눈다. 시차가 생기면 먼저 간 쪽의 충격파가 나머지를
      // 물고 들어가 「셋을 나란히 비교한다」가 성립하지 않는다.
      const [a, b] = this.partitions();
      this.ignitePile(0, a - 1);
      this.ignitePile(a + 1, b - 1);
      this.ignitePile(b + 1, g.width - 1);
    }
  }

  /** 칸막이 두 줄의 x 좌표. 배치와 대본이 같은 값을 읽도록 계산을 한 군데 둔다. */
  private partitions(): [number, number] {
    const g = this.grid;
    return [Math.round(g.width / 3), Math.round((g.width * 2) / 3)];
  }

  // --- 추가 맞춤 연출 -------------------------------------------------------------

  /** open_ignite: 벽 용기 없이 3초 붓고 점화 (원유·휘발유·경유·등유·LPG·톱밥·레진) */
  private tickOpenIgnite(): void {
    const t = this.t;
    if (t >= OPEN_IGNITE_CYCLE) {
      this.loop();
      return;
    }
    if (t < OPEN_IGNITE_POUR) {
      const isGas = getMaterial(this.subjectId).phase === Phase.Gas;
      if (isGas) {
        this.dropGasStream(this.subjectId, 0.5);
      } else {
        this.dropLiquidStream(this.subjectId, 0.5);
      }
      return;
    }
    if (t >= OPEN_IGNITE_AT && t < OPEN_IGNITE_AT + IGNITE_FLAME) {
      this.ignitePile(0, this.grid.width - 1);
      const isGas = getMaterial(this.subjectId).phase === Phase.Gas;
      if (isGas) {
        const g = this.grid;
        const midX = Math.round(g.width * 0.5);
        for (let y = 0; y < g.height; y++) {
          if (g.get(midX, y) === this.subjectId) {
            this.sim.context.spawn(midX, y, DEMO_FIRE.id);
            break;
          }
        }
      }
    }
  }

  /** 기체 전용: 아래에서 생성되어 위로 솟구친다. */
  private dropGasStream(id: number, at: number): void {
    if (this.rand() > SAND_CHANCE) return;
    const g = this.grid;
    const jitter = Math.round((this.rand() * 2 - 1) * STREAM_JITTER);
    const x = Math.min(g.width - 1, Math.max(0, Math.round(g.width * at) + jitter));
    const y = g.height - 2;
    if (g.get(x, y) !== EMPTY) return;
    this.sim.context.spawn(x, y, id);
    if (x + 1 < g.width && g.get(x + 1, y) === EMPTY) {
      this.sim.context.spawn(x + 1, y, id);
    }
  }

  /** brush_ignite: 브러시로 생성 후 아래에 불 생성으로 점화 (석탄·나무·레진) */
  private tickBrushIgnite(): void {
    const t = this.t;
    if (t >= BRUSH_IGNITE_CYCLE) {
      this.loop();
      return;
    }
    const lineY = Math.round(this.grid.height * 0.55);
    if (t < BRUSH_IGNITE_DRAG) {
      this.dragBrush(t, lineY, this.subjectId);
      return;
    }
    this.brush = null;
    if (t >= BRUSH_IGNITE_DRAG && t < BRUSH_IGNITE_DRAG + IGNITE_FLAME) {
      const g = this.grid;
      const x0 = Math.round(g.width * BRUSH_X0);
      const x1 = Math.round(g.width * BRUSH_X1);
      const fireY = lineY + BRUSH_R + 1;
      for (let x = x0; x <= x1; x++) {
        if (g.inBounds(x, fireY) && g.get(x, fireY) === EMPTY) {
          this.sim.context.spawn(x, fireY, DEMO_FIRE.id);
        }
      }
    }
  }

  /** glass_shockwave: 고체 유리 배치 후 1초 대기 후 충격파 (유리·깨진 유리) */
  private buildGlassBlock(): void {
    const g = this.grid;
    const x0 = Math.round(g.width * 0.3);
    const x1 = Math.round(g.width * 0.7);
    const y0 = Math.round(g.height * 0.45);
    const y1 = Math.round(g.height * 0.65);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        g.set(x, y, GLASS.id);
      }
    }
  }

  private triggerGlassShockwave(): void {
    const g = this.grid;
    const x0 = Math.round(g.width * 0.3);
    const x1 = Math.round(g.width * 0.7);
    const yUnder = Math.min(g.height - 1, Math.round(g.height * 0.65) + 1);
    const cells: number[] = [];
    for (let x = x0; x <= x1; x++) {
      cells.push(x, yUnder);
    }
    fireShockwave(this.sim.context, cells);
  }

  private tickGlassShockwave(): void {
    const t = this.t;
    if (t >= GLASS_CYCLE) {
      this.loop();
      return;
    }
    if (t === GLASS_WAIT) {
      this.triggerGlassShockwave();
    }
  }

  /** 기체 전용: 특정 X 좌표 아래에서 생성되어 위로 솟구친다. */
  private dropGasStreamAtX(id: number, x: number): void {
    if (this.rand() > SAND_CHANCE) return;
    const g = this.grid;
    const y = g.height - 2;
    if (!g.inBounds(x, y) || g.get(x, y) !== EMPTY) return;
    this.sim.context.spawn(x, y, id);
  }

  /** hydrogen_oxygen: 3초간 수소+산소 가운데 한 칸 차이로 아래에서 생성 후 2초 대기 후 점화 (산소·수소) */
  private tickHydrogenOxygen(): void {
    const t = this.t;
    if (t >= HO_CYCLE) {
      this.loop();
      return;
    }
    if (t < HO_POUR) {
      const midX = this.grid.width >> 1;
      this.dropGasStreamAtX(HYDROGEN.id, midX - 1);
      this.dropGasStreamAtX(OXYGEN.id, midX + 1);
      return;
    }
    if (t < HO_AT) return;
    if (t === HO_AT) {
      const g = this.grid;
      const midX = g.width >> 1;
      const upperY = Math.max(1, Math.round(g.height * 0.2));
      if (g.inBounds(midX, upperY)) {
        this.sim.context.spawn(midX, upperY, DEMO_FIRE.id);
      }
    }
  }

  /** soapywater: 1막 비누 용해 7초 후 2막 비눗물 웅덩이에서 바이러스 소독 및 휘발유 유화 (비눗물) */
  private tickSoapyWater(): void {
    const t = this.t;
    if (t >= SOAPY_CYCLE) {
      this.loop();
      return;
    }

    if (t < DISSOLVE_CYCLE) {
      this.tickDissolve(DEMO_SOAP.id);
      return;
    }

    const act2Start = DISSOLVE_CYCLE;
    if (t === act2Start) {
      this.buildSoapyWaterPool();
      return;
    }

    const virusPourEnd = act2Start + SOAPY_VIRUS_POUR;
    const virusHoldEnd = virusPourEnd + SOAPY_VIRUS_HOLD;
    const gasPourEnd = virusHoldEnd + SOAPY_GAS_POUR;

    const virusId = this.cast?.soapyCleaners?.[0] ?? DEMO_SAND.id;
    const gasId = this.cast?.soapyCleaners?.[1] ?? DEMO_WATER.id;

    if (t < virusPourEnd) {
      this.dropStream(virusId, POUR_AT);
      return;
    }
    if (t < virusHoldEnd) return;

    if (t < gasPourEnd) {
      this.dropStream(gasId, POUR_AT);
      return;
    }
  }

  private buildSoapyWaterPool(): void {
    this.grid.clear();
    this.buildPool(DEMO_SOAPY_WATER.id, 9);
    this.grid.randomizeTints();
  }

  /** saltpeter: 1막 초석 단독 연소 후 2막에서 초석 3초 줄기 + 캐러멜 3초 생성 → 4초 대기 → 점화 (질산칼륨) */
  private tickSaltpeter(): void {
    const t = this.t;
    if (t >= SP_CYCLE) {
      this.loop();
      return;
    }

    if (t < SP_ACT1) {
      if (t < SP_BERM) {
        for (const at of GP_BERM_AT) this.dropStream(DEMO_SAND.id, at);
      }
      if (t < SP_PILE) {
        this.dropStream(this.subjectId, GP_PILE_AT);
      }
      if (t >= SP_ACT1_FIRE && t < SP_ACT1_FIRE + IGNITE_FLAME) {
        this.ignitePile(0, this.grid.width - 1);
      }
      return;
    }

    const act2T = t - SP_ACT1;
    if (act2T === 0) {
      this.grid.clear();
      return;
    }

    if (act2T < SP_POUR2) {
      this.dropStream(this.subjectId, 0.4);
      this.dropStream(DEMO_CARAMEL.id, 0.5);
      return;
    }
    if (act2T < SP_FIRE2) return;

    if (act2T >= SP_FIRE2 && act2T < SP_FIRE2 + IGNITE_FLAME) {
      this.ignitePile(0, this.grid.width - 1);
    }
  }

  /** alcohol: 바닥 알코올 웅덩이에 바이러스 1초 붓기 -> 3초 소독 관찰 -> 1초 불 점화 및 연소 3초 관찰 후 초기화 (알코올) */
  private tickAlcohol(): void {
    const t = this.t;
    if (t >= ALCOHOL_CYCLE) {
      this.loop();
      return;
    }

    const virusId = this.cast?.soapyCleaners?.[0] ?? DEMO_SAND.id;
    if (t < ALCOHOL_VIRUS_POUR) {
      this.dropStream(virusId, POUR_AT);
      return;
    }
    if (t < ALCOHOL_IGNITE) return;

    if (t >= ALCOHOL_IGNITE && t < ALCOHOL_IGNITE + IGNITE_FLAME) {
      this.ignitePile(0, this.grid.width - 1);
    }
  }

  /** acidvapor: 정 중앙 철 바닥을 두고 하단에서 덮어쓰기로 산 증기 분출 (산 증기) */
  private tickAcidVapor(): void {
    const t = this.t;
    if (t >= ACID_CYCLE) {
      this.loop();
      return;
    }
    if (t < ACID_POUR) {
      this.spawnAcidVaporStream();
    }
  }

  private spawnAcidVaporStream(): void {
    if (this.rand() > SAND_CHANCE) return;
    const g = this.grid;
    const y = g.height - 2;
    const x0 = Math.round(g.width * 0.4);
    const x1 = Math.round(g.width * 0.6);
    for (let x = x0; x <= x1; x++) {
      if (this.rand() < 0.3) {
        if (g.inBounds(x, y)) {
          g.set(x, y, DEMO_ACID_VAPOR.id);
          this.sim.context.setTemp(x, y, 100);
        }
      }
    }
  }
}

/** 8이웃(대각선 포함) 오프셋. TNT 기폭의 이웃 검사와 같은 범위. */
const NEIGHBORS_8: readonly [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];
