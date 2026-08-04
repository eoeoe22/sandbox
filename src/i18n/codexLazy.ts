// The codex prose, fetched on demand.
//
// `./codex.ts` reaches the two description tables and the tag vocabulary — about
// 68 KB of bilingual source that the guide page renders and nothing else did.
// Then the sandbox grew a 물질 카드 on palette hover, which needs exactly those
// words. Importing them there statically would put the whole encyclopedia in the
// sandbox island's bundle, downloaded and parsed before the first frame, for a
// panel most sessions never open — the same weight the boundary in `codex.ts`
// was drawn to keep out, walked back in through a different door.
//
// So the sandbox asks for them the first time a pointer settles on a chip. One
// dynamic import means one extra chunk, fetched once and cached here for the
// rest of the session; the guide page is untouched (it still imports `./codex`
// directly, and paying up front is right for a page that is nothing but this
// text).
//
// The cache is module-level rather than per-component because the palette
// remounts — a language switch, a control-panel re-render — and a second fetch
// of a chunk the browser already has would still cost a render pass with no card
// in it.

export type CodexText = typeof import('./codex');

let cached: CodexText | null = null;
let pending: Promise<CodexText> | null = null;

/** The tables if they're already here, or null. Lets a caller render the card on
 *  the very first frame once something else has loaded them. */
export function codexTextNow(): CodexText | null {
  return cached;
}

/**
 * Fetch the tables (or hand back the in-flight promise / the cached module).
 * Safe to call on every hover: after the first one it is a resolved promise.
 *
 * A failure clears `pending` rather than caching it. Holding the rejected
 * promise would make one bad fetch permanent — a network blip, or a chunk hash
 * that went stale under a tab left open across a deploy — and every hover for
 * the rest of the session would get the same dead promise back with no retry.
 * The next hover is exactly the moment to try again.
 */
export function loadCodexText(): Promise<CodexText> {
  if (cached !== null) return Promise.resolve(cached);
  pending ??= import('./codex').then(
    (mod) => {
      cached = mod;
      return mod;
    },
    (err) => {
      pending = null;
      throw err;
    },
  );
  return pending;
}
