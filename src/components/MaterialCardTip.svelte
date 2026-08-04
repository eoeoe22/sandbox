<script lang="ts">
  // 물질 카드 (인게임) — the guide page's detail card, floated beside the palette
  // chip the pointer is resting on.
  //
  // The point is that it is not a second, shorter description written for the
  // sidebar: it is `CodexCard`, the same component the /guide dialog opens, fed
  // from the same extraction (`codexEntryFor`) and the same prose tables. A
  // material's numbers, tags and reactions therefore cannot drift between the
  // two — there is only one of them.
  //
  // Two things it does that the guide page doesn't have to:
  //
  //  • The prose tables arrive by dynamic import (see i18n/codexLazy), so the
  //    sandbox doesn't ship 68 KB of encyclopedia to a session that never hovers
  //    a chip. Until they land the card simply isn't rendered — a beat's wait on
  //    the very first hover, nothing afterwards.
  //  • It draws its own icon instead of pointing into a sprite. The guide page
  //    has 134 drawings in one document and every `<use>` shares them; the
  //    sandbox has no sprite, and the palette already inlines `materialSvgFor`
  //    per chip, so one more copy for the open card costs a string.
  //
  // Two presentations, because two pointers.
  //
  //  • **hover** (mouse) — a floating panel beside the chip, purely passive
  //    (`pointer-events: none`), so it can never swallow a click meant for the
  //    chip underneath and never has to keep itself alive against the flyout's
  //    own hover bookkeeping. The price is that a very long card clips at the
  //    bottom rather than scrolling — the full one is a click away in /guide.
  //  • **sheet** (touch) — the same card in an 오프캔버스 panel, opened by a long
  //    press. A finger has no way to *rest* on something, so there is no hover to
  //    borrow; the card has to be asked for and then dismissed, which means it
  //    needs a scrim, an × and a way out. That is `Modal variant="offcanvas"`
  //    already, so this borrows it rather than growing its own. Being a real
  //    panel it also scrolls, so nothing clips here.
  //
  // The card itself, the extraction and the lazy prose are shared — only the
  // frame around them differs.
  import type { Material } from '../game/engine/types';
  import type { CodexCardData } from '../game/codex/types';
  import { EMPTY } from '../game/engine/types';
  import { codexEntryFor } from '../game/codex/entries';
  import { getMaterial } from '../game/materials';
  import { materialSvgFor } from '../game/render/materialSvg';
  import { $locale as locale, t, materialName, categoryLabel } from '../i18n';
  import { codexTextNow, loadCodexText, type CodexText } from '../i18n/codexLazy';
  import CodexCard from './CodexCard.svelte';
  import Modal from './Modal.svelte';

  interface Props {
    /** The material to describe, or null when there is nothing to show. */
    material: Material | null;
    /** Present as an 오프캔버스 sheet (touch long-press) instead of a floating
     *  hover panel. `anchor` is ignored in this mode — the panel docks to the
     *  edge rather than hanging off the chip. */
    sheet?: boolean;
    /** The box to sit beside, in viewport coordinates. The palette hands over
     *  the open flyout's rect rather than the chip's when the chip is inside one
     *  — a card that covered the very list it is describing would be worse than
     *  useless, and anchoring to the panel also stops it jumping chip to chip. */
    anchor: DOMRect | null;
    /** Dismissal (×, scrim, Escape). Sheet mode only — the hover panel has no
     *  controls of its own and is closed by the pointer leaving. */
    onclose?: () => void;
  }
  let { material, anchor, sheet = false, onclose }: Props = $props();

  // Already loaded by an earlier hover (module-level cache) → render on the
  // first frame; otherwise null until the import lands.
  let text = $state<CodexText | null>(codexTextNow());

  $effect(() => {
    if (material === null || text !== null) return;
    let alive = true;
    // No card if the fetch fails, and no unhandled rejection either. The next
    // hover retries from scratch — `loadCodexText` doesn't cache a failure.
    void loadCodexText().then(
      (mod) => {
        if (alive) text = mod;
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  });

  /** A material named by a stat, a trait or a reaction. Mirrors Codex.svelte's
   *  own `refName`, including the reason Empty is spelled out in words: it is a
   *  real answer ("leaves nothing behind"), but to `materialName` it is the
   *  eraser, and "→ 지우개" is not what happened. The English fallback comes off
   *  the live registry here rather than off a props list — an id the palette
   *  doesn't list (Debris, a heat ray) still has a `Material` to name. */
  function refName(id: number): string {
    void $locale;
    if (id === EMPTY) return t('codex.nothing');
    const m = getMaterial(id);
    return materialName(id, m?.name ?? String(id));
  }

  /** The card and the tag vocabulary it renders with, or null while there is
   *  nothing to show — one derived value rather than two, so the markup can't
   *  reach for the words before the tables have landed. */
  const view = $derived.by<{ card: CodexCardData; term: CodexText['codexTerm'] } | null>(() => {
    void $locale;
    const m = material;
    const tx = text;
    if (m === null || tx === null) return null;
    const entry = codexEntryFor(m);
    const card: CodexCardData = {
      name: materialName(m.id, m.name),
      sub: m.name,
      categoryName: categoryLabel(entry.category),
      // The four phase keys double as the first four category keys, so the state
      // chip reuses the label the palette already has for it. CodexCard drops it
      // when it just repeats the category, which is most materials.
      phaseName: categoryLabel(entry.phase),
      desc: tx.materialDescription(m.id),
      stats: entry.stats,
      traits: entry.traits,
      reactions: entry.reactions,
      iconHtml: materialSvgFor(m),
    };
    return { card, term: tx.codexTerm };
  });

  /** The sheet's header name. Derived separately from `view` because it does NOT
   *  need the prose tables — which is the point: a long press has to open
   *  something *now*, so the panel goes up with its title and fills in the body
   *  when the chunk lands (first press of a session only). The hover panel makes
   *  the opposite trade and waits, because a tooltip that pops up empty and then
   *  reflows under a resting pointer is worse than one that arrives a beat late. */
  const sheetTitle = $derived.by(() => {
    void $locale;
    return material === null ? '' : materialName(material.id, material.name);
  });

  // --- Placement ------------------------------------------------------------
  // Same problem the category flyout has (the sidebar sets `backdrop-filter` and
  // `overflow-y: auto`, which clips even a fixed-position descendant), so the
  // same answer: move the node to <body> and place it by hand.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  const GAP = 10;
  const EDGE = 8;

  let el = $state<HTMLDivElement | null>(null);
  let pos = $state<{ top: number; left: number } | null>(null);
  /** Whether the card ran past `max-height`, so the fade that says so is only
   *  drawn when there is actually something cut off below it. */
  let clipped = $state(false);

  /** Beside the anchor — to its right on the desktop layout, to its left when
   *  the right side has no room (a wide flyout, or a narrow window). Vertically
   *  it starts level with the anchor and slides up only as far as it must to
   *  stay on screen, so a tall card doesn't cover the palette it came from. */
  function place(): void {
    const box = el;
    const a = anchor;
    if (box === null || a === null) {
      pos = null;
      return;
    }
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    clipped = box.scrollHeight > box.clientHeight + 1;
    const right = a.right + GAP;
    const left = right + w <= window.innerWidth - EDGE ? right : a.left - GAP - w;
    const maxLeft = Math.max(EDGE, window.innerWidth - EDGE - w);
    const maxTop = Math.max(EDGE, window.innerHeight - EDGE - h);
    pos = {
      left: Math.min(Math.max(EDGE, left), maxLeft),
      top: Math.min(Math.max(EDGE, a.top), maxTop),
    };
  }

  // Re-place whenever what's shown or where it hangs changes. `place()` reads the
  // rendered size, which is only known after the card's own DOM exists — hence
  // the two passes (null position → measure → settle), the same convergence the
  // palette's flyout relies on. `card` is in the dependency list because the
  // height follows the content.
  $effect(() => {
    if (sheet) return; // the panel docks to the edge; nothing to measure
    void view;
    void anchor;
    void el;
    place();
  });
</script>

{#if sheet}
  {#if material !== null}
    <!-- 오프캔버스. The shared Modal already owns the scrim, the ×, Escape, the
         focus trap and the "a tap beside it dismisses, and doesn't fall through
         to whatever is underneath" release test — the three ways out the long
         press needs. -->
    <Modal open variant="offcanvas" title={sheetTitle} onclose={onclose ?? (() => {})} width={420}>
      {#if view !== null}
        <CodexCard card={view.card} term={view.term} {refName} />
      {:else}
        <p class="loading">{t('palette.cardLoading')}</p>
      {/if}
    </Modal>
  {/if}
{:else if view !== null && anchor !== null}
  <!-- Off-screen until measured, rather than hidden: `visibility: hidden` would
       still let it paint at the wrong spot for a frame on a slow layout. -->
  <div
    class="tip"
    class:clipped
    use:portal
    bind:this={el}
    role="tooltip"
    aria-hidden="true"
    style={`top:${pos?.top ?? -9999}px; left:${pos?.left ?? -9999}px`}
  >
    <CodexCard card={view.card} term={view.term} {refName} />
  </div>
{/if}

<style>
  /* Only ever visible for the beat between a long press and the prose chunk
     arriving, and only on the first press of a session. */
  .loading {
    margin: 0;
    padding: 1rem 0;
    color: #6b7684;
    text-align: center;
  }

  .tip {
    position: fixed;
    z-index: 30; /* above the category flyout (20), which it sits beside */
    width: 340px;
    max-width: calc(100vw - 16px);
    /* Tall enough for nearly every card; the few that overrun clip rather than
       scroll, because the panel takes no pointer events (see the note above). */
    max-height: min(78vh, 620px);
    overflow: hidden;
    padding: 12px 14px;
    background: rgba(11, 12, 16, 0.97);
    backdrop-filter: blur(6px);
    border: 1px solid #2a2a33;
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  /* A card that overran its box shouldn't end mid-word with no sign that it did.
     Sits above the content, takes no pointer events (nothing here does). */
  .tip.clipped::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 28px;
    background: linear-gradient(to bottom, rgba(11, 12, 16, 0), rgba(11, 12, 16, 0.97));
  }
</style>
