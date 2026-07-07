<script lang="ts">
  import {
    $running as running,
    $brushSize as brushSize,
    $fps as fps,
    requestClear,
    requestStep,
  } from '../state/store';
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

    <label class="brush">
      <span>브러시 크기: {$brushSize}</span>
      <input
        type="range"
        min="0"
        max="12"
        value={$brushSize}
        oninput={(e) => brushSize.set(+e.currentTarget.value)}
      />
    </label>

    <MaterialPalette />

    <div class="fps">{$fps} FPS</div>
    <p class="hint">캔버스를 드래그해 물질을 그리세요.</p>
  </aside>
{/if}

<style>
  .panel {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 10;
    width: 180px;
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
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
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
  .brush {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .brush input {
    width: 100%;
  }
  .fps {
    font-variant-numeric: tabular-nums;
    color: #8a8a99;
  }
  .hint {
    margin: 0;
    color: #6a6a78;
    font-size: 11px;
    line-height: 1.4;
  }
</style>
