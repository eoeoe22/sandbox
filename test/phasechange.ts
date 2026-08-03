// Headless harness for the declarative 상전이 pass — `Material.phaseChange`
// (engine/types.ts) applied by `tryPhaseChange` (materials/phasechange.ts).
//
// The whole point of moving melting points out of two dozen `update` bodies and
// onto the materials is that they become *readable* — by the palette, by a codex
// page, by this file. So the checks here are a registry sweep rather than a list
// of hand-picked scenes: every material that declares a transition is heated (or
// chilled) past its own threshold and has to actually change, and is then held
// just short of it and has to survive. Adding a new phase pair needs no edit
// here; it is covered the moment it is declared.
//
// What each half is for:
//
//   • **the resolution check** — both `at` and `into` are thunks, and this is
//     the check that says why. A register literal is built during module load,
//     in the middle of the melt/freeze pairs' import cycles (glass ↔ molten
//     glass, iron ↔ molten iron, ice ↔ water), so an eagerly-read
//     `IRON_MELT_TEMP` lands as `undefined`. That is not a crash: `t < undefined`
//     is false, the guard inverts, and every iron cell in the world melts on its
//     first tick at room temperature. Iron, Glass, Broken Glass and Ice all did
//     exactly that before the thunks went in. This check reads every declaration
//     and fails on the `undefined`, and the control below fails on the symptom.
//   • **the transition** — a declaration is inert unless the material's `update`
//     actually calls the pass, so declaring one and forgetting the call is the
//     new way to fail silently. Heating each material until it changes is the
//     only way to catch that.
//   • **the control** — held just under (or just over) its threshold, nothing
//     transitions. This is what an inverted or `undefined` threshold breaks.
//   • **hysteresis** — a melt point and its partner's set point must be spaced
//     apart, so the product of a transition is not immediately dragged back
//     across at the very temperature that produced it. Swept off the pairs, so
//     retuning either end of a pair too close to the other fails here.
//   • **ordering** — the pass is deliberately called from each material's own
//     `update` rather than driven by the engine, because Lava has to answer
//     water before it answers its own thermometer. That exception is the reason
//     for the design, so it gets a scene.
//
// Run: `node test/run-phasechange.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { allMaterials, getMaterial } from '../src/game/materials/registry';
import type { Material } from '../src/game/engine/types';
import { LAVA } from '../src/game/materials/lava';
import { WATER } from '../src/game/materials/water';
import { OBSIDIAN } from '../src/game/materials/obsidian';
import { STONE } from '../src/game/materials/stone';
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
Math.random = mulberry32(7);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const declared = allMaterials().filter((m) => m.phaseChange !== undefined);

// ── 1. Every declaration resolves ───────────────────────────────────────────
{
  const broken: string[] = [];
  for (const m of declared) {
    const pc = m.phaseChange!;
    const at = pc.at();
    const into = pc.into();
    if (!Number.isFinite(at)) broken.push(`${m.name}.at = ${at}`);
    if (getMaterial(into) === undefined) broken.push(`${m.name}.into = ${into} (unregistered)`);
    if (into === m.id) broken.push(`${m.name} transitions into itself`);
  }
  check(
    'every declared 상전이 resolves to a real threshold and a real material',
    broken.length === 0,
    broken.length ? broken.join('; ') : `${declared.length} declarations`,
  );
  // A sanity floor on the sweep itself: if an import ever stops pulling the
  // materials in, `declared` goes empty and every check below passes vacuously.
  check('…and the sweep actually found the roster', declared.length >= 20, `${declared.length} materials`);
}

const SIZE = 24;
const BLOCK = 4; // a 4×4 test block, small enough that nothing reaches the edges

/**
 * Stand a block of `m` in the middle of an empty world and hold that *whole
 * world* at `temp` for `ticks`, re-pinning every cell before each step. Pinning
 * globally rather than just the block is deliberate: with no gradient anywhere
 * there is no diffusion to argue about, so "it changed" can only mean the
 * threshold was crossed. The grid's default `wall` border keeps a product that
 * drifts — a vapour, a puff of smoke — inside the world to be counted.
 */
function hold(m: Material, temp: number, ticks = 10): { left: number; product: number } {
  const grid = new Grid(SIZE, SIZE);
  const sim = new Simulation(grid);
  const x0 = (SIZE - BLOCK) >> 1;
  const y0 = (SIZE - BLOCK) >> 1;
  for (let y = y0; y < y0 + BLOCK; y++)
    for (let x = x0; x < x0 + BLOCK; x++) grid.set(x, y, m.id);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);

  const into = m.phaseChange!.into();
  for (let t = 0; t < ticks; t++) {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) grid.setTemp(x, y, temp);
    sim.step();
  }
  let left = 0;
  let product = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === m.id) left++;
    else if (grid.cells[i] === into) product++;
  }
  return { left, product };
}

// ── 2. Held past its threshold, every material actually transitions ─────────
// This is the check that a declaration without a `tryPhaseChange` call fails.
{
  const stuck: string[] = [];
  for (const m of declared) {
    const pc = m.phaseChange!;
    const past = pc.when === 'atOrAbove' ? pc.at() + 20 : pc.at() - 20;
    const { left, product } = hold(m, past);
    if (left !== 0 || product === 0) {
      stuck.push(`${m.name} (${left} left, ${product} → ${getMaterial(pc.into()).name})`);
    }
  }
  check(
    'every material held past its threshold becomes what it declares',
    stuck.length === 0,
    stuck.length ? stuck.join('; ') : `${declared.length} transitions fired`,
  );
}

// ── 3. …and held just short of it, none of them do ──────────────────────────
// The direct control for an inverted or `undefined` threshold: those melt the
// world at room temperature, which is exactly what this scene is.
{
  const leaked: string[] = [];
  for (const m of declared) {
    const pc = m.phaseChange!;
    const shy = pc.when === 'atOrAbove' ? pc.at() - 20 : pc.at() + 20;
    const { left, product } = hold(m, shy);
    // Tolerant by two cells rather than exact, because a couple of materials do
    // something else at these temperatures that this pass has no part in — Dry
    // Ice keeps its slow leak into CO₂ well below its sublimation point.
    if (left < BLOCK * BLOCK - 2) {
      leaked.push(`${m.name} (${left}/${BLOCK * BLOCK} left, ${product} → ${getMaterial(pc.into()).name})`);
    }
  }
  check(
    '…and none of them transitions while held just short of it',
    leaked.length === 0,
    leaked.length ? leaked.join('; ') : `${declared.length} materials held`,
  );
}

// ── 4. Hysteresis: a pair's two set points are spaced apart ─────────────────
// Sand fuses at 1250 and Molten Glass sets at 1050, so the fresh melt is not
// dragged straight back to Glass at the very temperature that made it. Checked
// off the declarations rather than by eye, so pulling either end of a pair
// toward the other — which would make the boundary flicker every tick — fails
// here first.
{
  const flapping: string[] = [];
  for (const m of declared) {
    const pc = m.phaseChange!;
    const product = getMaterial(pc.into());
    const back = product.phaseChange;
    if (back === undefined) continue;
    const at = pc.at();
    const fires = back.when === 'atOrAbove' ? at >= back.at() : at <= back.at();
    if (fires) {
      flapping.push(`${m.name}@${at} → ${product.name}, which changes back at ${back.at()}`);
    }
  }
  check(
    'no pair flips back at the very temperature that produced it (hysteresis)',
    flapping.length === 0,
    flapping.length ? flapping.join('; ') : 'every pair is spaced',
  );
}

// ── 5. Ordering: Lava answers water before it answers its thermometer ───────
// The reason `tryPhaseChange` is called from each material's `update` instead of
// being driven by the engine ahead of it. Lava chilled to its set point while
// touching water is Obsidian, not Stone — the quench runs first and this pass
// never gets a turn. Drive the pass from the engine and this scene silently
// starts producing grey rock.
{
  const grid = new Grid(SIZE, SIZE);
  const sim = new Simulation(grid);
  const lavaFreeze = LAVA.phaseChange!.at();
  for (let y = 14; y < 18; y++) for (let x = 10; x < 14; x++) grid.set(x, y, LAVA.id);
  for (let x = 10; x < 14; x++) grid.set(x, 13, WATER.id);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  // At the set point exactly: cold enough that the declared transition would
  // fire this tick if it were consulted first.
  for (let y = 14; y < 18; y++) for (let x = 10; x < 14; x++) grid.setTemp(x, y, lavaFreeze);
  sim.step();
  // Only the face under the water is the quench's business — the lava deeper in
  // the block is untouched by it and sets to Stone on its own, correctly. So the
  // row directly beneath the water is what this scene reads.
  let obsidian = 0;
  let stone = 0;
  for (let x = 10; x < 14; x++) {
    if (grid.get(x, 14) === OBSIDIAN.id) obsidian++;
    else if (grid.get(x, 14) === STONE.id) stone++;
  }
  check(
    'lava at its set point but touching water quenches to Obsidian, not Stone',
    obsidian === 4 && stone === 0,
    `contact row: ${obsidian} obsidian, ${stone} stone`,
  );
}

// ── 6. …and with the water taken away, the same lava does set to Stone ──────
// The control for the scene above: same geometry, same temperature, no water —
// so "it wasn't Stone" above can only mean the quench won the race, not that the
// declared transition is broken.
{
  const grid = new Grid(SIZE, SIZE);
  const sim = new Simulation(grid);
  const lavaFreeze = LAVA.phaseChange!.at();
  for (let y = 14; y < 18; y++) for (let x = 10; x < 14; x++) grid.set(x, y, LAVA.id);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  for (let t = 0; t < 3; t++) {
    for (let y = 14; y < 18; y++) for (let x = 10; x < 14; x++) grid.setTemp(x, y, lavaFreeze);
    sim.step();
  }
  let stone = 0;
  let obsidian = 0;
  for (let x = 10; x < 14; x++) {
    if (grid.get(x, 14) === STONE.id) stone++;
    else if (grid.get(x, 14) === OBSIDIAN.id) obsidian++;
  }
  check(
    '…while the same row with no water over it sets to Stone',
    stone === 4 && obsidian === 0,
    `contact row: ${stone} stone, ${obsidian} obsidian`,
  );
}

console.log(failures === 0 ? '\nAll 상전이 checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
