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
    CodexCardData,
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
  import { onMount } from 'svelte';
  import type { Component } from 'svelte';
  import type { DemoCast, DemoTrigger, GuideDemoKind } from '../game/guideDemo';
  import type { GuideDemoScene } from '../game/demoScenes';
  // The number/reaction formatters live beside the Markdown writers so the page
  // and the clipboard can't say different things — see codex/format.ts.
  import {
    entryMarkdown,
    listMarkdown,
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
  import { copyText } from '../lib/clipboard';
  import Modal from './Modal.svelte';
  // The card body itself — shared with the sandbox palette's hover tooltip, so
  // the in-game card and this dialog can't say different things. See CodexCard.
  import CodexCard from './CodexCard.svelte';

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

  /** One card's worth of already-localized text, so markup does no lookups.
   *  `CodexCardData` is the part the detail dialog renders (and the part the
   *  sandbox's hover tooltip renders too — see CodexCard); everything added here
   *  is what this page needs on top of it to run the grid and the filters. */
  interface Card extends CodexCardData {
    key: string;
    /** Material id for the live demo, or null for an object (which has no phase
     *  and so no demo). Lifted out of the build-time entry so the detail dialog
     *  can hand it to `<GuideDemo>` without re-parsing the `m-<id>` key. */
    id: number | null;
    /** Sprite reference for the grid thumbnail — the same `<symbol>` the card's
     *  `iconHtml` points `<use>` at, without the wrapper. */
    symbol: string;
    /** Stable canonical category key — what the card's chip names. */
    category: string;
    /** Every category key this card files under, canonical first — what the
     *  tabs match. Longer than one only for a material declaring `alsoIn`. */
    categories: string[];
    /** Those same categories as localized labels, for the search half — typing a
     *  tab's name has to find what clicking that tab shows. `categoryName` is the
     *  canonical one alone, because that's what the card displays. */
    categoryNames: string[];
    /** Stable phase key, or null for an object — see CodexEntry.phase. */
    phase: string | null;
    /** This card's tag ids, for the 태그 필터. Same strings the panel offers. */
    tags: string[];
  }

  /** The hero drawing as markup: a reference into the page's own sprite, which
   *  is where all 134 drawings already live (see the note at the top). */
  const heroHtml = (symbol: string): string =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="${symbol}"/></svg>`;

  const cards = $derived.by<Card[]>(() => {
    void $locale;
    const mats = materials.map((e) => ({
      key: `m-${e.id}`,
      id: e.id,
      symbol: `#codex-m-${e.id}`,
      iconHtml: heroHtml(`#codex-m-${e.id}`),
      name: materialName(e.id, e.name),
      sub: e.name,
      category: e.category,
      categories: e.categories,
      categoryNames: e.categories.map(categoryLabel),
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
      id: null,
      symbol: `#codex-o-${o.kind}`,
      iconHtml: heroHtml(`#codex-o-${o.kind}`),
      name: objectLabel(o.kind as ObjectKind),
      sub: '',
      category: OBJECTS,
      categories: [OBJECTS],
      categoryNames: [t('codex.objects')],
      categoryName: t('codex.objects'),
      phase: null,
      phaseName: null,
      desc: objectDescription(o.kind as ObjectKind),
      // The one line the material cards don't have: 오브젝트 are bodies above the
      // grid, not cells in it, and the card says so where the difference bites.
      note: t('codex.objectNote'),
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
    const present = new Set(cards.flatMap((c) => c.categories));
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

  // The search half is name and category only — a "like" match, the same rule
  // the in-game palette search uses, so the two behave alike. It reads every
  // category the card files under, not just the one its chip shows, so typing a
  // tab's name and clicking that tab return the same set. An object has no
  // phase, so a 상태 selection excludes objects rather than pretending they are
  // solids.
  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (activeCategory !== 'all' && !c.categories.includes(activeCategory)) return false;
      if (activePhases.length > 0 && (c.phase === null || !activePhases.includes(c.phase))) return false;
      if (activeTags.length > 0 && !activeTags.every((tag) => c.tags.includes(tag))) return false;
      if (q === '') return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.sub.toLowerCase().includes(q) ||
        c.categoryNames.some((n) => n.toLowerCase().includes(q))
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

  /**
   * 카드 본문에 끼워 넣을 데모 컴포넌트. 정적 import 가 아니라 **마운트 뒤 동적
   * import** 인 것은 이 페이지가 원래 시뮬레이션을 한 줄도 싣지 않기 때문이다 —
   * 도감은 빌드 타임 추출이라 엔진·물질 레지스트리가 필요 없고, 그래서 도감만
   * 보고 나가는 사람도 가벼운 청크를 받는다(§1 "왜 빌드 타임인가" 참고).
   *
   * 데모를 카드에 끼우려면 두 가지 무거운 것이 필요하다: 엔진(Grid·Simulation·
   * CanvasRenderer)과, 카드의 **실제 물질**을 데모하려면 **전체 물질 배럴**(약 150종).
   * 둘 다 가이드 페이지의 첫 청크에 들어가면 안 되므로 여기서 끌어온다. basics
   * 탭(`GameGuideDoc`)이 같은 이유로 같은 패턴을 쓴다.
   *
   * `null` 인 동안은 데모 자리를 비운다 — 카드는 설명·수치·특성만으로도 완결된
   * 글이므로 로딩 표시를 둘 이유가 없다.
   */
  let Demo = $state<Component<{
    kind: GuideDemoKind;
    subjectId?: number;
    cast?: DemoCast;
    trigger?: DemoTrigger;
  }> | null>(null);
  /**
   * 맞춤 연출 표(`game/demoScenes.ts`)를 찾는 함수. 같은 이유로 동적이다 — 그
   * 표는 산·화약·질산암모늄을 이름으로 집으므로 전체 배럴에 매달려 있고, 정적으로
   * 걸면 위 문단이 막아 둔 것이 도로 열린다. 도착 전에는 `null` 이라 상태별 기본
   * 데모로 도는데, 두 import 가 같은 `await` 줄에 있어 그 창은 첫 카드가 열리기
   * 전에 닫힌다.
   */
  let sceneFor = $state<((id: number) => GuideDemoScene | null) | null>(null);
  onMount(async () => {
    // 전체 물질 배럴을 먼저 평가시킨다 — 카드의 실제 물질 id 가 레지스트리에
    // 등록되어야 렌더러가 그 색을 알고, 시뮬레이션이 그 물질의 동작을 안다.
    // 경량 데모 배럴(`materials/demo`)은 9종만 알아서 카드 물질이 검은 칸이 된다.
    await import('../game/materials');
    sceneFor = (await import('../game/demoScenes')).demoSceneFor;
    Demo = (await import('./GuideDemo.svelte')).default;
  });

  const open = (key: string): void => void (openKey = key);
  const close = (): void => void (openKey = null);

  /**
   * 열려 있는 카드가 무슨 데모를 도는가. **맞춤 연출이 phase 기본 데모보다 먼저다.**
   *
   * 맞춤 연출을 배정하는 자리가 **둘**이고, 둘 다 봐야 한다. 서로 다른 라운드에서 서로
   * 다른 제약을 안고 태어났고, 다루는 물질이 겹치지 않아 지금은 나란히 산다.
   *
   *  - `DEMO_OVERRIDE`(바로 아래) — 벽·흑요석·소금물·설탕물·베이킹소다. 대본이 놓는
   *    물질을 경량 배럴(`materials/demo.ts`)에 이름으로 들여놓고, 여기서는 **id
   *    리터럴**로만 가리킨다. 리터럴인 것은 의도다: 이 컴포넌트는 도감 첫 청크를
   *    가볍게 두려고 전체 물질 배럴을 정적 import 하지 않으므로(onMount 의 동적
   *    import 로만 평가한다), 매핑에 물질 객체를 끌어오면 그 정적 의존성이 첫 청크에
   *    들어간다. 대가로 숫자가 틀어지면 데모가 검은 캔버스가 되므로
   *    `check:material-ids` 와 함께 볼 자리다.
   *  - `sceneFor`(`game/demoScenes.ts`) — 산·화약·섬광화약·질산암모늄·불꽃놀이 화약·
   *    황·니트로. 이쪽은 대본이 모르는 물질을 `DemoCast` 배역표로 건네고, 표 자체가
   *    전체 배럴에 매달려 있어 **동적 import** 로만 온다(CODEX.md §16.1). 그래서 id 를
   *    리터럴로 적을 필요가 없다 — 물질을 이름으로 집는다.
   *
   * **순서가 못 박혀 있다.** 두 표의 id 는 지금 겹치지 않지만, 겹치는 날에는 위쪽이
   * 이긴다. 한 물질에 대본을 둘 배정한 것 자체가 실수이므로 조용히 섞이는 것보다
   * 한쪽으로 확정되는 편이 낫다.
   *
   * object 는 phase 도 맞춤 연출도 없으므로(`id === null`) 어느 쪽으로도 안 간다.
   */
  const PHASE_DEMOS = new Set<string>(PHASE_KEYS);
  // 맞춤 데모 매핑: 물질 id → GuideDemoKind. id 출처는 materials/*.ts(변경 시 갱신).
  const DEMO_OVERRIDE: Record<number, GuideDemoKind> = {
    1: 'wall', // WALL
    124: 'obsidian', // OBSIDIAN
    5: 'saltwater', // SALTWATER
    104: 'sugarwater', // SUGAR_WATER
    80: 'soda', // SODA (베이킹소다)
  };
  const cardDemo = $derived.by<{
    kind: GuideDemoKind;
    id: number;
    cast?: DemoCast;
    trigger?: DemoTrigger;
  } | null>(() => {
    const c = openCard;
    if (c === null || c.id === null) return null;
    // (1) id 리터럴 표.
    const override = DEMO_OVERRIDE[c.id];
    if (override !== undefined) return { kind: override, id: c.id };
    // (2) 배역표가 딸린 맞춤 연출. 도착 전(동적 import)에는 null 이라 (3)으로 간다.
    const custom = sceneFor?.(c.id) ?? null;
    if (custom !== null)
      return { kind: custom.kind, id: c.id, cast: custom.cast, trigger: custom.trigger };
    // (3) 그 외에는 phase 기반 기본 데모(상태 4종).
    if (c.phase === null || !PHASE_DEMOS.has(c.phase)) return null;
    return { kind: c.phase as GuideDemoKind, id: c.id };
  });

  // --- Formatting -----------------------------------------------------------
  // The number/reaction formatters now live in CodexCard (which renders them)
  // and in codex/format.ts (which writes them to the clipboard); what is left
  // here is the two lookups both of those borrow from the page.

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

  async function copy(text: string, where: 'list' | 'entry'): Promise<void> {
    const ok = await copyText(text);
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
        <!-- Cards, not chips, and the sentence is on the page rather than in a
             `title=`. Half these labels don't explain themselves (「체」,
             「충격파에 휩쓸림」) and a tooltip needs a hover a phone doesn't
             have — the same mistake the stat table already made once and had
             fixed (see .stat-desc). So the tag reads exactly the way its trait
             card does in the detail view, which is where the reader met it. -->
        {#each tagGroups as group (group.key)}
          <div class="tag-group">
            <h2 id={`tag-group-${group.key}`}>{t(`codex.tagGroup.${group.key}`)}</h2>
            <div class="tag-cards" role="group" aria-labelledby={`tag-group-${group.key}`}>
              {#each group.tags as id (id)}
                {@const on = activeTags.includes(id)}
                {@const n = tagCounts.get(id) ?? 0}
                <button
                  class="tag-card"
                  class:on
                  aria-pressed={on}
                  disabled={n === 0 && !on}
                  onclick={() => (activeTags = toggle(activeTags, id))}
                >
                  <span class="tag-card-head">
                    <span class="tag-card-name">{codexTerm(id).label}</span>
                    <span class="n">{n}</span>
                  </span>
                  <span class="tag-card-desc">{codexTerm(id).desc}</span>
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
  <!-- 오프캔버스, not a centered card. The detail is a document — long, scrolling,
       and read *against* the grid it came from — so it docks to the edge and
       leaves the list it was opened from in view behind the scrim. -->
  <Modal open variant="offcanvas" title={openCard.name} onclose={close} width={560}>
    <CodexCard card={openCard} term={codexTerm} {refName}>
      {#snippet actions()}
        <button class="copy" class:done={copyNotice?.where === 'entry'} onclick={copyEntry}>
          <i class={`bi ${copyNotice?.where === 'entry' ? 'bi-check2' : 'bi-clipboard'}`} aria-hidden="true"></i>
          <span>{copyLabel('entry', t('codex.copy'))}</span>
        </button>
      {/snippet}
      {#snippet demo()}
        {#if Demo !== null && cardDemo !== null}
          <Demo
            kind={cardDemo.kind}
            subjectId={cardDemo.id}
            cast={cardDemo.cast}
            trigger={cardDemo.trigger}
          />
        {/if}
      {/snippet}
    </CodexCard>
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

  .chip-btn:hover {
    color: #e0e6ed;
    border-color: #3a4150;
  }

  .chip-btn.on {
    background: #1e214f;
    border-color: #4f46e5;
    color: #c7d2fe;
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

  /* Bounded, unlike the page itself. The rule against nested scroll boxes on
     this page is about the *document* — losing inertial scroll, the address
     bar's auto-hide and find-in-page for the reading content. This is control
     furniture, and 43 explained tags unrolled in place would push the grid a
     screenful down every time the panel opens. `60vh` before the `min()` for
     the usual reason: an engine that doesn't know `dvh` throws the whole
     declaration away and the cap disappears. */
  .tag-panel {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.8rem 0.9rem;
    border-radius: 0.6rem;
    border: 1px solid #22262f;
    background: #10131a;
    max-height: 60vh;
    max-height: min(60vh, 60dvh);
    overflow-y: auto;
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

  /* Same grid the 특성 cards use in the detail view — a tag should look the
     same wherever the reader meets it. */
  .tag-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.4rem;
  }

  .tag-card {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0.6rem;
    border-radius: 0.5rem;
    border: 1px solid #22262f;
    background: #14161c;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }

  .tag-card:hover:not(:disabled) {
    border-color: #3a4150;
  }

  .tag-card.on {
    background: #1e214f;
    border-color: #4f46e5;
  }

  /* Under AND semantics a tag no current result carries is a dead end, and the
     label alone gives no way to know that. Never disabled while selected, or a
     filter that emptied the grid could not be clicked off again. */
  .tag-card:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .tag-card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
  }

  .tag-card-name {
    font-size: 0.82rem;
    font-weight: 650;
    color: #a5b4fc;
  }

  .tag-card.on .tag-card-name {
    color: #c7d2fe;
  }

  .tag-card .n {
    color: #6b7684;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }

  .tag-card.on .n {
    color: #a5b4fc;
  }

  .tag-card-desc {
    font-size: 0.75rem;
    line-height: 1.45;
    color: #9aa4b2;
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

  @media (max-width: 520px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }

    /* Two columns, and the badge row wraps — the cards are taller here. */
    .grid > li {
      contain-intrinsic-size: auto 175px;
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

    /* Same argument as the tabs. The tag cards need no rule of their own — a
       label over a sentence is already well past 44px. */
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
