// Headless behavioural harness for 가용성 — Material.miscible
// (engine/types.ts, SimContext.tryMove's refusal, behaviors.ts's diffuseMiscible).
//
// The tag exists because "섞인다" needs two things at once, and either one alone
// looks broken. Interdiffusion without switching the density sort off is undone
// on the next tick (the lighter partner is pushed straight back up); switching
// the sort off without interdiffusion just means two liquids that sit in layers
// and refuse to pass each other at all. What this file pins down:
//
//   • **Alcohol mixes into Water, and stays mixed.** Poured the wrong way round —
//     alcohol UNDER water, where the density sort would normally float it up in
//     a body — it spreads through the whole column instead of separating, and
//     the control (Gasoline, same density order, no tag) does separate.
//   • **Soapy Water emulsifies the petroleum liquids** — Crude Oil, Gasoline,
//     Kerosene, Diesel — and plain Water does NOT. That contrast is the point of
//     the feature: 물에 기름은 안 섞이지만 비눗물에는 섞인다.
//   • **Soapy Water and Water** blend into each other (a fresh pour leaves no
//     seam), which they could not do before: identical densities meant the sort
//     had nothing to say and nothing else stirred them.
//   • **Nothing is created or destroyed.** Mixing is swaps, so every scene ends
//     with exactly the cell counts it started with.
//   • **The density sort is untouched everywhere else.** Alcohol still floats on
//     Gasoline, and oil still floats on plain water — the tag is a per-pair
//     exemption, not a global switch.
//   • **A frozen cell doesn't wander.** Chilled past its freeze point a liquid
//     acts solid, and the diffusion has to respect that or a frost-rendered cell
//     visibly crawls through its neighbour.
//
// Run: `node test/run-miscible.mjs`.
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
/** Each block runs on its own seeded stream, so a change to one scene can't
 *  shift every later scene's randomness. Set SEED_BASE to re-run the whole
 *  harness on a different stream (`SEED_BASE=7 node test/run-miscible.mjs`) —
 *  nothing here is tuned to one lucky seed. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x5011);
let reseeds = 0;
function reseed(): void {
  Math.random = mulberry32(SEED_BASE + ++reseeds * 0x9e37);
}
reseed();

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
const WATER = ID('Water');
const ALCOHOL = ID('Alcohol');
const SOAPY_WATER = ID('Soapy Water');
const OIL = ID('Crude Oil');
const GASOLINE = ID('Gasoline');
const KEROSENE = ID('Kerosene');
const DIESEL = ID('Diesel');
const SAND = ID('Sand');

function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = grid.idx(x, y);
      grid.cells[i] = id;
      grid.aux[i] = 0;
      grid.tint[i] = (Math.random() * 256) | 0;
    }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** How many cells of `id` sit in rows [y0, y1]. */
function countIn(grid: Grid, id: number, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = 0; x < grid.width; x++) if (grid.get(x, y) === id) n++;
  return n;
}

// A sealed, completely full box: wall border, `topId` filling the upper half and
// `botId` the lower one, with no empty cell anywhere inside. That emptiness
// matters — with nowhere to flow, the ONLY thing that can move a cell is a
// density swap or the miscible interdiffusion, so a scene's outcome is about the
// pair and nothing else. Returns the box's interior bounds.
const BOX = { x0: 1, y0: 1, x1: 24, y1: 24 };
const MID = (BOX.y0 + BOX.y1 - 1) >> 1; // last row of the top half
function layered(topId: number, botId: number): { grid: Grid; sim: Simulation } {
  const grid = new Grid(26, 26);
  const sim = new Simulation(grid);
  fill(grid, 0, 0, 25, 25, WALL);
  fill(grid, BOX.x0, BOX.y0, BOX.x1, MID, topId);
  fill(grid, BOX.x0, MID + 1, BOX.x1, BOX.y1, botId);
  return { grid, sim };
}
/** Fraction of `id`'s cells that have crossed into the *other* half of the box
 *  from the one they were poured into — 0 = still perfectly layered, 0.5 = fully
 *  mixed (the material is spread evenly through both halves). */
function crossed(grid: Grid, id: number, startedOnTop: boolean): number {
  const total = count(grid, id);
  if (total === 0) return 0;
  const away = startedOnTop
    ? countIn(grid, id, MID + 1, BOX.y1)
    : countIn(grid, id, BOX.y0, MID);
  return away / total;
}

// The two bars every scene below is scored against, both read off `crossed`:
// how much of a poured layer has ended up in the *other* half of the box.
//
// A perfectly homogeneous mixture scores 0.5 and a pair that never mixed at all
// scores 0 — but "0.5 after 600 ticks" is not the right expectation for a
// diffusive process, which spreads as the square root of time and takes far
// longer than a scene to finish. Measured, a miscible pair lands between 0.30
// and 0.42 over these runs (alcohol/water at the top, the heavier oils at the
// bottom), so the bar sits under all of that with room for seed noise. It is a
// long way from ambiguous either way: the *layered* controls score 1.00, not
// 0.5 — a floated-out layer has crossed completely — which is why the two bars
// can be this far apart and still both be sharp.
const MIXED_BAR = 0.25;
const SEPARATED_BAR = 0.85;

// 1. The headline: Alcohol poured UNDER water. The density sort would normally
//    float the whole layer up (alcohol 1.9 vs water 3) and hand back two clean
//    layers the other way round; miscibility means it disperses into the column
//    instead. The box is sealed and full, so nothing but the pair's own rules is
//    at work.
{
  reseed();
  const { grid, sim } = layered(WATER, ALCOHOL);
  const alcohol0 = count(grid, ALCOHOL);
  const water0 = count(grid, WATER);
  for (let t = 0; t < 600; t++) sim.step();
  const up = crossed(grid, ALCOHOL, false);
  check('alcohol poured under water disperses through the column', up > MIXED_BAR,
    `${(up * 100).toFixed(0)}% of it is in the far half (0% = layered, 50% = even)`);
  check('…and mixing neither creates nor destroys a cell',
    count(grid, ALCOHOL) === alcohol0 && count(grid, WATER) === water0,
    `${count(grid, ALCOHOL)}/${alcohol0} alcohol, ${count(grid, WATER)}/${water0} water`);
}

// 2. The control for #1, and the proof the mechanism is per-pair and not a
//    global "liquids no longer sort": Gasoline is lighter than water in exactly
//    the same way alcohol is, carries no `miscible` tag, and separates.
{
  reseed();
  const { grid, sim } = layered(WATER, GASOLINE);
  for (let t = 0; t < 600; t++) sim.step();
  const up = crossed(grid, GASOLINE, false);
  check('gasoline under water floats out instead of mixing (untagged control)', up > SEPARATED_BAR,
    `${(up * 100).toFixed(0)}% of it reached the top half`);
}

// 3. …and the other direction of the same control: a fair pour, alcohol on top,
//    still ends mixed. (#1 could in principle be satisfied by a pair that simply
//    refuses to move at all, if the sort were the only thing that ever moved
//    them; starting already-sorted removes that reading — nothing here has any
//    reason to move except the interdiffusion.)
{
  reseed();
  const { grid, sim } = layered(ALCOHOL, WATER);
  for (let t = 0; t < 600; t++) sim.step();
  const down = crossed(grid, ALCOHOL, true);
  check('alcohol poured on top of water sinks in too', down > MIXED_BAR,
    `${(down * 100).toFixed(0)}% of it is in the far half`);
}

// 4. Once mixed it STAYS mixed — the property the tag's tryMove half exists for.
//    A pre-stirred solution left alone must not slowly re-sort into layers.
{
  reseed();
  const grid = new Grid(26, 26);
  const sim = new Simulation(grid);
  fill(grid, 0, 0, 25, 25, WALL);
  // Checkerboard the two through the whole box: the most thoroughly mixed state
  // there is, and the one a density sort would unpick fastest if it still ran.
  for (let y = BOX.y0; y <= BOX.y1; y++)
    for (let x = BOX.x0; x <= BOX.x1; x++)
      fill(grid, x, y, x, y, (x + y) % 2 === 0 ? ALCOHOL : WATER);
  for (let t = 0; t < 900; t++) sim.step();
  const top = countIn(grid, ALCOHOL, BOX.y0, MID);
  const total = count(grid, ALCOHOL);
  const share = top / total;
  check('a stirred alcohol/water solution does not re-separate', share < 0.65,
    `${(share * 100).toFixed(0)}% of the alcohol ended in the top half (50% = still mixed, 100% = separated)`);
}

// 5. 비눗물 + 기름 — all four petroleum liquids, each against the plain-Water
//    control in the same breath. This is the pair the feature was asked for:
//    soap is a surfactant, so the slick that rides on water in a hard flat layer
//    gets pulled apart and stirred through a soapy pool instead. Nothing
//    transforms — the oil is still oil, and still burns.
for (const [name, oilId] of [
  ['crude oil', OIL],
  ['gasoline', GASOLINE],
  ['kerosene', KEROSENE],
  ['diesel', DIESEL],
] as const) {
  reseed();
  const soapy = layered(SOAPY_WATER, oilId);
  const oil0 = count(soapy.grid, oilId);
  for (let t = 0; t < 600; t++) soapy.sim.step();
  const mixed = crossed(soapy.grid, oilId, false);

  reseed();
  const plain = layered(WATER, oilId);
  for (let t = 0; t < 600; t++) plain.sim.step();
  const layeredShare = crossed(plain.grid, oilId, false);

  check(`${name} under soapy water is emulsified through it`, mixed > MIXED_BAR,
    `${(mixed * 100).toFixed(0)}% crossed into the far half`);
  check(`…while under plain water the same oil floats out (control)`, layeredShare > SEPARATED_BAR,
    `${(layeredShare * 100).toFixed(0)}% reached the top half`);
  check(`…and the oil is still oil — nothing transformed it`,
    count(soapy.grid, oilId) === oil0, `${count(soapy.grid, oilId)} of ${oil0} left`);
}

// 6. 비눗물 + 물. Same density (3), so the sort never had an opinion about this
//    pair and they simply sat in whatever layers they were poured in. Now a
//    fresh pour blends into the pool instead of leaving a visible seam.
{
  reseed();
  const { grid, sim } = layered(SOAPY_WATER, WATER);
  for (let t = 0; t < 600; t++) sim.step();
  const down = crossed(grid, SOAPY_WATER, true);
  check('soapy water blends into plain water', down > MIXED_BAR,
    `${(down * 100).toFixed(0)}% crossed into the far half`);
}

// 7. The tag is an exemption for the *listed* pair only. Alcohol is miscible with
//    water and with nothing else, so it must still float on gasoline exactly as
//    it always did — the sort is alive and well everywhere it wasn't switched off.
{
  reseed();
  const { grid, sim } = layered(GASOLINE, ALCOHOL);
  for (let t = 0; t < 600; t++) sim.step();
  const up = crossed(grid, ALCOHOL, false);
  check('alcohol still floats up through gasoline (unlisted pair still sorts)', up > SEPARATED_BAR,
    `${(up * 100).toFixed(0)}% of it reached the top half`);
}

// 8. Frozen cells hold still. Alcohol freezes at -80°, so a column chilled past
//    that is a frost-rendered solid in all but name and must not crawl into the
//    water beside it — the same guard `diffuseWith` has always had.
{
  reseed();
  const grid = new Grid(26, 26);
  const sim = new Simulation(grid);
  fill(grid, 0, 0, 25, 25, WALL);
  fill(grid, BOX.x0, BOX.y0, BOX.x1, BOX.y1, WATER);
  fill(grid, 10, BOX.y0, 15, BOX.y1, ALCOHOL);
  // Hold the whole box far below alcohol's freeze point every tick — the heat
  // kernel would otherwise pull it back toward ambient as the scene runs.
  for (let t = 0; t < 400; t++) {
    for (let y = BOX.y0; y <= BOX.y1; y++)
      for (let x = BOX.x0; x <= BOX.x1; x++) grid.setTemp(x, y, -120);
    sim.step();
  }
  let strays = 0;
  for (let y = BOX.y0; y <= BOX.y1; y++)
    for (let x = BOX.x0; x <= BOX.x1; x++)
      if (grid.get(x, y) === ALCOHOL && (x < 10 || x > 15)) strays++;
  check('frozen alcohol does not diffuse into the water beside it', strays === 0,
    `${strays} cells wandered out of the frozen column`);
}

// 9. Solids and powders are untouched by any of this: a sand pile in a mixed
//    alcohol/water pool still sinks to the floor. (The tryMove change sits on the
//    displacement path every falling grain uses, so this is the guard that says
//    it only ever answers for the pair that asked.)
{
  reseed();
  const grid = new Grid(26, 40);
  const sim = new Simulation(grid);
  fill(grid, 0, 0, 25, 39, WALL);
  fill(grid, 1, 1, 24, 38, WATER);
  fill(grid, 1, 1, 24, 12, ALCOHOL);
  fill(grid, 10, 2, 15, 4, SAND);
  for (let t = 0; t < 600; t++) sim.step();
  const sandLow = countIn(grid, SAND, 30, 38);
  check('sand still sinks through a mixing alcohol/water pool', sandLow === count(grid, SAND),
    `${sandLow} of ${count(grid, SAND)} grains reached the floor`);
}

console.log(
  failures === 0 ? '\nALL PASS' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
