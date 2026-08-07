// Bundles and runs the object heat-model harness (test/objectheat.ts) under
// Node, stubbing the browser-only `?url` wasm import exactly like
// run-active-tiles.mjs does. Run: `node test/run-objectheat.mjs`.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'node_modules', '.cache', 'objectheat.bundle.mjs');

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
  entryPoints: [join(__dirname, 'objectheat.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  plugins: [wasmUrlStub],
  logLevel: 'warning',
});

await import(pathToFileURL(out).href);
