<script lang="ts">
  // 물질 카드 — one codex entry, drawn out in full: the hero drawing, the name
  // and its shelves, the description, the 수치 table, the 특성 cards and the
  // 반응 list.
  //
  // Two places show this. The guide page opens it in a dialog when a grid card
  // is clicked; the sandbox palette floats it beside a chip the pointer is
  // resting on. Neither is the "real" one — the card is the thing, and the shell
  // around it is the caller's business.
  //
  // What this component deliberately does NOT import is the codex prose
  // (i18n/codex.ts): the tag vocabulary and the description paragraph arrive as
  // props. That is not indirection for its own sake — it is what lets the
  // sandbox load those tables on demand instead of shipping ~68 KB of bilingual
  // encyclopedia to a page that mostly never opens a card at all. See
  // MaterialPalette's `loadCodexText` and the note in i18n/codex.ts.
  import type { Snippet } from 'svelte';
  import type {
    CodexCardData,
    CodexReaction,
    CodexStat,
    CodexTerm,
    CodexTrait,
  } from '../game/codex/types';
  import {
    reactionNotes as formatReactionNotes,
    statValue as formatStatValue,
  } from '../game/codex/format';
  import { t } from '../i18n';

  interface Props {
    card: CodexCardData;
    /** Words for a tag id (`key`, or `key.variant`) — `codexTerm` from
     *  i18n/codex, handed in rather than imported (see the note above). */
    term: (tagId: string) => CodexTerm;
    /** A material id's display name, for the `→` references and the reaction
     *  formulas. The two callers resolve the English fallback differently (one
     *  from its entry list, one from the live registry), so this is a prop too. */
    refName: (id: number) => string;
    /** Anything the caller wants in the header's right edge — the guide page's
     *  마크다운 복사 button. Rendered in the caller's own style scope, which is
     *  why only its box is styled here. */
    actions?: Snippet;
  }
  let { card, term, refName, actions }: Props = $props();

  const statValue = (s: CodexStat): string => formatStatValue(s, t);
  const notesOf = (r: CodexReaction): string[] => formatReactionNotes(r, t, refName);
  const termOf = (tr: CodexTrait): CodexTerm =>
    term(tr.variant === undefined ? tr.key : `${tr.key}.${tr.variant}`);
</script>

<div class="detail">
  <header>
    <!-- {@html} is safe here: the markup is generated from the material
         registry (a sprite reference or a `materialSvgFor` tile), never from
         user input. See CodexCardData.iconHtml. -->
    <span class="hero">{@html card.iconHtml}</span>
    <div class="titles">
      {#if card.sub !== '' && card.sub !== card.name}
        <p class="sub">{card.sub}</p>
      {/if}
      <span class="chip">{card.categoryName}</span>
      {#if card.phaseName !== null && card.phaseName !== card.categoryName}
        <span class="chip">{card.phaseName}</span>
      {/if}
    </div>
    {#if actions}
      <div class="actions">{@render actions()}</div>
    {/if}
  </header>

  <p class="desc">{card.desc}</p>
  {#if card.note}
    <p class="note">{card.note}</p>
  {/if}

  {#if card.stats.length > 0}
    <section>
      <h3>{t('codex.statsHeading')}</h3>
      <div class="table-wrap">
        <table>
          <tbody>
            {#each card.stats as s (s.key)}
              <tr>
                <th scope="row">
                  {term(s.key).label}
                  <span class="stat-desc">{term(s.key).desc}</span>
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

  {#if card.traits.length > 0}
    <section>
      <h3>{t('codex.traitsHeading')}</h3>
      <ul class="traits">
        {#each card.traits as tr (tr.key + (tr.variant ?? ''))}
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

  {#if card.reactions.length > 0}
    <section>
      <h3>{t('codex.reactionsHeading')}</h3>
      <ul class="reactions">
        {#each card.reactions as r, i (i)}
          <li class="reaction">
            <span class="formula">
              <span class="term self">{card.name}</span>
              <span class="plus">+</span>
              <span class="term">{refName(r.with)}</span>
              <span class="arrow">→</span>
              <span class="term out">{r.produce === undefined ? t('codex.reaction.unchanged') : refName(r.produce)}</span>
              {#if r.otherBecomes !== undefined}
                <span class="plus">+</span>
                <span class="term out">{refName(r.otherBecomes)}</span>
              {/if}
            </span>
            {#if notesOf(r).length > 0}
              <span class="notes">
                {#each notesOf(r) as note}<span class="note-chip">{note}</span>{/each}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  /* The card carries its own type scale rather than inheriting one, because its
     two shells disagree: the guide page's Modal body inherits the toolbar's
     compact 13px and the modal card's `user-select: none` — right for a settings
     sheet, wrong for a reference page — and the sandbox's floating panel comes
     from a sidebar that is compact on purpose. Both are turned back into
     document defaults here so the card reads the same in either. */
  .detail {
    font-size: 0.95rem;
    line-height: 1.5;
    user-select: text;
    color: #e0e6ed;
  }

  .detail header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }

  /* Pushed to the right of the title block, and allowed to drop to its own line
     rather than squeezing the name on a narrow phone. */
  .actions {
    margin-left: auto;
    flex: none;
  }

  .hero {
    display: block;
    width: 76px;
    height: 76px;
    flex: none;
    border-radius: 0.5rem;
    overflow: hidden;
    background: #0b0c10;
  }

  /* Whatever the caller handed over — a `<use>` into the guide page's sprite or
     an inline material tile — fills the box. */
  .hero :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  .titles .sub {
    margin: 0;
    color: #6b7684;
    font-size: 0.75rem;
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
    .hero {
      width: 56px;
      height: 56px;
    }
  }
</style>
