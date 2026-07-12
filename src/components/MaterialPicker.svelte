<script lang="ts">
  // A custom material selector that mirrors the main palette's 카테고리 > 세부물질
  // (category → detail) flow, used by the blend brush in place of a native
  // <select> dropdown. A trigger button (swatch + name) opens a popover that
  // first lists the material categories; picking one drills into that category's
  // materials. Picking a material calls `onpick` and closes the popover.
  //
  // The popover is portaled to <body> and positioned with JS for the same reason
  // as MaterialPalette's flyout: the settings sheet it lives in sets
  // `backdrop-filter` (a containing block for fixed descendants) and
  // `overflow-y: auto`, either of which would clip an in-flow flyout.
  import { onDestroy } from 'svelte';
  import { buildCategories } from '../game/materials/categories';
  import { toCss } from '../game/render/color';
  import type { Material } from '../game/engine/types';

  interface Props {
    /** Currently selected material id (highlighted in the popover). */
    value: number;
    /** Materials the picker offers, in palette order. */
    options: readonly Material[];
    /** Called with the chosen material id when the user picks one. */
    onpick: (id: number) => void;
    /** Accessible label for the trigger button. */
    ariaLabel?: string;
  }

  let { value, options, onpick, ariaLabel }: Props = $props();

  const categories = $derived(buildCategories([...options]));
  const selectedMat = $derived(options.find((m) => m.id === value));
  const selectedName = $derived(selectedMat?.name ?? '?');
  const selectedColor = $derived(selectedMat ? toCss(selectedMat.color) : '#888');

  // Popover open state and which category is drilled into (null = category list).
  let open = $state(false);
  let activeKey = $state<string | null>(null);

  let triggerEl = $state<HTMLButtonElement | null>(null);
  let flyoutEl = $state<HTMLDivElement | null>(null);
  let flyoutPos = $state<{ top: number; left: number } | null>(null);

  const activeCat = $derived(
    activeKey === null ? null : categories.find((c) => c.key === activeKey) ?? null,
  );

  // Where to move focus after the flyout (re)renders: 'selected' focuses the
  // item matching the current value (or the first) on open; 'first' focuses the
  // first item after a level switch. Consumed once by the focus effect below.
  let pendingFocus = $state<'selected' | 'first' | null>(null);

  function openPopover(): void {
    open = true;
    activeKey = null;
    pendingFocus = 'selected';
  }
  function close(restoreFocus = false): void {
    open = false;
    activeKey = null;
    pendingFocus = null;
    if (restoreFocus) triggerEl?.focus();
  }
  function toggle(): void {
    if (open) close();
    else openPopover();
  }

  function chooseCategory(key: string): void {
    activeKey = key;
    pendingFocus = 'first';
  }
  function back(): void {
    activeKey = null;
    pendingFocus = 'first';
  }
  function pick(id: number): void {
    onpick(id);
    close(true);
  }

  // --- Keyboard focus (restores the native <select>'s keyboard operability) ---
  // The flyout is portaled to the end of <body>, so it's out of the page's
  // logical tab order; moving focus into it on open — and back to the trigger on
  // close — is what makes it keyboard-reachable. Items are plain buttons (natively
  // Enter/Space-activatable and tabbable); arrow keys add roving focus on top.
  function focusables(): HTMLElement[] {
    return flyoutEl ? Array.from(flyoutEl.querySelectorAll<HTMLElement>('[data-item]')) : [];
  }
  function focusAt(i: number): void {
    const list = focusables();
    if (list.length) list[((i % list.length) + list.length) % list.length].focus();
  }
  function focusFlyout(mode: 'selected' | 'first'): void {
    const list = focusables();
    if (!list.length) return;
    const sel = mode === 'selected' ? list.findIndex((el) => el.dataset.selected === 'true') : -1;
    (sel >= 0 ? list[sel] : list[0]).focus();
  }

  function onFlyoutKeydown(e: KeyboardEvent): void {
    const list = focusables();
    if (!list.length) return;
    const cur = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        focusAt(cur + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        focusAt(cur - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(list.length - 1);
        break;
    }
  }

  // Move the flyout node to <body> so it's fixed to the real viewport (see the
  // component comment above).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  // Prefer opening to the right of the trigger (desktop: the sidebar sits at the
  // left with the canvas to the right); when it won't fit there, open above the
  // trigger if there's room, otherwise below. Falls back to unclamped right-of
  // placement before the flyout has been measured once. Mirrors MaterialPalette.
  const EDGE_MARGIN = 8;
  const GAP = 8;
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
      top =
        anchor.top - GAP - fh >= EDGE_MARGIN ? anchor.top - GAP - fh : anchor.bottom + GAP;
    }
    left = Math.min(
      Math.max(EDGE_MARGIN, left),
      Math.max(EDGE_MARGIN, window.innerWidth - EDGE_MARGIN - fw),
    );
    top = Math.min(
      Math.max(EDGE_MARGIN, top),
      Math.max(EDGE_MARGIN, window.innerHeight - EDGE_MARGIN - fh),
    );
    return { top, left };
  }

  function reposition(): void {
    if (!triggerEl) return;
    flyoutPos = computePosition(triggerEl.getBoundingClientRect());
  }

  $effect(() => {
    if (open) reposition();
    else flyoutPos = null;
  });

  // Re-measure once the flyout exists / its content (category list vs material
  // grid) changes size, so placement stays anchored. Reading `activeKey` keeps
  // this reactive to the drill-down switch.
  $effect(() => {
    void activeKey;
    if (open && flyoutEl) reposition();
  });

  $effect(() => {
    const handler = () => {
      if (open) reposition();
    };
    // Capture phase: sidebar scrolling fires a non-bubbling 'scroll' event.
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  });

  // Once the flyout for the current level exists, consume any pending focus
  // request so keyboard users land on a real control. Reading `activeKey` reruns
  // this on the level switch (categories ⇄ materials).
  $effect(() => {
    void activeKey;
    if (open && flyoutEl && pendingFocus) {
      const mode = pendingFocus;
      pendingFocus = null;
      focusFlyout(mode);
    }
  });

  onDestroy(() => close());

  // The flyout is portaled out of `root`, so clicks inside it must also count as
  // "inside" or they'd dismiss the popover. Detect on pointerdown, not click:
  // clicking a category button swaps the flyout's content, detaching the clicked
  // node before a bubbling `click` would reach here — so a click-time
  // `contains(target)` check would wrongly read as "outside" and close. At
  // pointerdown the DOM is still intact.
  let root = $state<HTMLDivElement | null>(null);
  function handlePointerDown(e: PointerEvent): void {
    if (!open) return;
    const target = e.target as Node;
    if (root && root.contains(target)) return;
    if (flyoutEl && flyoutEl.contains(target)) return;
    close();
  }
  function handleWindowKeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      // Escape backs out one level (materials → categories), then closes,
      // returning focus to the trigger on the final close.
      if (activeKey !== null) back();
      else close(true);
    }
  }
</script>

<svelte:window onpointerdown={handlePointerDown} onkeydown={handleWindowKeydown} />

<div class="picker" bind:this={root}>
  <button
    class="trigger"
    bind:this={triggerEl}
    onclick={toggle}
    aria-haspopup="true"
    aria-expanded={open}
    aria-label={ariaLabel ? `${ariaLabel}: ${selectedName}` : selectedName}
    title={selectedName}
  >
    <span class="swatch" style={`background:${selectedColor}`}></span>
    <span class="name">{selectedName}</span>
    <i class="bi bi-chevron-down chevron" aria-hidden="true"></i>
  </button>

  {#if open && flyoutPos}
    <!-- Plain focusable buttons in a labeled group (not role=menu): buttons are
         natively announced and Enter/Space-activatable, and arrow-key roving
         (onFlyoutKeydown) is layered on without the menu role's implied
         semantics we don't fully own. -->
    <div
      class="flyout"
      use:portal
      bind:this={flyoutEl}
      role="group"
      aria-label={activeCat ? `${activeCat.label} 물질` : '물질 카테고리'}
      onkeydown={onFlyoutKeydown}
      data-picker-portal
      style={`top:${flyoutPos.top}px; left:${flyoutPos.left}px`}
    >
      {#if activeCat === null}
        <div class="cats">
          {#each categories as cat (cat.key)}
            {@const isSel = cat.materials.some((m) => m.id === value)}
            <button
              class="cat"
              class:selected={isSel}
              data-item
              data-selected={isSel}
              onclick={() => chooseCategory(cat.key)}
              title={cat.label}
            >
              <i class={`bi ${cat.icon} cat-icon`} aria-hidden="true"></i>
              <span class="cat-label">{cat.label}</span>
              <span class="count">{cat.materials.length}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="mats-head">
          <button class="back" onclick={back} aria-label="카테고리로 돌아가기" title="뒤로">
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
          <i class={`bi ${activeCat.icon}`} aria-hidden="true"></i>
          <span class="mats-title">{activeCat.label}</span>
        </div>
        <div class="mats">
          {#each activeCat.materials as m (m.id)}
            <button
              class="chip"
              data-item
              data-selected={m.id === value}
              class:active={m.id === value}
              aria-pressed={m.id === value}
              onclick={() => pick(m.id)}
              title={m.name}
            >
              <span class="swatch" style={`background:${toCss(m.color)}`}></span>
              <span class="chip-label">{m.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .picker {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Trigger looks like the old <select> it replaces: swatch + name + chevron. */
  .trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    text-align: left;
  }
  .trigger:hover {
    border-color: #3a3a46;
  }
  .trigger[aria-expanded='true'] {
    border-color: #6ea8fe;
  }
  .trigger .swatch {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
  .trigger .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trigger .chevron {
    flex: none;
    font-size: 10px;
    color: #8a8a99;
  }

  /* The popover, portaled to <body> and positioned via JS. */
  .flyout {
    position: fixed;
    z-index: 30;
    width: max-content;
    max-width: min(80vw, 384px);
    max-height: min(70vh, 420px);
    padding: 8px;
    overflow-y: auto;
    background: rgba(20, 20, 26, 0.97);
    backdrop-filter: blur(6px);
    border: 1px solid #2a2a33;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  /* Level 1: category list (vertical, like the sidebar palette). */
  .cats {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 168px;
  }
  .cat {
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
  .cat:hover {
    border-color: #3a3a46;
  }
  .cat.selected {
    border-color: #6ea8fe;
    background: #232b3a;
  }
  .cat-icon {
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

  /* Level 2: header (back + category name) then the material chip grid. */
  .mats-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    color: #cfcfd8;
    font-weight: 600;
  }
  .back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font-size: 13px;
  }
  .back:hover {
    border-color: #3a3a46;
  }
  .mats-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mats {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 6px;
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
  .chip-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    text-align: center;
  }
</style>
