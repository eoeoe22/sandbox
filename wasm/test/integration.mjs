// Integration test for the STATEFUL host plumbing in engine/heatWasm.ts:
// the persistent conductivity region, the grid-sized buffers that get freed and
// re-allocated on resize, and running many ticks in a row (as Simulation.step
// does). Mirrors heatWasm.ts's logic exactly and drives a mini multi-tick sim
// with mid-run grid resizes, asserting the WASM temperature field stays
// bit-identical to the JS reference at every tick.
//
// Run: `node wasm/test/integration.mjs`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, '..', 'heat', 'target', 'wasm32-unknown-unknown', 'release', 'heat.wasm');

const RATE = 0.2;
const SUBSTEPS = 3;

// --- JS reference (matches Simulation.diffuseHeat + step's substep loop),
// leaving the final field in `temp`. ---
function diffuseHeatJsInPlace(cells, cond, temp, scratch, w, h) {
  let cur = temp;
  let next = scratch;
  for (let s = 0; s < SUBSTEPS; s++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const ci = cond[cells[i]];
        const ti = cur[i];
        if (ci === 0) { next[i] = ti; continue; }
        let acc = ti;
        if (x > 0) { const cj = cond[cells[i - 1]]; acc += RATE * (ci < cj ? ci : cj) * (cur[i - 1] - ti); }
        if (x < w - 1) { const cj = cond[cells[i + 1]]; acc += RATE * (ci < cj ? ci : cj) * (cur[i + 1] - ti); }
        if (y > 0) { const cj = cond[cells[i - w]]; acc += RATE * (ci < cj ? ci : cj) * (cur[i - w] - ti); }
        if (y < h - 1) { const cj = cond[cells[i + w]]; acc += RATE * (ci < cj ? ci : cj) * (cur[i + w] - ti); }
        next[i] = acc;
      }
    }
    const t = cur; cur = next; next = t;
  }
  if (cur !== temp) temp.set(cur);
}

// --- A faithful clone of heatWasm.ts's stateful manager. ---
const wasm = await WebAssembly.instantiate(readFileSync(WASM_PATH), {});
const ex = wasm.instance.exports;
const condPtr = ex.heat_alloc(256 * 4);
let bufCells = 0, cellsPtr = 0, tempPtr = 0, scratchPtr = 0;

function ensureBuffers(n) {
  if (n === bufCells) return;
  if (bufCells > 0) {
    ex.heat_free(cellsPtr, bufCells);
    ex.heat_free(tempPtr, bufCells * 4);
    ex.heat_free(scratchPtr, bufCells * 4);
  }
  cellsPtr = ex.heat_alloc(n);
  tempPtr = ex.heat_alloc(n * 4);
  scratchPtr = ex.heat_alloc(n * 4);
  bufCells = n;
}

function diffuseHeatWasm(cells, cond, temp, w, h) {
  const n = w * h;
  ensureBuffers(n);
  const buf = ex.memory.buffer; // re-read after ensureBuffers (a grow detaches it)
  new Uint8Array(buf, cellsPtr, n).set(cells.subarray(0, n));
  new Float32Array(buf, condPtr, 256).set(cond.subarray(0, 256));
  new Float32Array(buf, tempPtr, n).set(temp.subarray(0, n));
  ex.diffuse_heat(cellsPtr, condPtr, tempPtr, scratchPtr, w, h, RATE, SUBSTEPS);
  temp.set(new Float32Array(buf, tempPtr, n));
}

// --- Deterministic setup. ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(0xbeef);
const cond = new Float32Array(256);
cond[0] = 0;
for (let id = 1; id < 256; id++) cond[id] = rnd() < 0.15 ? 0 : rnd();

// Bottom-left-anchored resize matching Grid.resize, applied identically to
// cells and both temperature fields so the two worlds stay in lockstep.
function resizeWorld(w, h, nw, nh, cells, wasmTemp, jsTemp) {
  const nCells = new Uint8Array(nw * nh);
  const nWasm = new Float32Array(nw * nh).fill(20);
  const nJs = new Float32Array(nw * nh).fill(20);
  const copyW = Math.min(nw, w), copyRows = Math.min(nh, h);
  for (let r = 0; r < copyRows; r++) {
    const sy = h - 1 - r, ny = nh - 1 - r;
    for (let c = 0; c < copyW; c++) {
      nCells[ny * nw + c] = cells[sy * w + c];
      nWasm[ny * nw + c] = wasmTemp[sy * w + c];
      nJs[ny * nw + c] = jsTemp[sy * w + c];
    }
  }
  return { cells: nCells, wasmTemp: nWasm, jsTemp: nJs };
}

let w = 50, h = 30;
let cells = new Uint8Array(w * h);
let wasmTemp = new Float32Array(w * h);
let jsTemp = new Float32Array(w * h);
for (let i = 0; i < w * h; i++) {
  cells[i] = (rnd() * 256) | 0;
  const t = rnd() * 1500 - 100;
  wasmTemp[i] = t; jsTemp[i] = t; // identical start
}
let jsScratch = new Float32Array(w * h);

let maxDiff = 0;
const TICKS = 40;
for (let tick = 0; tick < TICKS; tick++) {
  // Resize mid-run to exercise ensureBuffers' free+realloc path (grow, then shrink).
  if (tick === 15 || tick === 25) {
    const nw = tick === 15 ? 70 : 40;
    const nh = tick === 15 ? 45 : 22;
    const r = resizeWorld(w, h, nw, nh, cells, wasmTemp, jsTemp);
    w = nw; h = nh; cells = r.cells; wasmTemp = r.wasmTemp; jsTemp = r.jsTemp;
    jsScratch = new Float32Array(w * h);
  }

  // Perturb a few cells each tick (as materials would), identically in both.
  for (let k = 0; k < 5; k++) {
    const i = (rnd() * w * h) | 0;
    const v = rnd() * 2000 - 200;
    wasmTemp[i] = v; jsTemp[i] = v;
  }

  diffuseHeatWasm(cells, cond, wasmTemp, w, h);
  diffuseHeatJsInPlace(cells, cond, jsTemp, jsScratch, w, h);

  for (let i = 0; i < wasmTemp.length; i++) {
    const d = Math.abs(wasmTemp[i] - jsTemp[i]);
    if (d > maxDiff) maxDiff = d;
    if (d !== 0) {
      console.error(`MISMATCH tick ${tick} cell ${i}: wasm=${wasmTemp[i]} js=${jsTemp[i]}`);
      process.exit(1);
    }
  }
}

console.log(`OK — ${TICKS} ticks with 2 resizes, WASM ≡ JS, max |diff| = ${maxDiff}`);
