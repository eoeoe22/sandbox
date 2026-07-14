// Phase 0 fixed benchmark scenes (docs/WASM-ENGINE-PORTING.md §Phase 0).
//
// Three reproducible scenarios the profiler measures against, so the "where does
// the tick go?" breakdown is comparable run to run and machine to machine:
//
//   empty  — nothing placed. Isolates the always-on cost (heat sweep over an
//            all-insulator field + background drift + render of a blank grid).
//   static — a settled landscape (sand dunes over water pools). Mostly-inert
//            occupied cells: heavy heat field, full CA scan, few reactions.
//   active — combustion everywhere (wood+fire, oil fires, lava meeting water).
//            Reaction-dominated: stresses the CA scan / material update rules.
//
// Seeded from a fixed PRNG (no Math.random) so a given scenario is identical
// every run. Dev-only: reached via `?bench=<name>` at startup (see Game.ts),
// never on a normal load.

import type { Grid } from './Grid';
import { getMaterial } from '../materials/registry';

export type BenchScenario = 'empty' | 'sparse' | 'static' | 'active';

export const BENCH_SCENARIOS: readonly BenchScenario[] = ['empty', 'sparse', 'static', 'active'];

export function isBenchScenario(v: string | null): v is BenchScenario {
  return v === 'empty' || v === 'sparse' || v === 'static' || v === 'active';
}

// Core material ids used by the scenes. Kept as literals (these are stable
// engine materials); a scene skips any id that isn't registered so it can't
// crash a build where a material was renumbered.
const SAND = 2;
const WATER = 3;
const FIRE = 9;
const LAVA = 10;
const OIL = 23;
const WOOD = 26;

const AMBIENT = 20; // °C, matches the sandbox's resting temperature.

/** Deterministic PRNG (mulberry32) so each scenario seeds identically. */
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

/** True if material id `id` is registered — scenes skip unknown ids. */
function has(id: number): boolean {
  return getMaterial(id) !== undefined;
}

function put(g: Grid, x: number, y: number, id: number, temp = AMBIENT): void {
  // Explicit bounds check so scene math near the edges (pillar caps, floor rows)
  // is safe on any grid size rather than relying on TypedArray dropping an
  // out-of-range write. `has` skips ids not present in this build.
  if (!g.inBounds(x, y) || !has(id)) return;
  g.set(x, y, id);
  g.setTemp(x, y, temp);
}

/** Fill `grid` with the named benchmark scene, replacing any current contents. */
export function seedBenchScenario(grid: Grid, scenario: BenchScenario): void {
  grid.clear();
  const w = grid.width;
  const h = grid.height;
  const rnd = mulberry32(0xb0a7 ^ (w * 73856093) ^ (h * 19349663));

  if (scenario === 'empty') return;

  if (scenario === 'sparse') {
    // A typical sandbox: mostly empty air with a few scattered features. This is
    // the case active-tile scanning is built for — the empty majority is skipped
    // entirely. A couple of sand dunes on the floor, one water pool, a small
    // burning patch. Roughly ~12% of the grid occupied.
    const floor = h - 1;
    for (let x = 0; x < w; x++) {
      // Two low dunes centered at ~1/4 and ~3/4 width.
      const d1 = Math.max(0, 1 - Math.abs(x - w * 0.25) / (w * 0.12));
      const d2 = Math.max(0, 1 - Math.abs(x - w * 0.72) / (w * 0.15));
      const duneH = Math.floor((d1 + d2) * h * 0.18 + rnd() * 2);
      for (let y = floor; y > floor - duneH && y > 0; y--) put(grid, x, y, SAND);
    }
    // A shallow water pool in the left third, one row deep-ish.
    const poolTop = Math.floor(h * 0.55);
    for (let x = 2; x < w * 0.3; x++) {
      for (let y = poolTop; y < poolTop + 3 && y < h; y++) put(grid, x, y, WATER);
    }
    // A small fire patch up high on the right (fed nothing, just churns a bit).
    const fx = Math.floor(w * 0.8);
    const fy = Math.floor(h * 0.3);
    for (let dx = 0; dx < 4; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        if (rnd() < 0.6) put(grid, fx + dx, fy + dy, FIRE, 800);
      }
    }
    return;
  }

  if (scenario === 'static') {
    // Water pool across the bottom, sand dunes mounded on top — a settled
    // landscape that mostly sits still: the CA scan walks a densely occupied
    // grid while few cells actually react.
    const waterTop = Math.floor(h * 0.7);
    for (let y = waterTop; y < h; y++) {
      for (let x = 0; x < w; x++) put(grid, x, y, WATER);
    }
    // Sand dunes: a low-frequency height field sculpted with a couple of sines.
    for (let x = 0; x < w; x++) {
      const duneH = 0.12 + 0.10 * (Math.sin(x * 0.04) * 0.5 + 0.5) + 0.05 * rnd();
      const top = Math.floor(h * (0.7 - duneH));
      for (let y = top; y < waterTop; y++) put(grid, x, y, SAND);
    }
    return;
  }

  // active: combustion fronts everywhere.
  // Wood pillars set alight at the top, oil pools burning, and a lava band over
  // water throwing steam — a reaction-saturated scene that keeps the material
  // update rules busy every tick.
  const floor = h - 1;
  // A shallow oil layer along the floor with fire seeded through it.
  for (let x = 0; x < w; x++) {
    put(grid, x, floor, OIL);
    if (rnd() < 0.35) put(grid, x, floor - 1, FIRE, 800);
  }
  // Evenly spaced wood pillars, each capped with fire so they burn down.
  const pillarGap = 9;
  for (let px = 4; px < w - 1; px += pillarGap) {
    const ph = Math.floor(h * (0.3 + 0.3 * rnd()));
    for (let y = floor - 2; y > floor - 2 - ph && y > 0; y--) put(grid, px, y, WOOD);
    put(grid, px, floor - 2 - ph, FIRE, 800);
    if (px + 1 < w) put(grid, px + 1, floor - 2 - ph, FIRE, 800);
  }
  // A lava band a third of the way down, with a thin water sheet just above it
  // so the two meet and churn (steam / rock), plus scattered embers.
  const lavaY = Math.floor(h * 0.35);
  for (let x = 0; x < w; x++) {
    put(grid, x, lavaY, LAVA, 1200);
    if (rnd() < 0.5) put(grid, x, lavaY - 1, WATER);
    if (rnd() < 0.08) put(grid, x, lavaY - 2, FIRE, 800);
  }
}
