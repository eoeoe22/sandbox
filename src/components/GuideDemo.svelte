<script lang="ts">
  // 가이드 문서의 예시 캔버스 하나. 스크린샷이 들어갈 자리에 **진짜 엔진**을 끼워
  // 넣은 것으로, 시작 화면(`StartScreenSandbox.svelte`)과 역할 분담이 같다: 장면과
  // 대본은 `game/guideDemo.ts`에 있고, 여기서는 그 세계를 캔버스·RAF·가시성에
  // 잇기만 한다.
  //
  // 시작 화면과 다른 점은 셋이다.
  //
  // 1. **격자 크기가 화면을 안 따라간다.** 본 게임은 칸 크기를 고정하고 칸 수를
  //    화면에 맞추지만(layout.ts), 데모는 반대다 — 칸 수가 장면마다 고정이고 칸
  //    크기가 화면을 따라 변한다. 대본이 격자 크기에 대한 비율로 짜여 있어서,
  //    폭이 달라질 때마다 칸 수가 바뀌면 같은 장면이 화면마다 다르게 흘러간다.
  //    그래서 `cellScale = 폭 / (CELL_PX × 칸수)`로 역산해 layout에 되먹인다.
  // 2. **안 보이면 안 돈다.** 한 페이지에 여섯이 붙고 문서는 스크롤되므로,
  //    IntersectionObserver로 화면 밖의 것은 멈춘다(시작 화면은 한 화면짜리라
  //    `visibilitychange`만으로 충분했다).
  // 3. **손잡이가 없다.** 시작 화면은 눌리면 충격파가 터지지만 데모는 보는
  //    그림이다 — 포인터를 아예 안 받고 스크린리더에도 감춘다.
  import { onMount } from 'svelte';
  import { CanvasRenderer } from '../game/render/CanvasRenderer';
  import { SandboxLayout } from '../game/layout';
  import { CELL_PX, MAX_STEPS_PER_FRAME, USE_WASM_HEAT } from '../game/config';
  import { initHeatWasm } from '../game/engine/heatWasm';
  import {
    GuideDemoWorld,
    GUIDE_DEMO_SPECS,
    DEMO_STEP_MS,
    type DemoBrush,
    type GuideDemoKind,
  } from '../game/guideDemo';
  import { t } from '../i18n';

  interface Props {
    kind: GuideDemoKind;
    /** 상태 4종 데모의 **주인공 물질 id**. basics 탭은 넘기지 않아 기본값(돌·모래·
     *  물·연기)으로 돌아가고, 물질 카드는 자기 물질 id 를 넘겨 그 물질로 데모한다.
     *  overlap·heat 는 이 값을 쓰지 않는다. */
    subjectId?: number;
  }
  let { kind, subjectId }: Props = $props();

  const spec = GUIDE_DEMO_SPECS[kind];

  let stageEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;

  /** 그려야 할 브러시 원(고체 데모만) — CSS px 기준의 화면 좌표로 옮긴 것. */
  let brushBox = $state<{ x: number; y: number; d: number } | null>(null);
  /** 열 뷰 뱃지에 쓸 현재 렌더링 모드(열전도 데모만 화면에 띄운다). */
  let heatView = $state(false);

  onMount(() => {
    // 본 게임·시작 화면과 같은 호출. 열확산은 데모의 유일한 무거운 패스이고,
    // 커널은 JS 경로와 비트 동일이며 못 받아 오면 조용히 JS로 되돌아간다.
    if (USE_WASM_HEAT) void initHeatWasm();

    const layout = new SandboxLayout();

    /** 캔버스의 CSS 크기에서 격자를 다시 뽑는다. 칸 수(spec.cols)를 고정으로 두고
     *  칸 크기를 역산하므로, 폭이 얼마든 격자는 항상 spec.cols 칸이다. */
    function measure(): { w: number; h: number } {
      const cw = Math.max(1, canvasEl.clientWidth);
      const ch = Math.max(1, canvasEl.clientHeight);
      layout.setCellScale(cw / (CELL_PX * spec.cols));
      layout.setViewport(cw, ch);
      return { w: layout.gw, h: layout.gh };
    }

    const first = measure();
    const world = new GuideDemoWorld(kind, first.w, first.h, Math.random, subjectId);
    const renderer = new CanvasRenderer(canvasEl, world.grid, layout);
    renderer.setBorderMode(spec.borderMode);

    // 움직임 최소화를 켠 사용자에게는 대본을 돌리지 않는다. 대신 장면이 할 말을
    // 다 한 시점까지 한 번 앞으로 감아 그 한 프레임만 그린다(guideDemo.ts의
    // GUIDE_DEMO_STILL_TICKS) — 빈 네모보다는 낫고, 스스로 움직이지는 않는다.
    const calm =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /** 브러시 원을 칸 좌표에서 캔버스 안의 CSS 좌표로. 격자는 캔버스 안에 가운데
     *  정렬돼 있으므로(layout.cssRect) 그 오프셋을 함께 더한다. */
    function projectBrush(b: DemoBrush | null): void {
      if (b === null) {
        brushBox = null;
        return;
      }
      const rect = layout.cssRect();
      const cell = layout.cell;
      const d = (b.r * 2 + 1) * cell;
      brushBox = {
        x: rect.x + (b.x + 0.5) * cell - d / 2,
        y: rect.y + (b.y + 0.5) * cell - d / 2,
        d,
      };
    }

    function draw(): void {
      // 열 뷰는 대본이 쥐고 있다. 렌더러에 매 프레임 되먹이는 편이 전환 시점을
      // 놓치지 않는다(대본이 바꾸는 값을 컴포넌트가 감시할 이유가 없다).
      renderer.setHeatOverlay(world.heatView);
      if (heatView !== world.heatView) heatView = world.heatView;
      renderer.render(world.grid);
      projectBrush(world.brush);
    }

    let gw = first.w;
    let gh = first.h;

    /** 캔버스 백버퍼와 격자를 현재 CSS 크기에 맞춘다. 격자 칸 수가 실제로 바뀐
     *  경우에만 `true` — 그때는 장면이 처음부터 다시 세워졌다는 뜻이다. */
    function resize(): boolean {
      const dpr = window.devicePixelRatio || 1;
      const { w, h } = measure();
      renderer.resize(
        Math.max(1, Math.floor(canvasEl.clientWidth * dpr)),
        Math.max(1, Math.floor(canvasEl.clientHeight * dpr)),
      );
      const rebuilt = w !== gw || h !== gh;
      if (rebuilt) {
        world.resize(w, h);
        gw = w;
        gh = h;
      }
      draw();
      return rebuilt;
    }

    if (calm) {
      world.windToStill();
      resize();
      const ro = new ResizeObserver(() => {
        // 칸 수가 바뀌었으면 장면이 빈 채로 다시 세워졌으므로 한 번 더 감아 준다.
        // 안 바뀌었으면 캔버스 크기만 맞춘 것이라 그대로 두어야 한다 — 여기서
        // 또 감으면 정지 화면이 대본을 지나쳐 다음 바퀴로 넘어간다.
        if (resize()) {
          world.windToStill();
          draw();
        }
      });
      ro.observe(canvasEl);
      return () => ro.disconnect();
    }

    // --- 루프 -----------------------------------------------------------------

    let raf: number | null = null;
    let last = 0;
    let acc = 0;

    function frame(now: number): void {
      raf = requestAnimationFrame(frame);
      let dt = now - last;
      last = now;
      if (dt > DEMO_STEP_MS * 2) dt = DEMO_STEP_MS * 2; // 탭 복귀 후 몰아치기 방지
      acc += dt;
      let steps = 0;
      while (acc >= DEMO_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        world.tick();
        acc -= DEMO_STEP_MS;
        steps++;
      }
      if (acc > DEMO_STEP_MS * MAX_STEPS_PER_FRAME) acc = 0;
      draw();
    }

    /** 화면 안에 있는가(IntersectionObserver)와 탭이 살아 있는가(visibility)가
     *  **둘 다** 참일 때만 돈다. 둘을 따로 두면 스크롤로 들어온 데모가 숨은
     *  탭에서도 살아난다. */
    let onScreen = false;

    function sync(): void {
      const shouldRun = onScreen && !document.hidden;
      if (shouldRun && raf === null) {
        last = performance.now();
        acc = 0;
        raf = requestAnimationFrame(frame);
      } else if (!shouldRun && raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }

    // 완전히 사라지기 전에 미리 멈추지 않도록 문턱을 0으로 둔다 — 한 픽셀이라도
    // 걸쳐 있으면 도는 편이, 스크롤 도중 장면이 얼어붙는 것보다 낫다.
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        sync();
      },
      { threshold: 0 },
    );
    io.observe(stageEl);

    const onVisibility = (): void => sync();
    document.addEventListener('visibilitychange', onVisibility);

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvasEl);

    resize();

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
</script>

<!-- 보는 그림이다. 포인터를 안 받고(`pointer-events: none`) 스크린리더에도 감춘다
     — 옆의 산문이 같은 내용을 이미 말하고 있고, 캔버스에는 읽어 줄 것이 없다. -->
<div
  class="demo"
  bind:this={stageEl}
  style={`aspect-ratio: ${spec.aspect};`}
  aria-hidden="true"
>
  <canvas bind:this={canvasEl}></canvas>
  {#if brushBox}
    <!-- 브러시 커서. 렌더러가 아니라 DOM에 그린다 — 엔진이 아는 것은 칠해진
         칸뿐이고, 커서는 화면 위에만 있는 것이라서다. -->
    <div
      class="cursor"
      style={`left: ${brushBox.x}px; top: ${brushBox.y}px; width: ${brushBox.d}px; height: ${brushBox.d}px;`}
    ></div>
  {/if}
  {#if kind === 'heat'}
    <span class="badge" class:hot={heatView}>
      {heatView ? t('render.heatmapOn') : t('render.heatmapOff')}
    </span>
  {/if}
</div>

<style>
  .demo {
    position: relative;
    width: 100%;
    border-radius: 0.5rem;
    overflow: hidden;
    background: #0a0b0f;
    border: 1px solid #262a33;
    /* 보는 그림이라 포인터를 흘려보낸다 — 문서 위에서 드래그로 글을 선택할 때
       여섯 개의 캔버스가 선택을 끊어 먹지 않게. */
    pointer-events: none;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* 브러시 원: 게임의 브러시 미리보기와 같은 흰 테두리 원. */
  .cursor {
    position: absolute;
    border: 1px solid rgba(255, 255, 255, 0.85);
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }

  /* 지금 무엇으로 그리고 있는지 — 열전도 데모가 도중에 열지도로 넘어가므로,
     화면이 갑자기 빨개진 이유를 한 단어로 밝힌다. */
  .badge {
    position: absolute;
    top: 0.4rem;
    right: 0.45rem;
    padding: 0.15rem 0.45rem;
    border-radius: 0.3rem;
    border: 1px solid #2c313c;
    background: rgba(10, 11, 15, 0.8);
    color: #9aa4b2;
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .badge.hot {
    border-color: #b45309;
    color: #fcd34d;
  }
</style>
