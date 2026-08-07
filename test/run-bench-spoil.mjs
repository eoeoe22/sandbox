// Bundles and runs the 부패 **performance** harness (test/bench-spoil.ts) under
// Node, stubbing the browser-only `?url` wasm import exactly like run-spoil.mjs
// does. This one prints timings and never fails — it is the thing to run when a
// change touches `spoil.ts` 의 잠김 광선, not a pass/fail gate.
// Run: `npm run bench:spoil`.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'node_modules', '.cache', 'bench.bundle.mjs');

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
  entryPoints: [join(__dirname, 'bench-spoil.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  plugins: [wasmUrlStub],
  logLevel: 'warning',
});

await import(pathToFileURL(out).href);
