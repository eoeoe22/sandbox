<script lang="ts">
  import {
    $running as running,
    $simSpeed as simSpeed,
    $brushSize as brushSize,
    $brushShape as brushShape,
    $brushMode as brushMode,
    $overwriteLevel as overwriteLevel,
    $tool as tool,
    $fps as fps,
    $fpsPeak as fpsPeak,
    $aspectMode as aspectMode,
    $gridDims as gridDims,
    $borderMode as borderMode,
    requestClear,
    requestStep,
    requestResetAspect,
  } from '../state/store';
  import {
    BRUSH_MIN,
    BRUSH_MAX,
    OVERWRITE_LEVELS,
    OVERWRITE_LEVEL_MIN,
    OVERWRITE_LEVEL_MAX,
  } from '../game/config';
  import MaterialPalette from './MaterialPalette.svelte';

  // Collapsed state is local UI — the engine doesn't care about it.
  let collapsed = $state(false);
</script>

{#if collapsed}
  <button
    class="toggle floating"
    onclick={() => (collapsed = false)}
    aria-label="설정 펼치기"
    aria-expanded="false"
    title="설정 펼치기"
  >
    <i class="bi bi-layout-sidebar-inset"></i>
  </button>
{:else}
  <aside class="panel">
    <div class="head">
      <h1>Particle Sandbox</h1>
      <button
        class="toggle"
        onclick={() => (collapsed = true)}
        aria-label="설정 접기"
        aria-expanded="true"
        title="설정 접기"
      >
        <i class="bi bi-layout-sidebar-inset"></i>
      </button>
    </div>

    <div class="row">
      <button onclick={() => running.set(!$running)}>
        {$running ? '⏸ 일시정지' : '▶ 재생'}
      </button>
      <button onclick={requestStep} disabled={$running}>⏭ 스텝</button>
      <button onclick={requestClear}>🗑 지우기</button>
    </div>

    <div class="brush">
      <span>속도: {$simSpeed === 2 ? '×2 (원래 속도)' : '×1 (기본)'}</span>
      <div class="row shape speed" role="group" aria-label="시뮬레이션 속도">
        <button
          class:active={$simSpeed === 1}
          onclick={() => simSpeed.set(1)}
          aria-pressed={$simSpeed === 1}
          title="기본 속도 (원래 속도의 절반)"
        >
          ×1
        </button>
        <button
          class:active={$simSpeed === 2}
          onclick={() => simSpeed.set(2)}
          aria-pressed={$simSpeed === 2}
          title="2배 속도 (원래 속도)"
        >
          ×2
        </button>
      </div>
    </div>

    <label class="brush">
      <span>브러시 크기: {$brushSize} (휠로 조절)</span>
      <input
        type="range"
        min={BRUSH_MIN}
        max={BRUSH_MAX}
        value={$brushSize}
        oninput={(e) => brushSize.set(+e.currentTarget.value)}
      />
    </label>

    <div class="row shape" role="group" aria-label="브러시 모양">
      <button
        class:active={$brushShape === 'circle'}
        onclick={() => brushShape.set('circle')}
        aria-pressed={$brushShape === 'circle'}
        title="원형 브러시"
      >
        ● 원형
      </button>
      <button
        class:active={$brushShape === 'square'}
        onclick={() => brushShape.set('square')}
        aria-pressed={$brushShape === 'square'}
        title="사각형 브러시"
      >
        ■ 사각형
      </button>
    </div>

    <div class="row shape" role="group" aria-label="브러시 채우기 방식">
      <button
        class:active={$brushMode === 'full'}
        onclick={() => brushMode.set('full')}
        aria-pressed={$brushMode === 'full'}
        title="브러시 영역을 빈틈없이 채웁니다"
      >
        ▣ Full
      </button>
      <button
        class:active={$brushMode === 'particle'}
        onclick={() => brushMode.set('particle')}
        aria-pressed={$brushMode === 'particle'}
        title="브러시 영역에 무작위로 빈틈을 남깁니다 (고체는 항상 Full)"
      >
        ▦ Particle
      </button>
    </div>

    <div class="row shape tools" role="group" aria-label="특수 브러시">
      <button
        class:active={$tool === 'material'}
        onclick={() => tool.set('material')}
        aria-pressed={$tool === 'material'}
        title="선택한 재료를 그립니다"
      >
        🖌 재료
      </button>
      <button
        class:active={$tool === 'heat'}
        onclick={() => tool.set('heat')}
        aria-pressed={$tool === 'heat'}
        title="브러시 영역의 온도를 올립니다 (빈칸 제외)"
      >
        🔥 가열
      </button>
      <button
        class:active={$tool === 'cool'}
        onclick={() => tool.set('cool')}
        aria-pressed={$tool === 'cool'}
        title="브러시 영역의 온도를 내립니다 (빈칸 제외)"
      >
        ❄️ 냉각
      </button>
      <button
        class:active={$tool === 'mix'}
        onclick={() => tool.set('mix')}
        aria-pressed={$tool === 'mix'}
        title="브러시 영역의 파티클을 섞습니다 (고체 제외)"
      >
        🌀 섞기
      </button>
    </div>

    <label class="brush">
      <span>덮어쓰기: {OVERWRITE_LEVELS[$overwriteLevel]}</span>
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

    <MaterialPalette />

    <div class="row shape border" role="group" aria-label="테두리 모드">
      <button
        class:active={$borderMode === 'wall'}
        onclick={() => borderMode.set('wall')}
        aria-pressed={$borderMode === 'wall'}
        title="테두리가 단단한 벽 — 파티클이 밖으로 나가지 못합니다"
      >
        🧱 벽
      </button>
      <button
        class:active={$borderMode === 'void'}
        onclick={() => borderMode.set('void')}
        aria-pressed={$borderMode === 'void'}
        title="테두리가 공허 — 가장자리에 닿은 파티클은 밖으로 떨어져 사라집니다"
      >
        🕳 공허
      </button>
    </div>

    <div class="aspect">
      <span class="dims">격자 {$gridDims.w}×{$gridDims.h}</span>
      <button
        class="reset"
        onclick={requestResetAspect}
        disabled={$aspectMode === 'device'}
        title="샌드박스를 기기 화면비에 맞춤"
      >
        기기에 맞춤
      </button>
    </div>

    <div
      class="fps"
      title="적응형 주사율(ProMotion/Adaptive Sync) 기기는 유휴 시 절전을 위해 주사율을 낮춥니다. '최대'는 이 세션에서 관측된 최고값입니다."
    >
      {$fps} FPS {#if $fpsPeak > $fps + 5}· 최대 {$fpsPeak}{/if}
    </div>
    <p class="hint">
      캔버스를 드래그해 물질을 그리세요. 우하단 핸들을 드래그하면 샌드박스 크기·화면비를 조절할 수 있어요.
    </p>
  </aside>
{/if}

<style>
  .panel {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 10;
    width: 180px;
    max-height: calc(100vh - 24px);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: rgba(20, 20, 26, 0.82);
    backdrop-filter: blur(6px);
    border: 1px solid #2a2a33;
    border-radius: 10px;
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
    position: sticky;
    top: -12px;
    margin: -12px -12px 0;
    padding: 12px 12px 8px;
    background: rgba(20, 20, 26, 0.92);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    z-index: 1;
  }
  h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .toggle:hover {
    border-color: #3a3a46;
  }
  /* Collapsed: the toggle floats alone in the corner where the panel was. */
  .toggle.floating {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 10;
    width: 38px;
    height: 38px;
    font-size: 18px;
    background: rgba(20, 20, 26, 0.82);
    backdrop-filter: blur(6px);
    border-radius: 10px;
    user-select: none;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .row button {
    flex: 1 1 auto;
    padding: 6px 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  }
  .row button:hover {
    border-color: #3a3a46;
  }
  .row button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .row.shape button.active {
    border-color: #6ea8fe;
    background: #23324a;
  }
  /* Set the special-brush row a touch apart from the painting controls above. */
  .row.tools {
    padding-top: 8px;
    border-top: 1px solid #2a2a33;
  }
  /* Separate the sandbox-edge toggle from the palette above it. */
  .row.border {
    padding-top: 8px;
    border-top: 1px solid #2a2a33;
  }
  .brush {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .brush input {
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
  .aspect {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .dims {
    font-variant-numeric: tabular-nums;
    color: #8a8a99;
  }
  .reset {
    padding: 4px 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  }
  .reset:hover {
    border-color: #3a3a46;
  }
  .reset:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .fps {
    font-variant-numeric: tabular-nums;
    color: #8a8a99;
    cursor: help;
  }
  .hint {
    margin: 0;
    color: #6a6a78;
    font-size: 11px;
    line-height: 1.4;
  }
</style>
