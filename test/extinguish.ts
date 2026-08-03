// Headless behavioural harness for 소화 — the shared suppression pass
// (src/game/materials/suppress.ts) and everything that reads it: Fire/Blue
// Flame's douse, combustion.ts's water contact, and the CO₂/Soda/Liquid N₂
// chills. Run: `node test/run-extinguish.mjs`.
//
// What this file exists to stop coming back: pouring water on a burning fuel used
// to do nothing at all. Measured on an 80-cell wood bed with 80 cells of water
// poured on it, 79 of that water was annihilated by the loose Fire gas wreathing
// the bed and only 21 contacts ever reached the fuel; the fire outlived the water
// every time and the bed burned to nothing. Three separate leaks added up to
// that, and each one has its own scene below:
//
//   1. Fire spent up to *eight* water cells on one flame lick (it steamed every
//      water neighbour it had). The bed re-wreaths flame for free every tick, so
//      that exchange rate could never be won. → scene 1.
//   2. Dousing cooled only the wetted face. Conduction from the still-burning
//      core puts a chilled coal surface back over its 580° autoignition inside
//      four ticks, so a surface-only douse has to win the same cell forever.
//      → scenes 2 and 3.
//   3. The water was deleted by the temperature system faster than it could act —
//      by radiant heat from up to three cells away, and by boiling *in place*
//      with nowhere for the steam to go, which fresh Water alone did (Saltwater
//      and Sugar Water always required room). → scenes 7 and 8.
//
// The other half is that the fix must not make water a universal solvent for
// fire: 화재 등급 keeps it away from oil (class B) and metal (class D) fires,
// which is what leaves CO₂ worth having. Those are scenes 4, 5 and 6.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial, allMaterials } from '../src/game/materials/registry';
import { fireClassOf } from '../src/game/materials/suppress';
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
Math.random = mulberry32(20260803);

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
const WALL = ID('Wall');
const WATER = ID('Water');
const STEAM = ID('Steam');
const FIRE = ID('Fire');
const SNOW = ID('Snow');
const ICE = ID('Ice');
const CO2 = ID('CO2');
const SODA = ID('Soda');
const WOOD = ID('Wood');
const COAL = ID('Coal');
const CRUDE_OIL = ID('Crude Oil');
const ALUMINUM_POWDER = ID('Aluminum Powder');
const HYDROGEN = ID('Hydrogen');

function makeWorld(w = 60, h = 60): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function rebuild(grid: Grid): void {
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Fuel cells still in the burning band — the only honest reading of "on fire",
 *  since a burning fuel cell *is fuel*, pinned hot, not a flame (combustion.ts). */
function litCount(grid: Grid, id: number): number {
  let n = 0;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.cells[grid.idx(x, y)] === id && grid.getTemp(x, y) >= 400) n++;
  return n;
}
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number, temp?: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      grid.cells[grid.idx(x, y)] = id;
      if (temp !== undefined) grid.setTemp(x, y, temp);
    }
}

/** The shared scene: a 20x4 fuel bed on a stone floor, lit end to end and left to
 *  establish itself, then `agent` poured on top of it as a 20x4 block. Returns
 *  how long the fire took to stay out and how much fuel survived. */
function pourOn(
  fuel: number,
  agent: number | null,
  opts: { ticks?: number; settle?: number } = {},
): { outAt: number; saved: number; fuel0: number; grid: Grid } {
  const ticks = opts.ticks ?? 300;
  const { grid, sim } = makeWorld();
  fill(grid, 0, 50, 59, 59, STONE);
  fill(grid, 20, 46, 39, 49, fuel);
  rebuild(grid);
  fill(grid, 20, 46, 39, 49, fuel, 900);
  for (let i = 0; i < (opts.settle ?? 40); i++) sim.step();
  const fuel0 = count(grid, fuel);
  if (agent !== null) {
    fill(grid, 20, 42, 39, 45, agent, getMaterial(agent).thermal?.init ?? 20);
    rebuild(grid);
  }
  let quiet = 0;
  let outAt = -1;
  for (let t = 1; t <= ticks; t++) {
    sim.step();
    if (litCount(grid, fuel) === 0) {
      quiet++;
      // "Out" means out and *staying* out — a burning bed flickers below the
      // threshold for a tick or two all the time, and the whole point of the
      // deep chill is that it does not come back.
      if (quiet >= 40 && outAt < 0) outAt = t - 39;
    } else quiet = 0;
  }
  return { outAt, saved: count(grid, fuel), fuel0, grid };
}

// ── 1. One flame costs one cell of water, not eight ─────────────────────────
// The single largest leak. updateFire's douse loop used to run to completion,
// steaming every water neighbour it had, and a burning body makes new flame for
// free every tick while the poured water is finite.
{
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 10, 10, 19, 19, WATER);
  rebuild(grid);
  const before = count(grid, WATER);
  grid.cells[grid.idx(15, 15)] = FIRE;
  grid.setTemp(15, 15, 1000);
  rebuild(grid);
  sim.step();
  const lost = before - count(grid, WATER);
  // One cell is the douse itself; anything past that is water the 1000° flame had
  // already heated past boiling in the same tick's diffusion pass, which is fair.
  // The number that matters is that it is nowhere near eight: this exact scene
  // used to lose seven, one for every water cell the flame happened to touch.
  check('one Fire cell in water costs one cell to douse, not the eight it touches',
    lost <= 2, `lost ${lost} (was 7 before the 1:1 rule)`);
  check('…and the flame itself dies doing it', count(grid, FIRE) === 0);
}

// ── 2. The re-ignition this whole pass exists to beat ───────────────────────
// Not a behaviour under test so much as the measurement that justifies the deep
// chill: cooling a burning mass's surface alone is undone by its own core within
// a handful of ticks. If this ever stops being true the chill's depth can be
// reconsidered — until then, surface-only suppression cannot work.
{
  const { grid, sim } = makeWorld(40, 40);
  fill(grid, 0, 30, 39, 39, WALL);
  fill(grid, 14, 24, 25, 29, COAL);
  rebuild(grid);
  fill(grid, 14, 24, 25, 29, COAL, 1300);
  for (let x = 14; x <= 25; x++) grid.setTemp(x, 24, 20); // chill the top row only
  let relitAt = -1;
  for (let t = 1; t <= 12; t++) {
    sim.step();
    if (relitAt < 0 && grid.getTemp(20, 24) >= 580) relitAt = t; // Coal's autoignition
  }
  check(
    'a burning coal block re-lights its own chilled surface within a few ticks',
    relitAt > 0 && relitAt <= 6,
    `back over 580° at t=${relitAt}`,
  );
}

// ── 3. Water genuinely puts a class-A fire out, and saves the fuel ──────────
// The headline. The control is the same bed with nothing poured on it: if the
// "extinguished" reading were really just "burned to completion", both arms would
// look alike — they must not.
{
  const wet = pourOn(WOOD, WATER);
  const dry = pourOn(WOOD, null);
  check('water puts a burning wood bed out', wet.outAt > 0, `out at t=${wet.outAt}`);
  check(
    '…and most of the wood is still there afterwards',
    wet.saved >= wet.fuel0 * 0.5,
    `${wet.saved}/${wet.fuel0} saved`,
  );
  check(
    '…control: the same bed with nothing poured on it burns away',
    dry.saved <= dry.fuel0 * 0.2,
    `${dry.saved}/${dry.fuel0} left`,
  );

  // Coal is the deep-seated case — it burns at 1300° instead of 800° and used to
  // be untouchable. It need not go out as fast as wood, but the fuel must survive.
  const coal = pourOn(COAL, WATER);
  check(
    'water on a burning coal bed saves most of the coal',
    coal.saved >= coal.fuel0 * 0.4,
    `${coal.saved}/${coal.fuel0} saved`,
  );
}

// ── 4. Class B (유류): water must still fail ────────────────────────────────
// A burning slick floats on the water it is poured onto and keeps burning — the
// oil-fire behaviour that predates this pass and must survive it. CO₂ is the
// control that proves the scene is winnable at all, so "water failed" can't be
// read as "nothing could have worked".
{
  const wet = pourOn(CRUDE_OIL, WATER, { ticks: 200 });
  const gas = pourOn(CRUDE_OIL, CO2, { ticks: 200 });
  check('water does not save a burning oil slick (class B)', wet.saved === 0, `${wet.saved} cells left`);
  check('…control: CO₂ on the same slick does', gas.saved > 0, `${gas.saved} cells left`);
}

// ── 5. Class B: and the water underneath doesn't boil away either ───────────
// The petroleum shield. Restated here because the new fightingFire() cap runs on
// the same line — a bug that broke the shield would show up as the pool steaming
// itself dry under the fire it is holding up.
{
  const { grid, sim } = makeWorld();
  fill(grid, 0, 50, 59, 59, STONE);
  fill(grid, 19, 40, 19, 49, WALL); // a walled tank, so "gone" can only mean boiled
  fill(grid, 40, 40, 40, 49, WALL);
  fill(grid, 20, 44, 39, 49, WATER);
  fill(grid, 20, 42, 39, 43, CRUDE_OIL);
  rebuild(grid);
  fill(grid, 20, 42, 39, 43, CRUDE_OIL, 900);
  const water0 = count(grid, WATER);
  for (let t = 0; t < 200; t++) sim.step();
  check(
    'the pool under a burning oil slick is not steamed away',
    count(grid, WATER) >= water0 * 0.8,
    `${count(grid, WATER)}/${water0} left`,
  );
}

// ── 6. Class D (금속): water must not quietly put a metal fire out ──────────
// Burning aluminum cracking water into Hydrogen is the *point* of a metal fire
// here. If water doused it first the hydrogen would never appear, which is how a
// class-D tag goes missing without anyone noticing. The paired scene is the same
// geometry with Coal in the aluminum's place: class A, so there the douse fires
// and the cell goes cold in one tick. Same water, same tick, opposite outcome —
// the difference is the tag and nothing else.
{
  function oneCellDouse(fuel: number): number {
    const { grid, sim } = makeWorld(30, 30);
    fill(grid, 9, 9, 21, 21, WALL);
    fill(grid, 10, 10, 20, 20, WATER);
    grid.cells[grid.idx(15, 15)] = fuel;
    rebuild(grid);
    grid.setTemp(15, 15, 1500);
    sim.step();
    return grid.getTemp(15, 15);
  }
  const alu = oneCellDouse(ALUMINUM_POWDER);
  const coal = oneCellDouse(COAL);
  check('water does not douse a burning aluminum grain (class D)', alu >= 400, `${alu.toFixed(0)}°C after one tick`);
  check('…control: the same water douses a burning coal grain (class A)', coal < 400, `${coal.toFixed(0)}°C after one tick`);

  // …and the hydrogen the metal fire answers water with is still produced.
  const { grid, sim } = makeWorld();
  fill(grid, 0, 50, 59, 59, WALL);
  for (let x = 28; x < 38; x++) grid.cells[grid.idx(x, 49)] = ALUMINUM_POWDER;
  rebuild(grid);
  let maxH2 = 0;
  for (let t = 0; t < 120; t++) {
    for (let x = 28; x < 38; x++) {
      if (grid.get(x, 49) === ALUMINUM_POWDER) grid.setTemp(x, 49, 1700); // keep it alight
      if (grid.get(x, 48) === 0) {
        grid.cells[grid.idx(x, 48)] = WATER;
        grid.setTemp(x, 48, 20);
      }
    }
    rebuild(grid);
    sim.step();
    maxH2 = Math.max(maxH2, count(grid, HYDROGEN));
  }
  check('water poured on burning aluminum still makes hydrogen', maxH2 > 0, `${maxH2} cells at once`);
}

// ── 7. Water fighting a fire holds below boiling — and only then ────────────
// The double-count that made pouring water read as pure evaporation: firefighting
// water is already spent by two explicit rolls, so letting the temperature system
// delete it as well left nothing for those rolls to decide. The paired control is
// the same geometry with the fuel cold: there the water must boil exactly as it
// always has, or "water stopped evaporating" would be the new bug.
{
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 9, 9, 21, 21, WALL);
  fill(grid, 10, 16, 20, 16, COAL);
  fill(grid, 10, 14, 20, 15, WATER);
  rebuild(grid);
  fill(grid, 10, 16, 20, 16, COAL, 1300);
  const w0 = count(grid, WATER);
  for (let t = 0; t < 6; t++) sim.step();
  check(
    'water laid on burning coal does not flash straight to steam',
    count(grid, WATER) >= w0 * 0.4,
    `${count(grid, WATER)}/${w0} left after 6 ticks`,
  );

  // Control: identical geometry, a hot *non-fuel* plate instead of burning coal.
  const { grid: g2, sim: s2 } = makeWorld(30, 30);
  fill(g2, 9, 9, 21, 21, WALL);
  fill(g2, 10, 16, 20, 16, STONE);
  fill(g2, 10, 14, 20, 15, WATER);
  fill(g2, 10, 10, 20, 13, 0); // headroom, so this is a hot plate and not a sealed can
  rebuild(g2);
  let boiled = 0;
  for (let t = 0; t < 20; t++) {
    fill(g2, 10, 16, 20, 16, STONE, 1300); // keep the plate hot, as a burner would be
    s2.step();
    boiled = Math.max(boiled, count(g2, STEAM));
  }
  check('…control: the same water on a hot stone plate boils normally', boiled > 0, `${boiled} steam cells`);
}

// ── 8. Steam needs somewhere to go ─────────────────────────────────────────
// Fresh Water boiled *in place*, needing no room at all, while its own solutions
// (Saltwater, Sugar Water) always required a free neighbour. That lone
// inconsistency cost roughly 5× in a firefight. A surface still boils; the inside
// of a packed body now has to wait its turn.
{
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 9, 9, 21, 21, WALL);
  fill(grid, 10, 10, 20, 20, WATER, 300); // sealed solid, well past boiling
  rebuild(grid);
  for (let t = 0; t < 10; t++) {
    // hold the heat on, so "did not boil" can't be read as "cooled down"
    for (let y = 10; y <= 20; y++)
      for (let x = 10; x <= 20; x++) if (grid.get(x, y) === WATER) grid.setTemp(x, y, 300);
    sim.step();
  }
  check('water sealed with nowhere to put the steam does not boil', count(grid, STEAM) === 0, `${count(grid, STEAM)} steam`);

  // Control: open the lid and the surface boils off at once.
  const { grid: g2, sim: s2 } = makeWorld(30, 30);
  fill(g2, 9, 9, 21, 21, WALL);
  fill(g2, 10, 10, 20, 20, WATER);
  for (let x = 10; x <= 20; x++) g2.cells[g2.idx(x, 9)] = 0; // open the top
  rebuild(g2);
  let steam = 0;
  for (let t = 0; t < 10; t++) {
    for (let y = 10; y <= 20; y++)
      for (let x = 10; x <= 20; x++) if (g2.get(x, y) === WATER) g2.setTemp(x, y, 300);
    s2.step();
    steam = Math.max(steam, count(g2, STEAM));
  }
  check('…control: the same water with the lid off boils', steam > 0, `${steam} steam cells`);
}

// ── 9. Snow and Ice are extinguishers now, and they melt rather than vanish ─
// Both used to carry no fire logic whatsoever: a snowball thrown on a bonfire did
// strictly nothing. Spending them must leave Water behind (Material.douses
// 'melt'), because a flake that flashed to Steam on contact would be a worse
// extinguisher than the puddle it should have left.
{
  for (const [id, name] of [
    [SNOW, 'Snow'],
    [ICE, 'Ice'],
  ] as const) {
    const { grid, sim } = makeWorld(30, 30);
    fill(grid, 9, 9, 21, 21, WALL);
    fill(grid, 10, 12, 20, 14, id, getMaterial(id).thermal?.init ?? 20);
    rebuild(grid);
    grid.cells[grid.idx(15, 15)] = FIRE;
    grid.setTemp(15, 15, 1000);
    rebuild(grid);
    const before = count(grid, id);
    sim.step();
    check(`${name} snuffs a flame it touches`, count(grid, FIRE) === 0);
    check(`…spending one ${name} cell leaves Water, not Steam`,
      before - count(grid, id) === 1 && count(grid, WATER) === 1 && count(grid, STEAM) === 0,
      `${before - count(grid, id)} spent, ${count(grid, WATER)} water, ${count(grid, STEAM)} steam`);
  }
}

// ── 10. What CO₂ is still for ──────────────────────────────────────────────
// Water was made to work, and on an ordinary A급 fire it is now roughly as good
// as the dedicated extinguishers — which is right, both for realism (a hose *is*
// the tool for burning wood) and for the 등급 design the rest of this file pins.
// So CO₂'s edge is not raw speed on wood, it is the two things water can never
// do: it works on the classes water is locked out of (scene 4), and it is not
// consumed by the work. A blanket walks a whole burning bed cold and is still
// lying there afterwards; the poured water is mostly gone.
{
  const gas = pourOn(COAL, CO2);
  const dry = pourOn(COAL, SODA);
  const wet = pourOn(COAL, WATER);
  check('CO₂ puts the coal bed out and saves essentially all of it',
    gas.outAt > 0 && gas.saved >= gas.fuel0 * 0.9, `out@${gas.outAt}, ${gas.saved}/${gas.fuel0}`);
  check('Soda does too', dry.outAt > 0 && dry.saved >= dry.fuel0 * 0.9, `out@${dry.outAt}, ${dry.saved}/${dry.fuel0}`);
  check('water now does too — the point of the whole pass',
    wet.outAt > 0 && wet.saved >= wet.fuel0 * 0.5, `out@${wet.outAt}, ${wet.saved}/${wet.fuel0}`);

  // …and the cost of doing it is what separates them. 80 cells of each went in.
  const leftCO2 = count(gas.grid, CO2);
  const leftWater = count(wet.grid, WATER);
  check('…but CO₂ is not consumed doing it, and the water is',
    leftCO2 > leftWater, `CO₂ ${leftCO2}/80 left, water ${leftWater}/80`);
}

// ── 11. The 화재 등급 roster, swept from the registry ───────────────────────
// Same idea as the acid/metal tag sweep: the class of every combustible is listed
// here by hand, so tagging a new metal or oil fuel — or forgetting to — breaks
// this check first and prints the new roster. Water works on class A and only
// class A, so a fuel landing in the wrong column silently changes whether the
// hose does anything to it.
{
  const expected: Record<string, string> = {
    // B — 유류. Derived from `petroleum`, never declared by hand.
    'Crude Oil': 'B',
    Gasoline: 'B',
    Kerosene: 'B',
    Diesel: 'B',
    // D — 금속. The aluminum line, which answers water with hydrogen instead.
    'Aluminum Powder': 'D',
    'Activated Aluminum': 'D',
  };
  const wrong: string[] = [];
  const roster: string[] = [];
  for (const m of allMaterials()) {
    if (m.combustible !== true) continue;
    const cls = fireClassOf(m.id);
    roster.push(`${m.name}=${cls}`);
    if ((expected[m.name] ?? 'A') !== cls) wrong.push(`${m.name} is ${cls}, expected ${expected[m.name] ?? 'A'}`);
  }
  for (const name of Object.keys(expected)) {
    if (!roster.some((r) => r.startsWith(name + '='))) wrong.push(`${name} is no longer combustible`);
  }
  check('every combustible sits in the 화재 등급 this file records', wrong.length === 0, wrong.join('; '));
  if (wrong.length) console.log('    current roster: ' + roster.join(', '));
}

console.log(failures === 0 ? '\nAll extinguishing checks passed.' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
