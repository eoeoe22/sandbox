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
