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

import { atom } from 'nanostores';
import type { ObjectKind } from '../state/store';
import { en as uiEn } from './ui.en';
import { ko as uiKo } from './ui.ko';
import { materialNamesEn, materialNamesKo, objectLabelsEn, objectLabelsKo, categoryLabelsEn, categoryLabelsKo } from './materials';

export type Locale = 'ko' | 'en';

export const LOCALES: readonly Locale[] = ['ko', 'en'];

/**
 * Detect the initial locale: a persisted choice wins, otherwise the browser's
 * language (anything starting with `ko` → Korean, everything else → English).
 * Safe under SSR / no-`navigator` (returns Korean, the project's default).
 */
function detectLocale(): Locale {
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of langs) {
      if (!l) continue;
      if (l.toLowerCase().startsWith('ko')) return 'ko';
      if (l.toLowerCase().startsWith('en')) return 'en';
    }
  }
  return 'ko';
}

/** The active UI locale. Persisted by state/persistence.ts; the initial value is
 *  the browser-detected one so the very first render is correct before
 *  hydration runs (no flash of the wrong language). */
export const $locale = atom<Locale>(detectLocale());

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
 * then the raw key. `params` fills `{placeholder}` tokens. Reading `$locale`
 * (via `$locale.get()`) keeps this in sync inside a Svelte `$derived` — callers
 * that want reactivity should access `$locale` in the same expression.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const loc = $locale.get();
  const tpl = lookup(UI_TABLES[loc], key) ?? lookup(uiEn, key) ?? key;
  return interpolate(tpl, params);
}

// --- Material / object / category display names -----------------------------
// Keyed by stable ids / keys (not English strings), so renaming a material's
// English `name` never orphans a translation. Falls back to the material's own
// `name` field (English) when no localized entry exists.

/** Display name of material `id` in the current locale (English `name` fallback). */
export function materialName(id: number, fallback?: string): string {
  const loc = $locale.get();
  const table = loc === 'ko' ? materialNamesKo : materialNamesEn;
  return table[id] ?? fallback ?? '?';
}

/** Display name of object `kind` in the current locale. */
export function objectLabel(kind: ObjectKind): string {
  const loc = $locale.get();
  const table = loc === 'ko' ? objectLabelsKo : objectLabelsEn;
  return table[kind];
}

/** Display label of a category `key` (stable id) in the current locale. */
export function categoryLabel(key: string): string {
  const loc = $locale.get();
  const table = loc === 'ko' ? categoryLabelsKo : categoryLabelsEn;
  return table[key] ?? key;
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
