<script lang="ts">
  // Editor for the 혼합 (blend) brush: pick up to BLEND_MAX_SLOTS materials and
  // set each one's share with a draggable ratio bar. The bar's segments are the
  // materials (colored by their own color), and dragging a boundary between two
  // segments shifts weight from one to the other — snapped to BLEND_RATIO_STEP%,
  // every segment kept at ≥ one step. The result is written to `$blendBrush`,
  // which PointerPainter reads to paint a per-cell weighted mixture.
  import { $blendBrush as blendBrush, type BlendComponent } from '../state/store';
  import { MATERIALS } from '../game/materials';
  import { toCss } from '../game/render/color';
  import { BLEND_MAX_SLOTS, BLEND_RATIO_STEP } from '../game/config';
  import MaterialPicker from './MaterialPicker.svelte';

  // Real materials only — the blend paints matter, never the eraser (id 0),
  // which isn't in MATERIALS anyway; the guard keeps this robust if that changes.
  const OPTIONS = MATERIALS.filter((m) => m.id !== 0);
  const matOf = (id: number) => MATERIALS.find((m) => m.id === id);
  const nameOf = (id: number) => matOf(id)?.name ?? '?';
  const colorOf = (id: number) => {
    const m = matOf(id);
    return m ? toCss(m.color) : '#888';
  };

  const comps = $derived($blendBrush);
  // Cumulative left-edge % of each segment, so dividers can be placed absolutely.
  const cum = $derived(
    comps.reduce<number[]>((acc, c, i) => {
      acc.push((i === 0 ? 0 : acc[i - 1]) + (i === 0 ? 0 : comps[i - 1].ratio));
      return acc;
    }, []),
  );

  const snap = (v: number) => Math.round(v / BLEND_RATIO_STEP) * BLEND_RATIO_STEP;

  const commit = (next: BlendComponent[]) => blendBrush.set(next);

  /**
   * Distribute `weights` into ratios that are whole multiples of BLEND_RATIO_STEP,
   * sum to exactly 100, and give every component at least one step. Used when the
   * number of components changes (add/remove); dragging a divider edits ratios
   * directly instead, so it never rounds the untouched segments.
   */
  function normalize(weights: number[]): number[] {
    const n = weights.length;
    const step = BLEND_RATIO_STEP;
    const totalUnits = 100 / step;
    const alloc = new Array<number>(n).fill(1); // one step each, guaranteed
    let remaining = totalUnits - n;
    if (remaining < 0) remaining = 0;
    const wsum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
    const ideal = weights.map((w) => ((w > 0 ? w : 0) / wsum) * remaining);
    const floor = ideal.map((v) => Math.floor(v));
    for (let k = 0; k < n; k++) alloc[k] += floor[k];
    const left = remaining - floor.reduce((a, b) => a + b, 0);
    const order = ideal
      .map((v, i) => ({ i, frac: v - floor[i] }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < left; k++) alloc[order[k % n].i]++;
    return alloc.map((u) => u * step);
  }

  function setId(index: number, id: number): void {
    commit(comps.map((c, k) => (k === index ? { ...c, id } : c)));
  }

  function addComp(): void {
    if (comps.length >= BLEND_MAX_SLOTS) return;
    const used = new Set(comps.map((c) => c.id));
    const pick = OPTIONS.find((m) => !used.has(m.id)) ?? OPTIONS[0];
    const ratios = normalize([...comps.map((c) => c.ratio), 100 / (comps.length + 1)]);
    const next = [
      ...comps.map((c, k) => ({ id: c.id, ratio: ratios[k] })),
      { id: pick.id, ratio: ratios[ratios.length - 1] },
    ];
    commit(next);
  }

  function removeComp(index: number): void {
    if (comps.length <= 2) return; // a blend needs at least two materials
    const kept = comps.filter((_, k) => k !== index);
    const ratios = normalize(kept.map((c) => c.ratio));
    commit(kept.map((c, k) => ({ id: c.id, ratio: ratios[k] })));
  }

  // --- Divider dragging -----------------------------------------------------
  let barEl: HTMLDivElement | undefined;
  let dragIndex = $state<number | null>(null);

  function applyDivider(i: number, pointerPct: number): void {
    let cumBefore = 0;
    for (let k = 0; k < i; k++) cumBefore += comps[k].ratio;
    const pairSum = comps[i].ratio + comps[i + 1].ratio;
    const lo = cumBefore + BLEND_RATIO_STEP;
    const hi = cumBefore + pairSum - BLEND_RATIO_STEP;
    let newCum = snap(pointerPct);
    if (newCum < lo) newCum = lo;
    else if (newCum > hi) newCum = hi;
    const ri = newCum - cumBefore;
    commit(
      comps.map((c, k) =>
        k === i ? { ...c, ratio: ri } : k === i + 1 ? { ...c, ratio: pairSum - ri } : c,
      ),
    );
  }

  function onDividerDown(e: PointerEvent, i: number): void {
    e.preventDefault();
    dragIndex = i;
  }
  function onWindowMove(e: PointerEvent): void {
    if (dragIndex === null || !barEl) return;
    const rect = barEl.getBoundingClientRect();
    if (rect.width === 0) return;
    applyDivider(dragIndex, ((e.clientX - rect.left) / rect.width) * 100);
  }
  function onWindowUp(): void {
    dragIndex = null;
  }
</script>

<svelte:window onpointermove={onWindowMove} onpointerup={onWindowUp} />

<div class="blend">
  <div class="bar" bind:this={barEl} class:dragging={dragIndex !== null}>
    {#each comps as c, i (i)}
      <div class="seg" style={`width:${c.ratio}%; background:${colorOf(c.id)}`}>
        <span class="pct">{c.ratio}%</span>
      </div>
    {/each}
    {#each comps.slice(0, -1) as _c, i (i)}
      <button
        class="divider"
        style={`left:${cum[i + 1]}%`}
        onpointerdown={(e) => onDividerDown(e, i)}
        aria-label={`${nameOf(comps[i].id)}와 ${nameOf(comps[i + 1].id)} 비율 조절`}
        title="드래그해 비율 조절"
      ></button>
    {/each}
  </div>

  <div class="slots">
    {#each comps as c, i (i)}
      <div class="slot">
        <MaterialPicker
          value={c.id}
          options={OPTIONS}
          onpick={(id) => setId(i, id)}
          ariaLabel={`${i + 1}번 물질`}
        />
        <span class="slot-pct">{c.ratio}%</span>
        <button
          class="mini"
          onclick={() => removeComp(i)}
          disabled={comps.length <= 2}
          aria-label="이 물질 제거"
          title="제거"
        >
          <i class="bi bi-dash-lg" aria-hidden="true"></i>
        </button>
      </div>
    {/each}
    {#if comps.length < BLEND_MAX_SLOTS}
      <button class="add" onclick={addComp} title="물질 추가">
        <i class="bi bi-plus-lg" aria-hidden="true"></i>
        <span>물질 추가</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .blend {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* The ratio bar: colored segments with draggable boundaries between them. */
  .bar {
    position: relative;
    display: flex;
    height: 30px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .bar.dragging {
    cursor: ew-resize;
  }
  .seg {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
  }
  .pct {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: #101014;
    background: rgba(255, 255, 255, 0.72);
    padding: 0 4px;
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none;
  }
  .divider {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 14px;
    transform: translateX(-50%);
    padding: 0;
    border: none;
    background: transparent;
    cursor: ew-resize;
    touch-action: none;
  }
  /* A visible grip line down the middle of the (wider) hit area. */
  .divider::before {
    content: '';
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 50%;
    width: 3px;
    transform: translateX(-50%);
    background: #e8e8ee;
    border: 1px solid rgba(0, 0, 0, 0.55);
    border-radius: 2px;
  }

  .slots {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .slot {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .slot-pct {
    flex: none;
    width: 40px;
    text-align: right;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: #cfcfd8;
  }
  .mini {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font-size: 13px;
  }
  .mini:hover {
    border-color: #3a3a46;
  }
  .mini:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 5px 8px;
    border: 1px dashed #3a3a46;
    border-radius: 6px;
    background: transparent;
    color: #cfcfd8;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .add:hover {
    border-color: #6ea8fe;
    color: #e8e8ee;
  }
</style>
