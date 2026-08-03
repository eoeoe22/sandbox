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
 * Under SSR / prerender this returns Korean, the project's default.
 *
 * The `window` guard is what makes that true, and it is load-bearing rather than
 * belt-and-braces: `navigator` alone is NOT proof of a browser. Node has exposed
 * a lookalike since v21 whose `language` is the *build machine's* locale
 * ('en-US' on CI), so gating on it prerendered every page in English — a
 * Korean-first project shipping an English static shell to crawlers and to
 * anyone reading before hydration, under a hardcoded `<html lang="ko">`.
 */
function detectLocale(): Locale {
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
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
