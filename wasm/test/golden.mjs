// Golden parity test: the Rust/WASM heat kernel vs. the JS reference.
//
// Runs both over randomized grids/conductivities/temperatures and asserts the
// outputs match. The Rust kernel mirrors the JS accumulation order (read f32 →
// widen to f64 → f64 math → store f32), so we expect BIT-IDENTICAL results and
// assert exactly that; a nonzero tolerance is available via TOL env only as a
// diagnostic. Run: `node wasm/test/golden.mjs`.
//
// This is the correctness gate for docs/WASM-ENGINE-PORTING.md Phase 2: turning
// USE_WASM_HEAT on must not change simulation behavior.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, '..', 'heat', 'target', 'wasm32-unknown-unknown', 'release', 'heat.wasm');

const RATE = 0.2; // HEAT_DIFFUSION_RATE
// Cover both substep parities: odd counts (3 = production) end with the latest
// field in `scratch` and hit the kernel's copy-back-to-temp branch; even counts
// end in `temp` and take the no-copy branch. 1 is the single-pass degenerate.
const SUBSTEP_CASES = [1, 2, 3, 4];
const TOL = Number(process.env.TOL ?? 0); // 0 = require bit-identical

// --- JS reference: a faithful copy of Simulation.diffuseHeat, called SUBSTEPS
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

function diffuseHeatJs(cells, cond, temp, w, h, rate, substeps) {
  let cur = temp;
  let next = new Float32Array(w * h);
  for (let s = 0; s < substeps; s++) {
    diffuseHeatJsOnce(cells, cond, cur, next, w, h, rate);
    const t = cur;
    cur = next;
    next = t;
  }
  return cur; // final field
}

// --- Deterministic PRNG so failures reproduce. ---
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

function buildCase(rnd, w, h) {
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n);
  // Conductivity LUT keyed by material id, with a few zero (insulator) entries
  // so the ci===0 early-out path is exercised. id 0 (Empty) is a pure insulator.
  const cond = new Float32Array(256);
  cond[0] = 0;
  for (let id = 1; id < 256; id++) cond[id] = rnd() < 0.15 ? 0 : rnd();
  for (let i = 0; i < n; i++) {
    cells[i] = (rnd() * 256) | 0;
    // Temperatures span cold sinks to hot masses.
    temp[i] = rnd() * 2200 - 200;
  }
  return { cells, cond, temp };
}

const wasm = await WebAssembly.instantiate(readFileSync(WASM_PATH), {});
const { memory, diffuse_heat, heat_alloc } = wasm.instance.exports;

function diffuseHeatWasm(cells, cond, temp, w, h, rate, substeps) {
  const n = w * h;
  const cellsPtr = heat_alloc(n);
  const condPtr = heat_alloc(256 * 4);
  const tempPtr = heat_alloc(n * 4);
  const scratchPtr = heat_alloc(n * 4);
  // Views must be created after all allocs (a grow would detach the buffer).
  new Uint8Array(memory.buffer, cellsPtr, n).set(cells);
  new Float32Array(memory.buffer, condPtr, 256).set(cond);
  new Float32Array(memory.buffer, tempPtr, n).set(temp);
  diffuse_heat(cellsPtr, condPtr, tempPtr, scratchPtr, w, h, rate, substeps);
  return new Float32Array(memory.buffer, tempPtr, n).slice();
}

const sizes = [
  [1, 1], [2, 1], [1, 3], [3, 3], [8, 5], [17, 13], [64, 41], [128, 90],
];
let maxDiff = 0;
let checked = 0;
let grids = 0;
const rnd = mulberry32(0x51ed);
for (let rep = 0; rep < 6; rep++) {
  for (const [w, h] of sizes) {
    for (const substeps of SUBSTEP_CASES) {
      const { cells, cond, temp } = buildCase(rnd, w, h);
      const js = diffuseHeatJs(cells, cond, temp.slice(), w, h, RATE, substeps);
      const rs = diffuseHeatWasm(cells, cond, temp, w, h, RATE, substeps);
      for (let i = 0; i < js.length; i++) {
        const d = Math.abs(js[i] - rs[i]);
        if (d > maxDiff) maxDiff = d;
        if (d > TOL) {
          console.error(
            `MISMATCH ${w}x${h} substeps=${substeps} rep${rep} cell ${i}: js=${js[i]} rs=${rs[i]} diff=${d}`,
          );
          process.exit(1);
        }
        checked++;
      }
      grids++;
    }
  }
}

console.log(`OK — ${checked} cells checked across ${grids} grids (substeps ${SUBSTEP_CASES.join(',')}), max |diff| = ${maxDiff} (tol ${TOL})`);
