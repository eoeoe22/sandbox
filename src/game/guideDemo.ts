// 가이드 문서(`/guide?tab=basics`)의 예시 장면들. 스크린샷 자리에 **진짜 엔진**을
// 끼워 넣은 것으로, 시작 화면(`startScreen.ts`)과 같은 구조를 따른다: 세계는 여기,
// 캔버스·RAF·가시성은 `components/GuideDemo.svelte`.
//
// 장면은 여섯이고 문서의 여섯 자리에 하나씩 붙는다.
//
//   solid   브러시가 캔버스 가운데에 벽으로 선을 하나 긋고, 지웠다가 다시 긋는다.
//   powder  모래가 위에서 한 줄기로 떨어져 더미를 쌓는다. 초기화 없이 계속.
//   liquid  벽으로 만든 그릇에 물이 떨어져 넘칠 때까지 차고, 초기화 후 반복.
//   gas     맨 아래에서 연기가 계속 올라온다. 초기화 없음.
//   overlap 모래를 한 줄기 쌓고, 그 위로 물을 부어 스며드는 것을 보여 준다.
//   heat    가로로 놓인 히트파이프 한 줄의 한쪽 끝을 불 Clone 이 달군다.
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
  DEMO_SAND,
  DEMO_WATER,
  DEMO_SMOKE,
  DEMO_HEATPIPE,
  DEMO_FIRE,
  DEMO_CLONE,
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

export type GuideDemoKind = 'solid' | 'powder' | 'liquid' | 'gas' | 'overlap' | 'heat';

/** 장면 목록. 문서가 붙이는 순서이자 검사가 훑는 순서다. */
export const GUIDE_DEMO_KINDS: readonly GuideDemoKind[] = [
  'solid',
  'powder',
  'liquid',
  'gas',
  'overlap',
  'heat',
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
  heat: { cols: 56, aspect: 3, borderMode: 'wall' },
};

/**
 * 움직임 최소화(prefers-reduced-motion)에서 대신 보여 줄 **정지 화면**의 틱 수.
 * 애니메이션을 아예 안 돌리는 대신, 대본이 할 말을 다 한 시점까지 한 번 돌린
 * 결과를 한 프레임 그리고 멈춘다 — 빈 네모를 남기는 것보다 낫고, 스스로 움직이는
 * 것은 하나도 없다.
 */
export const GUIDE_DEMO_STILL_TICKS: Record<GuideDemoKind, number> = {
  solid: 45, // 선을 다 그은 직후
  powder: 150, // 더미가 앉은 뒤
  liquid: 200, // 그릇이 거의 찬 무렵
  gas: 90, // 연기 기둥이 자리를 잡은 뒤
  overlap: 300, // 물이 모래에 스민 뒤
  heat: 200, // 열 뷰로 넘어가 기울기가 다 보이는 무렵
};

// --- 대본 길이(틱) --------------------------------------------------------------

/** solid: 나타나 0.5초 대기 → 1초 드래그 → 1초 대기 → 초기화. */
const SOLID_HOLD_IN = Math.round(DEMO_TPS * 0.5);
const SOLID_DRAG = DEMO_TPS;
const SOLID_HOLD_OUT = DEMO_TPS;
const SOLID_CYCLE = SOLID_HOLD_IN + SOLID_DRAG + SOLID_HOLD_OUT;

/** overlap: 모래 4초 → 1초 대기 → 물 4초 → 3초 대기 → 초기화. */
const OVERLAP_SAND = DEMO_TPS * 4;
const OVERLAP_GAP = DEMO_TPS * 1;
const OVERLAP_WATER = DEMO_TPS * 4;
const OVERLAP_TAIL = DEMO_TPS * 3;
const OVERLAP_CYCLE = OVERLAP_SAND + OVERLAP_GAP + OVERLAP_WATER + OVERLAP_TAIL;

/** heat: 일반 뷰 2초 → 열 뷰 5초 → 초기화. */
const HEAT_NORMAL = DEMO_TPS * 2;
const HEAT_THERMAL = DEMO_TPS * 5;
const HEAT_CYCLE = HEAT_NORMAL + HEAT_THERMAL;

/**
 * liquid: 넘칠 때까지 붓는다 — 길이가 대본이 아니라 **장면이 정한다**. 그릇 크기와
 * 물줄기 굵기는 칸 수에서 따라 나오므로 초를 못 박으면 화면비가 조금만 달라져도
 * "덜 찼는데 멈추는" 장면이 된다. 대신 굳었을 때를 대비한 상한만 둔다.
 */
const LIQUID_POUR_CAP = DEMO_TPS * 20;
/** 넘친 뒤 그대로 두는 시간. 넘치는 순간을 보고 나서 초기화되도록. */
const LIQUID_HOLD = DEMO_TPS * 1;

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

/** 고체 데모의 브러시 반지름(칸). 선 굵기가 이 값의 두 배가 된다. */
const BRUSH_R = 2;
/** 브러시가 지나는 구간(가로 비율). */
const BRUSH_X0 = 0.16;
const BRUSH_X1 = 0.84;

/** 액체 데모의 그릇: 좌우 벽의 가로 위치와 바닥·전 높이(세로 비율). */
const BOWL_X0 = 0.3;
const BOWL_X1 = 0.7;
const BOWL_BOTTOM = 0.86;
const BOWL_RIM = 0.42;

/** 기체 데모에서 연기가 태어나는 구간(가로 비율)과 한 틱당 개수. */
const SMOKE_X0 = 0.3;
const SMOKE_X1 = 0.7;
const SMOKE_PER_TICK = 2;

/** 열전도 데모: 파이프가 놓이는 높이(세로 비율)와 좌우 여백(칸). */
const PIPE_Y = 0.5;
const PIPE_PAD_LEFT = 6;
const PIPE_PAD_RIGHT = 4;
/** 불 Clone 기둥의 세로 반경(칸). 파이프 끝을 위아래로 감싸 불이 고이게 한다. */
const FIREBOX_R = 2;

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

  /** 대본이 한 바퀴를 돌아 초기화된 횟수. 검사가 반복을 확인하는 창구다. */
  loops = 0;

  /** 이번 바퀴가 시작된 뒤 지난 틱 수. */
  private t = 0;

  /** 액체 데모: 그릇이 넘친 틱(아직이면 -1). 넘친 뒤 LIQUID_HOLD 틱을 세는 기준. */
  private overflowAt = -1;

  private drainSince = DRAIN_SAMPLE_TICKS;
  private draining = false;

  private readonly rand: () => number;

  constructor(kind: GuideDemoKind, width: number, height: number, rand: () => number = Math.random) {
    this.kind = kind;
    this.rand = rand;
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

  /** 장면의 움직이지 않는 부분(그릇·파이프·불씨)을 놓는다. */
  private build(): void {
    if (this.kind === 'liquid') this.buildBowl();
    else if (this.kind === 'heat') this.buildPipe();
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
   * 열전도 데모: 가로로 히트파이프 한 줄, 왼쪽 끝에 불을 문 Clone 기둥.
   *
   * Clone 은 이웃의 **빈 칸**으로만 복제본을 뱉으므로, 기둥을 파이프보다 위아래로
   * 두 칸 넓게 세워 파이프 끝의 위아래가 불로 덮이게 한다. 열 교환은 상하좌우
   * 4이웃이라, 대각선으로만 닿는 배치였다면 파이프가 데워지지 않는다.
   *
   * `aux` 에 불의 id 를 미리 박아 두는 것은 팔레트의 더블클릭 Clone 단축키와 같은
   * 수법이다(clone.ts 의 `canAdopt` 주석). 그냥 두면 Clone 이 처음 닿은 것 —
   * 즉 히트파이프 — 를 물어 버려 불 대신 파이프를 뿜는다.
   */
  private buildPipe(): { y: number; x0: number; x1: number; cloneX: number } {
    const g = this.grid;
    const y = Math.round(g.height * PIPE_Y);
    const x0 = PIPE_PAD_LEFT;
    const x1 = g.width - 1 - PIPE_PAD_RIGHT;
    for (let x = x0; x <= x1; x++) g.set(x, y, DEMO_HEATPIPE.id);
    const cloneX = x0 - 1;
    for (let dy = -FIREBOX_R; dy <= FIREBOX_R; dy++) {
      const cy = y + dy;
      if (!g.inBounds(cloneX, cy)) continue;
      g.set(cloneX, cy, DEMO_CLONE.id);
      g.setAux(cloneX, cy, DEMO_FIRE.id);
    }
    return { y, x0, x1, cloneX };
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
    }
    this.sim.step();
    this.t++;
  }

  /** 대본 한 바퀴가 끝났을 때. 다음 `tick()`은 t=0부터 다시 시작한다. */
  private loop(): void {
    this.loops++;
    this.reset();
    this.t = -1; // 이번 tick() 끝의 `t++`가 0으로 만든다
  }

  // --- 고체: 브러시가 선을 긋는다 ------------------------------------------------

  private tickSolid(): void {
    const g = this.grid;
    const t = this.t;
    if (t >= SOLID_CYCLE) {
      this.loop();
      return;
    }
    const y = Math.round(g.height * 0.5);
    const x0 = Math.round(g.width * BRUSH_X0);
    const x1 = Math.round(g.width * BRUSH_X1);
    // 드래그 구간에서만 0→1로 흐르는 진행도. 앞뒤 대기 구간에서는 각각 0과 1에
    // 붙어 있으므로 브러시는 계속 보이고 자리만 안 움직인다.
    const p = t < SOLID_HOLD_IN ? 0 : t < SOLID_HOLD_IN + SOLID_DRAG ? (t - SOLID_HOLD_IN) / SOLID_DRAG : 1;
    const x = Math.round(x0 + (x1 - x0) * p);
    this.brush = { x, y, r: BRUSH_R };
    // 대기 구간에도 계속 찍는다 — 멈춘 브러시가 같은 자리를 덧칠하는 것은
    // 실제 브러시와 같은 동작이고, 드래그 첫 틱에 선이 갑자기 나타나지 않는다.
    if (t >= SOLID_HOLD_IN) this.paintDisc(x, y, BRUSH_R);
  }

  /** (cx,cy) 중심 반지름 r의 원을 벽으로 칠한다. 브러시가 칸을 직접 쓰는 것은
   *  게임의 브러시와 같다(반응 컨텍스트를 거치지 않는다). */
  private paintDisc(cx: number, cy: number, r: number): void {
    const g = this.grid;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!g.inBounds(x, y) || g.get(x, y) !== EMPTY) continue;
        g.set(x, y, DEMO_WALL.id);
        g.setTint(x, y, (this.rand() * 256) | 0);
      }
    }
  }

  // --- 가루: 모래 한 줄기 ---------------------------------------------------------

  private tickPowder(): void {
    this.dropStream(DEMO_SAND.id, 0.5);
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
    this.sim.context.spawn(x, STREAM_Y, DEMO_WATER.id);
    // 두 칸씩 부어야 그릇이 볼 만한 시간 안에 찬다. 좌우로 한 칸 벌려 두면
    // 줄기가 한 칸 굵기 그대로 보이면서 유량만 두 배가 된다.
    if (x + 1 < g.width) this.sim.context.spawn(x + 1, STREAM_Y, DEMO_WATER.id);
  }

  /** 그릇 밖(바닥 줄 아래)에 물이 있는가. */
  private spilled(x0: number, x1: number, bottom: number): boolean {
    const g = this.grid;
    const wid = DEMO_WATER.id;
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
      this.sim.context.spawn(x, floor, DEMO_SMOKE.id);
    }
  }

  // --- 겹침: 모래 위에 물 -----------------------------------------------------------

  private tickOverlap(): void {
    const t = this.t;
    if (t >= OVERLAP_CYCLE) {
      this.loop();
      return;
    }
    if (t < OVERLAP_SAND) this.dropStream(DEMO_SAND.id, 0.5);
    else if (t >= OVERLAP_SAND + OVERLAP_GAP && t < OVERLAP_SAND + OVERLAP_GAP + OVERLAP_WATER) {
      this.dropStream(DEMO_WATER.id, 0.5);
    }
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
}
