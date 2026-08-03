<script lang="ts">
  // 시작 화면(`/`) 배경에서 도는 **진짜 엔진**의 캔버스 쪽 절반. 세계 자체(줄
  // 낙하·배수·클릭 브러시·종류 룰렛)는 `game/startScreen.ts`에 있고, 여기서는
  // 그 세계를 캔버스·RAF·포인터에 잇기만 한다.
  //
  // 고정 설정(시작 화면에는 설정 UI가 없다): 속도 ×1, 테두리 = 벽/바닥, 연기 =
  // 중간. 세 값 모두 `game/startScreen.ts`의 상수다.

  import { onMount } from 'svelte';
  import { CanvasRenderer } from '../game/render/CanvasRenderer';
  import { SandboxLayout } from '../game/layout';
  import { MAX_STEPS_PER_FRAME } from '../game/config';
  import {
    StartScreenWorld,
    START_BORDER_MODE,
    START_CELL_SCALE,
    START_STEP_MS,
    type SpawnKind,
  } from '../game/startScreen';
  import { materialName, t } from '../i18n';

  let canvasEl: HTMLCanvasElement;
  /** 지금 누르면 나올 것 — 아래쪽 칩에 표시한다. */
  let currentKind = $state<SpawnKind>(null);
  let holding = $state(false);

  const kindLabel = (k: SpawnKind): string =>
    k === null ? t('tool.shock') : materialName(k.id, k.name);

  onMount(() => {
    const layout = new SandboxLayout();
    layout.setCellScale(START_CELL_SCALE);
    layout.setViewport(canvasEl.clientWidth, canvasEl.clientHeight);

    // 움직임 최소화를 켠 사용자에게는 물질 줄을 흘리지 않는다. 클릭은 그대로
    // 받으므로(사용자가 스스로 일으킨 움직임) 화면이 죽지는 않는다.
    const calm =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const world = new StartScreenWorld(layout.gw, layout.gh, { streams: !calm });
    currentKind = world.currentKind;

    const renderer = new CanvasRenderer(canvasEl, world.grid, layout);
    renderer.setBorderMode(START_BORDER_MODE);

    // --- 포인터 -------------------------------------------------------------

    /** CSS 좌표 → 격자 좌표. 격자는 캔버스 안에 가운데 정렬돼 있다(layout.cssRect). */
    function cellAt(clientX: number, clientY: number): { x: number; y: number } {
      const box = canvasEl.getBoundingClientRect();
      const rect = layout.cssRect();
      return {
        x: Math.floor((clientX - box.left - rect.x) / layout.cell),
        y: Math.floor((clientY - box.top - rect.y) / layout.cell),
      };
    }

    function onDown(e: PointerEvent): void {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const c = cellAt(e.clientX, e.clientY);
      if (!world.grid.inBounds(c.x, c.y)) return;
      canvasEl.setPointerCapture(e.pointerId);
      world.press(c.x, c.y);
      holding = true;
    }

    function onMove(e: PointerEvent): void {
      if (!world.isPressed) return;
      const c = cellAt(e.clientX, e.clientY);
      world.moveTo(c.x, c.y);
    }

    function onUp(): void {
      if (!world.isPressed) return;
      currentKind = world.release();
      holding = false;
    }

    canvasEl.addEventListener('pointerdown', onDown);
    canvasEl.addEventListener('pointermove', onMove);
    canvasEl.addEventListener('pointerup', onUp);
    canvasEl.addEventListener('pointercancel', onUp);

    // --- 루프 ---------------------------------------------------------------

    let raf: number | null = null;
    let last = 0;
    let acc = 0;

    function frame(now: number): void {
      raf = requestAnimationFrame(frame);
      let dt = now - last;
      last = now;
      if (dt > START_STEP_MS * 2) dt = START_STEP_MS * 2; // 탭 복귀 후 몰아치기 방지
      acc += dt;
      let steps = 0;
      while (acc >= START_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        world.tick();
        acc -= START_STEP_MS;
        steps++;
      }
      if (acc > START_STEP_MS * MAX_STEPS_PER_FRAME) acc = 0;
      renderer.render(world.grid);
    }

    function start(): void {
      if (raf !== null) return;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop(): void {
      if (raf === null) return;
      cancelAnimationFrame(raf);
      raf = null;
    }

    // 탭이 숨겨지면 멈춘다. 시작 화면은 한 화면에 담기므로(스크롤 없음)
    // IntersectionObserver까지는 두지 않는다.
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    function resize(): void {
      const dpr = window.devicePixelRatio || 1;
      renderer.resize(
        Math.max(1, Math.floor(canvasEl.clientWidth * dpr)),
        Math.max(1, Math.floor(canvasEl.clientHeight * dpr)),
      );
      layout.setViewport(canvasEl.clientWidth, canvasEl.clientHeight);
      world.resize(layout.gw, layout.gh);
    }
    resize();
    window.addEventListener('resize', resize);

    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
      canvasEl.removeEventListener('pointerdown', onDown);
      canvasEl.removeEventListener('pointermove', onMove);
      canvasEl.removeEventListener('pointerup', onUp);
      canvasEl.removeEventListener('pointercancel', onUp);
    };
  });
</script>

<div class="stage">
  <canvas bind:this={canvasEl} class="sim"></canvas>
  <div class="veil"></div>
  <div class="hint" class:held={holding}>
    <span class="dot"></span>
    <span class="text">아무 데나 누르면 <b>{kindLabel(currentKind)}</b></span>
  </div>
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    z-index: 0;
  }

  .sim {
    width: 100%;
    height: 100%;
    display: block;
    /* 메뉴 글자가 위에 얹히므로 살짝 눌러 둔다. 누른 자리는 그래도 또렷하다. */
    filter: brightness(0.78) saturate(1.05);
    touch-action: none;
    cursor: crosshair;
  }

  /* 가운데를 조금 어둡게 해 타이틀과 메뉴가 어떤 장면 위에서도 읽히게 한다. */
  .veil {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(
        ellipse at 50% 42%,
        rgba(8, 8, 12, 0.82) 0%,
        rgba(8, 8, 12, 0.35) 55%,
        rgba(8, 8, 12, 0.1) 100%
      ),
      linear-gradient(to bottom, rgba(8, 8, 12, 0.55) 0%, rgba(8, 8, 12, 0) 30%, rgba(8, 8, 12, 0.6) 100%);
  }

  .hint {
    position: absolute;
    left: 50%;
    bottom: 1.4rem;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.85rem;
    border-radius: 9999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(12, 12, 18, 0.6);
    backdrop-filter: blur(8px);
    color: #94a3b8;
    font-size: 0.82rem;
    white-space: nowrap;
    pointer-events: none;
    transition:
      color 0.2s ease,
      border-color 0.2s ease;
  }

  .hint b {
    color: #e2e8f0;
    font-weight: 700;
  }

  .hint.held {
    color: #cbd5e1;
    border-color: rgba(129, 140, 248, 0.5);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #818cf8;
    box-shadow: 0 0 8px #818cf8;
  }

  @media (max-width: 480px) {
    .hint {
      font-size: 0.75rem;
      bottom: 0.9rem;
    }
  }
</style>
