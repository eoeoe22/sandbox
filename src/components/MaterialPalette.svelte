<script lang="ts">
  // Alias the `$`-prefixed atom to a plain name so Svelte's `$store`
  // auto-subscription (`$selected`) resolves to it correctly.
  import { onDestroy } from 'svelte';
  import {
    $selectedMaterial as selected,
    $tool as tool,
    $selectedObject as selectedObject,
    $cloneTarget as cloneTarget,
    $favorites as favorites,
    $recentPicks as recentPicks,
    OBJECT_KINDS,
    recordRecentPick,
    toggleFavorite,
  } from '../state/store';
  import type { ObjectKind } from '../state/store';
  import { MATERIALS, getMaterial, CLONE } from '../game/materials';
  import { canAdopt } from '../game/materials/clone';
  import type { Material } from '../game/engine/types';
  import { buildCategories, categoryOf } from '../game/materials/categories';
  import { objectSvgFor } from '../game/render/objectSvg';
  import { materialSvgFor } from '../game/render/materialSvg';
  import { $locale as locale, t, materialName, objectLabel, categoryLabel } from '../i18n';
  import { loadCodexText } from '../i18n/codexLazy';
  import MaterialCardTip from './MaterialCardTip.svelte';

  // Category grouping (declared `category`, or a phase fallback) lives in the
  // shared `categories` module so the blend brush's picker groups materials
  // identically. This is the ordered list of category tabs with their members.
  // Re-resolved when the locale changes so labels follow the active language.
  const categories = $derived.by(() => {
    void $locale;
    return buildCategories(MATERIALS);
  });

  // The 독립 오브젝트 layer isn't made of materials, so it gets its own palette
  // tab appended after the material categories. Picking an item here switches to
  // the 'object' tool, and a click on the canvas spawns that object (see
  // PointerPainter). The three drums share one capsule and differ only in what
  // they spill when destroyed; the swatch color matches each drum's sprite.
  // Item labels resolve through `objectLabel()` so they follow the active
  // language. Each item's palette swatch is the object's real in-world shape as
  // SVG (objectSvgFor), generated from the same sprite data the renderer draws.
  // The kinds are a plain constant, but the labelled items are `$derived` over
  // `$locale` (same reason as `categories`/`quickItems`): `objectLabel()` reads
  // the locale atom with a plain `.get()`, so a constant array would freeze the
  // flyout's labels at whatever language was active when it was built.
  // The kind list itself lives in the store (OBJECT_KINDS) so persistence can
  // validate saved recent picks against the same source.
  const OBJECT_ITEMS = $derived.by<{ key: ObjectKind; label: string }[]>(() => {
    void $locale;
    return OBJECT_KINDS.map((key) => ({ key, label: objectLabel(key) }));
  });

  // --- Search --------------------------------------------------------------
  // A non-empty query flips the palette from category tabs to a flat filtered
  // grid, matching the material name or its category (both case-insensitive), in
  // registry order. Matches against the current locale's display name so typing
  // Korean finds Korean-named materials. The category flyout is suppressed while
  // searching. Re-runs when the locale changes so the query language tracks the
  // display language.
  let query = $state('');
  const searching = $derived(query.trim().length > 0);
  const matches = $derived.by<Material[]>(() => {
    void $locale;
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return MATERIALS.filter((m) => {
      const name = materialName(m.id, m.name).toLowerCase();
      const cat = categoryLabel(categoryOf(m)).toLowerCase();
      return name.includes(q) || cat.includes(q);
    });
  });

  // --- Favorites / recent quick-access ------------------------------------
  const favSet = $derived(new Set($favorites));
  const isFav = (id: number): boolean => favSet.has(id);
  // A quick-access slot holds either a material chip or an 독립 오브젝트 chip —
  // the recents list tracks both, since picking an object is just as much "what
  // the user last painted" as picking a material is. Favorites stay
  // material-only (the star toggle lives on material chips), so an object entry
  // is never a favorite.
  type QuickItem = { kind: 'material'; mat: Material } | { kind: 'object'; key: ObjectKind };

  // Favorites first (in the order they were starred), then recent picks not
  // already starred. Ids that no longer resolve are dropped. Holds materials and
  // object kinds, not labels: the chips resolve their own name through
  // `materialName()`/`objectLabel()` in the markup, which track the locale by
  // themselves (i18n/reactive.svelte.ts), so this list has no locale dependency
  // to declare.
  const quickItems = $derived.by<QuickItem[]>(() => {
    const favs: QuickItem[] = $favorites
      .map((id) => getMaterial(id))
      .filter((m): m is Material => m !== undefined)
      .map((mat) => ({ kind: 'material', mat }));
    const recents: QuickItem[] = [];
    for (const pick of $recentPicks) {
      if (typeof pick === 'string') {
        recents.push({ kind: 'object', key: pick });
        continue;
      }
      if (favSet.has(pick)) continue; // already shown in the favorites run
      const mat = getMaterial(pick);
      if (mat) recents.push({ kind: 'material', mat });
    }
    return [...favs, ...recents];
  });
  // The quick-access strip is a fixed-size grid so it never reflows the layout as
  // items come and go: always QUICK_SLOTS cells, each either a chip (material or
  // object) or an empty placeholder box. Desktop shows all QUICK_SLOTS; mobile
  // shows only the first six (the rest hidden via CSS) so the strip stays a
  // compact part of the scrolling bottom row. See `.quick` styles.
  const QUICK_SLOTS = 9;
  const quickSlots = $derived.by<(QuickItem | null)[]>(() => {
    const items = quickItems.slice(0, QUICK_SLOTS);
    return Array.from({ length: QUICK_SLOTS }, (_, i) => items[i] ?? null);
  });

  // Which category's flyout is showing. `hovered` follows the pointer (mouse);
  // `pinned` is a click-to-lock override so touch devices (no hover) can open
  // and keep a category's material list on screen.
  let hovered = $state<string | null>(null);
  let pinned = $state<string | null>(null);
  const open = $derived(pinned ?? hovered);

  // The object tab's key. A constant string used both as the palette state key
  // (hovered/pinned) and as the resolved display label via `t()`.
  const OBJECT_KEY = '__objects__';
  const objectTabLabel = $derived.by(() => {
    void $locale;
    return t('palette.objectKey');
  });

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
    // A pending pick()-triggered close (see PICK_CLOSE_DELAY below) was scheduled
    // for whatever flyout was open *before* this hover — without canceling it
    // here, that stale timer could fire up to 400ms later and null out `hovered`
    // out from under a flyout the user has since opened (e.g. pick a material,
    // then immediately hover a different category within the delay window).
    clearTimeout(pickCloseTimer);
    hovered = key;
  }

  function scheduleHoverClose(): void {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      hovered = null;
    }, 150);
  }

  // A category flyout's chips are unmounted (portaled node removed) the instant
  // pick() closes the flyout, which would swallow a genuine double-click: the
  // browser fires click→click→dblclick on the *same* element, but if the first
  // click's handler tore that element out of the DOM right away, the second
  // click/dblclick would land on whatever's now underneath instead — 물질
  // 더블클릭 (pickClone) would never fire. So a plain pick() defers the flyout
  // close by PICK_CLOSE_DELAY (long enough to outlast the browser's own
  // click/dblclick disambiguation window) instead of closing synchronously;
  // pickClone() cancels that pending close and finishes it immediately once a
  // dblclick actually arrives. Selection itself (`selected.set`) still happens
  // the instant a click lands — only the flyout's dismissal is delayed.
  const PICK_CLOSE_DELAY = 400;
  let pickCloseTimer: ReturnType<typeof setTimeout> | undefined;

  function closeFlyoutSoon(): void {
    clearTimeout(pickCloseTimer);
    pickCloseTimer = setTimeout(() => {
      pinned = null;
      hovered = null;
    }, PICK_CLOSE_DELAY);
  }

  function closeFlyoutNow(): void {
    clearTimeout(pickCloseTimer);
    pinned = null;
    hovered = null;
  }

  // --- 물질 카드 (hover) ----------------------------------------------------
  // Resting on a chip floats the /guide 도감 card for that material beside the
  // palette — the whole card, not a shortened restatement of it (see
  // MaterialCardTip). It answers the question the palette itself can't: a swatch
  // and a name say what a material looks like and nothing about what it does.
  //
  // Two places deliberately don't do this:
  //
  //  • The 최근/즐겨찾기 quick strip. Those chips are the ones you already know —
  //    they are there *because* you just used them — and the strip sits under
  //    the search box where a card would cover the categories on every pass of
  //    the pointer. Requested that way, and it is the right cut.
  //  • Touch. There is no hover to rest, and a card triggered by a tap would
  //    fight the tap that picks the material. Gated on `pointerType === 'mouse'`
  //    rather than on a media query, because what makes this work is a pointer
  //    that can hover without committing, not a wide screen.
  const CARD_DELAY = 300;
  let cardMat = $state<Material | null>(null);
  let cardAnchor = $state<DOMRect | null>(null);
  let cardTimer: ReturnType<typeof setTimeout> | undefined;

  /** What the card hangs off: the open flyout when the chip lives inside one (a
   *  card that covered the list you are reading would be self-defeating, and
   *  anchoring to the panel also keeps it still as the pointer runs along the
   *  chips), otherwise the chip itself. */
  function anchorFor(chip: HTMLElement): DOMRect {
    const host = flyoutEl !== null && flyoutEl.contains(chip) ? flyoutEl : chip;
    return host.getBoundingClientRect();
  }

  function cardEnter(e: PointerEvent, m: Material): void {
    if (e.pointerType !== 'mouse') return;
    const chip = e.currentTarget as HTMLElement;
    // Start fetching the prose now rather than when the timer fires, so the
    // first card of a session appears with the rest of them (see codexLazy).
    // A failure just means no card — swallowed here rather than left to become
    // an unhandled rejection on every hover, since this call is only a head
    // start and MaterialCardTip asks again anyway.
    void loadCodexText().catch(() => {});
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => {
      cardMat = m;
      cardAnchor = anchorFor(chip);
    }, CARD_DELAY);
  }

  function hideCard(): void {
    clearTimeout(cardTimer);
    cardMat = null;
    cardAnchor = null;
  }

  // The card outlives its chip in two ways the chip's own pointerleave can't
  // catch: a flyout that closes on its delay (the chip is unmounted, not left)
  // and a search that changes its results under a stationary pointer.
  $effect(() => {
    void open;
    void matches;
    hideCard();
  });

  onDestroy(() => {
    clearTimeout(closeTimer);
    clearTimeout(pickCloseTimer);
    clearTimeout(cardTimer);
  });

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
  // recent-materials list that feeds the quick-access bar. The flyout's close
  // is deferred (see closeFlyoutSoon) rather than immediate, so a chip that's
  // about to be double-clicked stays mounted long enough for pickClone() below
  // to catch it.
  function pick(id: number): void {
    clearTimeout(closeTimer);
    selected.set(id);
    // A plain pick leaves any earlier 더블클릭 Clone target behind — picking Clone
    // this way latches onto whatever it touches in-world, the normal way.
    cloneTarget.set(null);
    tool.set('material');
    recordRecentPick(id);
    closeFlyoutSoon();
  }

  // Double-clicking a material chip is a shortcut for "give me a Clone that's
  // already latched onto this" — selects Clone but pre-seeds $cloneTarget so
  // PointerPainter can seed the painted cell's aux with it directly (see
  // PointerPainter.paintCells), skipping the in-world touch Clone normally
  // needs before it starts emitting copies. Only materials Clone could ever
  // organically latch onto (canAdopt) qualify — Wall/Void/Blast/Clone itself
  // fall back to a normal pick() instead of a target that would never adopt.
  // The browser's own click→click→dblclick sequence already ran pick(id) twice
  // before this fires (each call re-arming closeFlyoutSoon), so this only needs
  // to override that pending close and finish the job as a Clone selection.
  function pickClone(id: number): void {
    if (!canAdopt(id)) {
      pick(id);
      closeFlyoutNow();
      return;
    }
    clearTimeout(closeTimer);
    selected.set(CLONE.id);
    cloneTarget.set(id);
    tool.set('material');
    recordRecentPick(CLONE.id);
    closeFlyoutNow();
  }

  // Star / unstar a material without selecting it (the star sits on top of the
  // chip, so stop the click from also reaching the chip's pick handler).
  function toggleFav(e: MouseEvent, id: number): void {
    e.stopPropagation();
    toggleFavorite(id);
  }

  // Picking an object selects it and switches to the 'object' placement tool (a
  // canvas click then spawns it). Mirrors pick() for materials — records the
  // pick in the recent list (objects share that list with materials) and closes
  // the flyout. No deferred close here: object chips have no 더블클릭 shortcut to
  // keep alive, so the flyout can go away immediately.
  function pickObject(kind: ObjectKind): void {
    clearTimeout(closeTimer);
    selectedObject.set(kind);
    tool.set('object');
    recordRecentPick(kind);
    pinned = null;
    hovered = null;
  }

  function toggleCategory(key: string): void {
    clearTimeout(closeTimer);
    // Same stale-timer hazard as openOnHover above — cancel any pending
    // pick()-triggered close before (re)pinning a category.
    clearTimeout(pickCloseTimer);
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
        placeholder={t('palette.searchPlaceholder')}
        aria-label={t('palette.searchAria')}
        bind:value={query}
        onkeydown={(e) => {
          if (e.key === 'Escape') query = '';
        }}
      />
      {#if query}
        <button
          class="search-clear"
          onclick={() => (query = '')}
          aria-label={t('palette.searchClear')}
          title={t('palette.searchClearTooltip')}
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      {/if}
    </div>

    {#if !searching}
      <div class="quick" role="group" aria-label={t('palette.quickGroup')}>
        {#each quickSlots as slot, i (i)}
          {#if slot?.kind === 'material'}
            <!-- No hover card in the quick strip — see the note on cardEnter. -->
            {@render starChip(slot.mat, false)}
          {:else if slot?.kind === 'object'}
            {@render quickObjectChip(slot.key)}
          {:else}
            <div class="chip-wrap placeholder" aria-hidden="true">
              <div class="chip empty"></div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  {#if searching}
    <div class="results" role="group" aria-label={t('palette.resultsGroup')}>
      {#if matches.length === 0}
        <span class="no-results">{t('palette.noResults')}</span>
      {:else}
        {#each matches as m (m.id)}
          {@render starChip(m, true)}
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
          title={objectTabLabel}
        >
          <i class="bi bi-circle-fill icon" aria-hidden="true"></i>
          <span class="cat-label">{objectTabLabel}</span>
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
      aria-label={objectTabLabel}
      style={`top:${flyoutPos.top}px; left:${flyoutPos.left}px`}
      onmouseenter={() => openOnHover(OBJECT_KEY)}
      onmouseleave={scheduleHoverClose}
    >
      {#each OBJECT_ITEMS as it (it.key)}
        <button
          class="chip"
          role="menuitem"
          class:active={$tool === 'object' && $selectedObject === it.key}
          onclick={() => pickObject(it.key)}
          title={it.label}
        >
          <!-- The object's real in-world silhouette as SVG, scaled to the swatch
               box (see objectSvgFor). {@html} is safe here: the markup is built
               only from trusted constant sprite data, never user input. -->
          <span class="swatch obj">{@html objectSvgFor(it.key)}</span>
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
        onmouseleave={() => {
          // Leaving the flyout for the gap around it drops the card too — the
          // chips' own pointerleave doesn't fire when the pointer exits over the
          // flyout's padding.
          hideCard();
          scheduleHoverClose();
        }}
      >
        {#each cat.materials as m (m.id)}
          <button
            class="chip"
            role="menuitem"
            class:active={$selected === m.id && $tool === 'material'}
            onclick={() => pick(m.id)}
            ondblclick={() => pickClone(m.id)}
            onpointerenter={(e) => cardEnter(e, m)}
            onpointerleave={hideCard}
          >
            <!-- The material's real in-world look as SVG — the same speckle,
                 weave, chevron or heat ramp the renderer draws (see
                 materialSvgFor). {@html} is safe here for the same reason it is
                 on the object chips: the markup is generated from the material
                 registry, never from user input. -->
            <span class="swatch mat">{@html materialSvgFor(m)}</span>
            <span class="label">{materialName(m.id, m.name)}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- The hover card. Renders (and portals itself out of this clipping sidebar)
     only while a chip is being rested on; the codex prose it needs is fetched
     the first time that happens. -->
<MaterialCardTip material={cardMat} anchor={cardAnchor} />

<!-- A material chip with a star toggle in its corner, shared by the quick-access
     bar and the search results. The star is a sibling button (not nested inside
     the chip button — that would be invalid HTML) positioned over the corner. -->
{#snippet starChip(m: Material, card: boolean)}
  <div class="chip-wrap">
    <button
      class="chip"
      class:active={$selected === m.id && $tool === 'material'}
      onclick={() => pick(m.id)}
      ondblclick={() => pickClone(m.id)}
      onpointerenter={card ? (e) => cardEnter(e, m) : undefined}
      onpointerleave={card ? hideCard : undefined}
      title={card ? undefined : materialName(m.id, m.name)}
    >
      <span class="swatch mat">{@html materialSvgFor(m)}</span>
      <span class="label">{materialName(m.id, m.name)}</span>
    </button>
    <button
      class="star"
      class:on={isFav(m.id)}
      onclick={(e) => toggleFav(e, m.id)}
      aria-label={isFav(m.id)
        ? t('palette.favRemove', { name: materialName(m.id, m.name) })
        : t('palette.favAdd', { name: materialName(m.id, m.name) })}
      aria-pressed={isFav(m.id)}
      title={isFav(m.id) ? t('palette.favRemoveTooltip') : t('palette.favAddTooltip')}
    >
      <i class={`bi ${isFav(m.id) ? 'bi-star-fill' : 'bi-star'}`} aria-hidden="true"></i>
    </button>
  </div>
{/snippet}

<!-- An 독립 오브젝트 chip in the quick-access bar. Same wrapper and chip as a
     material slot so the strip's rhythm doesn't break, but with no star: only
     materials can be favorited, so an object chip has nothing to toggle. Picking
     it goes through the same pickObject() the object flyout uses. -->
{#snippet quickObjectChip(kind: ObjectKind)}
  <div class="chip-wrap">
    <button
      class="chip"
      class:active={$tool === 'object' && $selectedObject === kind}
      onclick={() => pickObject(kind)}
      title={objectLabel(kind)}
    >
      <span class="swatch obj">{@html objectSvgFor(kind)}</span>
      <span class="label">{objectLabel(kind)}</span>
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
  /* Empty quick-access slot: a faded dashed box that reserves a chip's footprint
     so the strip keeps its shape whether or not there are favorites/recents. */
  .chip.empty {
    width: 56px;
    height: 100%;
    border-style: dashed;
    border-color: #262630;
    background: transparent;
    opacity: 0.6;
    cursor: default;
  }
  .chip.empty:hover {
    border-color: #262630;
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
  /* display:flex so the chip fills a wrapper that a taller (two-line) neighbour
     stretched — otherwise the short chips in a row would float with a gap under
     them. */
  .chip-wrap {
    position: relative;
    display: flex;
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
    justify-content: flex-start;
    gap: 4px;
    width: 56px;
    min-height: 46px;
    padding: 6px 2px;
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
  /* An object swatch shows the object's real in-world shape as SVG (objectSvgFor),
     scaled to fit this box while keeping its aspect ratio — a round ball, an
     upright drum, a slim dynamite stick. No fill/border of its own; the SVG is the
     art. Taller than a material swatch so the upright drum/dynamite read clearly. */
  .chip .swatch.obj {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 26px;
    border: none;
    border-radius: 0;
    background: none;
  }
  .chip .swatch.obj :global(svg.obj-svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* …except in the quick-access strip, where an object swatch is capped to the
     material swatch's height. The strip is a fixed-size grid whose whole point is
     that it doesn't reflow as items come and go; a 26px-tall object chip would
     stretch its whole row (flex stretch) the moment an object entered the recent
     list, and on mobile the bar's height is fixed, so the extra 8px would just be
     clipped. The SVG still scales to fit while keeping its aspect ratio, so the
     upright drum simply reads a bit smaller here. */
  .quick .chip .swatch.obj {
    width: 24px;
    height: 18px;
  }
  /* A material swatch keeps the rounded, bordered tile it always was — it stands
     for a block of the stuff, not for a free-floating shape the way an object
     chip does — but its fill is now the generated pattern (materialSvgFor)
     instead of a flat background colour. `overflow: hidden` is what makes the
     SVG honour the tile's border-radius; without it the pattern would square off
     the corners the border still rounds. */
  .chip .swatch.mat {
    overflow: hidden;
    padding: 0;
    line-height: 0;
  }
  .chip .swatch.mat :global(svg.mat-svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* Names are never truncated: a two-word name ("White Phosphorus") wraps onto a
     second line rather than turning into "White Pho…". The chip keeps its fixed
     56px width so the grid stays on its column rhythm — only the height grows,
     and flex's default stretch makes every chip on a row match the tallest one,
     so a wrapped row still reads as a row. 9px + break-word is what keeps the
     longest single token in the registry (Phosphorus/Antimatter, 10 chars) on
     one line inside that width; break-word only ever kicks in if a future name
     is longer still, and even then it wraps instead of overflowing. Korean
     names (the ko locale) break between syllables on their own, so a long one
     like 드라이아이스 wraps the same way instead of spilling out. */
  .chip .label {
    width: 100%;
    overflow-wrap: break-word;
    white-space: normal;
    font-size: 9px;
    line-height: 1.25;
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

    /* Chips inside the bar — the quick-access slots and the search results, but
       not the flyout (portalled out of .palette, so it keeps the desktop wrap).
       The bar is a fixed-height strip that scrolls sideways, so a long name
       widens its chip instead of wrapping onto a second line that the bar has
       no room for. */
    .palette .chip {
      width: auto;
      min-width: 56px;
      padding: 6px 6px;
    }
    .palette .chip .label {
      white-space: nowrap;
    }

    /* Quick-access recents/favorites: the first six slots show on mobile (slots
       7–9 stay in the DOM but are hidden). The bar already scrolls sideways, so
       six chips cost no layout — they just push the category buttons further
       along the row — and six is enough to reach the last handful of picks
       without reopening a category. Each visible chip keeps its swatch, name,
       and (materials only) corner star — same as desktop. */
    .quick > *:nth-child(n + 7) {
      display: none;
    }
  }
</style>
