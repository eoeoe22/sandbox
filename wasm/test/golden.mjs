// Golden parity test: the Rust/WASM heat kernel vs. the JS reference.
//
// Runs both over randomized grids/conductivities/temperatures and asserts the
// outputs match. The Rust kernel mirrors the JS accumulation order (read f32 →
// widen to f64 → f64 math → store f32), so we expect BIT-IDENTICAL results and
// assert exactly that; a nonzero tolerance is available via TOL env only as a
// diagnostic. Run: `node wasm/test/golden.mjs`.
//
// This is the correctness gate for the WASM kernel (wasm/README.md "정확성"):
// turning USE_WASM_HEAT on must not change simulation behavior.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, '..', 'heat', 'target', 'wasm32-unknown-unknown', 'release', 'heat.wasm');

const RATE = 0.2; // HEAT_DIFFUSION_RATE
// Cover both substep parities: odd counts (9 = production) end with the latest
// field in `scratch` and hit the kernel's copy-back-to-temp branch; even counts
// end in `temp` and take the no-copy branch. 1 is the single-pass degenerate.
const SUBSTEP_CASES = [1, 2, 3, 4, 9];
const TOL = Number(process.env.TOL ?? 0); // 0 = require bit-identical

// Inert-tile skip geometry — must match engine/dirtyTiles.ts TILE_BITS and the
// TILE_BITS constant in the Rust kernel.
const TILE_BITS = 4;
const TILE = 1 << TILE_BITS;

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

// --- Inert-tile skip: the mask, and the tiled JS loop that consumes it.
// This mirrors Simulation.buildHeatTiles / the tiled Simulation.diffuseHeat.
// Everything below must agree with the plain full-grid reference above — that
// agreement IS the claim the skip rests on (an all-zero-conductivity tile is a
// no-op, so not visiting it changes nothing). ---
function buildTiles(cells, cond, w, h) {
  const tilesX = (w + TILE - 1) >> TILE_BITS;
  const tilesY = (h + TILE - 1) >> TILE_BITS;
  const tiles = new Uint8Array(tilesX * tilesY);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const trow = (y >> TILE_BITS) * tilesX;
    for (let x = 0; x < w; x++) {
      if (cond[cells[row + x]] !== 0) tiles[trow + (x >> TILE_BITS)] = 1;
    }
  }
  return { tiles, tilesX, tilesY };
}

function diffuseHeatJsTiled(cells, cond, temp, w, h, rate, substeps, tiles, tilesX, tilesY) {
  let cur = temp;
  // Seed the back buffer: skipped cells are never written, so this stands in for
  // the copy-through they would have done, in both buffers, for every substep.
  let next = cur.slice();
  for (let s = 0; s < substeps; s++) {
    for (let ty = 0; ty < tilesY; ty++) {
      const trow = ty * tilesX;
      const y0 = ty << TILE_BITS;
      const y1 = Math.min(y0 + TILE, h);
      for (let tx = 0; tx < tilesX; tx++) {
        if (tiles[trow + tx] === 0) continue;
        const x0 = tx << TILE_BITS;
        const x1 = Math.min(x0 + TILE, w);
        for (let y = y0; y < y1; y++) {
          const row = y * w;
          for (let x = x0; x < x1; x++) {
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
    }
    const t = cur;
    cur = next;
    next = t;
  }
  return cur;
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

// Dense noise: every cell a random id, so most tiles conduct. Stresses the
// arithmetic and the ci===0 early-out, but hardly ever produces an inert tile.
function buildDenseCase(rnd, w, h) {
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

// Sandbox-shaped: mostly Empty air with a few blobs of matter, which is what
// actually produces whole inert tiles for the skip to drop. Some blobs are made
// of a zero-conductivity id (Wall), so a tile can be fully occupied and *still*
// inert — the skip keys on conductivity, not on emptiness.
function buildSparseCase(rnd, w, h) {
  const n = w * h;
  const cells = new Uint8Array(n); // all Empty
  const temp = new Float32Array(n);
  const cond = new Float32Array(256);
  cond[0] = 0; // Empty
  cond[1] = 0; // Wall — occupied but a perfect insulator
  for (let id = 2; id < 256; id++) cond[id] = rnd();
  for (let i = 0; i < n; i++) temp[i] = rnd() * 2200 - 200;
  const blobs = 1 + ((rnd() * 4) | 0);
  for (let b = 0; b < blobs; b++) {
    const bw = 1 + ((rnd() * Math.max(1, w >> 1)) | 0);
    const bh = 1 + ((rnd() * Math.max(1, h >> 1)) | 0);
    const bx = (rnd() * Math.max(1, w - bw + 1)) | 0;
    const by = (rnd() * Math.max(1, h - bh + 1)) | 0;
    const id = rnd() < 0.25 ? 1 : 2 + ((rnd() * 254) | 0);
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) cells[y * w + x] = id;
    }
  }
  return { cells, cond, temp };
}

const wasm = await WebAssembly.instantiate(readFileSync(WASM_PATH), {});
const { memory, diffuse_heat, heat_alloc } = wasm.instance.exports;

function diffuseHeatWasm(cells, cond, temp, w, h, rate, substeps, mask) {
  const n = w * h;
  const nTiles = mask ? mask.tiles.length : 0;
  const cellsPtr = heat_alloc(n);
  const condPtr = heat_alloc(256 * 4);
  const tempPtr = heat_alloc(n * 4);
  const scratchPtr = heat_alloc(n * 4);
  const tilesPtr = nTiles > 0 ? heat_alloc(nTiles) : 0;
  // Views must be created after all allocs (a grow would detach the buffer).
  new Uint8Array(memory.buffer, cellsPtr, n).set(cells);
  new Float32Array(memory.buffer, condPtr, 256).set(cond);
  new Float32Array(memory.buffer, tempPtr, n).set(temp);
  if (tilesPtr !== 0) new Uint8Array(memory.buffer, tilesPtr, nTiles).set(mask.tiles);
  diffuse_heat(
    cellsPtr, condPtr, tempPtr, scratchPtr, w, h, rate, substeps,
    tilesPtr, mask ? mask.tilesX : 0, mask ? mask.tilesY : 0,
  );
  return new Float32Array(memory.buffer, tempPtr, n).slice();
}

const sizes = [
  [1, 1], [2, 1], [1, 3], [3, 3], [8, 5], [17, 13], [64, 41], [128, 90],
];
const builders = [
  ['dense', buildDenseCase],
  ['sparse', buildSparseCase],
];
let maxDiff = 0;
let checked = 0;
let grids = 0;
let skipped = 0; // inert tiles the mask dropped, summed over every case
let totalTiles = 0;
const rnd = mulberry32(0x51ed);

/** Compare `got` against the full-grid JS reference, or die with the detail. */
function expect(js, got, label) {
  for (let i = 0; i < js.length; i++) {
    const d = Math.abs(js[i] - got[i]);
    if (d > maxDiff) maxDiff = d;
    if (d > TOL) {
      console.error(`MISMATCH ${label} cell ${i}: js=${js[i]} got=${got[i]} diff=${d}`);
      process.exit(1);
    }
    checked++;
  }
}

for (let rep = 0; rep < 6; rep++) {
  for (const [scene, build] of builders) {
    for (const [w, h] of sizes) {
      for (const substeps of SUBSTEP_CASES) {
        const { cells, cond, temp } = build(rnd, w, h);
        const mask = buildTiles(cells, cond, w, h);
        totalTiles += mask.tiles.length;
        for (const t of mask.tiles) if (t === 0) skipped++;
        const label = `${scene} ${w}x${h} substeps=${substeps} rep${rep}`;
        // The full-grid JS loop is the reference every other path must match.
        const js = diffuseHeatJs(cells, cond, temp.slice(), w, h, RATE, substeps);
        // 1. WASM with no mask — the original parity claim.
        expect(js, diffuseHeatWasm(cells, cond, temp, w, h, RATE, substeps, null), `${label} wasm/full`);
        // 2. WASM skipping inert tiles — the skip must change nothing.
        expect(js, diffuseHeatWasm(cells, cond, temp, w, h, RATE, substeps, mask), `${label} wasm/tiled`);
        // 3. The tiled JS loop the engine actually runs when WASM is unavailable.
        const jsTiled = diffuseHeatJsTiled(
          cells, cond, temp.slice(), w, h, RATE, substeps, mask.tiles, mask.tilesX, mask.tilesY,
        );
        expect(js, jsTiled, `${label} js/tiled`);
        grids++;
      }
    }
  }
}

if (skipped === 0) {
  console.error('MISMATCH: no inert tile was ever skipped — the skip path went untested');
  process.exit(1);
}

console.log(
  `OK — ${checked} cells checked across ${grids} grids × 3 paths ` +
    `(substeps ${SUBSTEP_CASES.join(',')}), ${skipped}/${totalTiles} tiles skipped as inert, ` +
    `max |diff| = ${maxDiff} (tol ${TOL})`,
);
