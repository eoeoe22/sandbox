<script lang="ts">
  // 시작 화면(`/`) 배경에서 도는 **진짜 엔진**의 캔버스 쪽 절반. 세계 자체(줄
  // 낙하·배수·자동 이벤트·종류 룰렛·클릭 충격파)는 `game/startScreen.ts`에
  // 있고, 여기서는 그 세계를 캔버스·RAF·포인터에 잇기만 한다.
  //
  // 포인터로 하는 일은 하나뿐이다: **누른 자리에서 충격파 한 번**. 화면 좌표를
  // 칸 좌표로 바꿔 `world.burstAt`에 넘기는 것이 이 파일의 몫이고, 터질지
  // 말지·무엇이 터질지는 전부 저쪽이 정한다.
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
  /** 포인터를 받는 쪽. 캔버스가 아니라 이 껍데기다 — 캔버스 위에 베일이
   *  덮여 있어서, 캔버스에 직접 걸면 눌린 것이 베일이라 안 온다. */
  let stageEl: HTMLDivElement;

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

    // --- 포인터 -------------------------------------------------------------
    // 배경을 누르면 그 자리에서 충격파가 한 번 터진다. 앞면(타이틀·푸터·여백)은
    // 포인터를 흘려보내므로(index.astro의 `.foreground { pointer-events: none }`)
    // **메뉴 버튼 세 줄만 빼면 화면 어디를 눌러도** 여기로 온다.

    /** CSS 좌표 → 격자 좌표. 격자는 캔버스 안에 가운데 정렬돼 있다(layout.cssRect). */
    function cellAt(clientX: number, clientY: number): { x: number; y: number } {
      const box = canvasEl.getBoundingClientRect();
      const rect = layout.cssRect();
      return {
        x: Math.floor((clientX - box.left - rect.x) / layout.cell),
        y: Math.floor((clientY - box.top - rect.y) / layout.cell),
      };
    }

    // 누를 때 한 번. 끌어도 더 터지지 않으므로 move/up을 볼 일이 없고, 포인터
    // 캡처도 필요 없다. `pointerdown`이라 터치에서도 지연 없이 즉시 터진다.
    function onDown(e: PointerEvent): void {
      // 마우스는 왼쪽 버튼만 — 오른쪽은 컨텍스트 메뉴 몫이다. 손가락·펜은 그대로.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const c = cellAt(e.clientX, e.clientY);
      world.burstAt(c.x, c.y); // 화면 밖이면 저쪽에서 걸러 낸다
    }
    stageEl.addEventListener('pointerdown', onDown);

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
      stageEl.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
    };
  });
</script>

<!-- 배경 전체가 하나의 두드릴 수 있는 면이다. 스크린리더에는 여전히 감춰
     둔다(`aria-hidden`) — 눌러 보면 파티클이 밀리는 순수 시각 효과라 읽어 줄
     것이 없고, 포커스를 받지 않으므로 키보드 순서에도 끼어들지 않는다. 시작
     화면이 하는 실제 일(게임 시작·불러오기·도감)은 전부 메뉴 버튼에 있다. -->
<div class="stage" bind:this={stageEl} aria-hidden="true">
  <canvas bind:this={canvasEl} class="sim"></canvas>
  <div class="veil"></div>
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    z-index: 0;
    /* 눌리는 면. 앞면이 포인터를 흘려보내므로(index.astro) 메뉴 버튼을 뺀 화면
       전체가 여기로 들어온다 — 캔버스 위에 덮인 베일까지 포함해서다.
       (터치에서 톡톡 두드려도 확대되지 않는 것은 이 페이지가 `app` 페이지라
       viewport 메타가 이미 확대를 막고 있어서다 — Base.astro의 `app` prop.) */
    pointer-events: auto;
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
