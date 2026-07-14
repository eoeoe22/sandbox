// Equivalence + determinism harness for the active-tile CA scan
// (src/game/engine/dirtyTiles.ts, docs/PERFORMANCE.md).
//
// Runs the REAL engine — every registered material, reactions, overlap fluids,
// heat — twice from an identical random scene: once with the full scan
// (dirty.enabled = false) and once with the active-tile scan (true). Because
// updateCell draws randomness only on active cells and both scans visit the
// same active cells in the same order, a seeded Math.random makes the two paths
// bit-identical — this asserts exactly that, every tick, over many scenes and
// both gravity orientations. It also re-runs the tile path to prove determinism
// (the property a future lockstep multiplayer needs).
//
// Run: node_modules/.bin/esbuild test/active-tiles.ts --bundle --platform=node
//        --format=esm | node --input-type=module

import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { mixCells } from '../src/game/engine/brushTools';
import { allMaterials } from '../src/game/materials/registry';
import type { GravityDir } from '../src/game/config';
import '../src/game/materials'; // register all materials (side effect)

// --- Seeded PRNG installed over Math.random so the whole sim is deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(1);
Math.random = () => rng();

// Valid (registered) material ids to sprinkle into scenes.
const IDS = allMaterials().map((m) => m.id).filter((id) => id !== 0);

interface Snapshot {
  w: number;
  h: number;
  cells: Uint8Array;
  temp: Float32Array;
  aux: Uint8Array;
  overlay: Uint8Array;
  overlayAux: Uint8Array;
  tint: Uint8Array;
}

/** Build a random scene: a `fill` fraction of cells get a random material, a
 *  random temperature, and a random tint (tint drives some overlap behavior). */
function makeScene(seed: number, w: number, h: number, fill: number): Snapshot {
  rng = mulberry32(seed);
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(20);
  const aux = new Uint8Array(n);
  const overlay = new Uint8Array(n);
  const overlayAux = new Uint8Array(n);
  const tint = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Math.random() < fill) {
      cells[i] = IDS[(Math.random() * IDS.length) | 0];
      temp[i] = Math.random() * 1600 - 100;
      tint[i] = (Math.random() * 256) | 0;
    }
  }
  return { w, h, cells, temp, aux, overlay, overlayAux, tint };
}

/** A settled sand slab filling the bottom `rows`, with quiet air above. The air
 *  tiles rebuild as asleep, so stirring at the slab's surface lifts grains into
 *  a tile the tile-scan would skip unless mixCells marks it — the exact
 *  condition the moving-box cases rarely hit. Fire/decay-free so the only motion
 *  is the stir + settling. */
function makeSlab(w: number, h: number, rows: number): Snapshot {
  const SAND = 2;
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(20);
  const tint = new Uint8Array(n);
  for (let y = h - rows; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells[y * w + x] = SAND;
      tint[y * w + x] = (x * 31 + y * 7) & 255;
    }
  }
  return { w, h, cells, temp, aux: new Uint8Array(n), overlay: new Uint8Array(n), overlayAux: new Uint8Array(n), tint };
}

function loadInto(grid: Grid, s: Snapshot): void {
  grid.cells.set(s.cells);
  grid.temp.set(s.temp);
  grid.aux.set(s.aux);
  grid.overlay.set(s.overlay);
  grid.overlayAux.set(s.overlayAux);
  grid.tint.set(s.tint);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}

/** Deep copy of the state arrays that must match between the two scans. */
function grab(grid: Grid): Snapshot {
  return {
    w: grid.width,
    h: grid.height,
    cells: grid.cells.slice(),
    temp: grid.temp.slice(),
    aux: grid.aux.slice(),
    overlay: grid.overlay.slice(),
    overlayAux: grid.overlayAux.slice(),
    tint: grid.tint.slice(),
  };
}

/** First index where two snapshots differ, or -1. Temperature is compared
 *  bit-exactly (both paths run the identical kernel), so no tolerance. */
function firstDiff(a: Snapshot, b: Snapshot): { field: string; i: number } | null {
  const fields: (keyof Snapshot)[] = ['cells', 'temp', 'aux', 'overlay', 'overlayAux', 'tint'];
  for (const f of fields) {
    const av = a[f] as ArrayLike<number>;
    const bv = b[f] as ArrayLike<number>;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return { field: f, i };
    }
  }
  return null;
}

/** A deterministic brush footprint (flat x,y pairs) for tick `t`: a box that
 *  walks across the grid. Derived from `t` only — no RNG — so the full and tile
 *  runs stir the identical cells and stay RNG-aligned. */
function mixFootprint(t: number, w: number, h: number, at?: [number, number]): number[] {
  const r = 3;
  const cx = at ? at[0] : 3 + ((t * 7) % Math.max(1, w - 6));
  const cy = at ? at[1] : 3 + ((t * 5) % Math.max(1, h - 6));
  const pts: number[] = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x >= 0 && x < w && y >= 0 && y < h) pts.push(x, y);
    }
  }
  return pts;
}

function run(
  scene: Snapshot,
  enabled: boolean,
  simSeed: number,
  gravity: GravityDir,
  ticks: number,
  mixEvery: number,
  mixAt?: [number, number],
): Snapshot[] {
  const grid = new Grid(scene.w, scene.h);
  grid.dirty.enabled = enabled;
  loadInto(grid, scene);
  const sim = new Simulation(grid);
  sim.setGravity(gravity, 1);
  rng = mulberry32(simSeed);
  const frames: Snapshot[] = [];
  for (let t = 0; t < ticks; t++) {
    // Interleave the stir brush (mixCells) — a between-ticks writer that mutates
    // cells/overlay directly. It must mark tiles or the tile scan would strand
    // grains it lifts into empty space; running it here proves it does. Both
    // runs stir identically (footprint is RNG-free, mixCells shares `rng`).
    if (mixEvery > 0 && t > 0 && t % mixEvery === 0) {
      mixCells(grid, mixFootprint(t, scene.w, scene.h, mixAt));
    }
    sim.step();
    frames.push(grab(grid));
  }
  return frames;
}

interface Case {
  seed: number;
  w: number;
  h: number;
  fill: number;
  gravity: GravityDir;
  ticks: number;
  mixEvery: number; // stir the brush every N ticks (0 = never)
  slabRows?: number; // if set, use a settled sand slab instead of random fill
  mixAt?: [number, number]; // fixed stir center (for the slab surface case)
}

const CASES: Case[] = [
  { seed: 0x1111, w: 48, h: 40, fill: 0.25, gravity: 'down', ticks: 120, mixEvery: 0 },
  { seed: 0x2222, w: 40, h: 48, fill: 0.5, gravity: 'down', ticks: 120, mixEvery: 0 },
  { seed: 0x3333, w: 33, h: 27, fill: 0.15, gravity: 'right', ticks: 120, mixEvery: 0 },
  { seed: 0x4444, w: 50, h: 50, fill: 0.6, gravity: 'up', ticks: 100, mixEvery: 0 },
  { seed: 0x5555, w: 64, h: 24, fill: 0.35, gravity: 'left', ticks: 100, mixEvery: 0 },
  { seed: 0x6666, w: 17, h: 71, fill: 0.4, gravity: 'down', ticks: 100, mixEvery: 0 },
  // Stir-brush coverage: mixCells writes cells/overlay directly between ticks,
  // so it must mark tiles — these cases would strand grains under the tile scan
  // if it didn't. Low fill so stirred grains land in otherwise-empty tiles.
  { seed: 0x7777, w: 48, h: 40, fill: 0.12, gravity: 'down', ticks: 140, mixEvery: 5 },
  { seed: 0x8888, w: 40, h: 44, fill: 0.2, gravity: 'down', ticks: 140, mixEvery: 7 },
  { seed: 0x9999, w: 33, h: 33, fill: 0.15, gravity: 'right', ticks: 120, mixEvery: 6 },
  // Targeted: settled sand slab (bottom 16 rows of a 48-tall grid = tile-row 2),
  // stir fixed at the surface (y=32, the boundary into asleep air tile-row 1).
  // Without the mixCells tile-mark this strands grains the tile scan skips.
  { seed: 0xa1, w: 48, h: 48, fill: 0, gravity: 'down', ticks: 80, mixEvery: 4, slabRows: 16, mixAt: [24, 32] },
];

const SIM_SEED = 0xc0ffee;
let failed = false;
let totalTicks = 0;

for (const c of CASES) {
  const scene = c.slabRows ? makeSlab(c.w, c.h, c.slabRows) : makeScene(c.seed, c.w, c.h, c.fill);
  const full = run(scene, false, SIM_SEED, c.gravity, c.ticks, c.mixEvery, c.mixAt);
  const tile = run(scene, true, SIM_SEED, c.gravity, c.ticks, c.mixEvery, c.mixAt);
  const tile2 = run(scene, true, SIM_SEED, c.gravity, c.ticks, c.mixEvery, c.mixAt); // determinism

  let caseOk = true;
  for (let t = 0; t < c.ticks; t++) {
    const d = firstDiff(full[t], tile[t]);
    if (d) {
      const { field, i } = d;
      console.error(
        `EQUIV FAIL seed=0x${c.seed.toString(16)} ${c.w}x${c.h} g=${c.gravity} tick ${t}: ` +
          `field ${field} cell ${i} (x=${i % c.w}, y=${(i / c.w) | 0}) ` +
          `full=${(full[t][field] as ArrayLike<number>)[i]} tile=${(tile[t][field] as ArrayLike<number>)[i]}`,
      );
      caseOk = false;
      break;
    }
    const dd = firstDiff(tile[t], tile2[t]);
    if (dd) {
      console.error(
        `DETERMINISM FAIL seed=0x${c.seed.toString(16)} tick ${t}: field ${dd.field} cell ${dd.i}`,
      );
      caseOk = false;
      break;
    }
  }
  totalTicks += c.ticks;
  if (caseOk) {
    const mix = c.mixEvery > 0 ? ` +mix/${c.mixEvery}` : '';
    console.log(`OK  seed=0x${c.seed.toString(16)} ${c.w}x${c.h} g=${c.gravity}${mix} — ${c.ticks} ticks bit-identical + deterministic`);
  } else {
    failed = true;
  }
}

if (failed) {
  console.error('\nFAILED — active-tile scan diverged from the full scan.');
  process.exit(1);
}
console.log(`\nOK — ${CASES.length} scenes, ${totalTicks} ticks total: active-tile scan ≡ full scan, and deterministic.`);
