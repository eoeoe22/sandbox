// Headless behavioural harness for 진공 기포 — goo does not settle full of holes.
//
// The thick goos (Slime, Acid Slime, Honey) are slowed by two throttles at once:
// a `FLOW_CHANCE` gate in their own update, and a high `viscosity` that
// updateLiquid reads to suppress the lateral step. Each is deliberate on its own;
// together they leave a settling blob pitted with enclosed empty cells, because
// the cell above a gap only follows on ~1 tick in 6 and the sideways fill that
// would close it is exactly what `viscosity` blocks. An empty cell renders as the
// bare background, so what a player sees is a green blob full of black windows —
// the reported bug, and the reason `behaviors.collapseVoidBelow` exists.
//
// What this pins:
//
//   • **The goos don't hold voids.** A blob dropped through air settles with few
//     enclosed holes at any moment — measured as the average over the run, not a
//     final count, because the artifact is transient by nature and it is the
//     *steady state* during settling that the eye reads.
//   • **The fix didn't just make goo runny.** Slime and Honey still fall at goo
//     pace (a 40-cell drop takes them well over a hundred ticks, against water's
//     ~35) and still hold a mound instead of levelling out (a blob spreads to a
//     fraction of the width water reaches). Enclosure is what separates the two:
//     an interior bubble collapses at once, the open air under a mound doesn't.
//   • **The controls place the blame correctly.** Lava (same gate, no
//     `viscosity`) and Mud (`viscosity`, no gate) never had the artifact and
//     still don't — it takes both throttles to produce it.
//
// Run: `node test/run-goovoids.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import '../src/game/materials';

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
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x600d);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const ID = (name: string): number => {
  for (let i = 1; i < 256; i++) {
    const m = getMaterial(i);
    if (m && m.name === name) return i;
  }
  throw new Error('no material ' + name);
};
const WALL = ID('Wall');
const DIR4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Empty cells with at least 3 of their 4 sides held by `id` — a hole *inside*
 *  the blob rather than the open air around it. This is the thing that renders
 *  as a black window, so it is what the harness counts. */
function holes(grid: Grid, id: number): number {
  let n = 0;
  for (let y = 1; y < grid.height - 1; y++)
    for (let x = 1; x < grid.width - 1; x++) {
      if (grid.get(x, y) !== 0) continue;
      let held = 0;
      for (const [dx, dy] of DIR4) if (grid.get(x + dx, y + dy) === id) held++;
      if (held >= 3) n++;
    }
  return n;
}

/** Drop a 12×12 blob through open air onto a floor and average the enclosed-hole
 *  count over every tick of the settling. Averaged over three streams. */
function pitting(id: number, ticks = 400): { peak: number; avg: number } {
  let peak = 0;
  let sum = 0;
  const seeds = [SEED_BASE, SEED_BASE + 0x9e37, SEED_BASE + 0x13c6e];
  for (const seed of seeds) {
    Math.random = mulberry32(seed);
    const grid = new Grid(40, 40);
    const sim = new Simulation(grid);
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 40; x++)
        if (x === 0 || y === 0 || x === 39 || y >= 38) grid.cells[grid.idx(x, y)] = WALL;
    for (let y = 4; y <= 15; y++) for (let x = 14; x <= 25; x++) grid.cells[grid.idx(x, y)] = id;
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    for (let t = 0; t < ticks; t++) {
      sim.step();
      const h = holes(grid, id);
      if (h > peak) peak = h;
      sum += h;
    }
  }
  return { peak, avg: sum / (ticks * seeds.length) };
}

/** Ticks for a 6×6 blob to fall 40 cells (-1 if it never lands), and how many
 *  columns it covers 300 ticks after landing — the two numbers that say the goo
 *  is still goo. */
function ooze(id: number): { fall: number; cols: number } {
  Math.random = mulberry32(SEED_BASE + 0x5a5a);
  const tall = new Grid(20, 60);
  const s1 = new Simulation(tall);
  for (let y = 0; y < 60; y++)
    for (let x = 0; x < 20; x++)
      if (x === 0 || x === 19 || y >= 58) tall.cells[tall.idx(x, y)] = WALL;
  for (let y = 2; y < 8; y++) for (let x = 7; x < 13; x++) tall.cells[tall.idx(x, y)] = id;
  tall.dirty.rebuild(tall.cells, tall.overlay, tall.width, tall.height);
  let fall = -1;
  for (let t = 1; t <= 1200 && fall < 0; t++) {
    s1.step();
    for (let x = 1; x < 19; x++) if (tall.get(x, 57) === id) fall = t;
  }

  Math.random = mulberry32(SEED_BASE + 0xa5a5);
  const wide = new Grid(60, 20);
  const s2 = new Simulation(wide);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 60; x++)
      if (x === 0 || x === 59 || y >= 18) wide.cells[wide.idx(x, y)] = WALL;
  for (let y = 11; y < 17; y++) for (let x = 27; x < 33; x++) wide.cells[wide.idx(x, y)] = id;
  wide.dirty.rebuild(wide.cells, wide.overlay, wide.width, wide.height);
  for (let t = 0; t < 300; t++) s2.step();
  const cols = new Set<number>();
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 60; x++) if (wide.get(x, y) === id) cols.add(x);
  return { fall, cols: cols.size };
}

// The bar. Before the fix a settling Slime blob averaged ~15 holes and Honey ~14
// (peaks in the 40s); after, both sit near 3. 6 is clear of both.
const PITTING_BAR = 6;

for (const name of ['Slime', 'Acid Slime', 'Honey']) {
  const r = pitting(ID(name));
  check(`${name} settles without pitting into holes`, r.avg < PITTING_BAR,
    `avg ${r.avg.toFixed(1)} enclosed holes per tick (peak ${r.peak})`);
}

// The controls: neither ever had the artifact, because each has only one of the
// two throttles. If a future change made these pit, the diagnosis in
// collapseVoidBelow's comment would be wrong.
for (const name of ['Lava', 'Mud']) {
  const r = pitting(ID(name));
  check(`${name} never pitted (only one throttle) and still doesn't`, r.avg < PITTING_BAR,
    `avg ${r.avg.toFixed(1)}`);
}

// …and the goo is still goo. Water is the yardstick in both directions: it falls
// 40 cells in ~35 ticks and levels right out, so anything near those numbers has
// stopped being viscous.
{
  const water = ooze(ID('Water'));
  check('the yardstick: water falls fast and levels out', water.fall > 0 && water.fall < 60 && water.cols > 28,
    `${water.fall} ticks, ${water.cols} columns`);
  for (const name of ['Slime', 'Honey']) {
    const r = ooze(ID(name));
    check(`${name} still falls at goo pace`, r.fall > water.fall * 2,
      `${r.fall} ticks vs water's ${water.fall}`);
    check(`…and still holds a mound instead of levelling`, r.cols < water.cols * 0.75,
      `${r.cols} columns vs water's ${water.cols}`);
  }
}

console.log(failures === 0 ? '\nAll goo void checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
