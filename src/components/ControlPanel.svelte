<script lang="ts">
  import {
    $running as running,
    $brushSize as brushSize,
    $fps as fps,
    requestClear,
    requestStep,
  } from '../state/store';
  import MaterialPalette from './MaterialPalette.svelte';
</script>

<aside class="panel">
  <h1>Particle Sandbox</h1>

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
  h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
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
