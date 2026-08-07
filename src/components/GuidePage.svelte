<script lang="ts">
  // /guide's top-level shell: a tab switcher over two static documents — the
  // material codex (Codex.svelte) and the new game-systems guide
  // (GameGuideDoc.svelte). Split out of guide.astro rather than living there
  // because switching tabs is client-side state, and Astro frontmatter has
  // none.
  //
  // Deliberately thin: each tab keeps its own page-head (home link + h1) and
  // footer nav, so this component owns only the strip that picks between them
  // — not a shared layout the two would have to agree on.
  import type { CodexEntry, CodexTagGroup, ObjectCodexEntry } from '../game/codex/types';
  import Codex from './Codex.svelte';
  import GameGuideDoc from './GameGuideDoc.svelte';
  import { t } from '../i18n';

  interface Props {
    materials: CodexEntry[];
    objects: ObjectCodexEntry[];
    tagGroups: CodexTagGroup[];
  }
  let { materials, objects, tagGroups }: Props = $props();

  type GuideTab = 'materials' | 'basics';

  /** Deep-linkable via `?tab=basics` — read once on mount; SSR has no
   *  location, so it falls back to the materials tab (the page's long-standing
   *  default) until hydration. */
  function initialTab(): GuideTab {
    if (typeof location === 'undefined') return 'materials';
    return new URLSearchParams(location.search).get('tab') === 'basics' ? 'basics' : 'materials';
  }

  let tab = $state<GuideTab>(initialTab());

  /** Switching tabs is not navigation — `replaceState` keeps the click off the
   *  back-button stack (Back should leave /guide entirely, not step through
   *  tabs) while still making the current tab a shareable/refreshable link. */
  function pick(next: GuideTab): void {
    if (tab === next) return;
    tab = next;
    if (typeof history === 'undefined') return;
    const url = new URL(location.href);
    if (next === 'materials') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    history.replaceState(null, '', url);
  }
</script>

<div class="guide-shell">
  <nav class="guide-tabs" role="tablist" aria-label={t('codex.tabMaterials')}>
    <button
      role="tab"
      class="gtab"
      class:active={tab === 'materials'}
      aria-selected={tab === 'materials'}
      onclick={() => pick('materials')}
    >
      <i class="bi bi-grid-3x3-gap-fill" aria-hidden="true"></i>
      <span>{t('codex.tabMaterials')}</span>
    </button>
    <button
      role="tab"
      class="gtab"
      class:active={tab === 'basics'}
      aria-selected={tab === 'basics'}
      onclick={() => pick('basics')}
    >
      <i class="bi bi-info-circle-fill" aria-hidden="true"></i>
      <span>{t('codex.tabBasics')}</span>
    </button>
  </nav>

  {#if tab === 'materials'}
    <Codex {materials} {objects} {tagGroups} />
  {:else}
    <GameGuideDoc />
  {/if}
</div>

<style>
  .guide-shell {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .guide-tabs {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    max-width: 1100px;
    margin: 0 auto;
    width: 100%;
  }

  .gtab {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1.1rem;
    border: 1px solid #262a33;
    border-radius: 0.6rem;
    background: #14161c;
    color: #94a3b8;
    font: inherit;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .gtab:hover {
    border-color: #3a4150;
    color: #c7cede;
  }

  .gtab.active {
    background: #1d2333;
    border-color: #4f46e5;
    color: #e0e6ed;
  }

  .gtab i {
    font-size: 1rem;
  }

  @media (max-width: 480px) {
    .gtab span {
      display: none;
    }
    .gtab {
      padding: 0.6rem 0.75rem;
    }
  }
</style>
