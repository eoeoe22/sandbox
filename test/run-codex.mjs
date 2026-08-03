// Bundles and runs the 도감 harness (test/codex.ts) under Node, stubbing the
// browser-only `?url` wasm import exactly like run-phasechange.mjs does.
// Run: `node test/run-codex.mjs`.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'node_modules', '.cache', 'codex.bundle.mjs');

const wasmUrlStub = {
  name: 'wasm-url-stub',
  setup(b) {
    b.onResolve({ filter: /\.wasm\?url$/ }, (args) => ({ path: args.path, namespace: 'wasm-url' }));
    b.onLoad({ filter: /.*/, namespace: 'wasm-url' }, () => ({
      contents: 'export default "heat.wasm";',
      loader: 'js',
    }));
  },
};

// The codex reads the i18n tables, and `src/i18n/index.ts` imports the Svelte
// signal that makes a lookup re-render on a language switch. That file is a
// `.svelte.ts` rune module — real code to Vite, a syntax error to esbuild. Its
// own header says a non-Svelte caller reading the signal is "just a number, no
// behavior change", which is exactly this harness, so the stub is the honest
// form of what it already does here.
const runeStub = {
  name: 'svelte-rune-stub',
  setup(b) {
    b.onResolve({ filter: /reactive\.svelte$/ }, (args) => ({
      path: args.path,
      namespace: 'rune-stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'rune-stub' }, () => ({
      contents: 'export function trackLocale() {}',
      loader: 'js',
    }));
  },
};

// ── The bundle boundary the sandbox's weight depends on ────────────────────
// `src/i18n/index.ts` is the barrel every island imports `t()` and
// `materialName()` from, so anything it reaches is in the chunk the bundler
// shares between them — and the codex's prose is ~48 KB of source that only the
// guide page ever renders. It was moved out to `src/i18n/codex.ts` after a build
// showed the sandbox and the start screen both downloading it; the comment that
// claimed the boundary had been false for as long as it existed, because nothing
// checked. This checks: walk the barrel's import graph and fail if a text table
// is in it. (Reaching it from an island directly would slip past — this pins the
// mistake that actually happened, which is the barrel quietly growing.)
const barrel = await build({
  entryPoints: [join(__dirname, '..', 'src', 'i18n', 'index.ts')],
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  plugins: [runeStub],
  logLevel: 'warning',
});
const leaked = Object.keys(barrel.metafile.inputs).filter((p) =>
  /src[\\/]i18n[\\/](codex\.(ko|en)|codexTerms)\.ts$/.test(p),
);
if (leaked.length > 0) {
  console.log(
    `FAIL  the shared i18n barrel must not reach the codex text tables — ${leaked.join(', ')}`,
  );
  console.log('\nImport them from src/i18n/codex.ts at the one place that renders them.');
  process.exit(1);
}
console.log('PASS  the shared i18n barrel does not reach the codex text tables');

await build({
  entryPoints: [join(__dirname, 'codex.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  plugins: [wasmUrlStub, runeStub],
  logLevel: 'warning',
});

await import(pathToFileURL(out).href);
