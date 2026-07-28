<script lang="ts">
  // Load options for one snapshot, shown before anything touches the canvas.
  //
  // The reason this exists: a shared snapshot is almost never the size of the
  // sandbox it lands in, and there's no single right answer for what to do about
  // it. Rather than guess, this shows a preview of the actual result and lets the
  // user pick — scale it to fit, drop it in at original size, or dial the scale
  // and position by hand. The preview runs the same resample/clip code the apply
  // does (state/snapshotFit), so it isn't an approximation of the result; it is
  // the result.
  import {
    resampleScene,
    placeScene,
    autoPlacement,
    centered,
    clampPlacement,
    sceneClip,
    SCALE_MIN,
    SCALE_MAX,
    type SnapshotPlacement,
  } from '../state/snapshotFit';
  import type { PersistedWorld } from '../state/persistence';
  import { $snapshotFit as snapshotFit } from '../state/store';
  import { SNAPSHOT_FITS, type SnapshotFit } from '../game/config';
  import { getMaterial } from '../game/materials';
  import { EMPTY } from '../game/engine/types';
  import { t } from '../i18n';
  import { untrack } from 'svelte';

  interface Props {
    /** The snapshot's world, already deserialized. */
    world: PersistedWorld;
    /** Snapshot name, shown in the header. */
    name: string;
    /** Live sandbox size, in cells — what the snapshot has to land in. */
    dstW: number;
    dstH: number;
    /** Called with the finished world (exactly dstW × dstH) when the user
     *  confirms. */
    onconfirm: (placed: PersistedWorld) => void;
    oncancel: () => void;
  }

  let { world, name, dstW, dstH, onconfirm, oncancel }: Props = $props();

  let mode = $state<SnapshotFit>($snapshotFit);
  // Seeded once from the remembered mode. `untrack` because this is deliberately
  // an initial value, not a binding: the component is mounted fresh each time the
  // modal opens, and once open the placement belongs to the user.
  let placement = $state<SnapshotPlacement>(
    untrack(() => autoPlacement(world.w, world.h, dstW, dstH, $snapshotFit)),
  );
  // Whether the two scale sliders move together. On by default — a distorted
  // scene is something you should have to ask for.
  let linked = $state(true);

  let canvasEl = $state<HTMLCanvasElement | null>(null);

  // id → packed 0xAABBGGRR color, including Empty (whose color is the board
  // background), so one lookup covers every cell the preview draws.
  const palette = (() => {
    const p = new Uint32Array(256);
    for (let id = 0; id < 256; id++) p[id] = getMaterial(id)?.color ?? 0xff000000;
    return p;
  })();

  // The resampled scene is only invalidated by a scale change, not by a pan, so
  // dragging the preview re-blits a cached buffer instead of re-voting every
  // cell — the difference between a smooth drag and a stuttering one on a large
  // world.
  let cache: { src: PersistedWorld; cw: number; ch: number; scene: PersistedWorld } | null = null;
  function scene(cw: number, ch: number): PersistedWorld {
    if (!cache || cache.src !== world || cache.cw !== cw || cache.ch !== ch) {
      cache = { src: world, cw, ch, scene: resampleScene(world, cw, ch) };
    }
    return cache.scene;
  }

  const scaleX = $derived(placement.cw / world.w);
  const scaleY = $derived(placement.ch / world.h);
  // Slider bounds in log2 space, so each notch is a constant ratio rather than a
  // constant number of cells. Stretched down when the automatic fit is itself
  // below the normal floor (a huge scene onto a small phone), so the slider can
  // always represent the placement it opens with.
  const tMin = $derived(Math.min(Math.log2(SCALE_MIN), Math.log2(Math.min(scaleX, scaleY))));
  const tMax = Math.log2(SCALE_MAX);

  /** Redraw the preview. Coalesced to one paint per frame — a drag emits pointer
   *  moves faster than the display refreshes. */
  let frame = 0;
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function draw(): void {
    const canvas = canvasEl;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = clampPlacement(placement, world.w, world.h, dstW, dstH);
    const sc = scene(p.cw, p.ch);

    const img = ctx.createImageData(dstW, dstH);
    const buf = new Uint32Array(img.data.buffer);
    // Everything the scene doesn't reach reads as empty board — which is exactly
    // what the apply leaves there.
    buf.fill(palette[EMPTY]);

    // Same clip the apply uses, so what's cut here is what's cut there.
    const { sx0, sy0, sx1, sy1 } = sceneClip(sc.w, sc.h, dstW, dstH, p.offX, p.offY);
    for (let sy = sy0; sy < sy1; sy++) {
      const srcRow = sy * sc.w;
      const dstRow = (sy + p.offY) * dstW + p.offX;
      for (let sx = sx0; sx < sx1; sx++) buf[dstRow + sx] = palette[sc.cells[srcRow + sx]];
    }
    ctx.putImageData(img, 0, 0);
  }

  // The live grid can change size under the modal — a window resize moves it —
  // and the canvas element's width/height attributes follow, which blanks the
  // bitmap. Re-derive the placement for the destination that now exists rather
  // than keeping offsets that referred to one that doesn't: `manual` keeps the
  // scale the user dialled in and gets re-anchored, the other two are re-derived
  // from their definition.
  let lastDst = untrack(() => ({ w: dstW, h: dstH }));
  $effect(() => {
    const w = dstW;
    const h = dstH;
    if (w === lastDst.w && h === lastDst.h) return;
    lastDst = { w, h };
    untrack(() => {
      placement =
        mode === 'manual'
          ? centered(placement.cw, placement.ch, w, h, world.w, world.h)
          : autoPlacement(world.w, world.h, w, h, mode);
    });
  });

  // Repaint whenever the placement, the destination size, or the canvas element
  // changes — `draw()` reads all three, but it runs inside a rAF callback, so
  // they have to be touched here to be tracked.
  $effect(() => {
    void placement;
    void dstW;
    void dstH;
    void canvasEl;
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
  });

  function pickMode(next: SnapshotFit): void {
    mode = next;
    snapshotFit.set(next);
    // `manual` keeps whatever is on screen — that's the point of it. The other
    // two are definitions, so switching to one re-derives its placement.
    if (next !== 'manual') {
      placement = autoPlacement(world.w, world.h, dstW, dstH, next);
    }
  }

  /** Any hands-on adjustment implies manual — otherwise the mode chip would
   *  claim "자동맞춤" while showing something the user moved themselves. */
  function goManual(): void {
    if (mode === 'manual') return;
    mode = 'manual';
    snapshotFit.set('manual');
  }

  function setScale(axis: 'x' | 'y', t: number): void {
    goManual();
    const s = Math.pow(2, t);
    const cw = axis === 'x' || linked ? Math.max(1, Math.round(world.w * s)) : placement.cw;
    const ch = axis === 'y' || linked ? Math.max(1, Math.round(world.h * s)) : placement.ch;
    // Keep the scene's centre where it was, so scaling zooms around the middle
    // instead of dragging the picture off toward the origin.
    const cx = placement.offX + placement.cw / 2;
    const cy = placement.offY + placement.ch / 2;
    placement = clampPlacement(
      { cw, ch, offX: Math.round(cx - cw / 2), offY: Math.round(cy - ch / 2) },
      world.w,
      world.h,
      dstW,
      dstH,
    );
  }

  /** Manual presets: the three placements worth one click. */
  function preset(kind: 'auto' | 'one' | 'fill'): void {
    goManual();
    placement =
      kind === 'fill'
        ? centered(dstW, dstH, dstW, dstH, world.w, world.h)
        : autoPlacement(world.w, world.h, dstW, dstH, kind === 'one' ? 'simple' : 'auto');
  }

  // --- Dragging the preview to reposition ---
  let dragFrom = $state<{ x: number; y: number; offX: number; offY: number } | null>(null);

  function onPointerDown(e: PointerEvent): void {
    goManual();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragFrom = { x: e.clientX, y: e.clientY, offX: placement.offX, offY: placement.offY };
  }

  function onPointerMove(e: PointerEvent): void {
    const canvas = canvasEl;
    if (!dragFrom || !canvas) return;
    // Pointer travel is in CSS px; the placement is in destination cells.
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    placement = {
      ...placement,
      offX: Math.round(dragFrom.offX + ((e.clientX - dragFrom.x) * dstW) / rect.width),
      offY: Math.round(dragFrom.offY + ((e.clientY - dragFrom.y) * dstH) / rect.height),
    };
  }

  function onPointerUp(e: PointerEvent): void {
    dragFrom = null;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  /** Nudge by a few cells from the keyboard, so repositioning isn't drag-only. */
  function onCanvasKeydown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 10 : 1;
    const d =
      e.key === 'ArrowLeft'
        ? [-step, 0]
        : e.key === 'ArrowRight'
          ? [step, 0]
          : e.key === 'ArrowUp'
            ? [0, -step]
            : e.key === 'ArrowDown'
              ? [0, step]
              : null;
    if (!d) return;
    e.preventDefault();
    goManual();
    placement = { ...placement, offX: placement.offX + d[0], offY: placement.offY + d[1] };
  }

  function confirm(): void {
    const p = clampPlacement(placement, world.w, world.h, dstW, dstH);
    onconfirm(placeScene(scene(p.cw, p.ch), dstW, dstH, p.offX, p.offY));
  }

  function fmtScale(s: number): string {
    return `${s < 0.1 ? s.toFixed(3) : s.toFixed(2)}×`;
  }
</script>

<div class="load">
  <p class="head">
    <span class="snap-name" title={name}>{name}</span>
    <span class="dims">{world.w}×{world.h} → {dstW}×{dstH}</span>
  </p>

  <!-- The preview is the primary control: it's draggable, focusable, and
       arrow-key nudgeable, so repositioning never depends on a pointer. -->
  <button
    type="button"
    class="preview-wrap"
    class:grabbing={dragFrom !== null}
    aria-label={t('load.previewAria')}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onkeydown={onCanvasKeydown}
  >
    <canvas
      bind:this={canvasEl}
      class="preview"
      width={dstW}
      height={dstH}
      style="aspect-ratio: {dstW} / {dstH}"
      aria-hidden="true"
    ></canvas>
  </button>

  <div class="modes" role="radiogroup" aria-label={t('load.modeGroup')}>
    {#each SNAPSHOT_FITS as m (m)}
      <button
        class="mode"
        role="radio"
        aria-checked={mode === m}
        class:active={mode === m}
        onclick={() => pickMode(m)}
        title={t(`load.mode.${m}Tooltip`)}
      >
        {t(`load.mode.${m}`)}
      </button>
    {/each}
  </div>
  <p class="mode-desc">{t(`load.mode.${mode}Tooltip`)}</p>

  {#if mode === 'manual'}
    <div class="manual">
      <label class="row">
        <span class="cap">{linked ? t('load.scale') : t('load.scaleX')}</span>
        <input
          type="range"
          min={tMin}
          max={tMax}
          step="0.01"
          value={Math.log2(scaleX)}
          oninput={(e) => setScale('x', Number(e.currentTarget.value))}
        />
        <span class="val">{fmtScale(scaleX)}</span>
      </label>
      {#if !linked}
        <label class="row">
          <span class="cap">{t('load.scaleY')}</span>
          <input
            type="range"
            min={tMin}
            max={tMax}
            step="0.01"
            value={Math.log2(scaleY)}
            oninput={(e) => setScale('y', Number(e.currentTarget.value))}
          />
          <span class="val">{fmtScale(scaleY)}</span>
        </label>
      {/if}
      <label class="check">
        <input type="checkbox" checked={linked} onchange={(e) => (linked = e.currentTarget.checked)} />
        <span>{t('load.linkAxes')}</span>
      </label>
      <div class="presets">
        <button class="ctl tiny" onclick={() => preset('auto')}>{t('load.presetAuto')}</button>
        <button class="ctl tiny" onclick={() => preset('one')}>{t('load.presetOriginal')}</button>
        <button class="ctl tiny" onclick={() => preset('fill')}>{t('load.presetFill')}</button>
      </div>
      <p class="hint">{t('load.manualHint')}</p>
    </div>
  {/if}

  <div class="actions">
    <button class="ctl" onclick={oncancel}>{t('load.cancel')}</button>
    <button class="ctl primary" onclick={confirm}>
      <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i>
      <span>{t('load.confirm')}</span>
    </button>
  </div>
</div>

<style>
  .load {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: min(420px, 74vw);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin: 0;
    min-width: 0;
  }
  .snap-name {
    color: #e8e8ee;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dims {
    flex: none;
    color: #7a7a88;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  /* A <button> rather than a div: this surface is genuinely a control (drag or
     arrow-key it to move the scene), and a real button gets focus, keyboard
     reachability and an accessible name for free. The canvas inside is purely
     the picture. */
  .preview-wrap {
    display: flex;
    justify-content: center;
    width: 100%;
    padding: 0;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #101014;
    cursor: grab;
    /* Let the wrapper own the gesture: without this, a drag on touch scrolls the
       modal instead of moving the scene. */
    touch-action: none;
  }
  .preview-wrap:focus-visible {
    outline: 2px solid #6ea8fe;
    outline-offset: 2px;
  }
  .preview-wrap.grabbing {
    cursor: grabbing;
  }
  .preview {
    display: block;
    max-width: 100%;
    max-height: 42vh;
    border-radius: 5px;
    /* Cells are cells — no smoothing, or a 1-cell wire blurs into nothing and
       the preview stops matching the grid it's previewing. */
    image-rendering: pixelated;
  }

  .modes {
    display: flex;
    gap: 4px;
  }
  .mode {
    flex: 1 1 0;
    padding: 6px 4px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #14141a;
    color: #cfcfd8;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .mode:hover {
    border-color: #3a3a46;
    color: #e8e8ee;
  }
  .mode.active {
    background: #23324a;
    border-color: #6ea8fe;
    color: #6ea8fe;
  }
  .mode-desc {
    margin: 0;
    color: #7a7a88;
    font-size: 11px;
    line-height: 1.4;
  }

  .manual {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #16161c;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cap {
    flex: none;
    width: 48px;
    color: #8a8a96;
    font-size: 11px;
  }
  .row input[type='range'] {
    flex: 1 1 auto;
    min-width: 0;
  }
  .val {
    flex: none;
    width: 56px;
    color: #cfcfd8;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #8a8a96;
    font-size: 11px;
    cursor: pointer;
  }
  .presets {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .hint {
    margin: 0;
    color: #6a6a78;
    font-size: 11px;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .ctl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
  }
  .ctl:hover {
    border-color: #6ea8fe;
  }
  .ctl.tiny {
    padding: 3px 8px;
    font-size: 12px;
  }
  .ctl.primary {
    background: #23324a;
    border-color: #6ea8fe;
    color: #cfe0ff;
  }
</style>
