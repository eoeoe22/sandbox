<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    $running as running,
    $simSpeed as simSpeed,
    $brushSize as brushSize,
    $brushShape as brushShape,
    $brushMode as brushMode,
    $overwriteLevel as overwriteLevel,
    $tool as tool,
    $selectedMaterial as selectedMaterial,
    $fps as fps,
    $fpsPeak as fpsPeak,
    $gridDims as gridDims,
    $borderMode as borderMode,
    $smokeLevel as smokeLevel,
    requestClear,
    requestStep,
  } from '../state/store';
  import {
    BRUSH_MIN,
    BRUSH_MAX,
    OVERWRITE_LEVELS,
    OVERWRITE_LEVEL_MIN,
    OVERWRITE_LEVEL_MAX,
  } from '../game/config';
  import { getMaterial } from '../game/materials';
  import MaterialPalette from './MaterialPalette.svelte';
  import BlendBrush from './BlendBrush.svelte';

  // Name of the currently selected paint material, shown on the 재료 (draw) brush
  // button so the active material is always visible without opening the palette.
  const selectedName = $derived(getMaterial($selectedMaterial)?.name ?? '재료');

  // Mobile-only: the secondary settings (speed, brush size/shape/mode, overwrite,
  // edge mode, HUD) collapse behind a toggle so the bottom bar stays two rows.
  // On desktop the sheet is always shown inline in the sidebar and this is unused.
  let sheetOpen = $state(false);
  let sheetEl = $state<HTMLDivElement | null>(null);
  let toggleEl = $state<HTMLButtonElement | null>(null);

  // 전체 지우기 is destructive, so it's a two-step confirm: the first click arms
  // the button (its label switches to a confirm prompt for 2s); a second click
  // within that window clears the world, otherwise it quietly disarms.
  let clearArmed = $state(false);
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  function handleClear(): void {
    if (clearArmed) {
      clearTimeout(clearTimer);
      clearArmed = false;
      requestClear();
      return;
    }
    clearArmed = true;
    clearTimer = setTimeout(() => {
      clearArmed = false;
    }, 2000);
  }

  // Mobile settings sheet has no X button — tapping the toggle again or anywhere
  // outside the sheet closes it. The toggle's own click runs before this bubbles
  // to window, so `toggleEl` guards against it reopening/closing twice. On desktop
  // the sheet is always shown inline (its `.open` class is ignored), so closing
  // `sheetOpen` here has no visible effect.
  function handleWindowClick(e: MouseEvent): void {
    if (!sheetOpen) return;
    const t = e.target as Node;
    if (sheetEl?.contains(t)) return;
    if (toggleEl?.contains(t)) return;
    sheetOpen = false;
  }

  onDestroy(() => clearTimeout(clearTimer));
</script>

<svelte:window onclick={handleWindowClick} />

<aside class="panel">
  <div class="head">
    <i class="bi bi-boxes" aria-hidden="true"></i>
    <h1>Particle Sandbox</h1>
  </div>

  <!-- Primary controls (bottom-bar row 1 on mobile) + material palette (row 2). -->
  <div class="bar">
    <div class="bar-row primary">
      <div class="group" role="group" aria-label="재생 제어">
        <button
          class="ctl"
          onclick={() => running.set(!$running)}
          aria-label={$running ? '일시정지' : '재생'}
          title={$running ? '일시정지' : '재생'}
        >
          <i class={`bi ${$running ? 'bi-pause-fill' : 'bi-play-fill'}`} aria-hidden="true"></i>
          <span class="label">{$running ? '일시정지' : '재생'}</span>
        </button>
        <button
          class="ctl"
          onclick={requestStep}
          disabled={$running}
          aria-label="한 스텝 진행"
          title="한 스텝 진행 (일시정지 중)"
        >
          <i class="bi bi-skip-end-fill" aria-hidden="true"></i>
          <span class="label">스텝</span>
        </button>
        <button
          class="ctl clear-btn"
          class:armed={clearArmed}
          onclick={handleClear}
          aria-label={clearArmed ? '전체 지우기 확인' : '전체 지우기'}
          title="전체 지우기"
        >
          <i class="bi bi-trash3" aria-hidden="true"></i>
          <span class="label">{clearArmed ? '계속하시겠습니까?' : '지우기'}</span>
        </button>
      </div>

      <div class="group" role="group" aria-label="브러시 도구">
        <button
          class="ctl material-btn"
          class:active={$tool === 'material'}
          onclick={() => tool.set('material')}
          aria-pressed={$tool === 'material'}
          aria-label={`재료: ${selectedName}`}
          title={`선택한 재료를 그립니다: ${selectedName}`}
        >
          <i class="bi bi-brush" aria-hidden="true"></i>
          <span class="label material-name">{selectedName}</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'heat'}
          onclick={() => tool.set('heat')}
          aria-pressed={$tool === 'heat'}
          aria-label="가열"
          title="브러시 영역의 온도를 올립니다 (빈칸 제외)"
        >
          <i class="bi bi-fire" aria-hidden="true"></i>
          <span class="label">가열</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'cool'}
          onclick={() => tool.set('cool')}
          aria-pressed={$tool === 'cool'}
          aria-label="냉각"
          title="브러시 영역의 온도를 내립니다 (빈칸 제외)"
        >
          <i class="bi bi-snow" aria-hidden="true"></i>
          <span class="label">냉각</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'mix'}
          onclick={() => tool.set('mix')}
          aria-pressed={$tool === 'mix'}
          aria-label="섞기"
          title="브러시 영역의 파티클을 섞습니다 (고체 제외)"
        >
          <i class="bi bi-tornado" aria-hidden="true"></i>
          <span class="label">섞기</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'blend'}
          onclick={() => tool.set('blend')}
          aria-pressed={$tool === 'blend'}
          aria-label="혼합 브러시"
          title="여러 물질을 비율대로 섞어 그립니다 (설정에서 비율 조절)"
        >
          <i class="bi bi-palette-fill" aria-hidden="true"></i>
          <span class="label">혼합</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'erase'}
          onclick={() => tool.set('erase')}
          aria-pressed={$tool === 'erase'}
          aria-label="지우개"
          title="브러시 영역을 지웁니다 (빈칸으로)"
        >
          <i class="bi bi-eraser-fill" aria-hidden="true"></i>
          <span class="label">지우개</span>
        </button>
      </div>

      <!-- Mobile only: reveal the settings sheet. -->
      <button
        class="ctl sheet-toggle"
        bind:this={toggleEl}
        onclick={() => (sheetOpen = !sheetOpen)}
        aria-label="설정"
        aria-expanded={sheetOpen}
        title="설정"
      >
        <i class="bi bi-sliders2" aria-hidden="true"></i>
      </button>
    </div>

    <div class="bar-row palette-row">
      <MaterialPalette />
    </div>
  </div>

  <!-- Secondary settings. Desktop: inline in the sidebar. Mobile: pop-up sheet
       (no X button — tap outside or the toggle to close; see handleWindowClick). -->
  <div class="sheet" class:open={sheetOpen} bind:this={sheetEl}>
    <div class="sheet-head">
      <span>설정</span>
    </div>

    <div class="field">
      <span class="field-label">속도: {$simSpeed === 2 ? '×2 (원래 속도)' : '×1 (기본)'}</span>
      <div class="seg" role="group" aria-label="시뮬레이션 속도">
        <button
          class="ctl"
          class:active={$simSpeed === 1}
          onclick={() => simSpeed.set(1)}
          aria-pressed={$simSpeed === 1}
          title="기본 속도 (원래 속도의 절반)"
        >
          ×1
        </button>
        <button
          class="ctl"
          class:active={$simSpeed === 2}
          onclick={() => simSpeed.set(2)}
          aria-pressed={$simSpeed === 2}
          title="2배 속도 (원래 속도)"
        >
          ×2
        </button>
      </div>
    </div>

    <label class="field">
      <span class="field-label">
        브러시 크기: {$brushSize}<span class="wheel-hint"> (휠로 조절)</span>
      </span>
      <input
        type="range"
        min={BRUSH_MIN}
        max={BRUSH_MAX}
        value={$brushSize}
        oninput={(e) => brushSize.set(+e.currentTarget.value)}
      />
    </label>

    <div class="field">
      <span class="field-label">브러시 모양</span>
      <div class="seg" role="group" aria-label="브러시 모양">
        <button
          class="ctl"
          class:active={$brushShape === 'circle'}
          onclick={() => brushShape.set('circle')}
          aria-pressed={$brushShape === 'circle'}
          title="원형 브러시"
        >
          <i class="bi bi-circle-fill" aria-hidden="true"></i>
          <span class="label">원형</span>
        </button>
        <button
          class="ctl"
          class:active={$brushShape === 'square'}
          onclick={() => brushShape.set('square')}
          aria-pressed={$brushShape === 'square'}
          title="사각형 브러시"
        >
          <i class="bi bi-square-fill" aria-hidden="true"></i>
          <span class="label">사각형</span>
        </button>
      </div>
    </div>

    <div class="field">
      <span class="field-label">채우기</span>
      <div class="seg" role="group" aria-label="브러시 채우기 방식">
        <button
          class="ctl"
          class:active={$brushMode === 'full'}
          onclick={() => brushMode.set('full')}
          aria-pressed={$brushMode === 'full'}
          title="브러시 영역을 빈틈없이 채웁니다"
        >
          <i class="bi bi-grid-fill" aria-hidden="true"></i>
          <span class="label">Full</span>
        </button>
        <button
          class="ctl"
          class:active={$brushMode === 'particle'}
          onclick={() => brushMode.set('particle')}
          aria-pressed={$brushMode === 'particle'}
          title="브러시 영역에 무작위로 빈틈을 남깁니다 (고체는 항상 Full)"
        >
          <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
          <span class="label">Particle</span>
        </button>
      </div>
    </div>

    <label class="field">
      <span class="field-label">덮어쓰기: {OVERWRITE_LEVELS[$overwriteLevel]}</span>
      <input
        type="range"
        min={OVERWRITE_LEVEL_MIN}
        max={OVERWRITE_LEVEL_MAX}
        step="1"
        value={$overwriteLevel}
        oninput={(e) => overwriteLevel.set(+e.currentTarget.value)}
      />
      <div class="overwrite-steps" aria-hidden="true">
        {#each OVERWRITE_LEVELS as _, i}
          <span class="step" class:filled={i <= $overwriteLevel}></span>
        {/each}
      </div>
    </label>

    <div class="field">
      <span class="field-label">테두리</span>
      <div class="seg" role="group" aria-label="테두리 모드">
        <button
          class="ctl"
          class:active={$borderMode === 'wall'}
          onclick={() => borderMode.set('wall')}
          aria-pressed={$borderMode === 'wall'}
          title="테두리가 단단한 벽 — 파티클이 밖으로 나가지 못합니다"
        >
          <i class="bi bi-bricks" aria-hidden="true"></i>
          <span class="label">벽</span>
        </button>
        <button
          class="ctl"
          class:active={$borderMode === 'void'}
          onclick={() => borderMode.set('void')}
          aria-pressed={$borderMode === 'void'}
          title="테두리가 공허 — 가장자리에 닿은 파티클은 밖으로 떨어져 사라집니다"
        >
          <i class="bi bi-dash-square-dotted" aria-hidden="true"></i>
          <span class="label">공허</span>
        </button>
      </div>
    </div>

    <div class="field">
      <span class="field-label">연기</span>
      <div class="seg" role="group" aria-label="연기 세기">
        <button
          class="ctl"
          class:active={$smokeLevel === 'high'}
          onclick={() => smokeLevel.set('high')}
          aria-pressed={$smokeLevel === 'high'}
          title="연소·폭발 반응이 연기를 많이 냅니다"
        >
          <i class="bi bi-cloud-fog2" aria-hidden="true"></i>
          <span class="label">상</span>
        </button>
        <button
          class="ctl"
          class:active={$smokeLevel === 'medium'}
          onclick={() => smokeLevel.set('medium')}
          aria-pressed={$smokeLevel === 'medium'}
          title="연기를 적당히 냅니다 (기본값)"
        >
          <i class="bi bi-cloud" aria-hidden="true"></i>
          <span class="label">중</span>
        </button>
        <button
          class="ctl"
          class:active={$smokeLevel === 'off'}
          onclick={() => smokeLevel.set('off')}
          aria-pressed={$smokeLevel === 'off'}
          title="반응에서 연기를 내지 않습니다"
        >
          <i class="bi bi-cloud-slash" aria-hidden="true"></i>
          <span class="label">끔</span>
        </button>
      </div>
    </div>

    <div class="field">
      <span class="field-label">혼합 브러시</span>
      <BlendBrush />
    </div>

    <div class="hud">
      <span class="dims">격자 {$gridDims.w}×{$gridDims.h}</span>
      <span
        class="fps"
        title="적응형 주사율(ProMotion/Adaptive Sync) 기기는 유휴 시 절전을 위해 주사율을 낮춥니다. '최대'는 이 세션에서 관측된 최고값입니다."
      >
        {$fps} FPS {#if $fpsPeak > $fps + 5}· 최대 {$fpsPeak}{/if}
      </span>
    </div>

    <p class="hint">
      캔버스를 드래그해 물질을 그리세요. 오른쪽 클릭이나 지우개 브러시로 지웁니다.
    </p>
  </div>
</aside>

<style>
  /* --------------------------------------------------------------------- */
  /* Desktop (default): the panel is a fixed sidebar docked to the left, the
     full height of the viewport. Its width matches the --sidebar-w the canvas
     carves out, so the sandbox never sits underneath it.                   */
  /* --------------------------------------------------------------------- */
  .panel {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 10;
    width: var(--sidebar-w);
    height: 100vh;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: rgba(20, 20, 26, 0.92);
    backdrop-filter: blur(8px);
    border-right: 1px solid #2a2a33;
    color: #e8e8ee;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 13px;
    user-select: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: #3a3a46 transparent;
  }
  .panel::-webkit-scrollbar {
    width: 8px;
  }
  .panel::-webkit-scrollbar-track {
    background: transparent;
  }
  .panel::-webkit-scrollbar-thumb {
    background: #3a3a46;
    border-radius: 4px;
  }
  .panel::-webkit-scrollbar-thumb:hover {
    background: #4a4a58;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e8e8ee;
  }
  .head i {
    font-size: 18px;
    color: #6ea8fe;
  }
  h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .bar,
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .bar-row.primary {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .group .ctl {
    flex: 1 1 auto;
  }

  /* Shared button. */
  .ctl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  }
  .ctl i {
    font-size: 15px;
    line-height: 1;
  }
  .ctl:hover {
    border-color: #3a3a46;
  }
  .ctl:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .ctl.active {
    border-color: #6ea8fe;
    background: #23324a;
  }
  /* Armed 전체 지우기 button: an amber "are you sure?" state before it wipes. */
  .ctl.armed {
    border-color: #e0a030;
    background: #4a3a1a;
    color: #ffd98a;
  }
  .ctl.armed:hover {
    border-color: #f0b040;
  }

  /* The 재료 brush button shows the selected material's name in full — never
     truncated with an ellipsis. The button sizes to fit the name (the control
     group wraps around it on desktop; the bar scrolls sideways on mobile). */
  .material-name {
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
  }

  /* Two-option segmented control (speed, shape, mode, border). */
  .seg {
    display: flex;
    gap: 6px;
  }
  .seg .ctl {
    flex: 1 1 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-label {
    color: #cfcfd8;
  }
  .field input[type='range'] {
    width: 100%;
  }

  .overwrite-steps {
    display: flex;
    gap: 3px;
  }
  .overwrite-steps .step {
    flex: 1 1 0;
    height: 4px;
    border-radius: 2px;
    background: #2a2a33;
  }
  .overwrite-steps .step.filled {
    background: #6ea8fe;
  }

  .hud {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 10px;
    font-variant-numeric: tabular-nums;
    color: #8a8a99;
  }
  .fps {
    cursor: help;
  }
  .hint {
    margin: 0;
    color: #6a6a78;
    font-size: 11px;
    line-height: 1.4;
  }

  /* The settings sheet header (label only) + toggle are mobile-only affordances. */
  .sheet-head,
  .sheet-toggle {
    display: none;
  }

  /* --------------------------------------------------------------------- */
  /* Mobile: the panel becomes a two-row bar docked along the bottom. Row 1 is
     the primary controls, row 2 the material palette; both scroll sideways if
     they overflow. The secondary settings live in a sheet that pops up above
     the bar when toggled.

     Anchored with `top` (not `bottom:0`) so it lands at the toolbar/canvas
     boundary measured from the dynamic viewport. `bottom:0` on a fixed element
     is relative to the *layout* viewport (100vh — the large height with the
     address bar collapsed), which hides the bar behind the address bar on
     mobile. `top: calc(100dvh - h)` is measured from the top using dvh (the
     *visible* viewport), so it always sits just under the canvas regardless of
     address-bar state.                                       */
  /* --------------------------------------------------------------------- */
  @media (max-width: 768px) {
    .panel {
      /* vh fallback for browsers without dvh support. */
      top: calc(100vh - var(--bottombar-h));
      top: calc(100dvh - var(--bottombar-h));
      bottom: auto;
      left: 0;
      width: 100vw;
      height: var(--bottombar-h);
      padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
      gap: 6px;
      border-right: none;
      border-top: 1px solid #2a2a33;
      overflow: visible;
    }

    .head {
      display: none;
    }

    .bar {
      flex: 1;
      min-width: 0;
      gap: 6px;
    }
    .bar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 0;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .bar-row::-webkit-scrollbar {
      display: none;
    }
    .bar-row.primary {
      flex-direction: row;
    }
    .group {
      flex: none;
      flex-wrap: nowrap;
    }
    .group .ctl {
      flex: none;
    }
    /* Icon-only buttons in the bar: hide the text labels, square them up. */
    .bar .label {
      display: none;
    }
    /* …except the 재료 button, which keeps showing the selected material name
       (the bar scrolls sideways, so a wider button is fine). */
    .bar .material-btn .material-name {
      display: inline;
    }
    /* …and the armed 지우기 button, so the "계속하시겠습니까?" confirm prompt is
       visible on mobile too (the bar scrolls to fit the wider button). */
    .bar .ctl.armed .label {
      display: inline;
    }
    .bar .ctl {
      padding: 8px 10px;
    }
    .bar .ctl i {
      font-size: 17px;
    }

    .sheet-toggle {
      display: inline-flex;
      flex: none;
      margin-left: auto;
    }

    /* Sheet becomes a pop-up anchored to the top edge of the bar. It's
       position:absolute (not fixed) so the panel's backdrop-filter containing
       block keeps it pinned to the bar rather than the viewport. */
    .sheet {
      position: absolute;
      left: 8px;
      right: 8px;
      bottom: calc(100% + 8px);
      max-height: 60vh;
      padding: 12px;
      background: rgba(20, 20, 26, 0.97);
      backdrop-filter: blur(8px);
      border: 1px solid #2a2a33;
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
      overflow-y: auto;
      overscroll-behavior: contain;
      display: none;
    }
    .sheet.open {
      display: flex;
    }
    .sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
    }
    /* On the roomy sheet, restore icon+label buttons for clarity. */
    .sheet .label {
      display: inline;
    }
    .wheel-hint {
      display: none;
    }
  }
</style>
