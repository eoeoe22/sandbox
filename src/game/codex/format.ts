// How a codex number and a codex reaction read as text — and, on top of that,
// the 마크다운 복사 writers.
//
// The two halves are one file on purpose. A stat's unit suffix and a reaction's
// condition chips are the only places the codex turns raw extracted data into a
// sentence, and both the page and the clipboard need exactly that turn. Written
// twice they would drift, and the drift would be invisible: the copied text
// would simply say something slightly different from the screen it came from.
// So the page imports `statValue`/`reactionNotes` from here too, and the export
// is built out of the same calls the markup makes.
//
// Two export shapes, because two questions are being asked:
//
//   entryMarkdown  — one card, everything about it. The detail dialog already
//                    knows the whole answer; this writes it down.
//   listMarkdown   — the whole result set, as a summary table plus each entry's
//                    description. At 134 rows a full dump would be thousands of
//                    lines and nobody pastes that anywhere; a table of name /
//                    category / state / traits plus a paragraph each stays
//                    readable and is what a narrowed filter is *for* ("every
//                    acid-proof liquid, as notes").
//
// This module holds no i18n import of its own — it takes `t` and the lookups it
// needs from its caller. That is what keeps the prose tables behind Codex.svelte's
// single import site (see i18n/codex.ts and test/run-codex.mjs) while still
// letting test/codex.ts drive the whole thing headlessly with the real tables.

import type { CodexReaction, CodexStat, CodexTerm, CodexTrait } from './types';

/** `t()` from i18n, passed in rather than imported. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Trim a float to at most two decimals without leaving `1.00` behind. */
const trim = (n: number): string => String(Math.round(n * 100) / 100);

/** A stat's number with its unit — one row of the 수치 table, as text. */
export function statValue(s: CodexStat, t: Translate): string {
  switch (s.unit) {
    case 'temp':
      return `${trim(s.value)}${t('codex.unit.temp')}`;
    case 'chance':
      return `${trim(s.value * 100)}%`;
    case 'cells':
      return `${trim(s.value)}${t('codex.unit.cells')}`;
    case 'ticks':
      return `${trim(s.value)}${t('codex.unit.ticks')}`;
    case 'seconds':
      return `${trim(s.value)}${t('codex.unit.seconds')}`;
    default:
      return trim(s.value);
  }
}

/** The extra conditions on a reaction, as short chips. */
export function reactionNotes(
  r: CodexReaction,
  t: Translate,
  refName: (id: number) => string,
): string[] {
  const notes: string[] = [];
  if (r.probability !== undefined) notes.push(t('codex.reaction.chance', { v: `${trim(r.probability * 100)}%` }));
  if (r.tempMin !== undefined) notes.push(t('codex.reaction.tempMin', { v: trim(r.tempMin) }));
  if (r.tempMax !== undefined) notes.push(t('codex.reaction.tempMax', { v: trim(r.tempMax) }));
  if (r.heat !== undefined && r.heat > 0) notes.push(t('codex.reaction.exo', { v: trim(r.heat) }));
  if (r.heat !== undefined && r.heat < 0) notes.push(t('codex.reaction.endo', { v: trim(r.heat) }));
  if (r.byproduct !== undefined) notes.push(`${t('codex.reaction.byproduct')} ${refName(r.byproduct)}`);
  if (r.catalyst !== undefined) notes.push(`${t('codex.reaction.catalyst')} ${refName(r.catalyst)}`);
  return notes;
}

/** One entry, already localized — structurally what Codex.svelte's `Card` is. */
export interface CodexMarkdownEntry {
  name: string;
  /** English name, when the display name is something else. */
  sub: string;
  categoryName: string;
  /** 고체·가루·액체·기체, or null for an object (which has no phase). */
  phaseName: string | null;
  desc: string;
  stats: readonly CodexStat[];
  traits: readonly CodexTrait[];
  reactions: readonly CodexReaction[];
}

/** The localized lookups the writer borrows from the page. */
export interface CodexMarkdownText {
  t: Translate;
  /** Words for a tag id (`key`, or `key.variant`). */
  term: (tagId: string) => CodexTerm;
  /** A material id's display name. */
  refName: (id: number) => string;
  /** A tag id → its badge label. */
  tagLabel: (t: CodexTrait) => string;
}

/** What the list export says the reader is looking at. */
export interface CodexMarkdownContext {
  /** Human-readable filter summary lines ("카테고리: 액체"), already localized. */
  filters: string[];
  /** How many entries the codex has in total, for "34 of 134". */
  total: number;
}

/** A table cell: pipes would end the column early and a newline the row. */
const cell = (s: string): string => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/** `물 (Water)`, or just `물` when the two names are the same. */
const titleOf = (e: CodexMarkdownEntry): string =>
  e.sub !== '' && e.sub !== e.name ? `${e.name} (${e.sub})` : e.name;

function statsTable(e: CodexMarkdownEntry, tx: CodexMarkdownText): string[] {
  if (e.stats.length === 0) return [];
  return [
    `## ${tx.t('codex.statsHeading')}`,
    '',
    `| ${tx.t('codex.md.item')} | ${tx.t('codex.md.value')} |`,
    '| --- | --- |',
    ...e.stats.map((s) => {
      const ref = s.refId === undefined ? '' : ` → ${tx.refName(s.refId)}`;
      return `| ${cell(tx.term(s.key).label)} | ${cell(statValue(s, tx.t) + ref)} |`;
    }),
    '',
  ];
}

function traitList(e: CodexMarkdownEntry, tx: CodexMarkdownText): string[] {
  if (e.traits.length === 0) return [];
  return [
    `## ${tx.t('codex.traitsHeading')}`,
    '',
    ...e.traits.map((tr) => {
      const id = tr.variant === undefined ? tr.key : `${tr.key}.${tr.variant}`;
      const words = tx.term(id);
      const refs = [...(tr.refId === undefined ? [] : [tr.refId]), ...(tr.refIds ?? [])];
      const arrow = refs.length === 0 ? '' : ` → ${refs.map(tx.refName).join(', ')}`;
      return `- **${words.label}** — ${words.desc}${arrow}`;
    }),
    '',
  ];
}

function reactionList(e: CodexMarkdownEntry, tx: CodexMarkdownText): string[] {
  if (e.reactions.length === 0) return [];
  return [
    `## ${tx.t('codex.reactionsHeading')}`,
    '',
    ...e.reactions.map((r) => {
      const out =
        r.produce === undefined ? tx.t('codex.reaction.unchanged') : tx.refName(r.produce);
      const also = r.otherBecomes === undefined ? '' : ` + ${tx.refName(r.otherBecomes)}`;
      const notes = reactionNotes(r, tx.t, tx.refName);
      const tail = notes.length === 0 ? '' : ` (${notes.join(', ')})`;
      return `- ${e.name} + ${tx.refName(r.with)} → ${out}${also}${tail}`;
    }),
    '',
  ];
}

/** The 카테고리 · 상태 line under a title. The state is dropped when it just
 *  repeats the category — most materials are filed under their own phase, and
 *  "카테고리: 액체 · 상태: 액체" is noise on every one of them. The same rule the
 *  detail dialog's chips follow. */
const facts = (e: CodexMarkdownEntry, tx: CodexMarkdownText): string => {
  const parts = [`${tx.t('codex.md.category')}: ${e.categoryName}`];
  if (e.phaseName !== null && e.phaseName !== e.categoryName) {
    parts.push(`${tx.t('codex.md.phase')}: ${e.phaseName}`);
  }
  return parts.join(' · ');
};

/** One entry as a standalone document — the detail dialog, written down. */
export function entryMarkdown(e: CodexMarkdownEntry, tx: CodexMarkdownText): string {
  return [
    `# ${titleOf(e)}`,
    '',
    facts(e, tx),
    '',
    e.desc,
    '',
    ...statsTable(e, tx),
    ...traitList(e, tx),
    ...reactionList(e, tx),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
}

/**
 * The visible result set: one summary table, then each entry's description.
 *
 * The traits column carries every tag rather than the card's first three — the
 * grid truncates because it has 190px, and a text file doesn't. Filtering down
 * to "acid-proof liquids" and then losing 내산성 to a `+3` would defeat the
 * point of copying it out.
 */
export function listMarkdown(
  entries: readonly CodexMarkdownEntry[],
  tx: CodexMarkdownText,
  ctx: CodexMarkdownContext,
): string {
  const head = [
    `# ${tx.t('codex.title')}`,
    '',
    tx.t('codex.md.shown', { n: entries.length, total: ctx.total }),
    // Each summary part already carries its own "축: 값" label, so the heading
    // is joined with a dash rather than a second colon.
    ...(ctx.filters.length === 0 ? [] : [`${tx.t('codex.md.filters')} — ${ctx.filters.join(' · ')}`]),
    '',
  ];

  if (entries.length === 0) return [...head, tx.t('codex.empty'), ''].join('\n');

  const table = [
    `| ${tx.t('codex.md.name')} | ${tx.t('codex.md.category')} | ${tx.t('codex.md.phase')} | ${tx.t('codex.traitsHeading')} |`,
    '| --- | --- | --- | --- |',
    ...entries.map((e) =>
      [
        '',
        cell(titleOf(e)),
        cell(e.categoryName),
        cell(e.phaseName ?? '—'),
        cell(e.traits.map(tx.tagLabel).join(', ') || '—'),
        '',
      ].join(' | ').trim(),
    ),
    '',
  ];

  const bodies = entries.flatMap((e) => [`## ${titleOf(e)}`, '', facts(e, tx), '', e.desc, '']);

  return [...head, ...table, '---', '', ...bodies].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
