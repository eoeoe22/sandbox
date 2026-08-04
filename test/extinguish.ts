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
import { AMBIENT_TEMP } from '../src/game/config';
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
const AMBIENT = AMBIENT_TEMP;

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
): { outAt: number; saved: number; fuel0: number; agentAt60: number; grid: Grid } {
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
  let agentAt60 = 0;
  for (let t = 1; t <= ticks; t++) {
    sim.step();
    // Snapshot the agent early, while the job is being done. Reading it at the end
    // of a 300-tick run would fold in CO₂'s own slow thinning into air, which has
    // nothing to do with what firefighting costs.
    if (t === 60 && agent !== null) agentAt60 = count(grid, agent);
    if (litCount(grid, fuel) === 0) {
      quiet++;
      // "Out" means out and *staying* out — a burning bed flickers below the
      // threshold for a tick or two all the time, and the whole point of the
      // deep chill is that it does not come back.
      if (quiet >= 40 && outAt < 0) outAt = t - 39;
    } else quiet = 0;
  }
  return { outAt, saved: count(grid, fuel), fuel0, agentAt60, grid };
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
  // Latch the world's "something is burning" flag as a real scene would have it:
  // it rolls over at the *start* of each step (fireSeen -> fireActive), so priming
  // `fireSeen` is what makes this tick see it set. Only a flame in its very first
  // tick ever sees it unset, and by then any real fire has burned for hundreds of
  // ticks. Scene 12 pins the flag's own behaviour separately.
  sim.context.fireSeen = true;
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
    sim.context.fireSeen = true; // as scene 1 — a real fire is never in its first tick
    sim.step();
    return grid.getTemp(15, 15);
  }
  const alu = oneCellDouse(ALUMINUM_POWDER);
  const coal = oneCellDouse(COAL);
  // The douse writes exactly AMBIENT_TEMP, so the reading that separates the two
  // classes is "was it slammed to ambient", not any absolute burn threshold — a
  // grain the douse skipped still loses heat by ordinary conduction into the cold
  // water around it.
  //
  // So compare the two grains against each other rather than against a fixed
  // margin. The margin used to be `alu > AMBIENT + 100`, which quietly depended
  // on how fast a grain sheds heat into water in one tick: the 열전도 로그 스케일
  // 개편 ([`docs/PHYSICS.md`](../docs/PHYSICS.md)) sped that up and the reading
  // fell from well over 120° to 73° — still nowhere near the doused control's
  // exact 20°, but under the old threshold. The relative form says what this
  // scene actually means and survives the next conduction retune; the absolute
  // floor stays only to stop a future change that conducts all the way to
  // ambient from passing as "not doused".
  check('water does not douse a burning aluminum grain (class D)',
    alu > coal + 25 && alu > AMBIENT + 25,
    `${alu.toFixed(0)}°C vs the doused control's ${coal.toFixed(0)}°C (ambient ${AMBIENT})`);
  check('…control: the same water douses a burning coal grain (class A)',
    coal <= AMBIENT + 5, `${coal.toFixed(0)}°C after one tick`);

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

  // …and the cost of doing it is what separates them. 80 cells of each went in;
  // read 60 ticks later, while the work is still being done.
  check('…but CO₂ is barely consumed doing it, and the water is spent',
    gas.agentAt60 >= 64 && wet.agentAt60 <= 48,
    `CO₂ ${gas.agentAt60}/80 left at t+60, water ${wet.agentAt60}/80`);
}

// ── 12. The world's "something is burning" flag ────────────────────────────
// fightingFire sweeps a 7x7 box for every water cell at or above boiling. That is
// free in an ordinary scene (only a thin surface layer boils at once) but a steam
// plant holds a whole reservoir over the boil point permanently, where the sweep
// measured ~37% of tick time while being guaranteed to find nothing. So it is
// gated on an O(1) flag. The risk of a gate like that is it silently latches the
// wrong way: stuck on, the shield never lifts and water stops boiling near old
// ashes; stuck off, the shield never engages and the whole pass is undone.
{
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 9, 9, 21, 21, WALL);
  fill(grid, 10, 16, 20, 16, COAL);
  fill(grid, 10, 14, 20, 15, WATER);
  fill(grid, 10, 10, 20, 13, 0); // headroom, so a boil is never blocked for want of room
  rebuild(grid);
  fill(grid, 10, 16, 20, 16, COAL, 1300);
  // Two steps, not one: the flag is accumulated during a tick and rolled over at
  // the start of the next, which is the documented one-tick lag.
  sim.step();
  sim.step();
  check('the burning flag is set while a fuel bed is alight', sim.context.fireActive === true);

  // Hold the water hot but put the fire out cold: the flag must fall, and the
  // water must go back to boiling on the leftover heat exactly as it always did.
  for (let t = 0; t < 4; t++) {
    fill(grid, 10, 16, 20, 16, COAL, 20);
    for (let y = 14; y <= 15; y++)
      for (let x = 10; x <= 20; x++) if (grid.get(x, y) === WATER) grid.setTemp(x, y, 300);
    sim.step();
  }
  check('…and falls again once nothing is alight', sim.context.fireActive === false);
  check('…so the leftover water boils normally again', count(grid, STEAM) > 0, `${count(grid, STEAM)} steam`);

  // A world that never had a fire in it never sets the flag at all — this is the
  // case the gate exists for, and the one where the sweep would be pure waste.
  const { grid: g2, sim: s2 } = makeWorld(30, 30);
  fill(g2, 9, 9, 21, 21, WALL);
  fill(g2, 10, 14, 20, 15, WATER, 300);
  fill(g2, 10, 10, 20, 13, 0);
  rebuild(g2);
  for (let t = 0; t < 4; t++) s2.step();
  check('a world with no fire in it never sets the flag', s2.context.fireActive === false);
}

// ── 11. The fuel roster, swept from the registry ────────────────────────────
// Same idea as the acid/metal tag sweep: every fuel's 화재 등급 and its two
// defining numbers are listed here by hand, so tagging a new metal or oil fuel —
// or forgetting to — breaks this check first and prints the new roster.
//
// The class half matters because water works on class A and only class A, so a
// fuel landing in the wrong column silently changes whether the hose does
// anything to it. The 발화점/속도 half is checkable at all only because
// `Material.combustion` carries it (it used to be a `const SPEC` sealed inside
// each fuel's module, reachable by nothing but that fuel): a retune of the burn
// economy — or a fat-fingered digit while moving one — now has to come past this
// line, which is the same discipline the acid reactivity series already gets.
{
  // name → [화재 등급, burnChance, 발화점]. Class defaults to 'A' when omitted in
  // the material (B is derived from `petroleum`; D is the aluminum line, which
  // answers water with hydrogen instead of going out).
  const expected: Record<string, [string, number, number]> = {
    'Crude Oil': ['B', 0.2, 420],
    Gasoline: ['B', 0.25, 400],
    Kerosene: ['B', 0.15, 420],
    Diesel: ['B', 0.017, 450],
    'Aluminum Powder': ['D', 0.05, 1000],
    'Activated Aluminum': ['D', 0.09, 700],
    Wood: ['A', 0.06, 500],
    Sawdust: ['A', 0.08, 450],
    Coal: ['A', 0.035, 580],
    'Coal Powder': ['A', 0.035, 580],
    Alcohol: ['A', 0.15, 250],
    Honey: ['A', 0.05, 360],
    Sugar: ['A', 0.09, 300],
    Sulfur: ['A', 0.08, 250],
    Resin: ['A', 0.017, 400],
    Amber: ['A', 0.03, 400],
    Fuse: ['A', 0.06, 260],
    C4: ['A', 0.05, 320],
    Plant: ['A', 0.1, 400],
    Polyethylene: ['A', 0.05, 380],
  };
  const wrong: string[] = [];
  const roster: string[] = [];
  for (const m of allMaterials()) {
    const spec = m.combustion;
    if (spec === undefined) continue;
    const cls = fireClassOf(m.id);
    roster.push(`${m.name}=${cls}/${spec.burnChance}/${spec.autoIgniteTemp}`);
    const want = expected[m.name];
    if (want === undefined) {
      wrong.push(`${m.name} is a new fuel this file does not record`);
    } else if (want[0] !== cls || want[1] !== spec.burnChance || want[2] !== spec.autoIgniteTemp) {
      wrong.push(
        `${m.name} is ${cls}/${spec.burnChance}/${spec.autoIgniteTemp}, expected ${want.join('/')}`,
      );
    }
  }
  for (const name of Object.keys(expected)) {
    if (!roster.some((r) => r.startsWith(name + '='))) wrong.push(`${name} is no longer a fuel`);
  }
  check('every fuel keeps the 화재 등급 and burn spec this file records', wrong.length === 0, wrong.join('; '));
  if (wrong.length) console.log('    current roster: ' + roster.join(', '));
}

console.log(failures === 0 ? '\nAll extinguishing checks passed.' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
