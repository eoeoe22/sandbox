// Bundles and runs the electricity packing harness (test/electricity.ts) under
// Node, the same way run-active-tiles.mjs does: the engine imports the committed
// heat.wasm via Vite's `?url` suffix, which is browser-only, so we stub that
// import for esbuild. The harness never initializes the wasm heat path.
//
// This harness also reaches into src/state/persistence.ts, which pulls in the
// i18n module and through it `reactive.svelte.ts` — a Svelte runes module whose
// `$state` only exists after the Svelte compiler has run. Nothing here renders
// markup, so that module is stubbed with its one export as a no-op rather than
// dragging the Svelte toolchain into a Node test.
// Run: `node test/run-electricity.mjs`.

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'node_modules', '.cache', 'electricity.bundle.mjs');

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

const runesStub = {
  name: 'svelte-runes-stub',
  setup(b) {
    b.onResolve({ filter: /reactive\.svelte$/ }, (args) => ({
      path: args.path,
      namespace: 'svelte-runes',
    }));
    b.onLoad({ filter: /.*/, namespace: 'svelte-runes' }, () => ({
      contents: 'export function trackLocale() {}',
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [join(__dirname, 'electricity.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  plugins: [wasmUrlStub, runesStub],
  logLevel: 'warning',
});

await import(pathToFileURL(out).href);
