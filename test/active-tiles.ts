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

function run(scene: Snapshot, enabled: boolean, simSeed: number, gravity: GravityDir, ticks: number): Snapshot[] {
  const grid = new Grid(scene.w, scene.h);
  grid.dirty.enabled = enabled;
  loadInto(grid, scene);
  const sim = new Simulation(grid);
  sim.setGravity(gravity, 1);
  rng = mulberry32(simSeed);
  const frames: Snapshot[] = [];
  for (let t = 0; t < ticks; t++) {
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
}

const CASES: Case[] = [
  { seed: 0x1111, w: 48, h: 40, fill: 0.25, gravity: 'down', ticks: 120 },
  { seed: 0x2222, w: 40, h: 48, fill: 0.5, gravity: 'down', ticks: 120 },
  { seed: 0x3333, w: 33, h: 27, fill: 0.15, gravity: 'right', ticks: 120 },
  { seed: 0x4444, w: 50, h: 50, fill: 0.6, gravity: 'up', ticks: 100 },
  { seed: 0x5555, w: 64, h: 24, fill: 0.35, gravity: 'left', ticks: 100 },
  { seed: 0x6666, w: 17, h: 71, fill: 0.4, gravity: 'down', ticks: 100 },
];

const SIM_SEED = 0xc0ffee;
let failed = false;
let totalTicks = 0;

for (const c of CASES) {
  const scene = makeScene(c.seed, c.w, c.h, c.fill);
  const full = run(scene, false, SIM_SEED, c.gravity, c.ticks);
  const tile = run(scene, true, SIM_SEED, c.gravity, c.ticks);
  const tile2 = run(scene, true, SIM_SEED, c.gravity, c.ticks); // determinism

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
    console.log(`OK  seed=0x${c.seed.toString(16)} ${c.w}x${c.h} g=${c.gravity} — ${c.ticks} ticks bit-identical + deterministic`);
  } else {
    failed = true;
  }
}

if (failed) {
  console.error('\nFAILED — active-tile scan diverged from the full scan.');
  process.exit(1);
}
console.log(`\nOK — ${CASES.length} scenes, ${totalTicks} ticks total: active-tile scan ≡ full scan, and deterministic.`);
