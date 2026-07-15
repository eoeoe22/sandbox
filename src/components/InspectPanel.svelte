<script lang="ts">
  import { $inspect as inspect, $inspectData as inspectData, $tool as tool } from '../state/store';
  import { toCss } from '../game/render/color';

  // The 돋보기 readout. Floats over the top of the sandbox (not tucked in the
  // settings sheet) so the survey is visible the moment inspect is on, on both
  // desktop and mobile. It's a pure readout — pointer-events:none — so it never
  // eats a brush stroke, even if the pointer wanders under it. PointerPainter
  // keeps $inspectData live; it goes null when the pointer leaves the canvas.
  const data = $derived($inspectData);
  const occupied = $derived(data?.occupied ?? 0);
  const overlapped = $derived(data?.overlapped ?? 0);

  // Composition ratio is per-material over every material *occurrence* — a cell
  // of wet sand holds two (the sand host + the water soaked into it, 겹침), so
  // the denominator is occupied + overlapped and the ratios still sum to 100%.
  const totalInstances = $derived(occupied + overlapped);
  function pct(count: number): number {
    return totalInstances > 0 ? Math.round((count / totalInstances) * 100) : 0;
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

  // 영역(rect) 도구는 커서 위치가 아니라 드래그로 지정한 사각 선택 영역을 그리므로,
  // 돋보기도 같은 영역을 관찰한다(PointerPainter.inspectFootprint). 아직 선택이
  // 없으면 data가 null이라 안내 문구를 대신 보여준다.
  const isRectTool = $derived($tool === 'rect');
</script>

{#if $inspect && isRectTool && !data}
  <div class="inspect" role="status" aria-live="polite">
    <div class="ins-head">
      <i class="bi bi-bounding-box" aria-hidden="true"></i>
      <span>영역 정보</span>
    </div>
    <p class="empty">드래그해 영역을 선택하면 정보가 표시됩니다</p>
  </div>
{:else if $inspect && data}
  <div class="inspect" role="status" aria-live="polite">
    <div class="ins-head">
      <i class={`bi ${isRectTool ? 'bi-bounding-box' : 'bi-search'}`} aria-hidden="true"></i>
      <span>{isRectTool ? '영역 정보' : '브러시 정보'}</span>
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
        {#if overlapped > 0}
          <span class="wet" title="액체가 스며든(겹친) 칸 수 — 예: 젖은 모래">
            <i class="bi bi-droplet-half" aria-hidden="true"></i>
            겹침 {overlapped.toLocaleString()}칸
          </span>
        {/if}
      </div>

      <ul class="breakdown">
        {#each rows as e (e.id)}
          <li>
            <span class="swatch" style={`background:${toCss(e.color)}`}></span>
            <span class="name">{e.name}</span>
            {#if e.avgTemp !== null}
              <span class="temp" title={`${e.name} 평균 온도`}>
                {Math.round(e.avgTemp).toLocaleString()}°C
              </span>
            {:else}
              <span class="temp none" title="온도 없음 (벽 등)">—</span>
            {/if}
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
    width: 240px;
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
  /* 겹침(젖음) count — tinted like a liquid so it reads apart from the dry tallies. */
  .wet {
    color: #6ea8fe;
  }
  .wet i {
    font-size: 11px;
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
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e8e8ee;
  }
  /* Per-material average temperature — tinted amber like the summary temperature
     so it reads as a heat value, not a count. */
  .temp {
    flex: none;
    min-width: 46px;
    text-align: right;
    color: #f0c85a;
  }
  .temp.none {
    color: #6a6a78;
  }
  .count {
    flex: none;
    min-width: 32px;
    text-align: right;
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
