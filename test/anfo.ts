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
import { DEBRIS } from '../src/game/materials/debris';
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
/** Every cell of `fluid` in the world, wherever it currently lives: a primary
 *  cell, an overlap occupant, or the payload of a Debris fragment in flight.
 *  Conservation is phrased in this so "it drained away" and "it was consumed"
 *  can't be confused for one another (borrowed from test/overlap.ts). */
function fluidTotal(grid: Grid, fluid: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === fluid) n++;
    else if (grid.cells[i] === DEBRIS.id && grid.aux[i] === fluid) n++;
    if (grid.overlay[i] === fluid) n++;
  }
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

// 1. The soak converts — gradually — and eats the fuel doing it.
{
  for (const fuel of [DIESEL, KEROSENE]) {
    const { grid, sim } = makeWorld(40, 40);
    floor(grid, 36);
    soakedBed(grid, 10, 30, 30, 36, fuel.id);
    const prills = count(grid, AMMONIUM_NITRATE.id);

    // Gradual, not a flip: a bed soaked through and through must still be mostly
    // bare prill a handful of ticks in. This is the pin on MIX_CHANCE actually
    // gating anything — remove the gate and this is 100% on tick one.
    for (let t = 0; t < 5; t++) sim.step();
    const early = count(grid, ANFO.id);
    check(
      `${fuel.name}: 전환은 서서히 일어난다 (몇 틱 만에 다 바뀌지 않는다)`,
      early < prills * 0.5,
      `${early}/${prills} after 5 ticks`,
    );

    for (let t = 0; t < 400; t++) sim.step();
    const made = count(grid, ANFO.id);
    check(
      `${fuel.name}: 시간이 지나면 젖은 프릴이 ANFO가 된다`,
      made > prills * 0.5,
      `${made}/${prills} converted`,
    );
    // One drop makes one grain: every fuel cell either still exists somewhere
    // (soaked, or drained back out as a primary cell) or was drunk by exactly
    // one conversion. This is what makes "부은 만큼만 만들어진다" true.
    check(
      `${fuel.name}: 마신 만큼만 소비된다 (전환 1칸당 연료 1칸)`,
      made + fluidTotal(grid, fuel.id) === prills,
      `${made} made + ${fluidTotal(grid, fuel.id)} left vs ${prills} poured`,
    );
  }
}

// 2. Water. The prill is an ordinary powder now — no `overlapFluids` allowlist —
//    so water soaks into it like water into sand. Two things must hold: it is
//    not a fuel (never makes ANFO), and a grain wet on the *inside* must still
//    count as wet. That second one is the whole reason the misfire check reads
//    the 겹침 slot: a scene that only ever puts water beside the charge passes
//    either way and proves nothing.
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
    '…하지만 보통 가루처럼 스며들기는 한다',
    countSoakedInto(grid, AMMONIUM_NITRATE.id, WATER.id) > 0,
    `${countSoakedInto(grid, AMMONIUM_NITRATE.id, WATER.id)} grains soaked`,
  );
}

// 2b. …and a grain wet on the INSIDE is a dud, with no water anywhere near it as
//     a primary cell. This is the exact hole the soaked read closes: before it,
//     a charge whose own slot was full of water detonated happily, because the
//     misfire scan only ever looked at its neighbors.
//
//     Water is written straight into the slot rather than poured, for two
//     reasons: a pour only wets a fraction of the grains (so the dry majority
//     would chain and the scene would prove nothing about the wet ones), and
//     this way the charge's neighbors are all bone-dry charge — the *only*
//     signal available is the slot. Held at 500°, which is over the 300°
//     decomposition point and also over the cold pack's 80° tempMax, so the
//     dissolution rule can't quietly remove the grains instead.
{
  for (const charge of [AMMONIUM_NITRATE, AMMONAL]) {
    const { grid, sim } = makeWorld(40, 40);
    floor(grid, 36);
    for (let y = 30; y < 36; y++)
      for (let x = 10; x < 30; x++) {
        grid.set(x, y, charge.id);
        grid.setOverlay(x, y, WATER.id);
        grid.setTemp(x, y, 500);
      }
    const before = count(grid, charge.id);
    const soakedGrains = countSoakedInto(grid, charge.id, WATER.id);
    sim.step();
    const after = count(grid, charge.id);
    check(
      `${charge.name}: 속이 젖은 장약은 500°에도 불발 (이웃엔 물이 없다)`,
      soakedGrains === before && after === before,
      `${after}/${before} left, ${soakedGrains} internally wet`,
    );
  }
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

// 5. ANFO is the family's exception: wet, it still goes off — pitifully. The
//    fuel coating means the grain never dissolves, so there is always something
//    left to fire, unlike the prill and Ammonal (scene 2b). Both halves matter:
//    it must NOT be a dud, and it must be drastically weaker.
{
  // "It fired" is measured as damage done, not as every grain being gone: a wet
  // charge is `soloSource` (see anfo.ts), so it chains grain by grain rather
  // than going up as one surveyed mass, and a fixed tick budget can end with
  // some of it still burning down. A genuine dud craters zero.
  function crater(soak: boolean): { stone: number } {
    const { grid, sim } = makeWorld(160, 160);
    floor(grid, 120);
    const before = count(grid, STONE.id);
    for (let x = 68; x < 92; x++) grid.set(x, 119, ANFO.id);
    // Water written straight into the 겹침 slot: the drowned-magazine state,
    // reached deterministically instead of waiting on a pour to percolate.
    if (soak) for (let x = 68; x < 92; x++) grid.setOverlay(x, 119, WATER.id);
    for (let x = 68; x < 92; x++) grid.setTemp(x, 119, 500);
    for (let t = 0; t < 24; t++) sim.step();
    return { stone: before - count(grid, STONE.id) };
  }
  const dry = crater(false);
  const wet = crater(true);
  check('젖은 ANFO도 터지기는 한다 (불발이 아니다)', wet.stone > 0, `${wet.stone} stone cells`);
  check(
    '…하지만 위력이 대폭 줄어든다',
    wet.stone * 4 < dry.stone,
    `${wet.stone} vs ${dry.stone} stone cells (마른 장약 대비)`,
  );
}

// 5b. …and that weakening stays on the wet grain. A detonation's options apply
//     to the whole mass the survey sweeps up, not to the cell that triggered it,
//     so without `soloSource` one damp grain anywhere in a dry magazine drags
//     the entire charge down to the fizzle — and *which* grain reaches its
//     update first decides the yield, which is a scan-order lottery, not a rule.
//     Measured before the fix: 1003 stone dry, 238 with one wet grain at the
//     head of the scan order, 1004 with the same grain at the tail. Both ends
//     are checked here because a fix that only helps one position isn't one.
{
  function crater(wetX: number | null): number {
    const { grid, sim } = makeWorld(200, 200);
    floor(grid, 150);
    const before = count(grid, STONE.id);
    for (let x = 60; x < 140; x++) grid.set(x, 149, ANFO.id);
    if (wetX !== null) grid.setOverlay(wetX, 149, WATER.id);
    for (let x = 60; x < 140; x++) grid.setTemp(x, 149, 500);
    for (let t = 0; t < 30; t++) sim.step();
    return before - count(grid, STONE.id);
  }
  const dry = crater(null);
  for (const [where, x] of [['맨 앞', 60], ['맨 뒤', 139]] as const) {
    const one = crater(x);
    check(
      `마른 장약 속 젖은 알갱이 한 칸(${where})은 전체를 무력화하지 않는다`,
      one > dry * 0.8,
      `${one} vs ${dry} stone cells`,
    );
  }
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
