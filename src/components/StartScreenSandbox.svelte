<script lang="ts">
  // 시작 화면(`/`) 배경에서 도는 **진짜 엔진**의 캔버스 쪽 절반. 세계 자체(줄
  // 낙하·배수·자동 이벤트·종류 룰렛)는 `game/startScreen.ts`에 있고, 여기서는
  // 그 세계를 캔버스와 RAF에 잇기만 한다. 배경은 눌러서 노는 곳이 아니라 혼자
  // 굴러가는 장면이라, 포인터를 받지 않는다.
  //
  // 고정 설정(시작 화면에는 설정 UI가 없다): 속도 ×1, 테두리 = 벽/바닥, 연기 =
  // 중간. 세 값 모두 `game/startScreen.ts`의 상수다.

  import { onMount } from 'svelte';
  import { CanvasRenderer } from '../game/render/CanvasRenderer';
  import { SandboxLayout } from '../game/layout';
  import { MAX_STEPS_PER_FRAME, USE_WASM_HEAT } from '../game/config';
  import { initHeatWasm } from '../game/engine/heatWasm';
  import {
    StartScreenWorld,
    START_BORDER_MODE,
    START_CELL_SCALE,
    START_STEP_MS,
  } from '../game/startScreen';

  let canvasEl: HTMLCanvasElement;

  onMount(() => {
    // Rust/WASM 열확산 커널을 배경에서 받아 둔다(본 게임의 Game.ts와 같은 호출).
    // 열확산 패스는 dirty tile을 안 타는 전면 이중 루프라 이 배경 틱에서 가장
    // 비싼 자리인데, 시작 화면만 이 호출이 없어서 JS 폴백에 묶여 있었다.
    // 커널은 JS 경로와 비트 동일이고 못 받아 오면 조용히 JS로 되돌아간다.
    if (USE_WASM_HEAT) void initHeatWasm();

    const layout = new SandboxLayout();
    layout.setCellScale(START_CELL_SCALE);
    layout.setViewport(canvasEl.clientWidth, canvasEl.clientHeight);

    // 움직임 최소화를 켠 사용자에게는 아무것도 스스로 움직이지 않게 한다 —
    // 떨어지는 줄도, 1초마다 터지는 이벤트도 사용자가 일으킨 움직임이 아니다.
    const calm =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const world = new StartScreenWorld(layout.gw, layout.gh, { motion: !calm });

    const renderer = new CanvasRenderer(canvasEl, world.grid, layout);
    renderer.setBorderMode(START_BORDER_MODE);

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
    };
  });
</script>

<div class="stage" aria-hidden="true">
  <canvas bind:this={canvasEl} class="sim"></canvas>
  <div class="veil"></div>
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    z-index: 0;
    /* 배경일 뿐이라 포인터를 받지 않는다 — 위에 얹힌 메뉴가 온전히 가져간다. */
    pointer-events: none;
  }

  .sim {
    width: 100%;
    height: 100%;
    display: block;
    /* 메뉴 글자가 위에 얹히므로 살짝 눌러 둔다. 불꽃은 그래도 또렷하다. */
    filter: brightness(0.78) saturate(1.05);
  }

  /* 가운데를 조금 어둡게 해 타이틀과 메뉴가 어떤 장면 위에서도 읽히게 한다. */
  .veil {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        ellipse at 50% 42%,
        rgba(8, 8, 12, 0.82) 0%,
        rgba(8, 8, 12, 0.35) 55%,
        rgba(8, 8, 12, 0.1) 100%
      ),
      linear-gradient(to bottom, rgba(8, 8, 12, 0.55) 0%, rgba(8, 8, 12, 0) 30%, rgba(8, 8, 12, 0.6) 100%);
  }
</style>
