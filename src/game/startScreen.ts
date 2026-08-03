// 시작 화면(`/`)의 배경에서 도는 세계. 소개용 장식이 아니라 게임의
// Grid/Simulation을 그대로 쓰되, 물질만 경량 배럴(`materials/lite`)로 줄여
// 로드한다 — 그래서 첫 화면은 전체 물질 레지스트리를 받지 않는다.
//
// 배경은 기본적으로 **혼자 굴러가는 장면**이다: 네 줄이 계속 떨어지고, 1초에
// 한 번 아무 데서나 불이나 충격파가 터진다. 여기에 손잡이가 딱 하나 있다 —
// **배경을 누르면 그 자리에서 충격파가 터진다**(`burstAt`). 물질을 칠하는
// 브러시가 아니라 한 번 치고 마는 두드림이라, 시작 화면은 여전히 "보는 장면"
// 이면서도 눌러 보면 반응은 한다.
//
// 렌더러·캔버스·RAF는 여기 없다(components/StartScreenSandbox.svelte가 맡는다).
// 여기 있는 것은 **브라우저 없이 검증할 수 있는 부분** 전부다: 줄 낙하, 배수,
// 자동 이벤트와 그 자리 고르기, 종류를 뽑는 룰렛, 그리고 클릭 충격파.
// 컴포넌트에 남는 것은 화면 좌표 → 칸 좌표 변환뿐이다.
// 검증은 `npm run test:startscreen`.

import { Grid } from './engine/Grid';
import { Simulation } from './engine/Simulation';
import { EMPTY, type Material } from './engine/types';
import { TICK_HZ } from './config';
import { fireShockwave } from './materials/woofer';
import { LITE_MATERIALS, LITE_FIRE } from './materials/lite';

// --- 고정 설정 ---------------------------------------------------------------
// 시작 화면에는 설정 UI가 없다. 본 게임의 기본값과 같은 값으로 못 박아 두고,
// 나중에 기본값이 바뀌더라도 시작 화면은 여기 적힌 대로 돌게 한다.

/** 시뮬레이션 속도 배율(본 게임 기본값과 같은 ×1). */
export const START_SIM_SPEED = 1;
/** ×1에서의 고정 스텝 간격(ms). Game.ts와 같은 식: `2000 / (TICK_HZ × 배율)`. */
export const START_STEP_MS = 2000 / (TICK_HZ * START_SIM_SPEED);
/** 테두리: 벽과 바닥이 있어서 쌓인다. */
export const START_BORDER_MODE = 'wall' as const;
/** 연기: 본 게임 기본값과 같은 중간 단계. */
export const START_SMOKE_LEVEL = 'medium' as const;

/**
 * 셀 크기 배율(config의 CELL_SCALES의 가장 굵은 단계와 같은 값 — 클수록 굵고
 * 가볍다). 본 게임은 1이지만 시작 화면은 배경이라 2로 잡는다: 1080p에서 약
 * 360×202칸으로, 본 게임의 1/4 규모다.
 */
export const START_CELL_SCALE = 2;

// --- 떨어지는 줄 ---------------------------------------------------------------

/** 스트림 하나가 한 틱에 한 알갱이를 떨어뜨릴 확률. 4줄 × 0.45 ≈ 1.8칸/틱. */
const STREAM_CHANCE = 0.45;
/** 스트림이 좌우로 흔들리는 폭(칸). 0이면 자로 잰 듯한 한 줄이 된다. */
const STREAM_JITTER = 1;
/** 알갱이가 태어나는 높이(위에서 몇 번째 줄). y=0이 천장이다. */
const STREAM_Y = 1;

// --- 배수 ---------------------------------------------------------------------
// 벽과 바닥이 있으므로 줄을 그냥 두면 언젠가 화면이 꽉 차서 굳는다. 바닥 줄에서
// 조금씩 새어 나가게 해 유입과 균형을 맞춘다(모래시계처럼 보인다).
// 점유율 계산은 선형 스캔이라 매 틱이 아니라 이 주기마다 잰다.

const DRAIN_SAMPLE_TICKS = 30;
const DRAIN_SOFT_FILL = 0.35;
const DRAIN_HARD_FILL = 0.5;
/**
 * 배수량(칸/틱)을 **화면 너비에 비례**시킨다. 유입은 줄 수로 정해져 해상도와
 * 무관한데, 같은 점유율을 되돌리는 데 필요한 칸 수는 넓이를 따라 늘기 때문이다.
 * 고정값으로 두면 해상도를 올릴 때마다 배수가 상대적으로 약해진다. 아래 계수는
 * 240칸 폭에서 3칸·8칸이 되도록 맞춘 값이다.
 */
const DRAIN_SOFT_PER_WIDTH = 3 / 240;
const DRAIN_HARD_PER_WIDTH = 8 / 240;
/** 좁은 화면에서도 유입(≈1.8칸/틱)을 못 따라잡는 일이 없게 하는 하한. */
const DRAIN_MIN_CELLS = 3;

// --- 자동 이벤트 ---------------------------------------------------------------

/**
 * 이벤트 간격(틱). 스텝 간격이 `START_STEP_MS`이므로 정확히 1초에 한 번이다.
 */
export const AUTO_EVENT_TICKS = Math.round(1000 / START_STEP_MS);
/** 이벤트가 덮는 원의 반지름(칸). */
const EVENT_R = 4;
/** 불 이벤트가 그 원을 채우는 비율. 불은 금방 꺼지므로 촘촘하게 뿌린다. */
const EVENT_FIRE_FILL = 0.7;
/** 아직 아무것도 안 쌓인 열에서 터질 때 고르는 높이 구간(위에서부터의 비율). */
const EVENT_EMPTY_Y_MIN = 0.45;
const EVENT_EMPTY_Y_MAX = 0.85;

// --- 클릭 충격파 ---------------------------------------------------------------

/**
 * 배경을 눌렀을 때 터지는 원의 반지름(칸). 자동 이벤트(`EVENT_R`)보다 굵다 —
 * 자동 이벤트는 1초마다 알아서 터지는 배경음이라 눈에 덜 띄어야 하지만, 클릭은
 * **내가 눌러서 일어난 일**이라 누른 티가 나야 한다. 충격파가 실제로 미는
 * 거리(`woofer.ts`의 SHOCK_VIS_REACH ≈ 8칸)와 비슷한 값이라, 원이 커진 만큼
 * 파면도 한 덩어리로 퍼진다.
 */
const BURST_R = 7;

/**
 * 이벤트 한 번이 만드는 것. `null`은 충격파 — 물질이 아니라 도구다.
 * 나머지는 경량 배럴이 등록한 불이다.
 */
export type SpawnKind = Material | null;

/**
 * 룰렛에 들어가는 전체 목록. 순서는 무의미하다(어차피 섞는다).
 */
export const START_KINDS: readonly SpawnKind[] = [null, LITE_FIRE];

/** 이벤트가 터진 자리와 종류. 검사와 디버깅에서 "무엇이 어디서" 를 읽는 창구다. */
export interface StartEvent {
  x: number;
  y: number;
  kind: SpawnKind;
}

/**
 * 시작 화면의 세계 하나. 캔버스도 렌더러도 모르고, `tick()`을 불러 주는 쪽이
 * 박자를 쥔다.
 */
export class StartScreenWorld {
  readonly grid: Grid;
  readonly sim: Simulation;

  /** 다음 이벤트에서 터질 것. 터질 때마다 룰렛에서 새로 뽑는다. */
  currentKind: SpawnKind;

  /** 마지막으로 터진 것. 자동 이벤트든 클릭 충격파든 나중 것이 들어간다.
   *  아직 아무것도 안 터졌으면 null. */
  lastEvent: StartEvent | null = null;

  /** 지금까지 터진 **자동** 이벤트 수. 클릭은 여기 안 센다(`burstCount`) —
   *  1초 박자를 재는 값이라 사용자가 끼어들면 뜻이 흐려진다. */
  eventCount = 0;

  /** 지금까지 사용자가 눌러서 터뜨린 충격파 수. */
  burstCount = 0;

  /**
   * 스스로 움직일지. 줄 낙하와 자동 이벤트를 **함께** 여닫는다 — 둘 다 사용자가
   * 일으킨 움직임이 아니므로, 움직임 최소화(prefers-reduced-motion)에서는 같이
   * 꺼져야 한다.
   */
  motion: boolean;

  /** 아직 안 뽑힌 종류들. 비면 다시 섞어 채운다 — 그래서 한 바퀴 안에서는
   *  같은 종류가 두 번 나오지 않는다. `pop()`으로 꺼내므로 맨 뒤가 "다음"이다. */
  private bag: SpawnKind[] = [];

  private sinceEvent = 0;

  private drainPerTick = 0;
  private sinceSample = DRAIN_SAMPLE_TICKS;

  private readonly rand: () => number;

  constructor(width: number, height: number, opts: { motion?: boolean; rand?: () => number } = {}) {
    this.rand = opts.rand ?? Math.random;
    this.motion = opts.motion ?? true;
    this.grid = new Grid(width, height);
    this.sim = new Simulation(this.grid);
    this.sim.setBorderMode(START_BORDER_MODE);
    this.sim.setSmokeLevel(START_SMOKE_LEVEL);
    this.currentKind = this.drawKind();
  }

  /** 스트림 `i`의 x좌표(칸). 화면을 (줄 수 + 1)로 나눈 경계들. */
  streamX(i: number): number {
    const x = Math.round((this.grid.width * (i + 1)) / (LITE_MATERIALS.length + 1));
    return Math.min(this.grid.width - 1, Math.max(0, x));
  }

  /** 화면 크기가 바뀌었을 때. 격자는 내용을 물고 리사이즈된다(바닥 기준 정렬). */
  resize(width: number, height: number): void {
    this.grid.resize(width, height);
  }

  // --- 룰렛 -------------------------------------------------------------------

  /** 주머니에서 하나 꺼낸다. 비었으면 새로 섞되, 방금 쓴 것이 바로 이어서
   *  나오지 않도록 맨 뒤 칸만 앞쪽과 맞바꾼다. */
  private drawKind(): SpawnKind {
    if (this.bag.length === 0) {
      this.bag = START_KINDS.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
      const last = this.bag.length - 1;
      if (last > 0 && this.bag[last] === this.currentKind) {
        [this.bag[last], this.bag[0]] = [this.bag[0], this.bag[last]];
      }
    }
    return this.bag.pop() as SpawnKind;
  }

  // --- 자동 이벤트 -------------------------------------------------------------

  /** 반지름 `r`의 원에 걸리는 칸들을 [x,y,x,y,…] 평면 배열로. `fireShockwave`가
   *  이 꼴을 받는다. 자동 이벤트(EVENT_R)와 클릭(BURST_R)이 같이 쓴다. */
  private eventCells(cx: number, cy: number, r: number): number[] {
    const out: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (this.grid.inBounds(x, y)) out.push(x, y);
      }
    }
    return out;
  }

  /**
   * 이벤트가 터질 자리. 아무 칸이나 고르면 대개 허공이라 아무 일도 안 일어나므로,
   * 고른 열의 **더미 표면**을 잡는다. 원의 중심을 표면 칸에 두어 절반은 공중,
   * 절반은 더미 속이 되게 하는데, 이건 취향이 아니라 **불이 안 붙어서** 그렇다:
   * 표면 바로 위에 얹기만 하면 불은 기체라 옮겨붙기 전에 떠올라 버려서, 휘발유
   * 웅덩이 위에 37칸을 뿌려도 60틱 동안 한 칸도 안 타고 꺼진다(실측). 걸터앉히면
   * 같은 장면이 웅덩이의 1/3을 태운다. 대신 더미 몇 칸이 불로 덮여 사라지는데,
   * 어차피 바닥으로 배수되는 배경이라 아깝지 않다.
   *
   * 표면은 바닥에서 위로 올라가며 찾는다 — 위에서 내려오면 마침 그 열을 지나던
   * **떨어지는 중인 알갱이**를 표면으로 착각한다.
   */
  private pickEventCell(): { x: number; y: number } {
    const g = this.grid;
    const x = Math.floor(this.rand() * g.width);
    const floor = g.height - 1;
    if (g.get(x, floor) !== EMPTY) {
      let y = floor;
      while (y > 0 && g.get(x, y) !== EMPTY) y--;
      return { x, y: Math.min(floor, y + 1) };
    }
    // 아직 그 열에 쌓인 게 없다(시작 직후). 화면 아래쪽 허공에서 터진다.
    const lo = g.height * EVENT_EMPTY_Y_MIN;
    const hi = g.height * EVENT_EMPTY_Y_MAX;
    return { x, y: Math.min(floor, Math.floor(lo + this.rand() * (hi - lo))) };
  }

  /**
   * 지금 이벤트를 하나 터뜨리고 다음 종류를 뽑는다. 평소에는 `tick()`이 1초마다
   * 알아서 부르지만, 박자와 무관하게 한 번 터뜨리고 싶을 때 직접 불러도 된다.
   */
  fireEvent(): StartEvent {
    const { x, y } = this.pickEventCell();
    const kind = this.currentKind;
    const ctx = this.sim.context;
    const cells = this.eventCells(x, y, EVENT_R);
    if (kind === null) {
      fireShockwave(ctx, cells);
    } else {
      for (let k = 0; k < cells.length; k += 2) {
        if (this.rand() > EVENT_FIRE_FILL) continue;
        ctx.spawn(cells[k], cells[k + 1], kind.id);
      }
    }
    const ev: StartEvent = { x, y, kind };
    this.lastEvent = ev;
    this.eventCount++;
    // 다음 것은 지금 뽑아 둔다 — `drawKind`가 "방금 쓴 것" 을 보고 연속 등장을
    // 피하므로, `currentKind`가 아직 이번 종류일 때 불러야 한다.
    this.currentKind = this.drawKind();
    return ev;
  }

  // --- 클릭 -------------------------------------------------------------------

  /**
   * 누른 자리(칸 좌표)에서 충격파를 한 번 터뜨린다. 화면 밖이면 아무 일도 하지
   * 않고 `null`. 한 번 누를 때 한 번 — 누른 채 끌어도 더 터지지 않는다(그
   * 판단은 포인터를 쥔 컴포넌트 쪽에 있다).
   *
   * 종류를 뽑지 않고 **언제나 충격파**다. 룰렛에는 불도 있지만 클릭으로 불을
   * 놓으면 그건 브러시고, 그러면 시작 화면이 다시 "노는 곳"이 된다 — 여기서
   * 원하는 것은 세계를 바꾸지 않고 **누른 티만 내는** 반응이라, 물질을 만들지도
   * 없애지도 않는 충격파가 정확히 그 일을 한다.
   *
   * `motion`(움직임 최소화)에 걸리지 않는다. 그 스위치가 끄는 것은 줄 낙하와
   * 자동 이벤트, 즉 **사용자가 일으키지 않은 움직임**이고, 클릭은 사용자가
   * 스스로 일으킨 움직임이라 그 반대다 — 눌렀는데 아무 일도 안 나는 쪽이
   * 오히려 고장으로 읽힌다.
   *
   * 자동 이벤트의 박자(`sinceEvent`)는 건드리지 않는다. 클릭은 1초짜리 배경
   * 박자와 별개의 층이고, 눌렀다고 배경이 조용해지면 그것대로 어색하다.
   */
  burstAt(x: number, y: number): StartEvent | null {
    if (!this.grid.inBounds(x, y)) return null;
    fireShockwave(this.sim.context, this.eventCells(x, y, BURST_R));
    const ev: StartEvent = { x, y, kind: null };
    this.lastEvent = ev;
    this.burstCount++;
    return ev;
  }

  // --- 한 틱 -------------------------------------------------------------------

  tick(): void {
    const g = this.grid;
    const ctx = this.sim.context;

    if (this.motion) {
      for (let i = 0; i < LITE_MATERIALS.length; i++) {
        if (this.rand() > STREAM_CHANCE) continue;
        const jitter = Math.round((this.rand() * 2 - 1) * STREAM_JITTER);
        const x = Math.min(g.width - 1, Math.max(0, this.streamX(i) + jitter));
        ctx.spawn(x, STREAM_Y, LITE_MATERIALS[i].id);
      }

      if (++this.sinceEvent >= AUTO_EVENT_TICKS) {
        this.sinceEvent = 0;
        this.fireEvent();
      }
    }

    if (++this.sinceSample >= DRAIN_SAMPLE_TICKS) {
      this.sinceSample = 0;
      let filled = 0;
      for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== EMPTY) filled++;
      const ratio = filled / g.cells.length;
      const perWidth =
        ratio > DRAIN_HARD_FILL ? DRAIN_HARD_PER_WIDTH : ratio > DRAIN_SOFT_FILL ? DRAIN_SOFT_PER_WIDTH : 0;
      this.drainPerTick = perWidth === 0 ? 0 : Math.max(DRAIN_MIN_CELLS, Math.ceil(g.width * perWidth));
    }
    const floor = g.height - 1;
    for (let k = 0; k < this.drainPerTick; k++) {
      const x = Math.floor(this.rand() * g.width);
      if (g.get(x, floor) === EMPTY) continue;
      g.setOverlay(x, floor, 0); // 스며든 액체까지 같이 빠져나간다
      g.set(x, floor, EMPTY);
    }

    this.sim.step();
  }
}
