// Headless behavioural harness for 산 + 금속 → 수소 (materials/acid.ts's
// `tryEvolveHydrogen`, driven by the `Material.acidHydrogen` tag in
// engine/types.ts). What it pins down:
//
//   • **who fizzes** — every metal above hydrogen in the reactivity series does:
//     Iron and its filings, Uranium (both isotopes), solid Gallium, and the
//     aluminum three that had this behaviour before it was generalized;
//   • **who does not** — the metals *below* hydrogen (Wire's copper core,
//     Mercury) and the oxides/carbonates (Rust, Rust Powder, Iron Ore,
//     Limestone) still dissolve silently, and acid-resistant Nichrome isn't
//     touched at all. A test that only checked "hydrogen appears" would pass
//     just as happily if everything fizzed, which would be the wrong chemistry;
//   • **the ordering is the reactivity series** — read straight off the tags, so
//     a future retune can't quietly put iron above aluminum. Plus the
//     surface-area split each metal keeps between its powder and its bulk form;
//   • **1:1 consumption** — the acid is spent as it works, so a small puddle on a
//     big block of iron stops rather than acting as a free hydrogen catalyst;
//   • **the bubble is born cool** — under Hydrogen's 200° autoignition, so the
//     gas collects and you choose when it goes off (the whole point of the
//     chain), while a *packed* pile still can't be ignited by its own warmth;
//   • **Sodium is the exception** — it takes its own violent path in acid (Fire +
//     hot Hydrogen, and a detonation when packed) rather than the polite fizz,
//     because it is the top of the reactivity series;
//   • **liquids are out of scope by engine rule** — acid corrodes solids and
//     powders only, so a Liquid Gallium puddle is untouched (and Mercury with
//     it).
//
// Run: `node test/run-acidmetal.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { ACID } from '../src/game/materials/acid';
import { HYDROGEN } from '../src/game/materials/hydrogen';
import { IRON } from '../src/game/materials/iron';
import { METAL_POWDER } from '../src/game/materials/metalpowder';
import { ALUMINUM } from '../src/game/materials/aluminum';
import { ALUMINUM_POWDER } from '../src/game/materials/aluminumpowder';
import { ACTIVATED_ALUMINUM } from '../src/game/materials/activatedaluminum';
import { URANIUM } from '../src/game/materials/uranium';
import { U238 } from '../src/game/materials/u238';
import { GALLIUM } from '../src/game/materials/gallium';
import { LIQUID_GALLIUM } from '../src/game/materials/liquidgallium';
import { MERCURY } from '../src/game/materials/mercury';
import { WIRE } from '../src/game/materials/wire';
import { NICHROME } from '../src/game/materials/nichrome';
import { RUST } from '../src/game/materials/rust';
import { RUST_POWDER } from '../src/game/materials/rustpowder';
import { IRON_ORE } from '../src/game/materials/ironore';
import { LIMESTONE } from '../src/game/materials/limestone';
import { SODIUM } from '../src/game/materials/sodium';
import { FIRE } from '../src/game/materials/fire';
import { BLAST } from '../src/game/materials/blast';
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
Math.random = mulberry32(11);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function makeWorld(w = 60, h = 60): { grid: Grid; sim: Simulation } {
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

/**
 * The standard bench: a slab of `id` standing in an acid bath, run for `ticks`.
 * Returns how much hydrogen was ever in the air at once, how much of the slab
 * survived, and the hottest bubble seen — the three numbers every check below
 * is phrased in. The slab is 4 columns wide and reaches the surface, so it has
 * plenty of orthogonal acid contact (acid.ts corrodes over DIR4).
 */
function bath(
  id: number,
  ticks = 300,
  holdTemp = 0,
): { maxH2: number; left: number; hottestH2: number; acidLeft: number } {
  const acidRows = 10;
  const { grid, sim } = makeWorld();
  floor(grid, 50);
  for (let y = 50 - acidRows; y < 50; y++)
    for (let x = 10; x < 50; x++) grid.set(x, y, ACID.id);
  for (let y = 50 - acidRows; y < 50; y++)
    for (let x = 28; x < 32; x++) grid.set(x, y, id);
  let maxH2 = 0;
  let hottestH2 = -Infinity;
  for (let t = 0; t < ticks; t++) {
    // Optionally hold everything above the floor at a temperature — the only way
    // to bench a liquid whose melting point is near room temperature (Gallium
    // sets at 28°). It has to cover the *whole* width, not just the tank: both
    // liquids spread past the bath's edges, and a splash that cooled out there
    // would set into a solid bar and start fizzing after all.
    if (holdTemp > 0)
      for (let y = 0; y < 50; y++)
        for (let x = 0; x < 60; x++) grid.setTemp(x, y, holdTemp);
    sim.step();
    maxH2 = Math.max(maxH2, count(grid, HYDROGEN.id));
    for (let y = 0; y < 50; y++)
      for (let x = 0; x < 60; x++)
        if (grid.get(x, y) === HYDROGEN.id) hottestH2 = Math.max(hottestH2, grid.getTemp(x, y));
  }
  return { maxH2, hottestH2, left: count(grid, id), acidLeft: count(grid, ACID.id) };
}

// 1. The metals that *do* fizz. Every one of these sits above hydrogen in the
//    reactivity series, so acid must not just erase it — the acid cell doing the
//    eating becomes a bubble.
{
  const cases: Array<[string, number]> = [
    ['Iron', IRON.id],
    ['Metal Powder (iron filings)', METAL_POWDER.id],
    ['Uranium (U235)', URANIUM.id],
    ['U238', U238.id],
    ['Gallium', GALLIUM.id],
    ['Aluminum', ALUMINUM.id],
    ['Aluminum Powder', ALUMINUM_POWDER.id],
    ['Activated Aluminum', ACTIVATED_ALUMINUM.id],
  ];
  for (const [name, id] of cases) {
    const r = bath(id);
    check(`${name} standing in acid gives off hydrogen`, r.maxH2 > 0, `${r.maxH2} cells at once`);
  }
}

// 2. …and it really is dissolving while it does it (the fizz is the *ending* of
//    the metal, not a free byproduct sitting on top of the old behaviour).
{
  const r = bath(IRON.id);
  check('…and the iron is eaten away doing it', r.left < 40, `${r.left}/40 cells left`);
}

// 3. The metals that must NOT fizz. Copper (Wire) and Mercury sit *below*
//    hydrogen; Rust/Rust Powder/Iron Ore are oxides and Limestone a carbonate —
//    none of them has hydrogen to give. They may still dissolve (that's acid's
//    own phase-only corrosion, unchanged); what they may never do is bubble.
{
  const cases: Array<[string, number]> = [
    ['Wire (copper core)', WIRE.id],
    ['Rust', RUST.id],
    ['Rust Powder', RUST_POWDER.id],
    ['Iron Ore', IRON_ORE.id],
    ['Limestone', LIMESTONE.id],
  ];
  for (const [name, id] of cases) {
    const r = bath(id);
    check(`${name} dissolves in acid without any hydrogen`, r.maxH2 === 0, `${r.maxH2} cells`);
  }
  // Nichrome is the other kind of "no": acidResistant, so acid can't even eat it.
  const nichrome = bath(NICHROME.id);
  check(
    'acid-resistant Nichrome neither dissolves nor fizzes',
    nichrome.maxH2 === 0 && nichrome.left === 40,
    `${nichrome.left}/40 cells left`,
  );
}

// 4. Liquids are out of scope by engine rule, not by chemistry: acid's corrosion
//    pass looks at Solid/Powder only, so a Liquid Gallium puddle (and Mercury
//    with it) is untouched. Gallium's own switch is temperature — the *solid*
//    bar fizzes, the puddle it melts into does not.
{
  // Held at 40° so it stays a puddle — left at room temperature it would set
  // into solid Gallium (28°) and start fizzing, which is the rule, not a leak.
  const gal = bath(LIQUID_GALLIUM.id, 300, 40);
  check(
    'a Liquid Gallium puddle is untouched by acid (no liquid corrodes)',
    gal.maxH2 === 0 && gal.left === 40,
    `${gal.left}/40 cells left`,
  );
  const frozen = bath(LIQUID_GALLIUM.id);
  check(
    '…but let it cool and set, and the solid bar it becomes does fizz',
    frozen.maxH2 > 0,
    `${frozen.maxH2} cells at once`,
  );
  const merc = bath(MERCURY.id);
  check('…and so is Mercury', merc.maxH2 === 0 && merc.left === 40, `${merc.left}/40 cells left`);
}

// 5. The ordering *is* the reactivity series, read straight off the tags. Doing
//    it statically rather than by counting bubbles is deliberate: neighbouring
//    rates differ by too little to separate reliably in a stochastic run, and
//    this is the thing a future retune could silently break.
{
  const rate = (id: number): number => getMaterial(id).acidHydrogen?.chance ?? 0;
  check(
    'bulk metals are ranked by the reactivity series (U > Al > Fe > Ga)',
    rate(URANIUM.id) > rate(ALUMINUM.id) &&
      rate(ALUMINUM.id) > rate(IRON.id) &&
      rate(IRON.id) > rate(GALLIUM.id),
    `U ${rate(URANIUM.id)} > Al ${rate(ALUMINUM.id)} > Fe ${rate(IRON.id)} > Ga ${rate(GALLIUM.id)}`,
  );
  check(
    'the two uranium isotopes are chemically identical',
    rate(URANIUM.id) === rate(U238.id),
    `U235 ${rate(URANIUM.id)} = U238 ${rate(U238.id)}`,
  );
  check(
    'powder beats bulk in both metals (surface area)',
    rate(METAL_POWDER.id) > rate(IRON.id) && rate(ALUMINUM_POWDER.id) > rate(ALUMINUM.id),
    `Fe ${rate(IRON.id)}→${rate(METAL_POWDER.id)}, Al ${rate(ALUMINUM.id)}→${rate(ALUMINUM_POWDER.id)}`,
  );
  check(
    '…and aluminum dust still outpaces iron dust',
    rate(ALUMINUM_POWDER.id) > rate(METAL_POWDER.id),
    `Al ${rate(ALUMINUM_POWDER.id)} > Fe ${rate(METAL_POWDER.id)}`,
  );
  check(
    'the oxides and the sub-hydrogen metals carry no rate at all',
    rate(RUST.id) === 0 &&
      rate(RUST_POWDER.id) === 0 &&
      rate(IRON_ORE.id) === 0 &&
      rate(WIRE.id) === 0 &&
      rate(MERCURY.id) === 0 &&
      rate(NICHROME.id) === 0,
  );
}

// 6. Iron filings do visibly outrun a solid bar in the tank as well — the one
//    rate gap wide enough (3×) to read off a run rather than off the table.
{
  const bar = bath(IRON.id, 200);
  const dust = bath(METAL_POWDER.id, 200);
  check(
    'iron filings fizz harder than a solid iron bar in the same bath',
    dust.maxH2 > bar.maxH2,
    `${dust.maxH2} vs ${bar.maxH2} cells at once`,
  );
}

// 7. The fizz is 1:1 — one acid cell becomes one bubble and is gone — so the
//    hydrogen a puddle can ever make is capped by the size of the puddle, and
//    the puddle itself runs out rather than eating an iron floor forever.
//    (Acid's plain silent corrosion is *not* 1:1 and never was: a cell only
//    self-consumes at 8% per bite, so the crater is allowed to be bigger than
//    the puddle. It is the gas that is bounded.)
{
  const { grid, sim } = makeWorld();
  floor(grid, 50, IRON.id); // the whole floor is iron this time
  const acidCells = 40;
  for (let x = 10; x < 50; x++) grid.set(x, 49, ACID.id);
  let totalH2 = 0;
  const ironAt = count(grid, IRON.id);
  for (let t = 0; t < 600; t++) {
    sim.step();
    totalH2 = Math.max(totalH2, count(grid, HYDROGEN.id));
  }
  const eaten = ironAt - count(grid, IRON.id);
  check(
    'a puddle of acid on an iron floor runs out instead of eating forever',
    count(grid, ACID.id) === 0 && eaten > 0,
    `${eaten} iron cells eaten by ${acidCells} acid cells, then it stopped`,
  );
  check(
    '…and every bubble it made came out of that acid (1:1)',
    totalH2 <= acidCells,
    `${totalH2} bubbles from ${acidCells} acid cells`,
  );
}

// 8. The bubble is born cool — under Hydrogen's own 200° autoignition — so it
//    rises and collects instead of lighting at birth. That is what makes the
//    산 → 수소 chain a two-stage machine (fill the room, light it later) rather
//    than a firework.
{
  const r = bath(IRON.id);
  check(
    'hydrogen off an iron bar is born below its 200° autoignition',
    r.hottestH2 < 200,
    `hottest bubble ${r.hottestH2.toFixed(1)}°C`,
  );
  const alu = bath(ALUMINUM_POWDER.id);
  check(
    '…and so is hydrogen off the briskest ordinary fizz',
    alu.hottestH2 < 200,
    `hottest bubble ${alu.hottestH2.toFixed(1)}°C`,
  );
}

// 9. Sodium keeps its own violent path in acid rather than being demoted to the
//    polite tag fizz: it is the top of the reactivity series, and it detonates
//    in plain water. A light sprinkle burns…
{
  const { grid, sim } = makeWorld();
  floor(grid, 50);
  for (let y = 44; y < 50; y++) for (let x = 10; x < 50; x++) grid.set(x, y, ACID.id);
  for (let x = 20; x < 24; x++) grid.set(x, 43, SODIUM.id);
  let maxH2 = 0;
  let maxFire = 0;
  let maxBlast = 0;
  for (let t = 0; t < 120; t++) {
    sim.step();
    maxH2 = Math.max(maxH2, count(grid, HYDROGEN.id));
    maxFire = Math.max(maxFire, count(grid, FIRE.id));
    maxBlast = Math.max(maxBlast, count(grid, BLAST.id));
  }
  check(
    'a pinch of sodium on acid fizzles into fire and hydrogen',
    maxH2 > 0 && maxFire > 0,
    `${maxH2} H₂, ${maxFire} fire`,
  );
  check('…and burns off entirely', count(grid, SODIUM.id) === 0);
  check('…without a shockwave — a sprinkle burns, it does not detonate', maxBlast === 0);
  check(
    'sodium is deliberately NOT tagged for the quiet fizz',
    getMaterial(SODIUM.id).acidHydrogen === undefined,
  );
}

// 10. …and a *packed* pile in acid still detonates as one shockwave, exactly as
//     it does in water — 물 조금이면 불, 뭉쳐두면 폭발, and acid is no different.
//     Measured as Blast cells rather than a stone crater on purpose: sodium's
//     destructive power (45) is deliberately under a solid's durability, so this
//     blast heaves and burns rather than levelling stone (see sodium.ts).
{
  const { grid, sim } = makeWorld();
  floor(grid, 50);
  // A 10×10 lump under a proper bath of acid. Both the size and the depth are
  // deliberate: sodium is lighter than acid, so the pile churns as the liquid
  // sinks into it, and a small lump under a thin film can fizzle itself apart
  // grain by grain before any one grain is buried deeply enough to trip the
  // 5-neighbour gate. 뭉쳐두면 폭발 is a statement about mass.
  for (let y = 40; y < 50; y++) for (let x = 25; x < 35; x++) grid.set(x, y, SODIUM.id);
  for (let y = 30; y < 40; y++) for (let x = 15; x < 45; x++) grid.set(x, y, ACID.id);
  let maxBlast = 0;
  for (let t = 0; t < 60; t++) {
    sim.step();
    maxBlast = Math.max(maxBlast, count(grid, BLAST.id));
  }
  check(
    'a packed sodium lump touched by acid goes off as one shockwave',
    maxBlast > 0 && count(grid, SODIUM.id) === 0,
    `${maxBlast} blast cells at once`,
  );
}

console.log(failures === 0 ? '\nAll acid/metal checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
