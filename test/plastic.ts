/**
 * Plastics line harness — the cracking → polymerization chain that follows on
 * from fractional distillation.
 *
 * What it pins down, in the order the player meets it:
 *
 *   1. Cracking gate — Petroleum Vapor breaks down to Ethylene at 850° and NOT
 *      a degree below, so the "a bare fire can't do this, bring oxygen or coal"
 *      difficulty step is real and not an accident of tuning.
 *   2. Cracking yield — the aux cut tag steers the Ethylene/Ash split, so
 *      naphtha really is the better feedstock and distilling properly pays.
 *   3. No autoignition — a cloud of Ethylene sealed in a 1000° furnace stays
 *      Ethylene (it is oxygen-free in there), while a cloud touching a flame
 *      flashes over at once. Both halves matter: the first makes the cracker
 *      possible, the second keeps the gas dangerous.
 *   4. Coking — over-fire past 1250° and the monomer is lost as Ash.
 *   5. Polymerization window — resin grows on a catalyst inside 40~200° and
 *      stops outside it at both ends.
 *   6. Exotherm and stall — an uncooled bed heats itself out of its own window
 *      and stops; a cooled one keeps going. This is the core of the challenge,
 *      so it's checked as behaviour (does production actually stop?) rather
 *      than as a constant.
 *   7. Chain bound — CHAIN_GENERATIONS bounds how much one stray resin grain can
 *      ever make, so resin can't autocatalyse a whole cloud with no catalyst in
 *      it. (It bounds chain DEPTH, not distance — resin is a powder and falls,
 *      carrying its remaining generations somewhere else.)
 *   8. Blast-debris aux clamp — a resin grain whose aux was overwritten by the
 *      Debris carrier (which stores a material id there) must not read back as
 *      a giant generation count. Verified to fail if the clamp is removed: the
 *      unclamped run converts all 800 cells of the test cloud.
 *   9. The recipe works — a vapour charge in an iron chamber at the documented
 *      furnace temperature actually reaches 850° (measured: ~42 ticks), rather
 *      than the recipe being technically true but unusably slow.
 *
 * Run: `node test/run-plastic.mjs`.
 */
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { PETROLEUM_VAPOR } from '../src/game/materials/petroleumvapor';
import { ETHYLENE } from '../src/game/materials/ethylene';
import { CATALYST } from '../src/game/materials/catalyst';
import { POLYETHYLENE, CHAIN_GENERATIONS } from '../src/game/materials/polyethylene';
import { ASH } from '../src/game/materials/ash';
import { FIRE } from '../src/game/materials/fire';
import { WALL } from '../src/game/materials/wall';
import { IRON } from '../src/game/materials/iron';
import { getMaterial } from '../src/game/materials/registry';
import '../src/game/materials'; // register all materials (side effect)

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

/** A sealed Wall box with a `w`×`h` cavity, so nothing under test drifts off
 *  the edge of the world or falls out of the zone it is being held at. */
function box(w: number, h: number): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w + 2, h + 2);
  const sim = new Simulation(grid);
  for (let x = 0; x < w + 2; x++) {
    grid.set(x, 0, WALL.id);
    grid.set(x, h + 1, WALL.id);
  }
  for (let y = 0; y < h + 2; y++) {
    grid.set(0, y, WALL.id);
    grid.set(w + 1, y, WALL.id);
  }
  return { grid, sim };
}

/**
 * Hold the WHOLE box isothermal at `temp` and step it `ticks` times. What these
 * checks are about is how a reaction responds to a temperature, not how long a
 * furnace holds one, so the harness stands in for perfect temperature control.
 *
 * Every non-empty cell is held, walls included, and that matters: holding only
 * the material under test leaves a gradient against cold walls, and the step's
 * own heat pass then moves the cell off the temperature being tested *before*
 * its update runs — which reads as the material ignoring its own gate. Holding
 * everything leaves no gradient for the heat pass to act on.
 *
 * `packedTemp` materials are skipped — their `temp` is packed flight state, not
 * a reading (see Material.packedTemp).
 */
function holdAt(grid: Grid, sim: Simulation, temp: number, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const id = grid.get(x, y);
        if (id !== 0 && !getMaterial(id).packedTemp) grid.setTemp(x, y, temp);
      }
    }
    sim.step();
  }
}

function count(grid: Grid, id: number): number {
  let n = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) if (grid.get(x, y) === id) n++;
  }
  return n;
}

/** Fill the cavity of a fresh box with `id` and return the pieces. */
function filled(w: number, h: number, id: number, aux = 0): { grid: Grid; sim: Simulation } {
  const { grid, sim } = box(w, h);
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      grid.set(x, y, id);
      if (aux) grid.setAux(x, y, aux);
    }
  }
  return { grid, sim };
}

// --- 1. Cracking temperature gate --------------------------------------------
{
  const cold = filled(8, 8, PETROLEUM_VAPOR.id, 1);
  holdAt(cold.grid, cold.sim, 849, 200);
  check(
    'vapour below 850° never cracks',
    count(cold.grid, ETHYLENE.id) === 0,
    `${count(cold.grid, ETHYLENE.id)} ethylene at 849°`,
  );

  const hot = filled(8, 8, PETROLEUM_VAPOR.id, 1);
  holdAt(hot.grid, hot.sim, 851, 5);
  check(
    'vapour at 851° cracks',
    count(hot.grid, PETROLEUM_VAPOR.id) === 0 && count(hot.grid, ETHYLENE.id) > 0,
    `${count(hot.grid, ETHYLENE.id)} ethylene, ${count(hot.grid, PETROLEUM_VAPOR.id)} vapour left`,
  );
}

// --- 2. Yield by cut ----------------------------------------------------------
{
  // Big sample, one shot: every vapour cell cracks on the tick it is held at
  // 851°, so the Ethylene:Ash split is a direct read of crackYield.
  const yields: Record<number, number> = {};
  for (const code of [1, 2, 3]) {
    const { grid, sim } = filled(30, 30, PETROLEUM_VAPOR.id, code);
    holdAt(grid, sim, 851, 1);
    const eth = count(grid, ETHYLENE.id);
    yields[code] = eth / (eth + count(grid, ASH.id));
  }
  const near = (a: number, b: number) => Math.abs(a - b) < 0.06;
  check(
    'naphtha (gasoline cut) yields ~85% ethylene',
    near(yields[1], 0.85),
    yields[1].toFixed(3),
  );
  check('kerosene cut yields ~60% ethylene', near(yields[2], 0.6), yields[2].toFixed(3));
  check('diesel cut yields ~40% ethylene', near(yields[3], 0.4), yields[3].toFixed(3));
  check(
    'lighter cut always cracks better',
    yields[1] > yields[2] && yields[2] > yields[3],
    `${yields[1].toFixed(2)} > ${yields[2].toFixed(2)} > ${yields[3].toFixed(2)}`,
  );
}

// --- 3. Ethylene does not autoignite, but flame contact flashes it over --------
{
  const furnace = filled(8, 8, ETHYLENE.id);
  holdAt(furnace.grid, furnace.sim, 1000, 200);
  check(
    'ethylene sealed in a 1000° furnace never self-ignites',
    count(furnace.grid, ETHYLENE.id) === 64,
    `${count(furnace.grid, ETHYLENE.id)}/64 left`,
  );

  const lit = filled(8, 8, ETHYLENE.id);
  lit.grid.set(1, 8, FIRE.id);
  for (let t = 0; t < 40; t++) lit.sim.step();
  check(
    'a flame touching the cloud flashes it over',
    count(lit.grid, ETHYLENE.id) === 0,
    `${count(lit.grid, ETHYLENE.id)} ethylene left after 40 ticks`,
  );
}

// --- 4. Coking ----------------------------------------------------------------
{
  const { grid, sim } = filled(8, 8, ETHYLENE.id);
  holdAt(grid, sim, 1249, 100);
  check('ethylene at 1249° survives', count(grid, ETHYLENE.id) === 64, `${count(grid, ETHYLENE.id)}/64`);

  const over = filled(8, 8, ETHYLENE.id);
  holdAt(over.grid, over.sim, 1251, 3);
  check(
    'ethylene over-fired past 1250° cokes to ash',
    count(over.grid, ETHYLENE.id) === 0 && count(over.grid, ASH.id) === 64,
    `${count(over.grid, ASH.id)} ash`,
  );
}

/** A reactor: a catalyst floor with an ethylene cavity above it, walled in (Wall
 *  is a perfect insulator, so an unheld box keeps every degree the reaction
 *  makes — the honest "no cooling" case). */
function reactor(w: number, h: number, temp: number): { grid: Grid; sim: Simulation } {
  const { grid, sim } = box(w, h);
  for (let x = 1; x <= w; x++) grid.set(x, h, CATALYST.id);
  for (let y = 1; y < h; y++) {
    for (let x = 1; x <= w; x++) {
      grid.set(x, y, ETHYLENE.id);
      grid.setTemp(x, y, temp);
    }
  }
  return { grid, sim };
}

/** Resin made by a reactor held isothermal at `temp`. */
function heldReactorYield(temp: number, ticks: number): number {
  const { grid, sim } = reactor(10, 8, temp);
  holdAt(grid, sim, temp, ticks);
  return count(grid, POLYETHYLENE.id);
}

/** Hottest ethylene cell in the box, or -Infinity if none is left. */
function hottestEthylene(grid: Grid): number {
  let hottest = -Infinity;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.get(x, y) === ETHYLENE.id) hottest = Math.max(hottest, grid.getTemp(x, y));
    }
  }
  return hottest;
}

// --- 5. Polymerization window -------------------------------------------------
{
  check('no polymerization below the window (39°)', heldReactorYield(39, 300) === 0);
  check('no polymerization above the window (201°)', heldReactorYield(201, 300) === 0);
  const inWindow = heldReactorYield(100, 300);
  check("polymerizes at 100° (a water jacket's temperature)", inWindow > 0, `${inWindow} resin`);
}

// --- 6. Exotherm stalls an uncooled bed, and cooling restarts it ---------------
{
  // Tested as the loop a player actually sees, not as a yield comparison: an
  // uncooled bed must (a) heat ITSELF out of its own window and stop while there
  // is still ethylene left to convert — so the stall is thermal, not just the
  // charge running out — and (b) start again the moment the heat is taken away.
  // A yield comparison can't tell those apart from a bed that simply ran out of
  // feed or buried its own catalyst.
  const { grid, sim } = reactor(14, 10, 100);
  for (let t = 0; t < 400; t++) sim.step();
  const stalledAt = count(grid, POLYETHYLENE.id);
  const feedLeft = count(grid, ETHYLENE.id);
  const hottest = hottestEthylene(grid);

  // Let it run on with no cooling: production should be over.
  for (let t = 0; t < 400; t++) sim.step();
  const afterWaiting = count(grid, POLYETHYLENE.id);

  check(
    'an uncooled bed heats itself past its own ceiling',
    hottest > 200,
    `hottest remaining ethylene ${hottest.toFixed(0)}°`,
  );
  check(
    'the stall is thermal, not the charge running out',
    feedLeft > 0 && afterWaiting === stalledAt,
    `${feedLeft} ethylene left, ${stalledAt} → ${afterWaiting} resin over 400 more ticks`,
  );

  // Now cool it back to the middle of the window and the bed picks up again.
  holdAt(grid, sim, 100, 400);
  const afterCooling = count(grid, POLYETHYLENE.id);
  check(
    'cooling a stalled bed restarts it',
    afterCooling > afterWaiting,
    `${afterWaiting} → ${afterCooling} resin once cooled to 100°`,
  );
}

// --- 7/8. A stray resin grain can never autocatalyse the whole cloud ----------
{
  // One lone grain of resin in a big ethylene cloud with NO catalyst anywhere,
  // held isothermal so the exotherm can't mask the effect by stalling the
  // reaction — the worst case the generation counter has to survive.
  //
  // Note what the bound is and isn't. It is NOT a disc around the seed: resin is
  // a powder, so a grain with generations left falls and carries them somewhere
  // else, and the converted region is not confined to the seed's neighbourhood.
  // What CHAIN_GENERATIONS actually bounds is chain DEPTH, and with it the total
  // amount one stray grain can ever make. So the check is on the size of that
  // total against the cloud: a bounded chain nibbles a corner of it, an unbounded
  // one takes essentially all of it.
  const w = 40;
  const h = 20;
  const cloud = w * h;
  // Comfortably above what a legitimate chain makes (~10-15% of the cloud in
  // practice) and far below the ~100% an unclamped chain would take.
  const bound = Math.round(cloud * 0.3);

  function strayGrain(seedAux: number): number {
    const { grid, sim } = box(w, h);
    for (let y = 1; y <= h; y++) {
      for (let x = 1; x <= w; x++) {
        grid.set(x, y, ETHYLENE.id);
        grid.setTemp(x, y, 100);
      }
    }
    grid.set(20, 10, POLYETHYLENE.id);
    grid.setAux(20, 10, seedAux);
    holdAt(grid, sim, 100, 1500);
    return count(grid, POLYETHYLENE.id);
  }

  const honest = strayGrain(CHAIN_GENERATIONS);
  check(
    'a stray resin grain seeds only a bounded chain, never the whole cloud',
    honest <= bound,
    `${honest} grains (bound ${bound}, cloud ${cloud})`,
  );

  // Debris carries its origin material id in aux (see blast.ts), so a grain that
  // has been flung by a blast and landed comes back with aux = POLYETHYLENE.id.
  // Read unclamped that is a 140-generation chain — far deeper than the cloud is
  // wide, i.e. the whole cloud. The clamp in ethylene.ts is what stops it, and
  // this is the check that would catch its removal.
  const mangled = strayGrain(POLYETHYLENE.id);
  check(
    'a grain with a debris-mangled aux is clamped to the same bound',
    mangled <= bound,
    `${mangled} grains (bound ${bound}, cloud ${cloud})`,
  );
}

// --- 9. The recommended furnace actually gets there --------------------------
{
  // The playability risk behind the whole cracker: Petroleum Vapor conducts
  // badly (0.08), so "put a hot wall against it" could in principle take an
  // absurd number of ticks to drag it to 850° — which would make the documented
  // recipe a lie. So measure the recipe itself, end to end: an Iron chamber whose
  // walls are held at 1050°, i.e. an ordinary fire with one cell of Oxygen on it
  // (hot enough to crack, still under Iron's 1200° melt so the vessel survives).
  //
  // The assertion is deliberately loose — this is a "is it minutes or is it
  // never" guard, not a tuning pin — but the measured number is printed so a
  // future change that quietly makes the cracker ten times slower is visible.
  const w = 6;
  const h = 10;
  const { grid, sim } = box(w, h);
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      grid.set(x, y, PETROLEUM_VAPOR.id);
      grid.setAux(x, y, 1);
    }
  }
  // Line the cavity with Iron and hold that lining at furnace temperature.
  const wall: [number, number][] = [];
  for (let x = 0; x < w + 2; x++) {
    wall.push([x, 0], [x, h + 1]);
  }
  for (let y = 1; y <= h; y++) {
    wall.push([0, y], [w + 1, y]);
  }
  for (const [x, y] of wall) grid.set(x, y, IRON.id);

  let ticks = 0;
  const LIMIT = 3000;
  while (ticks < LIMIT && count(grid, ETHYLENE.id) === 0) {
    for (const [x, y] of wall) grid.setTemp(x, y, 1050);
    sim.step();
    ticks++;
  }
  check(
    'a 1050° iron chamber (fire + 1 oxygen) does crack its charge',
    ticks < LIMIT,
    `first ethylene at tick ${ticks}`,
  );
}

console.log(failed === 0 ? '\nAll plastics checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
