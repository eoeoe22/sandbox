<script lang="ts">
  // Alias the `$`-prefixed atom to a plain name so Svelte's `$store`
  // auto-subscription (`$selected`) resolves to it correctly.
  import { onDestroy } from 'svelte';
  import { $selectedMaterial as selected, $tool as tool } from '../state/store';
  import { MATERIALS } from '../game/materials';
  import { Phase } from '../game/engine/types';
  import { toCss } from '../game/render/color';

  const PHASE_LABELS: Record<Phase, string> = {
    [Phase.Empty]: '지우개',
    [Phase.Solid]: '고체',
    [Phase.Powder]: '가루',
    [Phase.Liquid]: '액체',
    [Phase.Gas]: '기체',
  };
  const PHASE_ICONS: Record<Phase, string> = {
    [Phase.Empty]: '🧹',
    [Phase.Solid]: '🪨',
    [Phase.Powder]: '🏖️',
    [Phase.Liquid]: '💧',
    [Phase.Gas]: '💨',
  };
  const PHASE_ORDER = [Phase.Empty, Phase.Solid, Phase.Powder, Phase.Liquid, Phase.Gas];

  const categories = PHASE_ORDER.map((phase) => ({
    phase,
    label: PHASE_LABELS[phase],
    icon: PHASE_ICONS[phase],
    materials: MATERIALS.filter((m) => m.phase === phase),
  })).filter((c) => c.materials.length > 0);

  // Which category's flyout is showing. `hovered` follows the pointer (mouse);
  // `pinned` is a click-to-lock override so touch devices (no hover) can open
  // and keep a category's material list on screen.
  let hovered = $state<Phase | null>(null);
  let pinned = $state<Phase | null>(null);
  const open = $derived(pinned ?? hovered);

  let root: HTMLDivElement;
  let flyoutEl = $state<HTMLDivElement | null>(null);
  const buttons = new Map<Phase, HTMLButtonElement>();

  // The category button and its flyout are separate elements (the flyout is
  // portaled to <body>) with a gap between them, so a plain mouseenter/leave
  // pair would close the flyout the instant the pointer crosses that gap.
  // Delay the close briefly so the pointer has time to reach the flyout;
  // entering either the category or the flyout cancels the pending close.
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function openOnHover(phase: Phase): void {
    clearTimeout(closeTimer);
    hovered = phase;
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
  function registerButton(node: HTMLButtonElement, phase: Phase) {
    buttons.set(phase, node);
    return {
      destroy() {
        buttons.delete(phase);
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

  // Prefers opening to the right of the button (the common case, plenty of
  // room in the canvas area). On narrow/touch viewports — `pinned` mode's
  // primary use case — the sidebar alone can eat most of the width, so if
  // the flyout wouldn't fit to the right without also being clamped back
  // over the button (making it un-clickable), drop it below the button
  // instead. Falls back to unclamped, right-of-button placement before the
  // flyout has been measured once (`flyoutEl` still null).
  function computePosition(anchor: DOMRect): { top: number; left: number } {
    if (!flyoutEl) return { top: anchor.top, left: anchor.right + GAP };
    const fw = flyoutEl.offsetWidth;
    const fh = flyoutEl.offsetHeight;
    let left = anchor.right + GAP;
    let top = anchor.top;
    if (left + fw > window.innerWidth - EDGE_MARGIN) {
      left = anchor.left;
      top = anchor.bottom + GAP;
    }
    left = Math.min(Math.max(EDGE_MARGIN, left), Math.max(EDGE_MARGIN, window.innerWidth - EDGE_MARGIN - fw));
    top = Math.min(Math.max(EDGE_MARGIN, top), Math.max(EDGE_MARGIN, window.innerHeight - EDGE_MARGIN - fh));
    return { top, left };
  }

  function reposition(phase: Phase): void {
    const btn = buttons.get(phase);
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

  function toggleCategory(phase: Phase): void {
    clearTimeout(closeTimer);
    pinned = pinned === phase ? null : phase;
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
  {#each categories as cat (cat.phase)}
    <div
      class="category"
      onmouseenter={() => openOnHover(cat.phase)}
      onmouseleave={scheduleHoverClose}
    >
      <button
        use:registerButton={cat.phase}
        id={`cat-btn-${cat.phase}`}
        class:active={open === cat.phase}
        class:selected={cat.materials.some(
          (m) => m.id === $selected && $tool === 'material'
        )}
        onclick={() => toggleCategory(cat.phase)}
        aria-expanded={open === cat.phase}
        aria-haspopup="true"
        aria-controls={`cat-flyout-${cat.phase}`}
        title={cat.label}
      >
        <span class="icon">{cat.icon}</span>
        {cat.label}
        <span class="count">{cat.materials.length}</span>
      </button>
    </div>
  {/each}

  {#if open !== null && flyoutPos}
    {@const cat = categories.find((c) => c.phase === open)}
    {#if cat}
      <div
        class="flyout"
        use:portal
        bind:this={flyoutEl}
        id={`cat-flyout-${cat.phase}`}
        role="menu"
        aria-label={cat.label}
        style={`top:${flyoutPos.top}px; left:${flyoutPos.left}px`}
        onmouseenter={() => openOnHover(cat.phase)}
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
    gap: 6px;
    max-width: min(70vw, 480px);
    padding: 8px;
    overflow-x: auto;
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
</style>
