<script lang="ts">
  // Alias the `$`-prefixed atom to a plain name so Svelte's `$store`
  // auto-subscription (`$selected`) resolves to it correctly.
  import { onDestroy } from 'svelte';
  import { $selectedMaterial as selected, $tool as tool } from '../state/store';
  import { MATERIALS } from '../game/materials';
  import { Phase, type Material } from '../game/engine/types';
  import { toCss } from '../game/render/color';

  // Thematic palette tabs, in display order, each with a Bootstrap Icon class. A
  // material shows up under its declared `category`; a material that declares
  // none falls back to the tab derived from its phase (so untagged materials
  // still land somewhere sensible and the "add a material = one file" rule is
  // preserved).
  const CATEGORY_META: { key: string; icon: string }[] = [
    { key: '지우개', icon: 'bi-eraser-fill' },
    { key: '고체', icon: 'bi-box-fill' },
    { key: '가루', icon: 'bi-hourglass-split' },
    { key: '액체', icon: 'bi-droplet-fill' },
    { key: '기체', icon: 'bi-cloud-fill' },
    { key: '불·열', icon: 'bi-fire' },
    { key: '폭발', icon: 'bi-asterisk' },
    { key: '냉각', icon: 'bi-snow' },
    { key: '전기', icon: 'bi-lightning-charge-fill' },
    { key: '생명', icon: 'bi-flower1' },
    { key: '특수', icon: 'bi-stars' },
  ];

  const PHASE_FALLBACK: Record<Phase, string> = {
    [Phase.Empty]: '지우개',
    [Phase.Solid]: '고체',
    [Phase.Powder]: '가루',
    [Phase.Liquid]: '액체',
    [Phase.Gas]: '기체',
  };

  const categoryOf = (m: Material): string => m.category ?? PHASE_FALLBACK[m.phase];
  const iconFor = (key: string): string =>
    CATEGORY_META.find((c) => c.key === key)?.icon ?? 'bi-tag-fill';

  // Bucket every palette material by resolved category, then order the tabs:
  // the known categories (in CATEGORY_META order) that actually have members,
  // followed by any not-yet-known category present (future materials can
  // introduce a new tab just by naming it — nothing here needs editing).
  const grouped = new Map<string, Material[]>();
  for (const m of MATERIALS) {
    const key = categoryOf(m);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(m);
    else grouped.set(key, [m]);
  }
  const orderedKeys = [
    ...CATEGORY_META.map((c) => c.key).filter((k) => grouped.has(k)),
    ...[...grouped.keys()].filter((k) => !CATEGORY_META.some((c) => c.key === k)),
  ];
  const categories = orderedKeys.map((key, index) => ({
    key,
    index,
    label: key,
    icon: iconFor(key),
    materials: grouped.get(key)!,
  }));

  // Which category's flyout is showing. `hovered` follows the pointer (mouse);
  // `pinned` is a click-to-lock override so touch devices (no hover) can open
  // and keep a category's material list on screen.
  let hovered = $state<string | null>(null);
  let pinned = $state<string | null>(null);
  const open = $derived(pinned ?? hovered);

  let root: HTMLDivElement;
  let flyoutEl = $state<HTMLDivElement | null>(null);
  const buttons = new Map<string, HTMLButtonElement>();

  // The category button and its flyout are separate elements (the flyout is
  // portaled to <body>) with a gap between them, so a plain mouseenter/leave
  // pair would close the flyout the instant the pointer crosses that gap.
  // Delay the close briefly so the pointer has time to reach the flyout;
  // entering either the category or the flyout cancels the pending close.
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function openOnHover(key: string): void {
    clearTimeout(closeTimer);
    hovered = key;
  }

  function scheduleHoverClose(): void {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      hovered = null;
    }, 150);
  }

  onDestroy(() => clearTimeout(closeTimer));

  // The sidebar (`ASIDE.panel`) sets `backdrop-filter`, which per spec makes
  // it the containing block for `position: fixed` descendants — so a
  // fixed-position flyout nested inside it is still clipped by the panel's
  // `overflow-y: auto`. Move the flyout's DOM node to <body> so it's fixed
  // to the real viewport instead.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  // Svelte action: records each category button's element so its position
  // can be read on demand (no bind:this into a Map key).
  function registerButton(node: HTMLButtonElement, key: string) {
    buttons.set(key, node);
    return {
      destroy() {
        buttons.delete(key);
      },
    };
  }

  // The flyout is `position: fixed` and placed via JS (not CSS `left: 100%`)
  // because the sidebar sets `overflow-y: auto`, which per spec forces
  // `overflow-x` to compute as `auto` too — an absolutely-positioned flyout
  // would get clipped instead of escaping the panel to the right.
  let flyoutPos = $state<{ top: number; left: number } | null>(null);

  const EDGE_MARGIN = 8;
  const GAP = 8;

  // Prefers opening to the right of the button — the desktop case, where the
  // sidebar sits at the left and there's plenty of canvas to the right. When the
  // flyout won't fit to the right (the mobile bottom bar, where categories run
  // along the bottom), it opens vertically instead: above the button if there's
  // room (the usual case for a bottom-docked bar), otherwise below. Falls back
  // to unclamped, right-of-button placement before the flyout has been measured
  // once (`flyoutEl` still null).
  function computePosition(anchor: DOMRect): { top: number; left: number } {
    if (!flyoutEl) return { top: anchor.top, left: anchor.right + GAP };
    const fw = flyoutEl.offsetWidth;
    const fh = flyoutEl.offsetHeight;
    let left: number;
    let top: number;
    if (anchor.right + GAP + fw <= window.innerWidth - EDGE_MARGIN) {
      left = anchor.right + GAP;
      top = anchor.top;
    } else {
      left = anchor.left;
      // Prefer above; drop below only when there isn't room above the button.
      top =
        anchor.top - GAP - fh >= EDGE_MARGIN ? anchor.top - GAP - fh : anchor.bottom + GAP;
    }
    left = Math.min(Math.max(EDGE_MARGIN, left), Math.max(EDGE_MARGIN, window.innerWidth - EDGE_MARGIN - fw));
    top = Math.min(Math.max(EDGE_MARGIN, top), Math.max(EDGE_MARGIN, window.innerHeight - EDGE_MARGIN - fh));
    return { top, left };
  }

  function reposition(key: string): void {
    const btn = buttons.get(key);
    if (!btn) return;
    flyoutPos = computePosition(btn.getBoundingClientRect());
  }

  $effect(() => {
    if (open !== null) reposition(open);
    else flyoutPos = null;
  });

  // Re-run once the flyout DOM node exists, so `computePosition` can measure
  // its real size (unavailable on the first pass above) and finalize
  // placement. Converges immediately since re-measuring the same size twice
  // yields the same position.
  $effect(() => {
    if (open !== null && flyoutEl) reposition(open);
  });

  // Sidebar scrolling fires a 'scroll' event that doesn't bubble to window,
  // so listen in the capture phase to keep the flyout aligned while open.
  $effect(() => {
    const handler = () => {
      if (open !== null) reposition(open);
    };
    window.addEventListener('scroll', handler, true);
    return () => window.removeEventListener('scroll', handler, true);
  });

  // Picking a material is also a request to paint it, so snap out of any
  // special brush (heat/cool/mix) back to material mode.
  function pick(id: number): void {
    clearTimeout(closeTimer);
    selected.set(id);
    tool.set('material');
    pinned = null;
    hovered = null;
  }

  function toggleCategory(key: string): void {
    clearTimeout(closeTimer);
    pinned = pinned === key ? null : key;
    hovered = null;
  }

  // The flyout is portaled to <body>, so it's not a descendant of `root` —
  // clicks inside it (e.g. its padding, not on a chip) must also count as
  // "inside" or they'd incorrectly dismiss a pinned flyout.
  function handleWindowClick(e: MouseEvent): void {
    if (pinned === null) return;
    const target = e.target as Node;
    if (root && root.contains(target)) return;
    if (flyoutEl && flyoutEl.contains(target)) return;
    pinned = null;
  }

  function handleWindowKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && (pinned !== null || hovered !== null)) {
      clearTimeout(closeTimer);
      pinned = null;
      hovered = null;
    }
  }

  // Keep the flyout aligned with its category button through viewport resizes.
  function handleReflow(): void {
    if (open !== null) reposition(open);
  }
</script>

<svelte:window
  onclick={handleWindowClick}
  onresize={handleReflow}
  onkeydown={handleWindowKeydown}
/>

<div class="palette" bind:this={root}>
  {#each categories as cat (cat.key)}
    <div
      class="category"
      onmouseenter={() => openOnHover(cat.key)}
      onmouseleave={scheduleHoverClose}
    >
      <button
        use:registerButton={cat.key}
        id={`cat-btn-${cat.index}`}
        class:active={open === cat.key}
        class:selected={cat.materials.some(
          (m) => m.id === $selected && $tool === 'material'
        )}
        onclick={() => toggleCategory(cat.key)}
        aria-expanded={open === cat.key}
        aria-haspopup="true"
        aria-controls={`cat-flyout-${cat.index}`}
        title={cat.label}
      >
        <i class={`bi ${cat.icon} icon`} aria-hidden="true"></i>
        <span class="cat-label">{cat.label}</span>
        <span class="count">{cat.materials.length}</span>
      </button>
    </div>
  {/each}

  {#if open !== null && flyoutPos}
    {@const cat = categories.find((c) => c.key === open)}
    {#if cat}
      <div
        class="flyout"
        use:portal
        bind:this={flyoutEl}
        id={`cat-flyout-${cat.index}`}
        role="menu"
        aria-label={cat.label}
        style={`top:${flyoutPos.top}px; left:${flyoutPos.left}px`}
        onmouseenter={() => openOnHover(cat.key)}
        onmouseleave={scheduleHoverClose}
      >
        {#each cat.materials as m (m.id)}
          <button
            class="chip"
            role="menuitem"
            class:active={$selected === m.id && $tool === 'material'}
            onclick={() => pick(m.id)}
            title={m.name}
          >
            <span class="swatch" style={`background:${toCss(m.color)}`}></span>
            <span class="label">{m.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .category {
    position: relative;
  }
  .category > button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .category > button:hover {
    border-color: #3a3a46;
  }
  .category > button.selected {
    border-color: #6ea8fe;
    background: #232b3a;
  }
  .category > button.active {
    border-color: #6ea8fe;
  }
  .icon {
    flex: none;
    font-size: 15px;
    line-height: 1;
    color: #b9c2d0;
  }
  .cat-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    margin-left: auto;
    color: #8a8a99;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .flyout {
    position: fixed;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 6px;
    width: max-content;
    max-width: min(80vw, 384px);
    max-height: min(70vh, 420px);
    padding: 8px;
    overflow-y: auto;
    background: rgba(20, 20, 26, 0.95);
    backdrop-filter: blur(6px);
    border: 1px solid #2a2a33;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }
  .chip {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 56px;
    padding: 6px 4px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
  }
  .chip:hover {
    border-color: #3a3a46;
  }
  .chip.active {
    border-color: #6ea8fe;
    background: #232b3a;
  }
  .chip .swatch {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    flex: none;
  }
  .chip .label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    text-align: center;
  }

  /* Mobile: the palette is row 2 of the bottom bar — a single horizontal strip
     of icon-only category buttons that scrolls sideways. Labels and counts are
     dropped so each category is a compact tap target; the flyout still shows the
     material names. */
  @media (max-width: 768px) {
    .palette {
      flex-direction: row;
      gap: 6px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .palette::-webkit-scrollbar {
      display: none;
    }
    .category {
      flex: none;
    }
    .category > button {
      width: auto;
      padding: 8px 11px;
    }
    .icon {
      font-size: 18px;
    }
    .cat-label,
    .category > button .count {
      display: none;
    }
  }
</style>
