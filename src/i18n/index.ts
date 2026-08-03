// Lightweight i18n built on the existing nanostores atoms, so a Svelte
// component can `import { $locale as locale }` and use `$locale` directly (the
// nanostores atom already satisfies Svelte's store contract). No extra
// dependency — this project is small enough (UI strings + material/category
// names) that a `t()` helper over two translation tables is all it needs.
//
// English (`ui.en`) is the source of truth for the UI keyset. The Korean table
// (`ui.ko`) mirrors it; a missing key falls back to English, then to the key
// itself, so a stale translation never blanks the UI.
//
// Material / category / object names live in `materials.ko` / `materials.en`
// (keyed by stable ids / keys, not by English strings) and are exposed via the
// `materialName` / `objectLabel` / `categoryLabel` helpers below.

import type { ObjectKind } from '../state/store';
import { en as uiEn } from './ui.en';
import { ko as uiKo } from './ui.ko';
import { materialNamesEn, materialNamesKo, objectLabelsEn, objectLabelsKo, categoryLabelsEn, categoryLabelsKo } from './materials';
import { materialCodexEn, objectCodexEn } from './codex.en';
import { materialCodexKo, objectCodexKo } from './codex.ko';
import { codexTerms } from './codexTerms';
import type { CodexTerm } from '../game/codex/types';
import { $locale, LOCALES, type Locale } from './locale';
import { trackLocale } from './reactive.svelte';

// The atom itself lives in `./locale` so `./reactive.svelte` can mirror it into
// a Svelte signal without an import cycle; re-exported here so `../i18n` stays
// the single import site for the rest of the app.
export { $locale, LOCALES };
export type { Locale };

const UI_TABLES: Record<Locale, unknown> = {
  ko: uiKo,
  en: uiEn,
};

/** Resolve a dotted key path (`'tool.brush.material'`) against a nested object. */
function lookup(table: unknown, key: string): string | undefined {
  if (!table) return undefined;
  let cur: unknown = table;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Replace `{name}`-style placeholders in a translation string. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in params ? String(params[k]) : `{${k}}`,
  );
}

/**
 * Translate a dotted UI key under the current locale, falling back to English
 * then the raw key. `params` fills `{placeholder}` tokens. `trackLocale()` makes
 * the call reactive on its own: used from markup or a `$derived`, the enclosing
 * effect re-runs on a language switch with no `$locale` bookkeeping at the call
 * site (see reactive.svelte.ts).
 */
export function t(key: string, params?: Record<string, string | number>): string {
  trackLocale();
  const loc = $locale.get();
  const tpl = lookup(UI_TABLES[loc], key) ?? lookup(uiEn, key) ?? key;
  return interpolate(tpl, params);
}

// --- Material / object / category display names -----------------------------
// Keyed by stable ids / keys (not English strings), so renaming a material's
// English `name` never orphans a translation. Falls back to the material's own
// `name` field (English) when no localized entry exists. Each one calls
// `trackLocale()` for the same reason `t()` does.

/** Display name of material `id` in the current locale (English `name` fallback). */
export function materialName(id: number, fallback?: string): string {
  trackLocale();
  const loc = $locale.get();
  const table = loc === 'ko' ? materialNamesKo : materialNamesEn;
  return table[id] ?? fallback ?? '?';
}

/** Display name of object `kind` in the current locale. */
export function objectLabel(kind: ObjectKind): string {
  trackLocale();
  const loc = $locale.get();
  const table = loc === 'ko' ? objectLabelsKo : objectLabelsEn;
  return table[kind];
}

/** Display label of a category `key` (stable id) in the current locale. */
export function categoryLabel(key: string): string {
  trackLocale();
  const loc = $locale.get();
  const table = loc === 'ko' ? categoryLabelsKo : categoryLabelsEn;
  return table[key] ?? key;
}

// --- 물질 도감 text ----------------------------------------------------------
// The codex's own vocabulary: a paragraph per material/object (codex.ko.ts /
// codex.en.ts, one file per language because each entry is prose about one
// thing) and a name plus an explanation per tag (codexTerms.ts, one file for
// both languages because a tag's wording is shared vocabulary and gets reworded
// in both at once). Kept apart from the tables above because it is bulk prose —
// only the guide page imports these, so the sandbox never pays for them.
//
// The descriptions fall back to Korean rather than to English, the opposite of
// `t()`. The Korean ones are the originals (they come from the Cloudwiki 물질
// guide), so a material whose English line hasn't been written yet should show
// the sentence that does exist rather than nothing at all.

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
 * falls back to the Korean original (test/codex.ts fails on a blank either way).
 */
export function codexTerm(key: string): CodexTerm {
  trackLocale();
  const entry = codexTerms[key];
  if (entry === undefined) return { label: key, desc: '' };
  const term = entry[$locale.get()];
  return term.label.trim() === '' ? entry.ko : term;
}

// --- <html lang> sync -------------------------------------------------------
// Keep document.documentElement.lang in lockstep with the active locale so
// screen readers / browser features pick the right language. Runs once on first
// subscription and re-runs whenever `$locale` changes.
let htmlLangSynced = false;
/** Wire up `<html lang>` syncing. Call once on app startup (idempotent). */
export function syncHtmlLang(): void {
  if (htmlLangSynced) return;
  htmlLangSynced = true;
  const apply = () => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = $locale.get();
    }
  };
  apply();
  $locale.listen(apply);
}
