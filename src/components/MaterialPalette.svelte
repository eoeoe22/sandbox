<script lang="ts">
  // Alias the `$`-prefixed atom to a plain name so Svelte's `$store`
  // auto-subscription (`$selected`) resolves to it correctly.
  import { onDestroy } from 'svelte';
  import {
    $selectedMaterial as selected,
    $tool as tool,
    $favorites as favorites,
    $recentMaterials as recentMaterials,
    recordMaterialUse,
    toggleFavorite,
  } from '../state/store';
  import { MATERIALS, getMaterial } from '../game/materials';
  import type { Material } from '../game/engine/types';
  import { buildCategories, categoryOf } from '../game/materials/categories';
  import { toCss } from '../game/render/color';

  // Category grouping (declared `category`, or a phase fallback) lives in the
  // shared `categories` module so the blend brush's picker groups materials
  // identically. This is the ordered list of category tabs with their members.
  const categories = buildCategories(MATERIALS);

  // The 독립 오브젝트 layer isn't made of materials, so it gets its own palette
  // tab appended after the material categories. Picking an item here switches to
  // the 'object' tool, and a click on the canvas spawns that object (see
  // PointerPainter). Only the rubber ball exists this milestone.
  const OBJECT_KEY = '오브젝트';
  const OBJECT_ITEMS = [{ key: 'ball', label: '고무공', color: '#d84652' }];

  // --- Search --------------------------------------------------------------
  // A non-empty query flips the palette from category tabs to a flat filtered
  // grid, matching the material name or its category (both case-insensitive), in
  // registry order. The category flyout is suppressed while searching.
  let query = $state('');
  const searching = $derived(query.trim().length > 0);
  const matches = $derived.by<Material[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return MATERIALS.filter(
      (m) => m.name.toLowerCase().includes(q) || categoryOf(m).toLowerCase().includes(q),
    );
  });

  // --- Favorites / recent quick-access ------------------------------------
  const favSet = $derived(new Set($favorites));
  const isFav = (id: number): boolean => favSet.has(id);
  // Favorites first (in the order they were starred), then recently-used
  // materials not already starred. Ids that no longer resolve are dropped.
  const quickItems = $derived.by<Material[]>(() => {
    const resolve = (ids: number[]): Material[] =>
      ids.map((id) => getMaterial(id)).filter((m): m is Material => m !== undefined);
    const favs = resolve($favorites);
    const recents = resolve($recentMaterials.filter((id) => !favSet.has(id)));
    return [...favs, ...recents];
  });

  // Which category's flyout is showing. `hovered` follows the pointer (mouse);
  // `pinned` is a click-to-lock override so touch devices (no hover) can open
  // and keep a category's material list on screen.
  let hovered = $state<string | null>(null);
  let pinned = $state<string | null>(null);
  const open = $derived(pinned ?? hovered);

  // Entering search swaps the category list for the results grid and the
  // template hides the flyout (`!searching` guard). Also drop any pinned/hovered
  // category, so a flyout that was open before the user started typing doesn't
  // spring back open on its own once the search is cleared.
  $effect(() => {
    if (searching) {
      pinned = null;
      hovered = null;
    }
  });

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
  // special brush (heat/cool/mix) back to material mode, and record it in the
  // recent-materials list that feeds the quick-access bar.
  function pick(id: number): void {
    clearTimeout(closeTimer);
    selected.set(id);
    tool.set('material');
    recordMaterialUse(id);
    pinned = null;
    hovered = null;
  }

  // Star / unstar a material without selecting it (the star sits on top of the
  // chip, so stop the click from also reaching the chip's pick handler).
  function toggleFav(e: MouseEvent, id: number): void {
    e.stopPropagation();
    toggleFavorite(id);
  }

  // Picking an object switches to the 'object' placement tool (a canvas click
  // then spawns it). Mirrors pick() for materials — closes the flyout.
  function pickObject(): void {
    clearTimeout(closeTimer);
    tool.set('object');
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
  <div class="pal-tools">
    <div class="search-wrap">
      <i class="bi bi-search search-icon" aria-hidden="true"></i>
      <input
        class="search"
        type="search"
        placeholder="물질 검색…"
        aria-label="물질 검색"
        bind:value={query}
        onkeydown={(e) => {
          if (e.key === 'Escape') query = '';
        }}
      />
      {#if query}
        <button
          class="search-clear"
          onclick={() => (query = '')}
          aria-label="검색 지우기"
          title="검색 지우기"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      {/if}
    </div>

    {#if quickItems.length > 0 && !searching}
      <div class="quick" role="group" aria-label="즐겨찾기·최근 사용">
        {#each quickItems as m (m.id)}
          {@render starChip(m)}
        {/each}
      </div>
    {/if}
  </div>

  {#if searching}
    <div class="results" role="group" aria-label="검색 결과">
      {#if matches.length === 0}
        <span class="no-results">일치하는 물질이 없습니다</span>
      {:else}
        {#each matches as m (m.id)}
          {@render starChip(m)}
        {/each}
      {/if}
    </div>
  {:else}
    <div class="cat-list">
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
      <!-- 독립 오브젝트 tab (not material-backed) — appended after the material
           categories, same look and flyout mechanics. -->
      <div
        class="category"
        onmouseenter={() => openOnHover(OBJECT_KEY)}
        onmouseleave={scheduleHoverClose}
      >
        <button
          use:registerButton={OBJECT_KEY}
          id="cat-btn-object"
          class:active={open === OBJECT_KEY}
          class:selected={$tool === 'object'}
          onclick={() => toggleCategory(OBJECT_KEY)}
          aria-expanded={open === OBJECT_KEY}
          aria-haspopup="true"
          aria-controls="cat-flyout-object"
          title={OBJECT_KEY}
        >
          <i class="bi bi-circle-fill icon" aria-hidden="true"></i>
          <span class="cat-label">{OBJECT_KEY}</span>
          <span class="count">{OBJECT_ITEMS.length}</span>
        </button>
      </div>
    </div>
  {/if}

  {#if !searching && open === OBJECT_KEY && flyoutPos}
    <div
      class="flyout"
      use:portal
      bind:this={flyoutEl}
      id="cat-flyout-object"
      role="menu"
      aria-label={OBJECT_KEY}
      style={`top:${flyoutPos.top}px; left:${flyoutPos.left}px`}
      onmouseenter={() => openOnHover(OBJECT_KEY)}
      onmouseleave={scheduleHoverClose}
    >
      {#each OBJECT_ITEMS as it (it.key)}
        <button
          class="chip"
          role="menuitem"
          class:active={$tool === 'object'}
          onclick={() => pickObject()}
          title={it.label}
        >
          <span class="swatch ball" style={`background:${it.color}`}></span>
          <span class="label">{it.label}</span>
        </button>
      {/each}
    </div>
  {:else if !searching && open !== null && flyoutPos}
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

<!-- A material chip with a star toggle in its corner, shared by the quick-access
     bar and the search results. The star is a sibling button (not nested inside
     the chip button — that would be invalid HTML) positioned over the corner. -->
{#snippet starChip(m: Material)}
  <div class="chip-wrap">
    <button
      class="chip"
      class:active={$selected === m.id && $tool === 'material'}
      onclick={() => pick(m.id)}
      title={m.name}
    >
      <span class="swatch" style={`background:${toCss(m.color)}`}></span>
      <span class="label">{m.name}</span>
    </button>
    <button
      class="star"
      class:on={isFav(m.id)}
      onclick={(e) => toggleFav(e, m.id)}
      aria-label={isFav(m.id) ? `${m.name} 즐겨찾기 해제` : `${m.name} 즐겨찾기 추가`}
      aria-pressed={isFav(m.id)}
      title={isFav(m.id) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
    >
      <i class={`bi ${isFav(m.id) ? 'bi-star-fill' : 'bi-star'}`} aria-hidden="true"></i>
    </button>
  </div>
{/snippet}

<style>
  .palette {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* Search + quick-access tools sit above the category list (desktop) or flow
     inline at the head of the palette strip (mobile). */
  .pal-tools {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-icon {
    position: absolute;
    left: 8px;
    color: #8a8a99;
    font-size: 12px;
    pointer-events: none;
  }
  .search {
    width: 100%;
    padding: 6px 26px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #14141a;
    color: #e8e8ee;
    font: inherit;
    font-size: 12px;
  }
  .search::placeholder {
    color: #6a6a78;
  }
  .search:focus {
    outline: none;
    border-color: #6ea8fe;
  }
  /* Hide the native search "×" (we render our own clear button). */
  .search::-webkit-search-cancel-button {
    display: none;
  }
  .search-clear {
    position: absolute;
    right: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #8a8a99;
    cursor: pointer;
    font-size: 11px;
  }
  .search-clear:hover {
    color: #e8e8ee;
    background: #2a2a33;
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .cat-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  /* Flat search-result grid: same chips as the category flyout, wrapping within
     the sidebar (desktop) or scrolling sideways (mobile). */
  .results {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 6px;
    max-height: min(46vh, 360px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3a3a46 transparent;
  }
  .no-results {
    color: #8a8a99;
    font-size: 11px;
    padding: 4px 2px;
  }

  /* A chip plus its corner star toggle (quick-access + results). */
  .chip-wrap {
    position: relative;
    flex: none;
  }
  .star {
    position: absolute;
    top: 1px;
    right: 1px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: rgba(20, 20, 26, 0.6);
    color: #7a7a88;
    cursor: pointer;
    font-size: 10px;
    line-height: 1;
  }
  .star:hover {
    color: #ffd98a;
  }
  .star.on {
    color: #ffcf4d;
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
  /* An object swatch is a ball, drawn round to read as the object it places. */
  .chip .swatch.ball {
    border-radius: 50%;
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
     that scrolls sideways: the search box, then the favorite/recent quick chips,
     then the icon-only category buttons (or search results). The section
     wrappers collapse to `display: contents` so all their children flow inline
     into that one scrolling row instead of stacking. Category labels/counts are
     dropped so each is a compact tap target; the flyout still shows names. */
  @media (max-width: 768px) {
    .palette {
      flex-direction: row;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .palette::-webkit-scrollbar {
      display: none;
    }
    .pal-tools,
    .quick,
    .cat-list,
    .results {
      display: contents;
    }
    .search-wrap {
      flex: 0 0 auto;
      width: 128px;
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
