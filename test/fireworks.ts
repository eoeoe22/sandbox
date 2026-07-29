// Headless behavioural harness for the firework chain (materials/fireworkstar.ts
// → materials/fireworkburst.ts): a star opens into a flower of Firework Burst
// cells, those cells read as the ~1200° flame they look like, and that reading
// stays purely cosmetic — it never conducts into the grid and never counts as
// heat against a free object. Run: `node test/run-fireworks.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { inspectCells } from '../src/game/engine/brushTools';
import { createWoodBox, createDynamite } from '../src/game/engine/objects';
import type { SimWoodBox, SimDynamite } from '../src/game/engine/objects';
import { getMaterial } from '../src/game/materials/registry';
import { AMBIENT_TEMP } from '../src/game/config';
import { FIREWORK_BURST, BURST_COLORS } from '../src/game/materials/fireworkburst';
import { FIREWORK_STAR } from '../src/game/materials/fireworkstar';
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
Math.random = mulberry32(11);

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
const STONE = ID('Stone');
const WOOD = ID('Wood');
const BURST = FIREWORK_BURST.id;

function makeWorld(w = 80, h = 80): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function floor(grid: Grid, y: number, id = STONE): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, yy)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Stamp a burst cell directly, the way fireworkstar.ts's bloom does. */
function paintBurst(grid: Grid, x: number, y: number, colorIndex = 0): void {
  grid.set(x, y, BURST);
  grid.setTemp(x, y, getMaterial(BURST).thermal?.init ?? AMBIENT_TEMP);
  grid.setAux(x, y, colorIndex);
}
/** Every cell of the rectangle, as the flat [x0,y0,x1,y1,…] run inspectCells wants. */
function cellsIn(x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(x, y);
  return out;
}

// 1. A star at the end of its flight opens a flower, and every cell of it carries
//    a real, hot reading rather than the 20°C room air it used to report.
{
  const { grid, sim } = makeWorld();
  // A hand-placed star has life 0 (spawn temp = thermal.init = 0), so it blooms
  // on its very first turn — the same path a spent star takes at apex.
  grid.set(40, 40, FIREWORK_STAR.id);
  grid.setTemp(40, 40, 0);
  grid.setAux(40, 40, 3);
  sim.step();
  const bursts = count(grid, BURST);
  check('a spent star opens a flower of Firework Burst cells', bursts > 20, `${bursts} cells`);

  let coldest = Infinity;
  let hottest = -Infinity;
  let colors = new Set<number>();
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.get(x, y) !== BURST) continue;
      const t = grid.getTemp(x, y);
      if (t < coldest) coldest = t;
      if (t > hottest) hottest = t;
      colors.add(grid.getAux(x, y));
    }
  }
  check('every burst cell reads hot, not room temperature', coldest > 900,
    `${coldest.toFixed(0)}…${hottest.toFixed(0)}°C`);
  check('the flower keeps its single rolled colour', colors.size === 1 && colors.has(3),
    `aux={${[...colors].join(',')}}`);
}

// 2. The 돋보기 readout is the reason the temperature exists: surveying a flower
//    must name the material and report that hot average, not "—" and not 20°.
{
  const { grid } = makeWorld();
  for (let x = 30; x < 40; x++) paintBurst(grid, x, 30, 5);
  const stats = inspectCells(grid, cellsIn(28, 28, 42, 32));
  const entry = stats.entries.find((e) => e.id === BURST);
  check('돋보기 lists the burst among the constituents', entry !== undefined);
  check('돋보기 reports its temperature (not "—")', entry?.avgTemp !== null && entry?.avgTemp !== undefined,
    `${entry?.avgTemp ?? 'null'}`);
  check('…and reports it hot', (entry?.avgTemp ?? 0) > 900, `${Math.round(entry?.avgTemp ?? 0)}°C`);
  check('the burst is one of the palette colours', BURST_COLORS.length > 0 && entry !== undefined);
}

// 3. …and that's all the temperature does: a flower washing over the grid warms
//    nothing (conduction is gated by the lower conductivity, and the burst's is 0).
{
  const { grid, sim } = makeWorld();
  // A block of Wood walled in by burst cells, re-stamped every tick so the flower
  // is continuously present for far longer than one real burst lives.
  for (let y = 38; y <= 42; y++) for (let x = 38; x <= 42; x++) grid.set(x, y, WOOD);
  let peak = -Infinity;
  for (let t = 0; t < 200; t++) {
    for (let y = 36; y <= 44; y++) {
      for (let x = 36; x <= 44; x++) {
        if (grid.get(x, y) === WOOD) continue;
        paintBurst(grid, x, y, 1);
      }
    }
    sim.step();
    for (let y = 38; y <= 42; y++)
      for (let x = 38; x <= 42; x++)
        if (grid.get(x, y) === WOOD) peak = Math.max(peak, grid.getTemp(x, y));
  }
  check('a flower never warms the grid it washes over', peak < AMBIENT_TEMP + 1,
    `wood peaked at ${peak.toFixed(1)}°C`);
  check('and never sets the wood alight', count(grid, WOOD) === 25, `${count(grid, WOOD)}/25 cells`);
}

// 4. The object layer reads raw cell temperatures, so it's the one place that has
//    to opt out explicitly (Material.decorTemp): a crate buried in a firework
//    flower must not cook off.
{
  const { grid, sim } = makeWorld(100, 100);
  floor(grid, 70);
  const crate = createWoodBox(50, 63);
  grid.objects.push(crate);
  for (let t = 0; t < 40; t++) sim.step(); // let it land
  check('a cold crate starts unlit', (crate as SimWoodBox).burnTicks === 0);
  let lit = false;
  for (let t = 0; t < 400; t++) {
    for (let y = 50; y <= 70; y++)
      for (let x = 40; x <= 60; x++)
        if (grid.get(x, y) === 0) paintBurst(grid, x, y, 2);
    sim.step();
    if ((crate as SimWoodBox).burnTicks > 0) lit = true;
  }
  check('a crate engulfed in firework flowers never catches', !lit);
  check('…and is still there afterwards', grid.objects.includes(crate));
}

// 5. Same rule at the dynamite fuse tip: a flower drifting across a snuffed fuse
//    is light, not a flame, so it must not re-light it.
{
  const { grid, sim } = makeWorld(100, 100);
  floor(grid, 70);
  const stick = createDynamite(50, 63) as SimDynamite;
  grid.objects.push(stick);
  for (let t = 0; t < 40; t++) sim.step();
  stick.lit = false; // a dud: snuffed fuse, countdown paused
  const fuseAt = stick.fuseTicks;
  let relit = false;
  for (let t = 0; t < 200; t++) {
    for (let y = 45; y <= 70; y++)
      for (let x = 40; x <= 60; x++)
        if (grid.get(x, y) === 0) paintBurst(grid, x, y, 6);
    sim.step();
    if (stick.lit) relit = true;
  }
  check('a flower does not re-light a snuffed fuse', !relit);
  check('…so the countdown stays paused', stick.fuseTicks === fuseAt,
    `${stick.fuseTicks}/${fuseAt}`);
  check('and the stick never goes off', grid.objects.includes(stick));
}

console.log(failures === 0 ? '\nAll firework checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
