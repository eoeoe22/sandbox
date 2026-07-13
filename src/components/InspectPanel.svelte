<script lang="ts">
  import { $inspect as inspect, $inspectData as inspectData } from '../state/store';
  import { toCss } from '../game/render/color';

  // The 돋보기 readout. Floats over the top of the sandbox (not tucked in the
  // settings sheet) so the survey is visible the moment inspect is on, on both
  // desktop and mobile. It's a pure readout — pointer-events:none — so it never
  // eats a brush stroke, even if the pointer wanders under it. PointerPainter
  // keeps $inspectData live; it goes null when the pointer leaves the canvas.
  const data = $derived($inspectData);
  const occupied = $derived(data?.occupied ?? 0);

  // Composition ratio is per-material over the *occupied* cells (empty air is
  // "nothing there", not a material), matching how the breakdown reads.
  function pct(count: number): number {
    return occupied > 0 ? Math.round((count / occupied) * 100) : 0;
  }

  // Fill ratio uses the whole footprint so "how full is the brush" stays honest.
  const fillPct = $derived(
    data && data.footprint > 0 ? Math.round((occupied / data.footprint) * 100) : 0,
  );

  // Keep the list short — the brush usually holds a handful of materials, but a
  // big brush over a busy scene could hold many. Show the top few and roll the
  // rest into a "+N종" tail so the card stays compact ("간략히").
  const MAX_ROWS = 6;
  const rows = $derived((data?.entries ?? []).slice(0, MAX_ROWS));
  const hiddenKinds = $derived(Math.max(0, (data?.entries.length ?? 0) - MAX_ROWS));
</script>

{#if $inspect && data}
  <div class="inspect" role="status" aria-live="polite">
    <div class="ins-head">
      <i class="bi bi-search" aria-hidden="true"></i>
      <span>브러시 정보</span>
    </div>

    {#if occupied === 0}
      <p class="empty">빈 공간 · {data.footprint}칸</p>
    {:else}
      <div class="summary">
        <span title="브러시 영역에서 입자가 찬 칸 / 전체 칸">
          입자 {occupied.toLocaleString()} / {data.footprint}칸 · {fillPct}%
        </span>
        {#if data.avgTemp !== null}
          <span title="입자가 있는 칸의 평균 온도 (벽 제외)">
            평균 {Math.round(data.avgTemp).toLocaleString()}°C
          </span>
        {/if}
      </div>

      <ul class="breakdown">
        {#each rows as e (e.id)}
          <li>
            <span class="swatch" style={`background:${toCss(e.color)}`}></span>
            <span class="name">{e.name}</span>
            <span class="count">{e.count.toLocaleString()}</span>
            <span class="ratio">{pct(e.count)}%</span>
          </li>
        {/each}
      </ul>
      {#if hiddenKinds > 0}
        <p class="more">그 외 {hiddenKinds}종</p>
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* Floating card pinned to the top of the play area (beside the sidebar on
     desktop, full-width top on mobile). pointer-events:none so it's a pure
     readout that never blocks painting. */
  .inspect {
    position: fixed;
    z-index: 8;
    top: 8px;
    left: calc(var(--sidebar-w) + 8px);
    width: 208px;
    max-width: calc(100vw - var(--sidebar-w) - 16px);
    padding: 8px 10px;
    background: rgba(20, 20, 26, 0.92);
    backdrop-filter: blur(8px);
    border: 1px solid #3a3320;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    color: #e8e8ee;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 12px;
    user-select: none;
    pointer-events: none;
  }

  .ins-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-weight: 600;
    color: #f0c85a;
  }
  .ins-head i {
    font-size: 14px;
  }

  .empty {
    margin: 0;
    color: #8a8a99;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-bottom: 6px;
    color: #cfcfd8;
    font-variant-numeric: tabular-nums;
  }

  .breakdown {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .breakdown li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-variant-numeric: tabular-nums;
  }
  .swatch {
    flex: none;
    width: 11px;
    height: 11px;
    border-radius: 3px;
    border: 1px solid rgba(0, 0, 0, 0.5);
  }
  .name {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e8e8ee;
  }
  .count {
    flex: none;
    color: #cfcfd8;
  }
  .ratio {
    flex: none;
    min-width: 34px;
    text-align: right;
    color: #8a8a99;
  }

  .more {
    margin: 4px 0 0;
    color: #8a8a99;
  }

  /* Mobile: the sidebar collapses to a bottom bar, so anchor the card to the
     top-left of the full-width canvas instead of beside a sidebar. */
  @media (max-width: 768px) {
    .inspect {
      left: 8px;
      max-width: calc(100vw - 16px);
    }
  }
</style>
