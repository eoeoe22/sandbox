// A Svelte signal that mirrors the `$locale` atom, so translation lookups made
// from markup re-render on a language switch.
//
// Why this exists: `t()` / `materialName()` / … read the locale with a plain
// `$locale.get()`. That is *not* a Svelte store read, so a template expression
// like `title={t('brush.shape')}` compiles to an effect with no dependency on
// the locale — it would keep the old language until something else happened to
// invalidate that effect. Whether a given label updated therefore came down to
// whether the compiler had grouped it into an effect that read `$locale` for
// some other reason (a `class:active={$locale === 'ko'}` next to it, say), which
// is not something call sites should have to reason about.
//
// Reading a module-level `$state` inside those functions fixes it at the source:
// every `t()` call, wherever it is written, now registers a dependency on this
// counter, and bumping the counter when the atom changes invalidates exactly the
// effects that rendered a translated string. Outside a Svelte effect (plain .ts
// callers, SSR) reading it is just a number — no behavior change.

// (Imported under a non-`$` alias: inside a `.svelte.ts` module Svelte reserves
// the `$` prefix for runes, so `$locale` isn't a legal local binding here.)
import { $locale as localeAtom } from './locale';

let version = $state(0);

localeAtom.listen(() => {
  version += 1;
});

/** Register the calling Svelte effect as a dependent of the active locale. */
export function trackLocale(): void {
  void version;
}
