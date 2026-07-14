// Phase 0 kernel micro-benchmark: JS reference vs. Rust/WASM heat kernel.
//
// The in-app profiler (`?perf`) tells us how big a slice of the tick heat
// diffusion is; this tells us how much faster the WASM kernel runs the *same*
// work than the JS loop it replaced. Together they answer the gating question
// for the next step (SIMD): is the heat pass a big enough slice, and is the
// scalar kernel already close enough to memory-bound that SIMD would help?
//
// Measures steady-state throughput (Mcell·substep / s) for both paths across a
// few grid sizes, mirroring the real host: buffers are allocated once and
// diffuse_heat runs all substeps per call. Run: `node wasm/bench/heat-bench.mjs`
// (needs the release wasm built — `bash wasm/build.sh` or cargo build).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, '..', 'heat', 'target', 'wasm32-unknown-unknown', 'release', 'heat.wasm');

const RATE = 0.2; // HEAT_DIFFUSION_RATE
const SUBSTEPS = 3; // HEAT_DIFFUSION_SUBSTEPS
const AMBIENT_MIX = true;

// --- JS reference: a faithful copy of Simulation.diffuseHeat, run SUBSTEPS
// times with buffer swapping, exactly like Simulation.step(). ---
function diffuseHeatJsOnce(cells, cond, cur, next, w, h, rate) {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const ci = cond[cells[i]];
      const ti = cur[i];
      if (ci === 0) {
        next[i] = ti;
        continue;
      }
      let acc = ti;
      if (x > 0) {
        const cj = cond[cells[i - 1]];
        acc += rate * (ci < cj ? ci : cj) * (cur[i - 1] - ti);
      }
      if (x < w - 1) {
        const cj = cond[cells[i + 1]];
        acc += rate * (ci < cj ? ci : cj) * (cur[i + 1] - ti);
      }
      if (y > 0) {
        const cj = cond[cells[i - w]];
        acc += rate * (ci < cj ? ci : cj) * (cur[i - w] - ti);
      }
      if (y < h - 1) {
        const cj = cond[cells[i + w]];
        acc += rate * (ci < cj ? ci : cj) * (cur[i + w] - ti);
      }
      next[i] = acc;
    }
  }
}

function diffuseHeatJs(cells, cond, temp, scratch, w, h, rate, substeps) {
  let cur = temp;
  let next = scratch;
  for (let s = 0; s < substeps; s++) {
    diffuseHeatJsOnce(cells, cond, cur, next, w, h, rate);
    const t = cur;
    cur = next;
    next = t;
  }
  // Leave the latest field in `temp`, like the kernel does.
  if (cur !== temp) temp.set(cur);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A realistic-ish field: ~15% insulator ids (air) so the ci===0 early-out fires
// like it does in play, the rest conductive, temperatures spanning cold to hot.
function buildCase(w, h) {
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n);
  const cond = new Float32Array(256);
  const rnd = mulberry32(0x51ed ^ (w * 2654435761));
  cond[0] = 0;
  for (let id = 1; id < 256; id++) cond[id] = rnd() < 0.15 ? 0 : rnd();
  for (let i = 0; i < n; i++) {
    cells[i] = (rnd() * 256) | 0;
    temp[i] = AMBIENT_MIX ? rnd() * 2200 - 200 : 20;
  }
  return { cells, cond, temp };
}

const wasm = await WebAssembly.instantiate(readFileSync(WASM_PATH), {});
const { memory, diffuse_heat, heat_alloc } = wasm.instance.exports;

// Mirror the host allocator: reserve regions once, reuse across calls.
function makeWasmRunner(cells, cond, temp, w, h) {
  const n = w * h;
  const cellsPtr = heat_alloc(n);
  const condPtr = heat_alloc(256 * 4);
  const tempPtr = heat_alloc(n * 4);
  const scratchPtr = heat_alloc(n * 4);
  new Uint8Array(memory.buffer, cellsPtr, n).set(cells);
  new Float32Array(memory.buffer, condPtr, 256).set(cond);
  const tempView = new Float32Array(memory.buffer, tempPtr, n);
  tempView.set(temp);
  return () => diffuse_heat(cellsPtr, condPtr, tempPtr, scratchPtr, w, h, RATE, SUBSTEPS);
}

function timeIt(fn, iters) {
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return performance.now() - t0;
}

// Auto-tune iteration count so each measured burst runs long enough (~250ms) to
// be stable regardless of grid size and machine speed.
function bench(label, fn) {
  fn(); // warm up
  let iters = 8;
  while (timeIt(fn, iters) < 60) iters *= 2;
  const ms = timeIt(fn, iters);
  return { label, iters, ms, perCall: ms / iters };
}

const sizes = [
  [90, 51], // ~1/16 grid
  [180, 101], // ~1/4 grid
  [360, 203], // default sandbox (73k cells)
  [600, 400], // near MAX_CELLS ceiling
];

console.log(`Heat kernel bench — JS vs Rust/WASM, ${SUBSTEPS} substeps/call\n`);
const head = ['grid', 'cells', 'JS ms/tick', 'WASM ms/tick', 'speedup', 'WASM Mcell·ss/s'];
const rows = [head];
for (const [w, h] of sizes) {
  const n = w * h;
  const { cells, cond, temp } = buildCase(w, h);
  const jsTemp = temp.slice();
  const jsScratch = new Float32Array(n);
  const js = bench('js', () => diffuseHeatJs(cells, cond, jsTemp, jsScratch, w, h, RATE, SUBSTEPS));
  const run = makeWasmRunner(cells, cond, temp, w, h);
  const ws = bench('wasm', run);
  const speedup = js.perCall / ws.perCall;
  const throughput = (n * SUBSTEPS) / (ws.perCall / 1000) / 1e6;
  rows.push([
    `${w}×${h}`,
    String(n),
    js.perCall.toFixed(3),
    ws.perCall.toFixed(3),
    `${speedup.toFixed(2)}×`,
    throughput.toFixed(1),
  ]);
}

// Fixed-width table print.
const widths = head.map((_, c) => Math.max(...rows.map((r) => r[c].length)));
for (const r of rows) {
  console.log(r.map((cell, c) => cell.padStart(widths[c])).join('  '));
}
console.log('\nms/tick = time for all substeps of one tick; lower is better.');
