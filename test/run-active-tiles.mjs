// Bundles and runs the active-tile equivalence harness (test/active-tiles.ts)
// under Node. The engine imports the committed heat.wasm via Vite's `?url`
// suffix, which is browser-only; the harness never calls initHeatWasm (so the
// sim uses the JS heat path in both runs), we just stub that import so esbuild
// can bundle. Run: `node test/run-active-tiles.mjs`.

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'node_modules', '.cache', 'active-tiles.bundle.mjs');

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

await build({
  entryPoints: [join(__dirname, 'active-tiles.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  plugins: [wasmUrlStub],
  logLevel: 'warning',
});

await import(pathToFileURL(out).href);
