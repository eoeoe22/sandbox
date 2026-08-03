// 시작 화면(`/`)의 배경에서 도는 세계. 소개용 장식이 아니라 게임의
// Grid/Simulation을 그대로 쓰되, 물질만 경량 배럴(`materials/lite`)로 줄여
// 로드한다 — 그래서 첫 화면은 전체 물질 레지스트리를 받지 않는다.
//
// 렌더러·캔버스·RAF·포인터 좌표 변환은 여기 없다(components/StartScreenSandbox
// .svelte가 맡는다). 여기 있는 것은 **브라우저 없이 검증할 수 있는 부분** 전부다:
// 다섯 줄 낙하, 배수, 클릭 브러시, 그리고 종류를 뽑는 룰렛.
// 검증은 `npm run test:startscreen`.

import { Grid } from './engine/Grid';
import { Simulation } from './engine/Simulation';
import { EMPTY, type Material } from './engine/types';
import { TICK_HZ, SHOCK_BRUSH_PERIOD } from './config';
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
 * 셀 크기 배율(config의 CELL_SCALES와 같은 축 — 클수록 굵고 가볍다). 본 게임은
 * 1이지만 시작 화면은 배경이라 3으로 굵게 잡는다: 1080p에서 약 240×135칸으로,
 * 본 게임의 1/9 규모다.
 */
export const START_CELL_SCALE = 3;

// --- 다섯 줄 -----------------------------------------------------------------

/** 스트림 하나가 한 틱에 한 알갱이를 떨어뜨릴 확률. 5줄 × 0.45 ≈ 2.3칸/틱. */
const STREAM_CHANCE = 0.45;
/** 스트림이 좌우로 흔들리는 폭(칸). 0이면 자로 잰 듯한 한 줄이 된다. */
const STREAM_JITTER = 1;
/** 알갱이가 태어나는 높이(위에서 몇 번째 줄). y=0이 천장이다. */
const STREAM_Y = 1;

// --- 배수 ---------------------------------------------------------------------
// 벽과 바닥이 있으므로 다섯 줄을 그냥 두면 언젠가 화면이 꽉 차서 굳는다. 바닥
// 줄에서 조금씩 새어 나가게 해 유입과 균형을 맞춘다(모래시계처럼 보인다).
// 점유율 계산은 선형 스캔이라 매 틱이 아니라 이 주기마다 잰다.

const DRAIN_SAMPLE_TICKS = 30;
const DRAIN_SOFT_FILL = 0.35;
const DRAIN_HARD_FILL = 0.5;
/** 물렁한 단계의 배수량(칸/틱). 유입 ≈2.3칸/틱보다 커야 균형이 잡힌다. */
const DRAIN_SOFT_CELLS = 3;
const DRAIN_HARD_CELLS = 8;

// --- 클릭 브러시 ---------------------------------------------------------------

/** 클릭 브러시 반지름(칸). */
const BRUSH_R = 4;
/** 브러시 원 안에서 실제로 채워지는 비율(가루 브러시처럼 흩뿌린다). */
const BRUSH_FILL = 0.4;
/** 불은 금방 꺼지므로 조금 더 촘촘하게 뿌린다. */
const BRUSH_FILL_FIRE = 0.7;

/**
 * 클릭 한 번이 만드는 것. `null`은 충격파 — 물질이 아니라 도구다.
 * 나머지는 경량 배럴이 실제로 등록한 물질(불 + 떨어지는 다섯 종)이다.
 */
export type SpawnKind = Material | null;

/**
 * 룰렛에 들어가는 전체 목록. 순서는 무의미하다(어차피 섞는다).
 */
export const START_KINDS: readonly SpawnKind[] = [null, LITE_FIRE, ...LITE_MATERIALS];

/**
 * 시작 화면의 세계 하나. 캔버스도 렌더러도 모르고, `tick()`을 불러 주는 쪽이
 * 박자를 쥔다.
 */
export class StartScreenWorld {
  readonly grid: Grid;
  readonly sim: Simulation;

  /** 지금 누르면 나올 것. 손을 뗄 때마다 바뀐다(`release`). */
  currentKind: SpawnKind;

  /** 다섯 줄을 흘릴지. 움직임 최소화(prefers-reduced-motion)에서 끈다. */
  streams: boolean;

  /** 아직 안 뽑힌 종류들. 비면 다시 섞어 채운다 — 그래서 한 바퀴 안에서는
   *  같은 종류가 두 번 나오지 않는다. `pop()`으로 꺼내므로 맨 뒤가 "다음"이다. */
  private bag: SpawnKind[] = [];

  private pressed = false;
  private brushX = 0;
  private brushY = 0;
  /** 충격파가 마지막으로 터진 틱. -1이면 박자와 무관하게 즉시 한 번 터진다. */
  private lastShockTick = -1;

  private drainPerTick = 0;
  private sinceSample = DRAIN_SAMPLE_TICKS;

  private readonly rand: () => number;

  constructor(width: number, height: number, opts: { streams?: boolean; rand?: () => number } = {}) {
    this.rand = opts.rand ?? Math.random;
    this.streams = opts.streams ?? true;
    this.grid = new Grid(width, height);
    this.sim = new Simulation(this.grid);
    this.sim.setBorderMode(START_BORDER_MODE);
    this.sim.setSmokeLevel(START_SMOKE_LEVEL);
    this.currentKind = this.drawKind();
    this.seed();
  }

  /** 스트림 `i`의 x좌표(칸). 화면을 (줄 수 + 1)로 나눈 경계들. */
  streamX(i: number): number {
    const x = Math.round((this.grid.width * (i + 1)) / (LITE_MATERIALS.length + 1));
    return Math.min(this.grid.width - 1, Math.max(0, x));
  }

  /** 첫 프레임부터 다섯 물질이 다 보이도록 바닥에 얕은 띠를 깐다. */
  private seed(): void {
    const g = this.grid;
    const bed = Math.min(6, Math.max(1, Math.floor(g.height / 8)));
    const n = LITE_MATERIALS.length;
    for (let y = g.height - bed; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (this.rand() > 0.85) continue;
        const band = Math.min(n - 1, Math.floor((x / g.width) * n));
        g.set(x, y, LITE_MATERIALS[band].id);
      }
    }
    g.randomizeTints();
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

  // --- 브러시 -----------------------------------------------------------------

  /** 브러시 원에 걸리는 칸들을 [x,y,x,y,…] 평면 배열로. `fireShockwave`가 이 꼴을 받는다. */
  private brushCells(cx: number, cy: number): number[] {
    const out: number[] = [];
    for (let dy = -BRUSH_R; dy <= BRUSH_R; dy++) {
      for (let dx = -BRUSH_R; dx <= BRUSH_R; dx++) {
        if (dx * dx + dy * dy > BRUSH_R * BRUSH_R) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (this.grid.inBounds(x, y)) out.push(x, y);
      }
    }
    return out;
  }

  /** 누르고 있는 동안 매 틱. 물질은 흩뿌리고, 충격파는 정해진 박자로만 터진다. */
  private stamp(): void {
    const kind = this.currentKind;
    const ctx = this.sim.context;
    if (kind === null) {
      // 충격파는 쌓이는 값이 아니라 사건이라 본 게임의 브러시와 같은 박자로 묶는다
      // (PointerPainter.shockGate와 같은 규칙 — 새로 누르면 즉시 한 번은 터진다).
      if (this.lastShockTick >= 0 && ctx.tick - this.lastShockTick < SHOCK_BRUSH_PERIOD) return;
      this.lastShockTick = ctx.tick;
      fireShockwave(ctx, this.brushCells(this.brushX, this.brushY));
      return;
    }
    const fill = kind === LITE_FIRE ? BRUSH_FILL_FIRE : BRUSH_FILL;
    const cells = this.brushCells(this.brushX, this.brushY);
    for (let k = 0; k < cells.length; k += 2) {
      if (this.rand() > fill) continue;
      ctx.spawn(cells[k], cells[k + 1], kind.id);
    }
  }

  /** 누름 시작. 그 자리에서 즉시 한 번 찍는다(짧은 탭도 반응하도록). */
  press(x: number, y: number): void {
    if (!this.grid.inBounds(x, y)) return;
    this.brushX = x;
    this.brushY = y;
    this.pressed = true;
    this.lastShockTick = -1;
    this.stamp();
  }

  /** 누른 채로 끌기. 격자 밖으로 나가면 마지막 칸을 유지한다. */
  moveTo(x: number, y: number): void {
    if (!this.pressed || !this.grid.inBounds(x, y)) return;
    this.brushX = x;
    this.brushY = y;
  }

  /** 손을 떼는 순간이 종류가 바뀌는 시점이다(누르는 동안에는 한 종류로 고정). */
  release(): SpawnKind {
    if (this.pressed) {
      this.pressed = false;
      this.currentKind = this.drawKind();
    }
    return this.currentKind;
  }

  get isPressed(): boolean {
    return this.pressed;
  }

  // --- 한 틱 -------------------------------------------------------------------

  tick(): void {
    const g = this.grid;
    const ctx = this.sim.context;

    if (this.streams) {
      for (let i = 0; i < LITE_MATERIALS.length; i++) {
        if (this.rand() > STREAM_CHANCE) continue;
        const jitter = Math.round((this.rand() * 2 - 1) * STREAM_JITTER);
        const x = Math.min(g.width - 1, Math.max(0, this.streamX(i) + jitter));
        ctx.spawn(x, STREAM_Y, LITE_MATERIALS[i].id);
      }
    }

    if (this.pressed) this.stamp();

    if (++this.sinceSample >= DRAIN_SAMPLE_TICKS) {
      this.sinceSample = 0;
      let filled = 0;
      for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== EMPTY) filled++;
      const ratio = filled / g.cells.length;
      this.drainPerTick =
        ratio > DRAIN_HARD_FILL ? DRAIN_HARD_CELLS : ratio > DRAIN_SOFT_FILL ? DRAIN_SOFT_CELLS : 0;
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
