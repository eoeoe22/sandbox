// Headless behavioural harness for the ammonium nitrate family after ANFO was
// promoted from "a state of the prill" to a material of its own.
//
// Two things changed at once and each can regress without the other noticing:
//
//   • **The soak now converts.** Diesel/Kerosene poured over Ammonium Nitrate
//     used to sit inertly in the 겹침 (overlap) slot and merely get *read* at
//     detonation time to swap in a stronger DetonateOptions. Now the grain that
//     drank it becomes an ANFO cell and the fuel is consumed
//     (ammoniumnitrate.ts). Water must still be refused by the `overlapFluids`
//     allowlist, or the cold pack and the wet-misfire check lose sight of it.
//   • **The whole family scales the same way.** ANFO and Ammonal used to force a
//     fixed `reach`/`power` through DetonateOptions while TNT grew with its
//     connected mass, so a big enough TNT block out-blasted a charge that is
//     nominally stronger. All four now declare `blastRadius`/`destructivePower`
//     and go through the one surveyed √-law (blast.ts `computeReach`). The
//     ordering — prill ≪ ANFO < TNT < Ammonal — is therefore checked at two very
//     different charge sizes, because "correct for one grain" was exactly the
//     property the old model had.
//
// Charges are started at 500°, not just over the 300° decomposition point: the
// heat-diffusion pass runs before a cell's own update, so a charge placed at
// 350° against a cold floor arrives at its own turn already back under the gate
// (measured at 290° — see docs/MATERIAL-SYSTEMS.md).
//
// Run: `node test/run-anfo.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { EMPTY } from '../src/game/engine/types';
import { STONE } from '../src/game/materials/stone';
import { WATER } from '../src/game/materials/water';
import { FIRE } from '../src/game/materials/fire';
import { DIESEL } from '../src/game/materials/diesel';
import { KEROSENE } from '../src/game/materials/kerosene';
import { AMMONIUM_NITRATE } from '../src/game/materials/ammoniumnitrate';
import { ANFO } from '../src/game/materials/anfo';
import { AMMONAL } from '../src/game/materials/ammonal';
import { TNT } from '../src/game/materials/tnt';
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

function makeWorld(w = 80, h = 80): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function floor(grid: Grid, y: number, id = STONE.id): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, yy)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
function countOverlay(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.overlay.length; i++) if (grid.overlay[i] === id) n++;
  return n;
}
/** Overlap occupants of `fluid` sitting specifically inside a `host` grain. The
 *  allowlist question is always about one host, and a world-wide overlay count
 *  answers a different one: the cold pack frosts its own puddle into Snow, which
 *  is a powder with no allowlist and so soaks water perfectly legitimately. */
function countSoakedInto(grid: Grid, host: number, fluid: number): number {
  let n = 0;
  for (let i = 0; i < grid.overlay.length; i++)
    if (grid.overlay[i] === fluid && grid.cells[i] === host) n++;
  return n;
}
function paintHot(grid: Grid, x: number, y: number, id: number, temp: number): void {
  grid.set(x, y, id);
  grid.setTemp(x, y, temp);
}
/** A prill bed with `fluid` already written into every grain's overlap slot —
 *  the state the engine reaches by pouring the fluid over the heap, placed
 *  directly so a scene starts from it deterministically (the same shortcut
 *  test/overlap.ts's `bed` takes). */
function soakedBed(
  grid: Grid,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  fluid: number,
): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      grid.set(x, y, AMMONIUM_NITRATE.id);
      if (fluid !== EMPTY) grid.setOverlay(x, y, fluid);
    }
}

// 1. The soak converts, and eats the fuel doing it.
{
  for (const fuel of [DIESEL, KEROSENE]) {
    const { grid, sim } = makeWorld(40, 40);
    floor(grid, 36);
    soakedBed(grid, 10, 30, 30, 36, fuel.id);
    const prills = count(grid, AMMONIUM_NITRATE.id);
    for (let t = 0; t < 20; t++) sim.step();
    const made = count(grid, ANFO.id);
    check(
      `${fuel.name}에 젖은 프릴은 ANFO가 된다`,
      made === prills && count(grid, AMMONIUM_NITRATE.id) === 0,
      `${made}/${prills} converted`,
    );
    check(
      `…그리고 마신 ${fuel.name}는 소비된다`,
      countOverlay(grid, fuel.id) === 0 && count(grid, fuel.id) === 0,
      `${countOverlay(grid, fuel.id)} soaked / ${count(grid, fuel.id)} loose left`,
    );
  }
}

// 2. Water is not a fuel: it stays outside the grain (the `overlapFluids`
//    allowlist) so the cold pack and the wet-misfire check keep seeing it, and
//    it must never produce ANFO.
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 36);
  for (let y = 30; y < 36; y++) for (let x = 10; x < 30; x++) grid.set(x, y, AMMONIUM_NITRATE.id);
  for (let x = 10; x < 30; x++) grid.set(x, 29, WATER.id);
  for (let t = 0; t < 30; t++) sim.step();
  check(
    '물은 프릴을 ANFO로 만들지 않는다',
    count(grid, ANFO.id) === 0,
    `${count(grid, ANFO.id)} cells`,
  );
  check(
    '…그리고 프릴 안으로 스며들지도 않는다 (겹침 화이트리스트 밖)',
    countSoakedInto(grid, AMMONIUM_NITRATE.id, WATER.id) === 0,
    `${countSoakedInto(grid, AMMONIUM_NITRATE.id, WATER.id)} soaked into prills`,
  );
}

// 3+4. The power order, at two charge sizes. Same scene, same ignition, only the
//      material and the width of the charge change — so the numbers are directly
//      comparable and the only thing under test is the yield each one declares.
{
  function crater(charge: number, width: number): number {
    const { grid, sim } = makeWorld(160, 160);
    floor(grid, 120);
    const before = count(grid, STONE.id);
    const x0 = 80 - (width >> 1);
    for (let x = x0; x < x0 + width; x++) paintHot(grid, x, 119, charge, 500);
    for (let t = 0; t < 24; t++) sim.step();
    return before - count(grid, STONE.id);
  }

  for (const width of [4, 24]) {
    const prill = crater(AMMONIUM_NITRATE.id, width);
    const anfo = crater(ANFO.id, width);
    const tnt = crater(TNT.id, width);
    const ammonal = crater(AMMONAL.id, width);
    const label = width === 4 ? '소량' : '대량';
    check(
      `${label} 장약: 질산암모늄 < ANFO`,
      prill < anfo,
      `${prill} vs ${anfo} stone cells`,
    );
    check(`${label} 장약: ANFO < TNT`, anfo < tnt, `${anfo} vs ${tnt} stone cells`);
    check(
      `${label} 장약: TNT < 암모날`,
      tnt < ammonal,
      `${tnt} vs ${ammonal} stone cells`,
    );
  }
}

// 5. ANFO inherits the prill's wet misfire — the palette-wide "적시면 무력화".
{
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  for (let x = 28; x < 32; x++) paintHot(grid, x, 49, ANFO.id, 500);
  for (let x = 28; x < 32; x++) grid.set(x, 48, WATER.id);
  sim.step();
  check('젖은 ANFO는 불발', count(grid, ANFO.id) > 0, `${count(grid, ANFO.id)} left`);
}

// 6. …and it goes off on a flame alone, no radiant heat needed. A column of Fire
//    rather than one cell: an unfuelled flame may burn out on its own update
//    before the charge beside it ever takes a turn, which would make a
//    single-cell scene a coin flip on the fire's lifetime rather than a check on
//    the charge's trigger list.
{
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  for (let x = 28; x < 32; x++) grid.set(x, 49, ANFO.id);
  for (let y = 46; y < 50; y++) grid.set(27, y, FIRE.id);
  for (let t = 0; t < 10; t++) sim.step();
  check('인접 화염이 ANFO를 기폭시킨다', count(grid, ANFO.id) === 0, `${count(grid, ANFO.id)} left`);
}

// 7. Ammonal keeps its fireball. The reach/power override is gone but the
//    `onCell` repaint is not, and that is the one thing that separates its
//    crater from every other charge's.
{
  // Peak Fire over the run, not Fire at some fixed tick: the fireball is painted
  // in the instant the front passes and then burns out, while both charges are
  // also throwing ordinary embers (any blast over EMBER_MIN_POWER does), so a
  // late sample measures how fast fire dies rather than how much was lit.
  function peakFire(charge: number): number {
    const { grid, sim } = makeWorld(160, 160);
    floor(grid, 120);
    for (let x = 76; x < 84; x++) paintHot(grid, x, 119, charge, 500);
    let peak = 0;
    for (let t = 0; t < 24; t++) {
      sim.step();
      const n = count(grid, FIRE.id);
      if (n > peak) peak = n;
    }
    return peak;
  }
  const ammonal = peakFire(AMMONAL.id);
  const anfo = peakFire(ANFO.id);
  check(
    '암모날은 크레이터를 불로 채운다 (ANFO는 구멍만)',
    // Comfortably more than the ~1.1× that ammonal's slightly wider crater would
    // buy on embers alone, so dropping the `onCell` repaint fails this.
    ammonal > anfo * 1.4,
    `${ammonal} vs ${anfo} fire cells at peak`,
  );
}

// 8. The mixed heap. A half-poured pile really is part ANFO and part bare prill,
//    and because the blast survey walks the connected mass without caring which
//    explosive each cell is, it lands between the two pure charges — the payoff
//    of doing this as a material conversion rather than a per-cell flag.
{
  function crater(fill: (grid: Grid, x: number, y: number) => void): number {
    const { grid, sim } = makeWorld(160, 160);
    floor(grid, 120);
    const before = count(grid, STONE.id);
    for (let x = 68; x < 92; x++) fill(grid, x, 119);
    for (let x = 68; x < 92; x++) grid.setTemp(x, 119, 500);
    for (let t = 0; t < 24; t++) sim.step();
    return before - count(grid, STONE.id);
  }
  const prill = crater((g, x, y) => g.set(x, y, AMMONIUM_NITRATE.id));
  const half = crater((g, x, y) => g.set(x, y, x % 2 ? ANFO.id : AMMONIUM_NITRATE.id));
  const full = crater((g, x, y) => g.set(x, y, ANFO.id));
  check(
    '절반만 적신 더미는 두 순수 장약 사이의 위력을 낸다',
    prill < half && half < full,
    `${prill} < ${half} < ${full} stone cells`,
  );
}

console.log(failures === 0 ? '\nAll ANFO checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
