// Accessors for the 물질 도감's own text: the description paragraph per material
// and object (codex.ko.ts / codex.en.ts) and the name plus explanation per tag
// (codexTerms.ts).
//
// These sit OUTSIDE `./index.ts` deliberately, and folding them back in — or
// re-exporting them from there for convenience — is a regression, not a tidy-up.
// `index.ts` is the barrel every island imports `t()` and `materialName()` from,
// so whatever it reaches becomes part of the chunk the bundler shares between
// those islands: the sandbox and the start screen would each download and parse
// the whole bilingual encyclopedia (~48 KB of source) that neither page ever
// renders. Only the guide page's island imports this module, so only the guide
// page pays for it. `test/run-codex.mjs` walks `index.ts`'s import graph and
// fails if the tables show up there again — the comment that used to claim this
// boundary went false without anyone noticing, which is why it is now checked.
//
// The descriptions fall back to Korean rather than to English, the opposite of
// `t()`. The Korean ones are the originals (they come from the Cloudwiki 물질
// guide), so a material whose English line hasn't been written yet should show
// the sentence that does exist rather than nothing at all.

import type { ObjectKind } from '../state/store';
import type { CodexTerm } from '../game/codex/types';
import { materialCodexEn, objectCodexEn } from './codex.en';
import { materialCodexKo, objectCodexKo } from './codex.ko';
import { codexTerms } from './codexTerms';
import { $locale } from './locale';
import { trackLocale } from './reactive.svelte';

/** Codex description of material `id` in the current locale. */
export function materialDescription(id: number): string {
  trackLocale();
  const table = $locale.get() === 'ko' ? materialCodexKo : materialCodexEn;
  return table[id] ?? materialCodexKo[id] ?? '';
}

/** Codex description of object `kind` in the current locale. */
export function objectDescription(kind: ObjectKind): string {
  trackLocale();
  const table = $locale.get() === 'ko' ? objectCodexKo : objectCodexEn;
  return table[kind] ?? objectCodexKo[kind] ?? '';
}

/**
 * Label and explanation for a codex stat row or trait card. `key` is the spec's
 * key from game/codex/stats.ts / traits.ts; a trait with a variant asks for
 * `${key}.${variant}`. An unknown key comes back as its own name so a missing
 * term shows up as a visible key rather than a blank card.
 *
 * There is no per-locale fallback to write here any more: one entry carries
 * every language, so a term that exists at all exists in both. Only a blank one
 * falls back to the Korean original — either half blank, since a card with a
 * heading and no sentence is the same hole as one with neither (test/codex.ts
 * fails on a blank either way).
 */
export function codexTerm(key: string): CodexTerm {
  trackLocale();
  const entry = codexTerms[key];
  if (entry === undefined) return { label: key, desc: '' };
  const term = entry[$locale.get()];
  return term.label.trim() === '' || term.desc.trim() === '' ? entry.ko : term;
}
