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

// Inert-tile skip geometry. The kernel holds no tile-size constant of its own —
// it uses whatever `diffuse_heat` is handed — so this harness sweeps several
// sizes to prove that, AND reads the production value straight out of
// engine/dirtyTiles.ts so a change there is exercised here instead of silently
// diverging. (Regex rather than an import: these harnesses run on bare Node
// with no bundler, and dirtyTiles.ts is TypeScript.)
const DIRTY_TILES_SRC = join(__dirname, '..', '..', 'src', 'game', 'engine', 'dirtyTiles.ts');
const PROD_TILE_BITS = (() => {
  const m = readFileSync(DIRTY_TILES_SRC, 'utf8').match(/export const TILE_BITS\s*=\s*(\d+)/);
  if (!m) {
    console.error(`could not read TILE_BITS out of ${DIRTY_TILES_SRC} — did the declaration move?`);
    process.exit(1);
  }
  return Number(m[1]);
})();
// 1 is the degenerate 2×2 tiling (nearly every tile live), 6 is coarser than any
// test grid here (one tile covering everything, exercising the clamped edges).
const TILE_BITS_CASES = [...new Set([1, 2, 3, PROD_TILE_BITS, 6])].sort((a, b) => a - b);

// The kernel's sanity cap on tile_bits, read from the kernel for the same reason
// TILE_BITS is read from dirtyTiles.ts: a hardcoded copy here could drift and
// this harness would keep agreeing with itself.
const KERNEL_SRC = join(__dirname, '..', 'heat', 'src', 'lib.rs');
const MAX_TILE_BITS = (() => {
  const m = readFileSync(KERNEL_SRC, 'utf8').match(/const MAX_TILE_BITS:\s*u32\s*=\s*(\d+)/);
  if (!m) {
    console.error(`could not read MAX_TILE_BITS out of ${KERNEL_SRC} — did the declaration move?`);
    process.exit(1);
  }
  return Number(m[1]);
})();

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
function buildTiles(cells, cond, w, h, tileBits) {
  const tile = 1 << tileBits;
  const tilesX = (w + tile - 1) >> tileBits;
  const tilesY = (h + tile - 1) >> tileBits;
  const tiles = new Uint8Array(tilesX * tilesY);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const trow = (y >> tileBits) * tilesX;
    for (let x = 0; x < w; x++) {
      if (cond[cells[row + x]] !== 0) tiles[trow + (x >> tileBits)] = 1;
    }
  }
  return { tiles, tilesX, tilesY, tileBits };
}

function diffuseHeatJsTiled(cells, cond, temp, w, h, rate, substeps, tiles, tilesX, tilesY, tileBits) {
  const tile = 1 << tileBits;
  let cur = temp;
  // Seed the back buffer: skipped cells are never written, so this stands in for
  // the copy-through they would have done, in both buffers, for every substep.
  let next = cur.slice();
  for (let s = 0; s < substeps; s++) {
    for (let ty = 0; ty < tilesY; ty++) {
      const trow = ty * tilesX;
      const y0 = ty << tileBits;
      const y1 = Math.min(y0 + tile, h);
      for (let tx = 0; tx < tilesX; tx++) {
        if (tiles[trow + tx] === 0) continue;
        const x0 = tx << tileBits;
        const x1 = Math.min(x0 + tile, w);
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
    tilesPtr, mask ? mask.tilesX : 0, mask ? mask.tilesY : 0, mask ? mask.tileBits : 0,
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
        const label0 = `${scene} ${w}x${h} substeps=${substeps} rep${rep}`;
        // The full-grid JS loop is the reference every other path must match.
        const js = diffuseHeatJs(cells, cond, temp.slice(), w, h, RATE, substeps);
        // 1. WASM with no mask — the original parity claim.
        expect(js, diffuseHeatWasm(cells, cond, temp, w, h, RATE, substeps, null), `${label0} wasm/full`);
        // The kernel takes the tile size as an argument, so sweep it: the same
        // scene must come out identical at every tiling, which is what lets
        // engine/dirtyTiles.ts own that number by itself.
        for (const tileBits of TILE_BITS_CASES) {
          const mask = buildTiles(cells, cond, w, h, tileBits);
          totalTiles += mask.tiles.length;
          for (const t of mask.tiles) if (t === 0) skipped++;
          const label = `${label0} tileBits=${tileBits}`;
          // 2. WASM skipping inert tiles — the skip must change nothing.
          expect(js, diffuseHeatWasm(cells, cond, temp, w, h, RATE, substeps, mask), `${label} wasm/tiled`);
          // 3. The tiled JS loop the engine actually runs when WASM is unavailable.
          const jsTiled = diffuseHeatJsTiled(
            cells, cond, temp.slice(), w, h, RATE, substeps,
            mask.tiles, mask.tilesX, mask.tilesY, mask.tileBits,
          );
          expect(js, jsTiled, `${label} js/tiled`);
        }
        grids++;
      }
    }
  }
}

if (skipped === 0) {
  console.error('MISMATCH: no inert tile was ever skipped — the skip path went untested');
  process.exit(1);
}

// Masks the kernel must refuse to trust. The tile size now crosses the ABI, so a
// host that gets the geometry wrong is a real failure mode — and the kernel's
// contract is "degrade to slower, never to broken": anything that doesn't
// describe a mask spanning the whole grid falls back to the full sweep. Without
// that, a bad mask silently leaves live cells undiffused, which is the bug a
// second drifting copy of the tile size used to be able to cause.
//
// `diffuse_step` has TWO independent rejection branches and each needs a case
// that ONLY it can catch. That is not a theoretical worry: the first draft of
// this block had five cases that all leaned on the geometry branch, and deleting
// the size-cap branch from the kernel entirely left every one of them passing.
// So each case below is built so the branch it names is the sole thing standing
// between it and a wrong answer — verified by deleting each branch in turn and
// watching exactly the intended cases go red.
//
// The trick for the size-cap cases: give the mask a geometry that is *valid for
// the tile size the kernel would compute if the cap weren't there*. A shift ≥ 32
// wraps on wasm32 (`1 << 32` masks to `1 << 0` = 1), so a per-cell mask is
// geometrically consistent with the wrapped size — the geometry check waves it
// through and only the explicit cap can stop it. Mark every tile inert so a
// kernel that accepts the mask diffuses nothing at all and the mismatch is loud.
{
  // Purpose-built scene: every cell conducts, on a grid whose width and height
  // are both non-multiples of the tile size (so the partial last row/column is
  // in play). A blobby sparse scene will NOT do here — with inert gaps, whether
  // a given mis-read mask happens to drop a *live* region comes down to where
  // the blobs landed, and two of these cases were passing on that luck alone
  // before this scene replaced it. With everything live, dropping or misreading
  // any region is guaranteed to lose real work.
  //
  // The size is DERIVED from the tile size, not fixed. It was hardcoded 61×39,
  // which is what these formulas give at TILE_BITS = 4 — but from TILE_BITS = 7
  // up, a 61-wide grid is narrower than a single tile, so the real tiling and
  // the deliberately-wrong smaller one both collapse to 1×1 and the "wrong tile
  // size" mask stops being malformed at all. (It failed loudly rather than
  // silently — the exclusivity assertion caught it as "no branch rejects it" —
  // but pointing at the wrong thing.) Spanning several tiles on both axes at
  // both the real and the halved tile size keeps every case meaningful at any
  // plausible TILE_BITS; the `+13`/`+7` keep both dimensions off a tile boundary.
  const TILE_SZ = 1 << PROD_TILE_BITS;
  const W = 3 * TILE_SZ + 13;
  const H = 2 * TILE_SZ + 7;
  const n = W * H;
  const cells = new Uint8Array(n).fill(7);
  const cond = new Float32Array(256);
  cond[7] = 0.8;
  const temp = new Float32Array(n);
  // Per-cell noise, NOT a smooth ramp. A linear gradient is harmonic — its
  // Laplacian is zero — so under diffusion the interior does not move at all and
  // dropping an interior tile would be invisible. (The first draft used
  // `x*17 + y*29` and the vacuity guard below caught it: only 1319/2379 cells
  // ever changed, all of them near the boundary.) Noise gives every cell a
  // nonzero Laplacian, so any region the kernel skips visibly fails to change.
  for (let i = 0; i < n; i++) temp[i] = rnd() * 2000 - 200;
  const good = buildTiles(cells, cond, W, H, PROD_TILE_BITS);
  const js = diffuseHeatJs(cells, cond, temp.slice(), W, H, RATE, 9);

  // Guard the guard: if this scene barely diffuses, "skipped everything" and
  // "swept everything" would agree and every case below would pass vacuously.
  let moved = 0;
  for (let i = 0; i < js.length; i++) if (js[i] !== temp[i]) moved++;
  if (moved < n * 0.9) {
    console.error(`MISMATCH: malformed-mask scene only moved ${moved}/${n} cells — cases could pass vacuously`);
    process.exit(1);
  }

  // Every tile inert, at a granularity that matches the *wrapped/degenerate*
  // tile size — so the geometry check passes and only the cap can reject.
  const perCell = { tiles: new Uint8Array(W * H), tilesX: W, tilesY: H };
  const single = { tiles: new Uint8Array(1), tilesX: 1, tilesY: 1 };

  // "Which branch rejects this mask" as an executable predicate, mirroring
  // `diffuse_step`. JS masks shift counts by 31 exactly as wasm32 does, so
  // `1 << 32` degenerates to 1 in both — which is the whole point of the cap
  // cases below. Each case declares the branch it means to exercise and we
  // assert *exactly* that one fires.
  //
  // This started life as a comment claiming "3 cap-only, 3 geometry-only", which
  // was true but unenforced: review pointed out that setting TILE_BITS to 1 in
  // dirtyTiles.ts makes the "disagrees" case's tile_bits 0, catching it on the
  // cap branch as well and silently halving the geometry branch's coverage with
  // no test noticing. A claim about which branch does the work belongs in an
  // assertion, not in prose, so here it is.
  const rejectedBy = (mask) => {
    const byCap = mask.tileBits === 0 || mask.tileBits > MAX_TILE_BITS;
    // Mirror the kernel's CONTROL FLOW, not just its two conditions: on the cap
    // branch `diffuse_step` returns immediately and never computes `tile` or
    // compares the geometry at all. Evaluating both unconditionally reports a
    // case as "caught by cap + geometry" that the kernel only ever sees the cap
    // for — a false positive that would fail the exclusivity assertion below for
    // no real reason. It is reachable: raise the kernel's MAX_TILE_BITS to 28
    // and the derived `MAX_TILE_BITS + 4` case becomes 32, whose shift wraps to
    // `tile = 1`, against which the 1×1 mask is no longer valid geometry.
    // (A predicate that mirrors the kernel is a second implementation of it —
    // the same hazard that got the tile size moved out of the kernel in the
    // first place — so it has to mirror the whole thing, early return included.)
    if (byCap) return { byCap: true, byGeom: false };
    const tile = 1 << mask.tileBits; // same wrap-by-31 the kernel would see
    const byGeom = mask.tilesX !== Math.ceil(W / tile) || mask.tilesY !== Math.ceil(H / tile);
    return { byCap, byGeom };
  };

  // The "wrong tile size" case has to be the *smaller* direction to bite (see
  // its comment), which needs a bit below the production one to exist. At
  // TILE_BITS = 1 there is none, and quietly settling for a weaker case is how
  // the coverage gap above happened — so say so and stop instead.
  if (PROD_TILE_BITS < 2) {
    console.error(
      `MISMATCH: TILE_BITS is ${PROD_TILE_BITS}; the "wrong tile size" malformed-mask case needs a ` +
        `smaller-but-nonzero tile size to exercise the geometry branch on its own. Rethink that case.`,
    );
    process.exit(1);
  }

  const bad = [
    // --- Branch 1: the tile_bits sanity cap (checked before the shift) ---
    // tile_bits 0 → tile 1; a per-cell mask IS valid geometry for that, so the
    // geometry check cannot fire. Only `tile_bits == 0` saves this.
    ['cap', 'tileBits 0, geometry consistent with it', { ...perCell, tileBits: 0 }],
    // tile_bits 32 → the real hazard: an overflowing shift, which wasm32 masks
    // to `1 << 0` = 1 rather than trapping. Per-cell geometry again matches that
    // wrapped size exactly, so only `tile_bits > MAX_TILE_BITS` saves this.
    ['cap', 'tileBits 32 (shift wraps to 0 on wasm32)', { ...perCell, tileBits: 32 }],
    // Same idea far past the cap without wrapping: tile 2^20 > the whole grid,
    // so a 1×1 mask is consistent geometry. Only the cap saves this.
    ['cap', `tileBits ${MAX_TILE_BITS + 4}, geometry consistent with it`,
      { ...single, tileBits: MAX_TILE_BITS + 4 }],

    // --- Branch 2: exact mask geometry ---
    // Undersized in x and in y separately: same `||`, but different operands, so
    // a copy-paste slip that compares h twice is caught by the x case alone.
    ['geom', 'tilesX too small', { ...good, tilesX: good.tilesX - 1 }],
    ['geom', 'tilesY too small', { ...good, tilesY: good.tilesY - 1 }],
    // The nastiest shape, and why this branch demands equality rather than
    // "big enough": a plausible tile COUNT with the wrong tile SIZE. A mere size
    // check passes it, and the kernel then reads each tile's mark for the wrong
    // physical region. Deliberately the *smaller* tile size — reading the mask
    // as finer tiles than it is means the loop's `tiles_x`/`tiles_y` bounds stop
    // short of the grid, so the far edge goes undiffused no matter what the
    // marks say. (The larger-size direction is the same class of bug but does
    // not bite on a uniformly-live field: the oversized blocks happen to re-tile
    // the whole grid and every mark it lands on says "process", so it silently
    // comes out right here. Checked — don't "fix" this to +1.)
    ['geom', 'tileBits disagrees with the mask', { ...good, tileBits: PROD_TILE_BITS - 1 }],
  ];
  const branchCount = { cap: 0, geom: 0 };
  for (const [branch, name, mask] of bad) {
    const { byCap, byGeom } = rejectedBy(mask);
    const fired = [byCap && 'cap', byGeom && 'geom'].filter(Boolean);
    if (fired.length !== 1 || fired[0] !== branch) {
      console.error(
        `MISMATCH malformed mask (${name}): meant to be rejected by the ${branch} branch alone, ` +
          `but ${fired.length === 0 ? 'no branch rejects it' : `it is rejected by: ${fired.join(' + ')}`}. ` +
          `A case caught by both branches proves neither, and one caught by none proves nothing.`,
      );
      process.exit(1);
    }
    branchCount[branch]++;
    expect(js, diffuseHeatWasm(cells, cond, temp, W, H, RATE, 9, mask), `malformed mask (${name})`);
  }
  if (branchCount.cap === 0 || branchCount.geom === 0) {
    console.error(`MISMATCH: malformed-mask cases cover only one branch (${JSON.stringify(branchCount)})`);
    process.exit(1);
  }
  console.log(
    `      malformed-mask fallback: ${bad.length} cases ` +
      `(${branchCount.cap} cap-only, ${branchCount.geom} geometry-only, each asserted exclusive) ` +
      `all matched the full sweep`,
  );
}

console.log(
  `OK — ${checked} cells checked across ${grids} grids ` +
    `(substeps ${SUBSTEP_CASES.join(',')}; tileBits ${TILE_BITS_CASES.join(',')}, ` +
    `production ${PROD_TILE_BITS}), ${skipped}/${totalTiles} tiles skipped as inert, ` +
    `max |diff| = ${maxDiff} (tol ${TOL})`,
);
