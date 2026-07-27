// The active-locale atom, split out from `index.ts` so the Svelte-signal mirror
// in `reactive.svelte.ts` can import it without a module cycle (index.ts imports
// that mirror to make `t()` and friends reactive). Everything here is re-exported
// from `./index`, which stays the module the rest of the app imports from.

import { atom } from 'nanostores';

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
