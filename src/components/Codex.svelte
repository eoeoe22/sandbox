<script lang="ts">
  // 물질 도감 — the browsable half of the guide page.
  //
  // Everything it draws was extracted at build time (see game/codex/entries.ts);
  // this component never imports the registry, which is what keeps the whole
  // simulation out of the guide page's bundle. What it does import is i18n, so
  // the page re-renders in the other language without being rebuilt: the props
  // carry ids and keys, the words are looked up here.
  //
  // Icons come from the sprite the Astro page emits above this component — the
  // grid and the detail view both point `<use>` at the same `<symbol>`, so the
  // 24×24 drawing is in the document once no matter how many places show it.
  import type {
    CodexEntry,
    CodexReaction,
    CodexStat,
    CodexTagGroup,
    CodexTrait,
    ObjectCodexEntry,
  } from '../game/codex/types';
  import { EMPTY } from '../game/engine/types';
  import { CATEGORY_META, PHASE_KEYS } from '../game/materials/categories';
  import { tagIdOf } from '../game/codex/tags';
  // The number/reaction formatters live beside the Markdown writers so the page
  // and the clipboard can't say different things — see codex/format.ts.
  import {
    entryMarkdown,
    listMarkdown,
    reactionNotes as formatReactionNotes,
    statValue as formatStatValue,
    type CodexMarkdownText,
  } from '../game/codex/format';
  import {
    $locale as locale,
    t,
    materialName,
    objectLabel,
    categoryLabel,
  } from '../i18n';
  // Not from '../i18n': the codex prose is imported here and only here, so it
  // stays out of the chunk the sandbox's islands share. See i18n/codex.ts.
  import { materialDescription, objectDescription, codexTerm } from '../i18n/codex';
  import type { ObjectKind } from '../state/store';
  import Modal from './Modal.svelte';

  interface Props {
    materials: CodexEntry[];
    objects: ObjectCodexEntry[];
    /** The 태그 필터 panel's headings and their tags, built at build time from
     *  what the entries declare (game/codex/tags.ts). */
    tagGroups: CodexTagGroup[];
  }
  let { materials, objects, tagGroups }: Props = $props();

  /** The objects tab's key — deliberately not a category any material can claim. */
  const OBJECTS = '__objects__';

  /** One card's worth of already-localized text, so markup does no lookups. */
  interface Card {
    key: string;
    symbol: string;
    name: string;
    /** The English name, shown under a Korean one as a second handle to search by. */
    sub: string;
    category: string;
    categoryName: string;
    /** Stable phase key, or null for an object — see CodexEntry.phase. */
    phase: string | null;
    phaseName: string | null;
    desc: string;
    stats: CodexStat[];
    traits: CodexTrait[];
    reactions: CodexReaction[];
    /** This card's tag ids, for the 태그 필터. Same strings the panel offers. */
    tags: string[];
  }

  const cards = $derived.by<Card[]>(() => {
    void $locale;
    const mats = materials.map((e) => ({
      key: `m-${e.id}`,
      symbol: `#codex-m-${e.id}`,
      name: materialName(e.id, e.name),
      sub: e.name,
      category: e.category,
      categoryName: categoryLabel(e.category),
      phase: e.phase,
      // The four phase keys double as the first four category keys, so the
      // 상태 chips reuse the labels the palette already has for them.
      phaseName: categoryLabel(e.phase),
      desc: materialDescription(e.id),
      stats: e.stats,
      traits: e.traits,
      reactions: e.reactions,
      tags: e.traits.map(tagIdOf),
    }));
    const objs = objects.map((o) => ({
      key: `o-${o.kind}`,
      symbol: `#codex-o-${o.kind}`,
      name: objectLabel(o.kind as ObjectKind),
      sub: '',
      category: OBJECTS,
      categoryName: t('codex.objects'),
      phase: null,
      phaseName: null,
      desc: objectDescription(o.kind as ObjectKind),
      stats: o.stats,
      traits: o.traits,
      reactions: [] as CodexReaction[],
      tags: o.traits.map(tagIdOf),
    }));
    return [...mats, ...objs];
  });

  // --- Filtering ------------------------------------------------------------
  // Three axes that narrow independently and at the same time. The category tabs
  // are the palette's own shelves; 상태 is the state of matter, which cuts across
  // them (Molten Iron files under 제련, Acid under 액체, and "everything that
  // pours" wants both); tags are what a material can *do*.
  //
  // Within an axis, selections widen (any of the chosen states); across axes and
  // between tags they narrow. Several tags is an AND because that is the
  // question being asked — "acid-proof AND conductive" is a thing you are trying
  // to build with, whereas "acid-proof OR conductive" is most of the palette.
  let query = $state('');
  let activeCategory = $state<string>('all');
  let activePhases = $state<string[]>([]);
  let activeTags = $state<string[]>([]);
  let tagsOpen = $state(false);

  const toggle = (list: string[], key: string): string[] =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  const anyFilter = $derived(
    activeCategory !== 'all' || activePhases.length > 0 || activeTags.length > 0 || query !== '',
  );

  function resetFilters(): void {
    activeCategory = 'all';
    activePhases = [];
    activeTags = [];
    query = '';
  }

  /** The 상태 chips, in the palette's phase order. */
  const phaseOptions = $derived.by(() => {
    void $locale;
    return PHASE_KEYS.map((key) => ({ key, label: categoryLabel(key) }));
  });

  /** The tabs, in the palette's own thematic order, with the objects tab last. */
  const tabs = $derived.by(() => {
    void $locale;
    const present = new Set(cards.map((c) => c.category));
    const keys = [
      ...CATEGORY_META.map((c) => c.key).filter((k) => present.has(k)),
      ...[...present].filter(
        (k) => k !== OBJECTS && !CATEGORY_META.some((c) => c.key === k),
      ),
    ];
    return [
      { key: 'all', label: t('codex.all'), icon: 'bi-grid-3x3-gap-fill' },
      ...keys.map((k) => ({
        key: k,
        label: categoryLabel(k),
        icon: CATEGORY_META.find((c) => c.key === k)?.icon ?? 'bi-tag-fill',
      })),
      ...(present.has(OBJECTS)
        ? [{ key: OBJECTS, label: t('codex.objects'), icon: 'bi-box-seam-fill' }]
        : []),
    ];
  });

  // The search half is name and category only — a "like" match on what the chip
  // actually says, the same rule the in-game palette search uses, so the two
  // behave alike. An object has no phase, so a 상태 selection excludes objects
  // rather than pretending they are solids.
  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (activeCategory !== 'all' && c.category !== activeCategory) return false;
      if (activePhases.length > 0 && (c.phase === null || !activePhases.includes(c.phase))) return false;
      if (activeTags.length > 0 && !activeTags.every((tag) => c.tags.includes(tag))) return false;
      if (q === '') return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.sub.toLowerCase().includes(q) ||
        c.categoryName.toLowerCase().includes(q)
      );
    });
  });

  // How many of the *current* results carry each tag. Counted off `visible`, so
  // a selected tag reads as the result count and an unselected one reads as
  // where clicking it would land — which is what makes a zero worth greying
  // out: with AND semantics that chip is a dead end, and there is no way to see
  // that from the label. A selected chip is never disabled, or a filter could
  // become impossible to undo.
  const tagCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const c of visible) for (const tag of c.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return counts;
  });

  // --- Detail modal ---------------------------------------------------------
  // Held by key rather than by object so the open card survives a language
  // switch (which rebuilds every Card). The dialog itself is the app's shared
  // Modal, which already owns the parts that are easy to get wrong — the focus
  // trap, restoring focus to the card that opened it, Escape, and portaling out
  // of any clipping ancestor.
  let openKey = $state<string | null>(null);
  const openCard = $derived(openKey === null ? null : cards.find((c) => c.key === openKey) ?? null);

  const open = (key: string): void => void (openKey = key);
  const close = (): void => void (openKey = null);

  // --- Formatting -----------------------------------------------------------
  // The two that also have to come out on the clipboard are imported; these are
  // the thin locale-bound wrappers the markup calls.

  const statValue = (s: CodexStat): string => formatStatValue(s, t);

  /** A material named by a stat or trait, in the current locale. */
  function refName(id: number): string {
    void $locale;
    // Empty needs saying in words. It is a real answer — Yeast and Virus die of
    // radiation leaving nothing, and Activated Aluminum consumes the water it
    // cracks — but it is a material like any other to `materialName`, which
    // answers with the *brush* that writes it: the reaction row came out reading
    // "활성 알루미늄 + 물 → 지우개" (or a bare "0" in English, since the eraser has
    // no English entry). Neither is what happened.
    if (id === EMPTY) return t('codex.nothing');
    const entry = materials.find((e) => e.id === id);
    // A `refId` can also point at a material the palette doesn't list (a blast
    // leaves Debris behind). Those have no codex entry to name, so fall back to
    // the id's own translation, which every material has.
    return materialName(id, entry?.name ?? String(id));
  }

  const termOf = (tr: CodexTrait) =>
    codexTerm(tr.variant === undefined ? tr.key : `${tr.key}.${tr.variant}`);

  const reactionNotes = (r: CodexReaction): string[] => formatReactionNotes(r, t, refName);

  /** How many badges a grid card shows before collapsing the rest into "+n". */
  const BADGE_LIMIT = 3;

  // --- 마크다운 복사 ---------------------------------------------------------
  // The writer itself is in game/codex/markdown.ts and holds no i18n of its own;
  // it borrows the very functions this component renders with, so what lands on
  // the clipboard can't disagree with what was on screen — same numbers, same
  // units, same tag names, same language.

  const markdownText = (): CodexMarkdownText => ({
    t,
    term: codexTerm,
    refName,
    tagLabel: (tr) => termOf(tr).label,
  });

  /** Every tag id in panel order — the order a filter summary lists them in. */
  const tagOrder = $derived(tagGroups.flatMap((g) => g.tags));

  /** What the copied list says it was filtered by, so a pasted table still
   *  explains which 34 of 134 these are. */
  function filterSummary(): string[] {
    void $locale;
    const out: string[] = [];
    if (activeCategory !== 'all') {
      const label = activeCategory === OBJECTS ? t('codex.objects') : categoryLabel(activeCategory);
      out.push(`${t('codex.md.category')}: ${label}`);
    }
    if (activePhases.length > 0) {
      const names = PHASE_KEYS.filter((k) => activePhases.includes(k)).map((k) => categoryLabel(k));
      out.push(`${t('codex.phaseFilter')}: ${names.join(', ')}`);
    }
    if (activeTags.length > 0) {
      const names = tagOrder.filter((id) => activeTags.includes(id)).map((id) => codexTerm(id).label);
      out.push(`${t('codex.tagFilter')}: ${names.join(', ')}`);
    }
    if (query.trim() !== '') out.push(`${t('codex.md.search')}: "${query.trim()}"`);
    return out;
  }

  /** Which button last ran, and whether it worked — the label swaps for a beat. */
  let copyNotice = $state<{ where: 'list' | 'entry'; ok: boolean } | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  /** The pre-async-clipboard route. `navigator.clipboard` needs a secure
   *  context, and the guide page is the kind of thing that gets opened off a
   *  LAN address or a `file://` copy of the build; falling back costs a dozen
   *  lines and the alternative is a button that silently does nothing. */
  function copyByExecCommand(text: string): boolean {
    const area = document.createElement('textarea');
    area.value = text;
    // Off-screen but still focusable — `display: none` can't be selected.
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  async function copy(text: string, where: 'list' | 'entry'): Promise<void> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = copyByExecCommand(text);
    }
    clearTimeout(copyTimer);
    copyNotice = { where, ok };
    copyTimer = setTimeout(() => (copyNotice = null), 2200);
  }

  const copyList = (): void => {
    void copy(
      listMarkdown(visible, markdownText(), { filters: filterSummary(), total: cards.length }),
      'list',
    );
  };

  const copyEntry = (): void => {
    if (openCard === null) return;
    void copy(entryMarkdown(openCard, markdownText()), 'entry');
  };

  /** A copy button's label: its name, or how the last press went. */
  const copyLabel = (where: 'list' | 'entry', idle: string): string =>
    copyNotice?.where !== where ? idle : t(copyNotice.ok ? 'codex.copied' : 'codex.copyFailed');
</script>

<div class="codex">
  <!-- The page's own heading lives in here rather than in the .astro file for
       one reason: it has to change language. Astro renders at build time, where
       there is no user locale — the island is the only thing that re-renders on
       a switch. Astro still renders this whole component to static HTML at build
       time, so the page reads fine before (and without) hydration; it just reads
       in Korean, the SSR default. -->
  <header class="page-head">
    <a class="home" href="/">
      <i class="bi bi-arrow-left" aria-hidden="true"></i>
      <span>{t('brand')}</span>
    </a>
    <h1>{t('codex.title')}</h1>
  </header>

  <div class="toolbar">
    <div class="search">
      <i class="bi bi-search" aria-hidden="true"></i>
      <input
        type="search"
        bind:value={query}
        placeholder={t('codex.search')}
        aria-label={t('codex.search')}
      />
      {#if query !== ''}
        <button class="clear" onclick={() => (query = '')} aria-label={t('codex.searchClear')}>
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      {/if}
    </div>

    <div class="tabs" role="tablist" aria-label={t('codex.title')}>
      {#each tabs as tab (tab.key)}
        <button
          role="tab"
          class="tab"
          class:active={activeCategory === tab.key}
          aria-selected={activeCategory === tab.key}
          onclick={() => (activeCategory = tab.key)}
        >
          <i class={`bi ${tab.icon}`} aria-hidden="true"></i>
          <span>{tab.label}</span>
        </button>
      {/each}
    </div>

    <!-- The two filters that run *beside* the category tabs rather than inside
         them. 상태 is short enough to stay open; tags are 35-odd chips, which
         would be five wrapped rows of furniture above a page you came here to
         read, so they live behind a disclosure that reports its own count. -->
    <div class="filter-row">
      <span class="filter-label" id="phase-filter-label">{t('codex.phaseFilter')}</span>
      <div class="chips" role="group" aria-labelledby="phase-filter-label">
        {#each phaseOptions as p (p.key)}
          <button
            class="chip-btn"
            class:on={activePhases.includes(p.key)}
            aria-pressed={activePhases.includes(p.key)}
            onclick={() => (activePhases = toggle(activePhases, p.key))}
          >{p.label}</button>
        {/each}
      </div>
    </div>

    <!-- `aria-controls` only while the panel is mounted: a reference to an id
         that isn't in the document is worse than not claiming one. -->
    <div class="filter-row">
      <button
        class="disclosure"
        class:open={tagsOpen}
        aria-expanded={tagsOpen}
        aria-controls={tagsOpen ? 'tag-panel' : undefined}
        onclick={() => (tagsOpen = !tagsOpen)}
      >
        <i class="bi bi-tags-fill" aria-hidden="true"></i>
        <span>{t('codex.tagFilter')}</span>
        {#if activeTags.length > 0}<span class="pill">{activeTags.length}</span>{/if}
        <i class={`bi ${tagsOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true"></i>
      </button>
      {#if anyFilter}
        <button class="reset" onclick={resetFilters}>
          <i class="bi bi-x-circle" aria-hidden="true"></i>
          <span>{t('codex.filterReset')}</span>
        </button>
      {/if}
    </div>

    {#if tagsOpen}
      <div class="tag-panel" id="tag-panel">
        <p class="tag-hint">{t('codex.tagFilterHint')}</p>
        {#each tagGroups as group (group.key)}
          <div class="tag-group">
            <h2 id={`tag-group-${group.key}`}>{t(`codex.tagGroup.${group.key}`)}</h2>
            <div class="chips" role="group" aria-labelledby={`tag-group-${group.key}`}>
              {#each group.tags as id (id)}
                {@const on = activeTags.includes(id)}
                {@const n = tagCounts.get(id) ?? 0}
                <button
                  class="chip-btn"
                  class:on
                  aria-pressed={on}
                  title={codexTerm(id).desc}
                  disabled={n === 0 && !on}
                  onclick={() => (activeTags = toggle(activeTags, id))}
                >
                  <span>{codexTerm(id).label}</span>
                  <span class="n">{n}</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="result-bar">
    <p class="count">{t('codex.count', { n: visible.length })}</p>
    <!-- Copies what is on screen, filters and all — the reason the filters and
         this button sit next to each other. -->
    <button
      class="copy"
      class:done={copyNotice?.where === 'list'}
      disabled={visible.length === 0}
      onclick={copyList}
    >
      <i class={`bi ${copyNotice?.where === 'list' ? 'bi-check2' : 'bi-clipboard'}`} aria-hidden="true"></i>
      <span>{copyLabel('list', t('codex.copyList'))}</span>
    </button>
  </div>

  {#if visible.length === 0}
    <div class="empty">
      <i class="bi bi-search" aria-hidden="true"></i>
      <p>{t('codex.empty')}</p>
      <p class="hint">{t('codex.emptyHint')}</p>
    </div>
  {:else}
    <ul class="grid">
      {#each visible as card (card.key)}
        <li>
          <button class="card" onclick={() => open(card.key)} aria-label={`${card.name} — ${t('codex.detail')}`}>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href={card.symbol} /></svg>
            <span class="names">
              <span class="name">{card.name}</span>
              {#if card.sub !== '' && card.sub !== card.name}<span class="sub">{card.sub}</span>{/if}
            </span>
            {#if card.traits.length > 0}
              <span class="badges">
                {#each card.traits.slice(0, BADGE_LIMIT) as tr (tr.key + (tr.variant ?? ''))}
                  <span class="badge">{termOf(tr).label}</span>
                {/each}
                {#if card.traits.length > BADGE_LIMIT}
                  <span class="badge more">+{card.traits.length - BADGE_LIMIT}</span>
                {/if}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <footer class="page-foot">
    <a class="btn primary" href="/sandbox">
      <i class="bi bi-play-circle-fill" aria-hidden="true"></i>
      <span>{t('codex.toSandbox')}</span>
    </a>
    <a class="btn" href="/">
      <i class="bi bi-house-door" aria-hidden="true"></i>
      <span>{t('codex.toHome')}</span>
    </a>
  </footer>
</div>

{#if openCard !== null}
  <Modal open title={openCard.name} onclose={close} width={640}>
    <div class="detail">
      <header>
        <svg class="hero" viewBox="0 0 24 24" aria-hidden="true"><use href={openCard.symbol} /></svg>
        <div class="titles">
          {#if openCard.sub !== '' && openCard.sub !== openCard.name}
            <p class="sub">{openCard.sub}</p>
          {/if}
          <span class="chip">{openCard.categoryName}</span>
          {#if openCard.phaseName !== null && openCard.phaseName !== openCard.categoryName}
            <span class="chip">{openCard.phaseName}</span>
          {/if}
        </div>
        <button class="copy" class:done={copyNotice?.where === 'entry'} onclick={copyEntry}>
          <i class={`bi ${copyNotice?.where === 'entry' ? 'bi-check2' : 'bi-clipboard'}`} aria-hidden="true"></i>
          <span>{copyLabel('entry', t('codex.copy'))}</span>
        </button>
      </header>

      <p class="desc">{openCard.desc}</p>
      {#if openCard.category === OBJECTS}
        <p class="note">{t('codex.objectNote')}</p>
      {/if}

      {#if openCard.stats.length > 0}
        <section>
          <h3>{t('codex.statsHeading')}</h3>
          <div class="table-wrap">
            <table>
              <tbody>
                {#each openCard.stats as s (s.key)}
                  <tr>
                    <th scope="row">
                      {codexTerm(s.key).label}
                      <span class="stat-desc">{codexTerm(s.key).desc}</span>
                    </th>
                    <td>
                      <span class="num">{statValue(s)}</span>
                      {#if s.refId !== undefined}
                        <span class="arrow">→</span><span class="ref">{refName(s.refId)}</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      {/if}

      {#if openCard.traits.length > 0}
        <section>
          <h3>{t('codex.traitsHeading')}</h3>
          <ul class="traits">
            {#each openCard.traits as tr (tr.key + (tr.variant ?? ''))}
              <li class="trait">
                <span class="trait-name">{termOf(tr).label}</span>
                <span class="trait-desc">{termOf(tr).desc}</span>
                {#if tr.refId !== undefined}
                  <span class="trait-ref">→ {refName(tr.refId)}</span>
                {/if}
                {#if tr.refIds !== undefined && tr.refIds.length > 0}
                  <span class="trait-ref">→ {tr.refIds.map(refName).join(', ')}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if openCard.reactions.length > 0}
        <section>
          <h3>{t('codex.reactionsHeading')}</h3>
          <ul class="reactions">
            {#each openCard.reactions as r, i (i)}
              <li class="reaction">
                <span class="formula">
                  <span class="term self">{openCard.name}</span>
                  <span class="plus">+</span>
                  <span class="term">{refName(r.with)}</span>
                  <span class="arrow">→</span>
                  <span class="term out">{r.produce === undefined ? t('codex.reaction.unchanged') : refName(r.produce)}</span>
                  {#if r.otherBecomes !== undefined}
                    <span class="plus">+</span>
                    <span class="term out">{refName(r.otherBecomes)}</span>
                  {/if}
                </span>
                {#if reactionNotes(r).length > 0}
                  <span class="notes">
                    {#each reactionNotes(r) as note}<span class="note-chip">{note}</span>{/each}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
  </Modal>
{/if}

<style>
  .codex {
    max-width: 1100px;
    margin: 0 auto;
    width: 100%;
  }

  /* --- Page heading ----------------------------------------------------- */
  .page-head {
    margin-bottom: 1.8rem;
  }

  .home {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: #4f46e5;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 600;
    /* 14.4px x 1.2 = 17.28px of text, padded out to ~44px and pulled back with
       a matching negative margin so the tap target grows but the layout doesn't
       move. The line-height is pinned rather than left at `normal` so the sum
       doesn't drift with the platform font's metrics. */
    line-height: 1.2;
    padding: 0.85rem 0.75rem;
    margin: -0.85rem -0.75rem calc(1rem - 0.85rem);
  }

  .home:hover {
    color: #818cf8;
  }

  .page-head h1 {
    margin: 0;
    font-size: 2.1rem;
    font-weight: 800;
    background: linear-gradient(135deg, #a5b4fc 0%, #38bdf8 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* --- Footer links ----------------------------------------------------- */
  .page-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid #22262f;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.6rem 1.1rem;
    border-radius: 0.55rem;
    border: 1px solid #262a33;
    background: #14161c;
    color: #c7cede;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .btn:hover {
    border-color: #3a4150;
    color: #e0e6ed;
  }

  .btn.primary {
    background: #4f46e5;
    border-color: #4f46e5;
    color: #fff;
  }

  .btn.primary:hover {
    background: #4338ca;
    border-color: #4338ca;
    color: #fff;
  }

  /* --- Toolbar ---------------------------------------------------------- */
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    margin-bottom: 1rem;
  }

  .search {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search .bi-search {
    position: absolute;
    left: 0.85rem;
    color: #6b7684;
    pointer-events: none;
  }

  .search input {
    width: 100%;
    padding: 0.7rem 2.4rem;
    border-radius: 0.6rem;
    border: 1px solid #262a33;
    background: #14161c;
    color: #e0e6ed;
    /* 16px exactly. Anything smaller and iOS Safari zooms the page when this is
       focused — it used to be masked by the viewport's `maximum-scale=1`, which
       a reading page can't keep (see Base.astro's `app` prop). */
    font-size: 1rem;
    font-family: inherit;
  }

  .search input:focus {
    outline: none;
    border-color: #4f46e5;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.22);
  }

  /* The browser's own clear affordance would sit beside ours. */
  .search input::-webkit-search-cancel-button {
    display: none;
  }

  .search .clear {
    position: absolute;
    right: 0.55rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    border: none;
    border-radius: 50%;
    background: #262a33;
    color: #9aa4b2;
    cursor: pointer;
    font-size: 0.7rem;
  }

  /* The visible pill is 27.2px; a thumb needs ~44. Grow the *hit* area with a
     pseudo-element rather than the box, so the button lands in exactly the same
     place it does today — widening the element instead would slide the circle
     several px left of where the design puts it. A miss here is worse than a
     miss usually is: it lands on the input behind and re-opens the keyboard. */
  .search .clear::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 44px;
    height: 44px;
  }

  .search .clear:hover {
    background: #333844;
    color: #e0e6ed;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    border: 1px solid #262a33;
    background: #14161c;
    color: #9aa4b2;
    font-size: 0.82rem;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .tab:hover {
    color: #e0e6ed;
    border-color: #3a4150;
  }

  .tab.active {
    background: #4f46e5;
    border-color: #4f46e5;
    color: #fff;
  }

  /* --- Filters beside the tabs ------------------------------------------ */
  .filter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.6rem;
  }

  .filter-label {
    color: #6b7684;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  /* A toggle, not a tab: the category pills are one-of-many and these are
     any-of-many, so they read as outlined until pressed rather than as a
     highlighted selection in a row. */
  .chip-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    border-radius: 0.4rem;
    border: 1px solid #262a33;
    background: #14161c;
    color: #9aa4b2;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .chip-btn:hover:not(:disabled) {
    color: #e0e6ed;
    border-color: #3a4150;
  }

  .chip-btn.on {
    background: #1e214f;
    border-color: #4f46e5;
    color: #c7d2fe;
  }

  /* Under AND semantics a tag no current result carries is a dead end, and the
     label alone gives no way to know that. Never disabled while selected, or a
     filter that emptied the grid could not be clicked off again. */
  .chip-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .chip-btn .n {
    color: #6b7684;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }

  .chip-btn.on .n {
    color: #a5b4fc;
  }

  .disclosure,
  .reset,
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    border-radius: 0.4rem;
    border: 1px solid #262a33;
    background: #14161c;
    color: #9aa4b2;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .disclosure:hover,
  .reset:hover,
  .copy:hover:not(:disabled) {
    color: #e0e6ed;
    border-color: #3a4150;
  }

  .disclosure.open {
    color: #c7d2fe;
    border-color: #3a4150;
  }

  .disclosure .pill {
    padding: 0 0.35rem;
    border-radius: 999px;
    background: #4f46e5;
    color: #fff;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }

  .tag-panel {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.8rem 0.9rem;
    border-radius: 0.6rem;
    border: 1px solid #22262f;
    background: #10131a;
  }

  .tag-hint {
    margin: 0;
    color: #6b7684;
    font-size: 0.75rem;
  }

  .tag-group h2 {
    margin: 0 0 0.35rem 0;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6b7684;
  }

  /* --- Result bar ------------------------------------------------------- */
  .result-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.9rem;
  }

  .count {
    margin: 0;
    color: #6b7684;
    font-size: 0.8rem;
  }

  .copy:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .copy.done {
    border-color: #4f46e5;
    color: #c7d2fe;
  }

  /* --- Grid ------------------------------------------------------------- */
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 0.7rem;
  }

  /* 134 cards, each with an SVG of a few dozen shapes, and a phone shows four.
     `content-visibility` lets the browser skip layout and paint for the ones
     off screen; `contain-intrinsic-size` keeps the scrollbar honest in the
     meantime by standing in at roughly a card's real height. */
  .grid > li {
    content-visibility: auto;
    contain-intrinsic-size: auto 150px;
  }

  .card {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.85rem;
    border-radius: 0.7rem;
    border: 1px solid #262a33;
    background: #14161c;
    color: #e0e6ed;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease, transform 0.12s ease;
  }

  .card:hover {
    border-color: #4f46e5;
    background: #181b23;
    transform: translateY(-1px);
  }

  .card .icon {
    width: 42px;
    height: 42px;
    border-radius: 0.35rem;
    /* A gas draws as a cloud on a transparent field (see materialSvg's
       GAS_CLOUD), so the tile needs a board behind it or it reads as a hole. */
    background: #0b0c10;
  }

  .names {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .name {
    font-weight: 650;
    font-size: 0.95rem;
    line-height: 1.25;
  }

  .sub {
    color: #6b7684;
    font-size: 0.75rem;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: auto;
    padding-top: 0.2rem;
  }

  .badge {
    padding: 0.12rem 0.4rem;
    border-radius: 0.3rem;
    background: #212633;
    color: #a5b4fc;
    font-size: 0.68rem;
    line-height: 1.5;
    white-space: nowrap;
  }

  .badge.more {
    background: transparent;
    color: #6b7684;
  }

  /* --- Empty state ------------------------------------------------------ */
  .empty {
    padding: 3rem 1rem;
    text-align: center;
    color: #6b7684;
  }

  .empty .bi {
    font-size: 1.8rem;
    opacity: 0.5;
  }

  .empty p {
    margin: 0.6rem 0 0 0;
  }

  .empty .hint {
    font-size: 0.85rem;
    opacity: 0.75;
  }

  /* --- Detail dialog ---------------------------------------------------- */
  /* The shell is the app's shared Modal; everything below styles what goes in
     its body. The body inherits the toolbar's compact 13px and, from the modal
     card, `user-select: none` — right for a settings sheet, wrong for a
     reference page, so this root turns both back into document defaults. */
  .detail {
    font-size: 0.95rem;
    line-height: 1.5;
    user-select: text;
  }

  .detail header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }

  /* Pushed to the right of the title block, and allowed to drop to its own line
     rather than squeezing the name on a narrow phone. */
  .detail header .copy {
    margin-left: auto;
    flex: none;
  }

  .hero {
    width: 76px;
    height: 76px;
    flex: none;
    border-radius: 0.5rem;
    background: #0b0c10;
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  .titles .sub {
    margin: 0;
  }

  .chip {
    display: inline-block;
    margin-top: 0.3rem;
    /* A material carries two — its shelf and its state of matter — and inline
       blocks would otherwise sit flush against each other. */
    margin-right: 0.3rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: #212633;
    color: #a5b4fc;
    font-size: 0.72rem;
  }

  .desc {
    margin: 1.1rem 0 0 0;
    line-height: 1.65;
    color: #c7cede;
  }

  .note {
    margin: 0.5rem 0 0 0;
    color: #6b7684;
    font-size: 0.82rem;
  }

  .detail section {
    margin-top: 1.4rem;
  }

  .detail h3 {
    margin: 0 0 0.6rem 0;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6b7684;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }

  tbody tr + tr {
    border-top: 1px solid #22262f;
  }

  th {
    text-align: left;
    font-weight: 500;
    color: #9aa4b2;
    padding: 0.45rem 0.6rem 0.45rem 0;
    white-space: nowrap;
  }

  /* What a row *means*, on the page rather than in a `title=` tooltip. A tooltip
     needs a hover, and a touch device has none — on a phone the explanation of
     every number here simply did not exist. The trait cards below already say
     their sentence out loud; this makes the table agree with them.

     `white-space: normal` is load-bearing: it undoes the `nowrap` it inherits
     from the `th` (there to keep the row label on one line), which a sentence
     would otherwise obey — stretching the table until `.table-wrap` turned into
     a horizontal scroller on a narrow phone. */
  .stat-desc {
    display: block;
    white-space: normal;
    max-width: 22rem;
    margin-top: 0.15rem;
    color: #6b7684;
    font-size: 0.78rem;
    font-weight: 400;
    line-height: 1.45;
  }

  td {
    padding: 0.45rem 0;
    text-align: right;
  }

  .num {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .arrow {
    margin: 0 0.35rem;
    color: #6b7684;
  }

  .ref {
    color: #a5b4fc;
  }

  .traits {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.5rem;
  }

  .trait {
    padding: 0.6rem 0.7rem;
    border-radius: 0.5rem;
    border: 1px solid #22262f;
    background: #10131a;
  }

  .trait-name {
    display: block;
    font-size: 0.85rem;
    font-weight: 650;
    color: #a5b4fc;
  }

  .trait-desc {
    display: block;
    margin-top: 0.2rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #9aa4b2;
  }

  .trait-ref {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.78rem;
    color: #c7cede;
  }

  .reactions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .reaction {
    padding: 0.55rem 0.7rem;
    border-radius: 0.5rem;
    border: 1px solid #22262f;
    background: #10131a;
  }

  .formula {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
    font-size: 0.85rem;
  }

  .term {
    color: #c7cede;
  }

  .term.self {
    color: #e0e6ed;
    font-weight: 650;
  }

  .term.out {
    color: #a5b4fc;
  }

  .plus {
    color: #6b7684;
  }

  .notes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.35rem;
  }

  .note-chip {
    padding: 0.1rem 0.4rem;
    border-radius: 0.3rem;
    background: #1a1e27;
    color: #6b7684;
    font-size: 0.72rem;
  }

  @media (max-width: 520px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }

    /* Two columns, and the badge row wraps — the cards are taller here. */
    .grid > li {
      contain-intrinsic-size: auto 175px;
    }

    .hero {
      width: 56px;
      height: 56px;
    }
  }

  /* Touch targets. Keyed off the pointer, not the viewport width, because what
     makes 31px too small is the finger, not the screen — a tablet at 800px has
     the same problem. The category pills are the page's primary filter and
     there are 16 of them wrapping into rows; at 31px tall with a 6.4px gap, a
     thumb aimed at one regularly lands on the row above. Only the height grows:
     wider pills would buy another wrapped row and make the aim worse. */
  @media (pointer: coarse) {
    .tabs {
      gap: 0.5rem;
    }

    .tab {
      min-height: 44px;
    }

    /* Same argument as the tabs, and it applies harder in the tag panel: 35
       chips wrap into six rows, so a thumb aimed at 내산성 has a neighbour
       directly above and below it. */
    .chips {
      gap: 0.5rem;
    }

    .chip-btn,
    .disclosure,
    .reset,
    .copy {
      min-height: 44px;
    }
  }
</style>
