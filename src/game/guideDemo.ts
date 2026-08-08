// 가이드 문서(`/guide?tab=basics`)의 예시 장면들. 스크린샷 자리에 **진짜 엔진**을
// 끼워 넣은 것으로, 시작 화면(`startScreen.ts`)과 같은 구조를 따른다: 세계는 여기,
// 캔버스·RAF·가시성은 `components/GuideDemo.svelte`.
//
// 장면은 여섯이고 문서의 여섯 자리에 하나씩 붙는다.
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
// **여기 있는 것은 브라우저 없이 검증할 수 있는 부분 전부다** — 장면 배치, 틱
// 단위 대본, 넘침 판정, 열 뷰 전환 시점. 컴포넌트에 남는 것은 캔버스 크기에서
// 격자 크기를 얻는 일과 브러시 원을 화면 좌표로 옮기는 일뿐이다.
// 검증은 `npm run test:guidedemo`.

import { Grid } from './engine/Grid';
import { Simulation } from './engine/Simulation';
import { EMPTY, type BorderMode } from './engine/types';
import { TICK_HZ } from './config';
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
} from './materials/demo';

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
  | 'wall'
  | 'obsidian'
  | 'saltwater'
  | 'sugarwater'
  | 'soda';

/** 장면 목록. 문서가 붙이는 순서이자 검사가 훑는 순서다. 뒤의 다섯(wall·obsidian·
 *  saltwater·sugarwater·soda)은 basics 문서에 붙지 않는 **물질별 맞춤 데모**로,
 *  카드가 열릴 때만 보인다. 검사의 세워짐/정지화면 루프가 같은 목록을 훑으므로 여기
 *  있어야 검증도 빠지지 않는다. */
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
 *  3) 랜덤 자리에 녹은 U235 3×3 덩어리를 **WALL 울타리 안에 가둬** 배치 →
 *     WALL_U235(3초) 대기. 액체 U235 는 흘러내려 흩어지면 이웃이 줄어 자가발열이
 *     멎고 굳어버리므로, 울타리가 가둬 이웃을 유지해야 임계(2000°)에 다다른다.
 *     배치 후 약 1초에 임계를 넘겨 핵광(Nuclear Ray)을 뿜고 U235 는 연소해 빠지
 *     지만 — **울타리 벽은 핵광에도 살아 남는다**(`isWall` 이 빔을 반사).
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
 * 액트2 단계: 흑요석 블록 배치 → TNT1(1초 후 격발) → OBSidian_TNT_BLAST(1.5초
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

/**
 * 녹은 U235 덩어리의 반지름(칸). 1이면 3×3. 임계(2000°) 폭주를 일으키려면 액체가
 * 흩어지지 않게 서로 붙어 있어야 하는데 — MOLTEN_URANIUM 은 중력으로 흘러내려
 * 이웃이 줄어 자가발열(+3/이웃)이 멎고, 바닥에 닿으면 전도로 열이 빠져 굳어버린다.
 * 그래서 {@link spawnU235Clump} 가 WALL 울타리 안에 이 반지름의 덩어리를 가둬
 * 놓는다 — 벽이 가둬 이웃을 유지해(발열 유지) 임계에 다다르게 하고, 동시에 그 벽이
 * 임계폭주의 열·핵광에도 살아남는 것(이 데모의 결론)을 한 장면에 담는다.
 */
const U235_CLUMP_R = 1;

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
      return DEMO_WALL.id;
  }
}

/** 브러시 커서. 고체 데모에서만 값이 있고 나머지는 `null`이다. */
export interface DemoBrush {
  /** 칸 좌표(중심). */
  x: number;
  y: number;
  /** 반지름(칸). */
  r: number;
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
    subjectId?: number,
  ) {
    this.kind = kind;
    this.rand = rand;
    this.subjectId = subjectId ?? defaultSubject(kind);
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

  /** 장면의 움직이지 않는 부분(그릇·파이프·불씨·블록·웅덩이)을 놓는다. */
  private build(): void {
    switch (this.kind) {
      case 'liquid':
        this.buildBowl();
        break;
      case 'heat':
        this.buildPipe();
        break;
      case 'wall':
        // 액트1 고정 배치: 중앙 벽 블록. 위협(TNT·산·U235)은 대본 안에서 놓는다.
        this.buildBlock(DEMO_WALL.id);
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
    }
    this.grid.randomizeTints();
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
  private buildPool(id: number): void {
    const g = this.grid;
    const x0 = Math.round(g.width * POOL_X0);
    const x1 = Math.round(g.width * POOL_X1);
    const bottom = g.height - 1;
    for (let dy = 0; dy < POOL_DEPTH; dy++) {
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
    this.brush = { x, y, r: BRUSH_R };
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
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!g.inBounds(x, y) || g.get(x, y) !== EMPTY) continue;
        g.set(x, y, id);
        g.setTint(x, y, (this.rand() * 256) | 0);
      }
    }
  }

  // --- 가루: 모래 한 줄기 ---------------------------------------------------------

  private tickPowder(): void {
    this.dropStream(this.subjectId, 0.5);
    this.drainFloor();
  }

  /** 가로 비율 `at` 자리에서 한 알갱이를 떨어뜨린다(확률 SAND_CHANCE). */
  private dropStream(id: number, at: number): void {
    if (this.rand() > SAND_CHANCE) return;
    const g = this.grid;
    const jitter = Math.round((this.rand() * 2 - 1) * STREAM_JITTER);
    const x = Math.min(g.width - 1, Math.max(0, Math.round(g.width * at) + jitter));
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
   * 블록(Box)에서 `margin` 칸 이상 떨어진, 비어 있는 칸 하나를 고른다. wall·obsidian
   * 액트2 가 TNT·U235 를 "블록과 겹치지 않는 랜덤 자리"에 놓을 때 쓴다. 블록 중심에서
   * margin 칸 이내는 피한다(TNT blastRadius 가 커서 블록에 바짝 붙으면 그림자 안으로
   * 들어가 폭발이 안 보인다). 최대 32번 굴려 보고, 맞는 자리가 없으면 가장자리로
   * 빠진다 — 빈 격자가 거의 없는 극단적 경우의 안전장치일 뿐, 정상 장면에선 한두 번에
   * 걸린다.
   */
  private pickClearSpot(box: { cx: number; cy: number; half: number }, margin: number): { x: number; y: number } | null {
    const g = this.grid;
    for (let i = 0; i < 32; i++) {
      const x = 1 + Math.floor(this.rand() * (g.width - 2));
      const y = 1 + Math.floor(this.rand() * (g.height - 2));
      if (g.get(x, y) !== EMPTY) continue;
      if (Math.abs(x - box.cx) <= box.half + margin && Math.abs(y - box.cy) <= box.half + margin) continue;
      return { x, y };
    }
    return null;
  }

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
      // 0틱에 TNT 한 칸 배치. 다음 사이클에선 loop()→reset()→build() 로 블록만
      // 다시 놓이고, TNT 자리는 비워지므로 매 사이클 새 위치.
      const spot = this.pickClearSpot(box, 2);
      if (spot) this.sim.context.spawn(spot.x, spot.y, DEMO_TNT.id);
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
      // 녹은 U235 3×3 덩어리를 WALL 울타리 안에 가둬 배치. 빈 공간에 놓으면 액체가
      // 흘러 흩어져 임계에 못 다다르므로 울타리가 이웃을 유지해 준다(spawnU235Clump
      // 주석 참고). spawn 으로 놓아 init 온도(1600°)가 보장되게 한다.
      this.spawnU235Clump(box);
      return;
    }
    if (t < u235End) return; // 임계 도달 → 핵광이 화면을 쓸고 울타리 벽이 살아남는다
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
   * 녹은 U235 (3×3) 를 WALL 울타리 안에 가둬 box 에서 떨어진 자리에 놓는다.
   *
   * **왜 울타리인가** — MOLTEN_URANIUM 은 액체라 중력으로 흘러내린다. 빈 공간에
   * 놓으면 아래로 퍼지면서 이웃 수가 줄어 자가발열(+3/이웃)이 멎고, 바닥에 닿는 순간
   * 전도로 열이 빠져 1400° 이하로 굳어버린다 — 임계(2000°)에 다다르지 못한다.
   * WALL 울타리가 액체를 가두면 이웃 수가 유지돼 자가발열이 누적하고, 약 30틱(1초)
   * 만에 임계를 넘겨 폭주한다(관측: 1600°→1748(10틱)→1881(20틱)→2014(30틱)→
   * 3930(40틱)→5376(50틱)). 임계 후엔 Nuclear Ray 가 울타리 안팎을 쓸고, U235 는
   * 연소해 Smoke 로 빠지지만 — **울타리 벽은 핵광에도 살아 남는다**(`isWall` 이
   * nuclearray 의 첫 차단 검사). 이것이 이 데모의 결론이자, 벽이 왜 울타리로 쓰였
   * 는지의 이유다.
   *
   * 울타리 안쪽 영역이 box(벽 블록)와 겹치지 않는 자리를 고른다.
   */
  private spawnU235Clump(box: { cx: number; cy: number; half: number }): void {
    const g = this.grid;
    const r = U235_CLUMP_R;
    const span = 2 * (r + 1) + 1; // 울타리 외곽 한 변: (r+1)*2+1. r=1 → 5
    for (let i = 0; i < 32; i++) {
      const x0 = 2 + Math.floor(this.rand() * (g.width - span - 3));
      const y0 = 2 + Math.floor(this.rand() * (g.height - span - 3));
      const cx = x0 + r + 1;
      const cy = y0 + r + 1;
      // box(중앙 벽 블록)와 겹치지 않게.
      if (Math.abs(cx - box.cx) <= box.half + span) continue;
      if (Math.abs(cy - box.cy) <= box.half + span) continue;
      // 울타리 외곽 영역이 전부 빈 칸인지 확인(기존 장면을 덮어쓰지 않게).
      let clear = true;
      for (let dy = 0; dy < span && clear; dy++) {
        for (let dx = 0; dx < span && clear; dx++) {
          if (g.get(x0 + dx, y0 + dy) !== EMPTY) clear = false;
        }
      }
      if (!clear) continue;
      // 울타리(테두리 한 줄)를 WALL, 안쪽 (2r+1)×(2r+1) 을 MOLTEN_U 로.
      for (let dy = 0; dy < span; dy++) {
        for (let dx = 0; dx < span; dx++) {
          const isEdge = dx === 0 || dy === 0 || dx === span - 1 || dy === span - 1;
          const x = x0 + dx;
          const y = y0 + dy;
          if (isEdge) {
            g.set(x, y, DEMO_WALL.id);
          } else {
            this.sim.context.spawn(x, y, DEMO_MOLTEN_URANIUM.id);
          }
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
    const box = this.blockBox();
    const tnt1Fuse = act2Start; // 전환 틱에 TNT1 배치
    const tnt1Blast = tnt1Fuse + OBS_TNT_FUSE;
    const tnt1Hold = tnt1Blast + OBS_TNT_BLAST;
    const tnt2Fuse = tnt1Hold; // 이어서 TNT2 배치
    const tnt2Blast = tnt2Fuse + OBS_TNT_FUSE;
    const tnt2Hold = tnt2Blast + OBS_TNT_BLAST;

    if (t === tnt1Fuse) {
      const spot = this.pickClearSpot(box, 2);
      if (spot) this.sim.context.spawn(spot.x, spot.y, DEMO_TNT.id);
      return;
    }
    if (t === tnt1Blast) {
      this.igniteNearestTnt(box);
      return;
    }
    if (t < tnt1Hold) return;

    if (t === tnt2Fuse) {
      const spot = this.pickClearSpot(box, 2);
      if (spot) this.sim.context.spawn(spot.x, spot.y, DEMO_TNT.id);
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
   * 떨어뜨린다. 가루가 담수 주머니를 녹아든 용액으로 바꾼다.
   *
   * 단계: 물 3초 → 용질 1초 → 관찰 3초 → 초기화.
   */
  private tickDissolve(soluteId: number): void {
    const t = this.t;
    if (t >= DISSOLVE_CYCLE) {
      this.loop();
      return;
    }
    if (t < DISSOLVE_WATER) {
      this.dropStream(DEMO_WATER.id, POUR_AT);
      return;
    }
    if (t < DISSOLVE_WATER + DISSOLVE_SOLUTE) {
      this.dropStream(soluteId, POUR_AT);
      return;
    }
    // DISSOLVE_HOLD: 섞이는 것을 관찰 후 loop()
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
}

/** 8이웃(대각선 포함) 오프셋. TNT 기폭의 이웃 검사와 같은 범위. */
const NEIGHBORS_8: readonly [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];
