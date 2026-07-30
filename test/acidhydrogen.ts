// Headless behavioural harness for **산 + 금속 → 수소** — the shared acid-metal
// reaction (materials/acidhydrogen.ts, `Material.acidHydrogen`) and the metal it
// was added for, Zinc (materials/zinc.ts → materials/moltenzinc.ts).
//
// What it pins down:
//
//   • the roster is the activity series, not "every metal" — Zinc, Iron, Metal
//     Powder, Gallium and the aluminums fizz; Mercury (below hydrogen) and
//     Nichrome (acid-resistant) do not, and Rust (already an oxide) dissolves
//     without giving off anything;
//   • the rate ordering — a zinc slab out-fizzes an iron slab of the same shape,
//     and loose iron powder out-fizzes the solid bar;
//   • both sides are consumed 1:1, so a bounded puddle is a bounded generator
//     rather than a free catalyst, and the gas is born *cold enough to collect*
//     (under Hydrogen's own 200° autoignition);
//   • the fumes do it too, at half rate, and Acid Slime at full rate;
//   • Sodium reacts with acid on its own violent terms (fire and hydrogen, or a
//     detonation when it's packed) instead of quietly bubbling;
//   • Zinc's casting round trip — 420° melts it, the pour actually *flows*
//     (the regression the aluminum pour shipped with once), and it sets back to
//     solid Zinc — plus the spark conduction it gets for being a metal.
//
// Run: `node test/run-acidhydrogen.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { conductorClass } from '../src/game/materials/spark';
import { ZINC } from '../src/game/materials/zinc';
import { MOLTEN_ZINC, ZINC_MELT_TEMP } from '../src/game/materials/moltenzinc';
import { ACID } from '../src/game/materials/acid';
import { ACID_VAPOR } from '../src/game/materials/acidvapor';
import { ACID_SLIME } from '../src/game/materials/acidslime';
import { HYDROGEN } from '../src/game/materials/hydrogen';
import { SODIUM } from '../src/game/materials/sodium';
import { FIRE } from '../src/game/materials/fire';
import { METAL_POWDER } from '../src/game/materials/metalpowder';
import { ALUMINUM_POWDER } from '../src/game/materials/aluminumpowder';
import { GALLIUM } from '../src/game/materials/gallium';
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
const IRON = ID('Iron');
const MERCURY = ID('Mercury');
const NICHROME = ID('Nichrome');
const RUST = ID('Rust');
const WATER = ID('Water');
const BATTERY = ID('Lithium Battery');

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
function paintHot(grid: Grid, x: number, y: number, id: number, temp: number): void {
  grid.set(x, y, id);
  grid.setTemp(x, y, temp);
}

/** The standard rig for every rate comparison below: a 3-cell-wide pillar of
 *  `metal` standing in a tank of acid, run for `ticks`. Same geometry, same seed
 *  stream length, so the hydrogen counts are comparable between metals. Returns
 *  how much gas was ever alive at once and how much metal is left. */
function fizzRig(metal: number, ticks = 300): { maxH2: number; metalLeft: number; acidLeft: number } {
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let y = 46; y < 60; y++) for (let x = 30; x < 50; x++) grid.set(x, y, ACID.id);
  for (let y = 46; y < 60; y++) for (let x = 39; x <= 41; x++) grid.set(x, y, metal);
  let maxH2 = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    maxH2 = Math.max(maxH2, count(grid, HYDROGEN.id));
  }
  return { maxH2, metalLeft: count(grid, metal), acidLeft: count(grid, ACID.id) };
}

// 1. The headline: a zinc slab standing in acid gives off hydrogen, and is eaten
//    doing it. Zn + 2HCl → ZnCl₂ + H₂ — the school-lab hydrogen generator.
{
  const zinc = fizzRig(ZINC.id);
  check('a zinc slab in acid gives off hydrogen', zinc.maxH2 > 0, `${zinc.maxH2} cells at once`);
  check('…and is consumed doing it', zinc.metalLeft < 42, `${zinc.metalLeft}/42 left`);
  // Both sides 1:1, so the puddle is a *bounded* generator: acid really is used up,
  // and a tank never acts as a free catalyst that eats a whole structure.
  check('…and so is the acid (1:1, not a free catalyst)', zinc.acidLeft < 238,
    `${zinc.acidLeft}/238 acid left`);
}

// 2. The activity series is the ordering, and the rate table reads it: zinc
//    (0.08) out-fizzes iron (0.03) in the same rig, and loose iron powder (0.05)
//    out-fizzes the solid bar — surface area on top of the series.
{
  const zinc = fizzRig(ZINC.id);
  const iron = fizzRig(IRON);
  const dust = fizzRig(METAL_POWDER.id);
  check('zinc out-fizzes iron in the same rig (Zn −0.76 V vs Fe −0.44 V)',
    zinc.maxH2 > iron.maxH2, `zinc ${zinc.maxH2} vs iron ${iron.maxH2}`);
  check('…but iron still fizzes (Fe + 2HCl → FeCl₂ + H₂)', iron.maxH2 > 0,
    `${iron.maxH2} cells at once`);
  check('…and loose iron powder beats the solid bar (표면적)', dust.maxH2 > iron.maxH2,
    `powder ${dust.maxH2} vs bar ${iron.maxH2}`);
  // Aluminum Powder (0.12) tops the table over Metal Powder (0.05). Measured as
  // *consumption* over a short run rather than as peak gas: two loose powders in a
  // tank both saturate the gas count long before the pile is gone, so the pile is
  // what carries the difference.
  const alu = fizzRig(ALUMINUM_POWDER.id, 40);
  const fe = fizzRig(METAL_POWDER.id, 40);
  check('…and aluminum powder (0.12) is eaten faster than iron powder (0.05)',
    alu.metalLeft < fe.metalLeft, `aluminum ${alu.metalLeft} vs iron ${fe.metalLeft} left of 42`);
}

// 3. The negative controls — the whole point of "고증을 따져서". A metal *below*
//    hydrogen in the series gives off nothing, a passivated alloy isn't even
//    touched, and an already-oxidized material dissolves silently.
{
  // Mercury (+0.85 V): acid never gets hydrogen out of it. (It is also a Liquid,
  // which acid's phase-gated corrosion pass ignores — both readings agree.)
  const hg = fizzRig(MERCURY, 200);
  check('mercury gives off NO hydrogen (below hydrogen in the series)', hg.maxH2 === 0);

  // Nichrome: `acidResistant`, so acid doesn't reach the metal at all.
  const ni = fizzRig(NICHROME, 200);
  check('nichrome gives off no hydrogen…', ni.maxH2 === 0);
  check('…because acid never eats it in the first place', ni.metalLeft === 42,
    `${ni.metalLeft}/42 left`);

  // Rust: iron that has already given up its electrons. Acid dissolves it as
  // before, and nothing comes off.
  const rust = fizzRig(RUST, 200);
  check('rust dissolves in acid but gives off no hydrogen (이미 산화된 것)',
    rust.maxH2 === 0 && rust.metalLeft < 42, `${rust.metalLeft}/42 left`);
}

// 4. Gallium is the slow end of the table (0.015, half acid's plain corrosion
//    rate) — above hydrogen, so it does react, but grudgingly.
{
  const ga = fizzRig(GALLIUM.id, 400);
  const zn = fizzRig(ZINC.id, 400);
  check('solid gallium fizzes too (양쪽성 금속)', ga.maxH2 > 0, `${ga.maxH2} cells at once`);
  check('…far more slowly than zinc', ga.maxH2 < zn.maxH2, `gallium ${ga.maxH2} vs zinc ${zn.maxH2}`);
}

// 5. The gas is born cold enough to *collect*. The reaction's heat is deliberately
//    small (well under Hydrogen's 200° autoignition), so a bubble rises and pools
//    under a roof instead of lighting itself the instant it exists.
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let y = 50; y < 60; y++) for (let x = 30; x < 50; x++) grid.set(x, y, ACID.id);
  for (let y = 50; y < 60; y++) for (let x = 39; x <= 41; x++) grid.set(x, y, ZINC.id);
  let hottest = -Infinity;
  let fires = 0;
  for (let t = 0; t < 200; t++) {
    sim.step();
    for (let i = 0; i < grid.cells.length; i++)
      if (grid.cells[i] === HYDROGEN.id) hottest = Math.max(hottest, grid.temp[i]);
    fires += count(grid, FIRE.id);
  }
  check('the hydrogen is born under its own 200° autoignition', hottest < 200,
    `hottest bubble ${hottest.toFixed(0)}°C`);
  check('…so a zinc tank never lights itself', fires === 0);
}

// 6. Every acidic medium runs the same reaction: the fumes at half rate (they bite
//    at half the liquid's rate to begin with), Acid Slime at the liquid's full
//    rate (동일한 부식력).
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  // A zinc ceiling with fumes pooled under it — the shape acid vapor actually
  // reaches metal in (boil a puddle, it etches what's above).
  for (let x = 30; x < 50; x++) grid.set(x, 40, ZINC.id);
  for (let y = 41; y < 50; y++) for (let x = 30; x < 50; x++) paintHot(grid, x, y, ACID_VAPOR.id, 100);
  let vaporH2 = 0;
  for (let t = 0; t < 300; t++) {
    sim.step();
    vaporH2 = Math.max(vaporH2, count(grid, HYDROGEN.id));
  }
  check('acid *vapor* etching zinc gives off hydrogen too', vaporH2 > 0, `${vaporH2} cells at once`);

  const { grid: g2, sim: s2 } = makeWorld();
  floor(g2, 60);
  for (let y = 50; y < 60; y++) for (let x = 30; x < 50; x++) g2.set(x, y, ACID_SLIME.id);
  for (let y = 50; y < 60; y++) for (let x = 39; x <= 41; x++) g2.set(x, y, ZINC.id);
  let slimeH2 = 0;
  for (let t = 0; t < 300; t++) {
    s2.step();
    slimeH2 = Math.max(slimeH2, count(g2, HYDROGEN.id));
  }
  check('…and so does an Acid Slime blob eating it', slimeH2 > 0, `${slimeH2} cells at once`);
}

// 7. Sodium keeps its own violent path in acid (it is the top of the series):
//    a light sprinkle burns and liberates hydrogen rather than merely bubbling…
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let y = 55; y < 60; y++) for (let x = 30; x < 50; x++) grid.set(x, y, ACID.id);
  for (let x = 36; x < 40; x++) grid.set(x, 54, SODIUM.id);
  let maxH2 = 0;
  let sawFire = false;
  for (let t = 0; t < 60; t++) {
    sim.step();
    maxH2 = Math.max(maxH2, count(grid, HYDROGEN.id));
    if (count(grid, FIRE.id) > 0) sawFire = true;
  }
  check('sodium sprinkled on acid burns and liberates hydrogen', maxH2 > 0 && sawFire,
    `${maxH2} H₂ cells, fire ${sawFire}`);

  // …and a packed lump detonates on acid contact exactly as it does on water. The
  // pile rests on the floor so it is genuinely packed (a falling one is not).
  const { grid: g2, sim: s2 } = makeWorld();
  floor(g2, 60);
  for (let y = 54; y < 60; y++) for (let x = 34; x < 44; x++) g2.set(x, y, SODIUM.id);
  for (let x = 34; x < 44; x++) g2.set(x, 53, ACID.id);
  const before = count(g2, SODIUM.id);
  for (let t = 0; t < 40; t++) s2.step();
  check('…and a packed lump detonates on acid, as it does on water',
    count(g2, SODIUM.id) < before / 2, `${count(g2, SODIUM.id)}/${before} left`);
}

// 8. Zinc's casting round trip. 420° — the lowest melting point of any structural
//    metal here — melts it, and the pour flows sideways instead of freezing in a
//    column (the bug the aluminum pour shipped with once: `updateLiquid` missing).
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  // Comfortably past the melt point, for the same reason the aluminum harness
  // gives itself the margin: the diffusion pass runs before the material update,
  // so a bar started a few degrees over sheds its way back under the point against
  // the cold terrain before its own turn comes round.
  for (let x = 30; x < 40; x++) paintHot(grid, x, 59, ZINC.id, ZINC_MELT_TEMP + 240);
  sim.step();
  check('a zinc bar heated past 420° melts', count(grid, MOLTEN_ZINC.id) > 0,
    `${count(grid, MOLTEN_ZINC.id)} cells`);
  check('…with the melt point where the metal says it is', ZINC_MELT_TEMP === 420);

  // It is a *liquid*, not a puddle glued where it was poured — the regression the
  // aluminum pour actually shipped with once (its update forgot `updateLiquid`, so
  // a column set exactly where it stood).
  const { grid: g2, sim: s2 } = makeWorld();
  floor(g2, 60);
  for (let y = 50; y < 59; y++) for (let x = 39; x <= 41; x++) paintHot(g2, x, y, MOLTEN_ZINC.id, 560);
  for (let t = 0; t < 60; t++) {
    // Hold the floor hot so the run is testing flow, not freezing.
    for (let x = 0; x < g2.width; x++) for (let y = 60; y < 63; y++) g2.setTemp(x, y, 560);
    s2.step();
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < g2.height; y++) {
    for (let x = 0; x < g2.width; x++) {
      if (g2.get(x, y) !== MOLTEN_ZINC.id) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  check('a molten zinc pour falls to the floor', maxY === 59, `lowest cell at y=${maxY}`);
  check('…and spreads sideways like a liquid', maxX - minX > 6,
    `spread ${maxX - minX + 1} cells wide`);

  // Quench it and it sets back to solid Zinc — the other half of the round trip.
  const { grid: g3, sim: s3 } = makeWorld();
  floor(g3, 60);
  for (let x = 38; x < 42; x++) paintHot(g3, x, 59, MOLTEN_ZINC.id, 500);
  for (let x = 30; x < 50; x++) for (let y = 55; y < 58; y++) paintHot(g3, x, y, WATER, 20);
  let frozen = 0;
  for (let t = 0; t < 300; t++) {
    s3.step();
    frozen = Math.max(frozen, count(g3, ZINC.id));
  }
  check('…and a cooled pour sets back into solid Zinc', frozen > 0, `${frozen} cells`);
}

// 9. Being a metal, Zinc carries a spark — registered as a conductor class, and
//    energized by a battery in contact.
{
  check('zinc is a registered spark conductor', conductorClass(ZINC.id) > 0,
    `class ${conductorClass(ZINC.id)}`);
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let x = 30; x < 50; x++) grid.set(x, 59, ZINC.id);
  grid.set(29, 59, BATTERY);
  let energized = false;
  for (let t = 0; t < 60; t++) {
    sim.step();
    for (let x = 40; x < 50; x++) if (grid.getAux(x, 59) !== 0) energized = true;
  }
  check('…and a battery drives a pulse down a zinc bar', energized);
}

console.log(failures === 0 ? '\nAll acid-hydrogen checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
