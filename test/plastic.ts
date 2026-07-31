/**
 * Plastics line harness — the cracking → polymerization chain that follows on
 * from fractional distillation.
 *
 * What it pins down, in the order the player meets it:
 *
 *   1. Cracking condition — Petroleum Vapor breaks down to Ethylene on contact
 *      with a Catalyst face and on nothing else. Heat alone does nothing, at any
 *      temperature. This replaced an 850° thermal gate that was unreachable in
 *      play (the fume condensed and burned long before it could be heated — see
 *      petroleumvapor.ts), so the "heat does nothing" half is a regression pin,
 *      not a triviality.
 *   2. Cracking yield — the aux cut tag steers the Ethylene/Ash split, so
 *      naphtha really is the better feedstock and distilling properly pays.
 *   3. No autoignition — a cloud of Ethylene sealed in a 1000° vessel stays
 *      Ethylene (it is oxygen-free in there), while a cloud touching a flame
 *      flashes over at once. Both halves matter: the first keeps a hot bed
 *      workable, the second keeps the gas dangerous.
 *   4. Coking — park the monomer past 1250° and it is lost as Ash.
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
 *   8. Out-of-range aux clamp — a resin grain whose aux holds something that is
 *      not a generation (a hand-edited save, a future system writing aux without
 *      gating on the cell's id) must not read back as a giant generation count.
 *      Verified to fail if the clamp is removed: the unclamped run converts all
 *      800 cells of the test cloud.
 *   9. The plant actually runs — the documented build (a gasoline pool on a
 *      heated floor, boiling up into a catalyst roof) returns a real FRACTION OF
 *      ITS CHARGE as product, with heat written only onto the hotplate and never
 *      onto the feedstock or the product. Its predecessor asserted merely that
 *      one cell ever cracked, which stayed green while the other fifty-nine
 *      burned away; measuring recovery instead is what makes this check able to
 *      fail. The sim is unseeded, so the number moves run to run (12-19 of 20
 *      seen over ~80 runs); the bar is a loose "does it run at all" — it passes
 *      at 5 — so the quoted range is colour, not a threshold.
 *  10. Acid resistance — the resin is what acid is shipped in, so none of the
 *      three corrosive materials (Acid, Acid Vapor, Acid Slime, which now share
 *      the one corrosion pass in materials/corrosion.ts) may take a single cell
 *      of it. Each scene runs twice over identical geometry, once with resin and
 *      once with Sawdust, because "nothing dissolved" and "nothing was ever in
 *      contact" look the same from a survivor count — the control is what tells
 *      them apart. The liquid-acid scene also pins the other direction: with
 *      nothing corrodible in the box the acid must not shrink either, since a
 *      puddle only ever spends itself as a byproduct of eating something. The
 *      vapour scene needs scaffolding to stay honest — a sealed box condenses
 *      its whole charge to liquid Acid early, which would silently turn it into
 *      a second copy of the liquid scene; see `reflux` there. Keeping the liquid
 *      out is also what exposed what fumes on their own actually do: they eat a
 *      heap's top face and stop dead, because a gas will not descend into the
 *      void it just opened.
 *
 * Run: `node test/run-plastic.mjs`.
 */
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { EMPTY } from '../src/game/engine/types';
import { PETROLEUM_VAPOR } from '../src/game/materials/petroleumvapor';
import { ETHYLENE } from '../src/game/materials/ethylene';
import { CATALYST } from '../src/game/materials/catalyst';
import { POLYETHYLENE, CHAIN_GENERATIONS } from '../src/game/materials/polyethylene';
import { ASH } from '../src/game/materials/ash';
import { ACID } from '../src/game/materials/acid';
import { ACID_VAPOR } from '../src/game/materials/acidvapor';
import { ACID_SLIME } from '../src/game/materials/acidslime';
import { SAWDUST } from '../src/game/materials/sawdust';
import { FIRE } from '../src/game/materials/fire';
import { WALL } from '../src/game/materials/wall';
import { IRON } from '../src/game/materials/iron';
import { GASOLINE } from '../src/game/materials/gasoline';
import { AMBIENT_TEMP } from '../src/game/config';
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

/**
 * A box whose cavity is horizontal channels of vapour separated by solid
 * catalyst rows, so every vapour cell touches a catalyst face on two sides and
 * cannot drift away from one. Isolates the cracking reaction from the question
 * of whether gas happens to reach the bed.
 */
function packedBed(w: number, h: number, code: number): { grid: Grid; sim: Simulation } {
  const { grid, sim } = box(w, h);
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      if (y % 2 === 1) {
        grid.set(x, y, CATALYST.id);
      } else {
        grid.set(x, y, PETROLEUM_VAPOR.id);
        grid.setAux(x, y, code);
      }
    }
  }
  return { grid, sim };
}

// --- 1. Cracking needs a catalyst, and needs nothing else ---------------------
{
  // Regression pin on the mechanic this line was rebuilt around. Cracking used
  // to be a pure 850° thermal gate, and that gate was unreachable in play (see
  // petroleumvapor.ts): the fume condensed and burned long before it could be
  // heated. Heat alone must now do NOTHING, at any temperature — including well
  // past the old threshold.
  const hot = filled(8, 8, PETROLEUM_VAPOR.id, 1);
  holdAt(hot.grid, hot.sim, 1000, 200);
  check(
    'heat alone never cracks vapour, however hot',
    count(hot.grid, ETHYLENE.id) === 0,
    `${count(hot.grid, ETHYLENE.id)} ethylene after 200 ticks at 1000°`,
  );

  // ...and a catalyst alone must be enough, with no help from the thermometer.
  // Held at ambient so this cannot be read as a warm-bed effect: 20° is the
  // coldest a player can hand the bed, and it is below even the polymerization
  // floor (40°), so the monomer produced here necessarily stays monomer. That
  // is the point — cracking answers to the catalyst, polymerization answers to
  // the catalyst AND the thermometer, and this separates the two.
  const cold = packedBed(8, 8, 1);
  holdAt(cold.grid, cold.sim, AMBIENT_TEMP, 200);
  check(
    'a catalyst cracks vapour at room temperature',
    count(cold.grid, PETROLEUM_VAPOR.id) === 0 && count(cold.grid, ETHYLENE.id) > 0,
    `${count(cold.grid, PETROLEUM_VAPOR.id)} vapour left, ` +
      `${count(cold.grid, ETHYLENE.id)} ethylene, ${count(cold.grid, POLYETHYLENE.id)} resin`,
  );
  check(
    'but it does not polymerize down there — the window floor still holds',
    count(cold.grid, POLYETHYLENE.id) === 0,
    `${count(cold.grid, POLYETHYLENE.id)} resin at ${AMBIENT_TEMP}°`,
  );
}

// --- 2. Yield by cut ----------------------------------------------------------
{
  // Two numbers here are load-bearing, and both were sized by measurement after
  // an earlier version of this check turned out to fail about 1 run in 20 — on
  // the diesel row, essentially always.
  //
  // 340°, because it has to clear the RE-BOIL point of every cut, not just the
  // polymerization ceiling. Cracking is a per-tick race against condensation,
  // and a cell that rains out is only returned to the sample if the puddle can
  // boil again (`refluxBoil`, certain at boilTemp + 60, simmering at 8%/tick
  // above boilTemp). At the 300° this check first used, gasoline (200) and
  // kerosene (260) both came back but diesel (320) did NOT, so diesel — and
  // only diesel — silently bled ~20% of its population to a puddle. That shrank
  // its effective n and inflated its variance: measured over 40 runs, diesel at
  // 300° had sd 0.0318 against a ±0.06 tolerance, i.e. under 2 sigma, which is
  // exactly the ~5% flake that was observed. At 340° every cut re-boils, nothing
  // is lost, and all three keep their full population. 340 also leaves 60° of
  // headroom under Gasoline's 400° autoignition, so the sample can't catch fire.
  //
  // 60×60, because tolerance has to be several sigma to be a pin rather than a
  // coin flip. At this size n is 1800 per cut, so the binomial sd is 0.0084 for
  // naphtha (p=0.85) and 0.0115 for BOTH kerosene and diesel — p(1-p) is 0.24
  // either way, since 0.6 and 0.4 sit the same distance from 0.5, so neither of
  // those two is inherently the noisier row. That puts ±0.06 at 7.1 sigma on
  // naphtha and 5.2 on the other two. Sample sds measured across independent
  // batches totalling ~110 suite runs landed between 0.007 and 0.014 per cut,
  // scattering around those figures as expected; worst deviation seen was 0.037
  // and nothing failed. (Those are historical observations, not bounds — a
  // fresh batch drawing a slightly lower or higher sample sd is normal.)
  const yields: Record<number, number> = {};
  for (const code of [1, 2, 3]) {
    const { grid, sim } = packedBed(60, 60, code);
    holdAt(grid, sim, 340, 200);
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

  // Seeded with a 2×2 pilot flame rather than a single Fire cell, and the reason
  // is worth writing down. Fire has a 0.1/tick burnout chance, so a lone seed
  // cell can burn out on the very tick it is placed — before the scan reaches
  // the ethylene next to it — and then nothing ignites at all. Measured over 400
  // runs the outcome was strictly bimodal: 0 ethylene left (front ran to
  // completion) in ~91% of runs, 63 left (front never started) in ~9%. Never a
  // partial burn, and running 80 or 150 ticks instead of 40 changed nothing —
  // so this was a flaky *seed*, not too small a tick budget. With four seed
  // cells the front has to lose every one of them in one tick (~1e-4) and the
  // same 400 runs came back 400/400 clean. What the check is actually for is the
  // propagation, so the seed shouldn't be the coin flip.
  const lit = filled(8, 8, ETHYLENE.id);
  for (const [fx, fy] of [[1, 8], [2, 8], [1, 7], [2, 7]]) lit.grid.set(fx, fy, FIRE.id);
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

  // Same bound must hold for an out-of-range aux. No live mechanic is known to
  // write one (blast debris rides as a different id and lands via `spawn`, which
  // zeroes aux) — this stands in for a hand-edited save or a future system that
  // writes aux without gating on the cell's id. A material id in that slot reads
  // unclamped as a 141-generation chain, far deeper than the cloud is wide, i.e.
  // the whole cloud; the clamp in ethylene.ts is what stops it, and this is the
  // check that would catch its removal.
  const mangled = strayGrain(POLYETHYLENE.id);
  check(
    'a grain with an out-of-range aux is clamped to the same bound',
    mangled <= bound,
    `${mangled} grains (bound ${bound}, cloud ${cloud})`,
  );
}

// --- 9. The whole recipe, driven by real heat, actually returns product -------
{
  // The check that would have caught the old design, and the reason it is
  // written the way it is.
  //
  // Its predecessor drove real heat too — an iron lining held at 1050°, vapour
  // free to find its own temperature — but it asserted only that ONE cell ever
  // became Ethylene, and then stopped the clock. That passes at 0% recovery: a
  // cell or two cracks while the other fifty-nine condense to Gasoline, ignite
  // at 400° in the hot vessel, and burn away. Measured on the old mechanic, a
  // 60-cell charge with the lining pinned forever at 900°, 1050° and 1150°
  // returned zero ethylene at every temperature, and the check was green for all
  // of them.
  //
  // So this one asserts a FRACTION OF THE CHARGE RECOVERED, not first light, and
  // it never writes a temperature onto the feedstock or the product — only onto
  // the iron hotplate under the pool, which is the one thing a player's fire
  // actually heats. Everything else has to follow from the sim.
  //
  // The build under test is the documented one: a pool of gasoline on a heated
  // floor, boiling (reflux: 200° + 60) into vapour that rises into a catalyst
  // roof. The hotplate sits at 300° — above the reflux point so the pool keeps
  // delivering, below Gasoline's 400° autoignition so the vessel is not a
  // firebox. Product is counted as monomer + resin together, since the roof is
  // cool enough at the top for some of it to set on the spot.
  const w = 10;
  const h = 12;
  const { grid, sim } = box(w, h);
  const CHARGE = 20;
  for (let y = h - 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) grid.set(x, y, GASOLINE.id);
  }
  // Catalyst roof, two rows under the lid, with a gap above the pool for the
  // vapour to rise through.
  for (let x = 1; x <= w; x++) grid.set(x, 1, CATALYST.id);
  // Iron hotplate: the floor of the vessel, and the only cell we ever heat.
  const plate: [number, number][] = [];
  for (let x = 0; x < w + 2; x++) plate.push([x, h + 1]);
  for (const [x, y] of plate) grid.set(x, y, IRON.id);

  const TICKS = 1200;
  for (let t = 0; t < TICKS; t++) {
    for (const [x, y] of plate) grid.setTemp(x, y, 300);
    sim.step();
  }
  const product = count(grid, ETHYLENE.id) + count(grid, POLYETHYLENE.id);
  // Loose on purpose — this is a "does the plant actually run" guard, not a
  // tuning pin. But it is a real fraction, so a change that makes the line
  // technically-true-but-useless again fails here instead of passing green.
  check(
    'a heated gasoline pool under a catalyst roof returns real product',
    product >= CHARGE * 0.25,
    `${product} ethylene+resin from a ${CHARGE}-cell pool ` +
      `(${count(grid, ETHYLENE.id)} monomer, ${count(grid, POLYETHYLENE.id)} resin, ` +
      `${count(grid, GASOLINE.id)} gasoline left)`,
  );
}

// --- 10. Acid runs off the resin ---------------------------------------------
{
  // Polyethylene is `acidResistant` (see polyethylene.ts) — the plastics line's
  // payoff, and the reason acid ships in HDPE jerrycans in the first place.
  //
  // Every scene here is run TWICE over the same geometry, once with resin and
  // once with Sawdust, and Sawdust is the control on purpose: it is the other
  // buoyant powder (density 2 against the resin's 2.75, both under Acid's 3), so
  // both heaps float up into the corrosive layer the same way and the contact
  // the resin survives is contact the control demonstrably had. Without that
  // pairing "resistant" is indistinguishable from "never touched it", which is
  // the failure mode a survivor count on its own cannot see.
  // The box is bigger than these scenes need for contact, and the acid ledger is
  // why. Acid only rolls to spend itself on a tick where it actually ate, so the
  // odds it never spends any is (1 - 0.08) ^ (cells eaten): at a 30-cell heap
  // that is a 1-in-12 spurious red, which is roughly what this scene was doing.
  // 140 cells eaten puts it at 1 in 100,000.
  //
  // The powder stays a MINORITY of the box, which is not cosmetic. A deep heap
  // under a thin acid layer is interface-limited — the buoyant grains can only
  // rise into acid that is there to be displaced — and a 8-rows-of-powder version
  // of this scene ate 8 cells instead of 140 and flaked worse than what it
  // replaced. Keep the ~1:3 ratio if these numbers are ever retuned.
  const POWDER_ROWS = 7;
  const W = 20;
  const H = 28;

  /** Cells of `id` on the main layer PLUS cells carrying it as a liquid overlay.
   *  Both layers have to be counted or the acid ledger below reads wrong for a
   *  reason that has nothing to do with corrosion: a buoyant powder that has
   *  surfaced through a pool holds the liquid it displaced in its own cell's
   *  overlay slot (behaviors.ts), so a submerged resin raft parks a cell of acid
   *  apiece off the main layer. Counting only `grid.get` would score all of those
   *  as "consumed" — which is exactly the thing under test. */
  function countAll(grid: Grid, id: number): number {
    let n = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.get(x, y) === id) n++;
        if (grid.getOverlay(x, y) === id) n++;
      }
    }
    return n;
  }

  /** Bottom `POWDER_ROWS` rows of a sealed box are `powder`, the rest `attacker`.
   *  Returns what is left of each after `ticks`. `perTick`, if given, runs at the
   *  end of every tick — see the vapour scene, which uses it to keep the chamber
   *  saturated. */
  function bath(
    powder: number,
    attacker: number,
    ticks: number,
    perTick?: (grid: Grid) => void,
  ): { powderLeft: number; powderStart: number; attackerLeft: number; attackerStart: number } {
    const { grid, sim } = box(W, H);
    for (let y = 1; y <= H; y++) {
      for (let x = 1; x <= W; x++) grid.set(x, y, y > H - POWDER_ROWS ? powder : attacker);
    }
    const powderStart = countAll(grid, powder);
    const attackerStart = countAll(grid, attacker);
    for (let t = 0; t < ticks; t++) {
      sim.step();
      perTick?.(grid);
    }
    return {
      powderLeft: countAll(grid, powder),
      powderStart,
      attackerLeft: countAll(grid, attacker),
      attackerStart,
    };
  }

  const TICKS = 600;

  // (a) Liquid Acid. The resin count must be EXACT, not merely high: nothing else
  // in this box can consume it (no flame, ambient temperature, no reaction row),
  // so a single missing cell means acid took it.
  const resin = bath(POLYETHYLENE.id, ACID.id, TICKS);
  const dust = bath(SAWDUST.id, ACID.id, TICKS);
  check(
    'acid does not eat Polyethylene',
    resin.powderLeft === resin.powderStart,
    `${resin.powderLeft}/${resin.powderStart} resin left`,
  );
  check(
    'control — the same acid bath eats Sawdust',
    dust.powderLeft < dust.powderStart * 0.5,
    `${dust.powderLeft}/${dust.powderStart} sawdust left`,
  );
  // The other direction, and the reason it belongs next to the check above: acid
  // only ever spends itself as a byproduct of corroding (corrosion.ts). A box holding
  // nothing corrodible must therefore come out with every acid cell it went in
  // with — so if some future change quietly made the resin corrodible-but-slow,
  // this fails even in the run where every resin cell happens to survive.
  check(
    'acid in a resin-lined box is not consumed either',
    resin.attackerLeft === resin.attackerStart,
    `${resin.attackerLeft}/${resin.attackerStart} acid left ` +
      `(sawdust control burned ${dust.attackerStart - dust.attackerLeft})`,
  );
  check(
    'control — the acid eating sawdust does spend itself',
    dust.attackerLeft < dust.attackerStart,
    `${dust.attackerLeft}/${dust.attackerStart} acid left`,
  );

  // (b) Acid Vapor. The fumes need one piece of scaffolding that the liquid and
  // the slime don't. Sealed in a full box every vapour cell has something over
  // its head, which is the *fast* condensation branch (0.03 a tick), so the whole
  // charge is liquid Acid inside ~150 of the 600 ticks — after which this scene
  // is just the liquid test again, and a vapour-only regression would sail past
  // it. So the chamber is kept saturated instead: `reflux` boils any condensate
  // back to fumes at the end of every tick, before the sim can give that cell a
  // turn as liquid Acid. `refluxed` counts what it caught, which is both proof
  // the confound is real and proof the scaffolding is doing something.
  let refluxed = 0;
  const reflux = (grid: Grid): void => {
    for (let y = 1; y <= H; y++) {
      for (let x = 1; x <= W; x++) {
        if (grid.get(x, y) === ACID.id) {
          grid.set(x, y, ACID_VAPOR.id);
          refluxed++;
        }
        // A drop caught under a floating grain sits in the overlay slot, which
        // only ever holds a fluid the host is submerged in — vent it rather than
        // put a gas there.
        if (grid.getOverlay(x, y) === ACID.id) {
          grid.setOverlay(x, y, EMPTY);
          refluxed++;
        }
      }
    }
  };
  // The control's target is exact rather than a fraction, and that is worth
  // stating because it is a fact about the engine, not about acid: fumes eat the
  // heap's top face and then STOP, at exactly W cells. A gas rises, so once the
  // interface row is gone the vapour will not descend into the void it just made,
  // and the row beneath is never touched again. So the control must lose its whole
  // top row — the resin, in the identical box, loses none — and neither side is
  // expected to go further. (The old version of this scene ran the sawdust to
  // 0/30, which was the tell that the liquid had taken over.)
  //
  // Long enough that clearing that row is a certainty and not a coin flip: at
  // 0.015 a tick the last of the face's W=20 cells goes at ~240 ticks on average
  // (the mean is (1/0.015)·H(W), and the harmonic number grows slowly enough that
  // widening the box barely moves it), so 1200 is about five times the mean.
  const VAPOR_TICKS = 1200;
  const vaporKept = bath(POLYETHYLENE.id, ACID_VAPOR.id, VAPOR_TICKS, reflux);
  const vaporControl = bath(SAWDUST.id, ACID_VAPOR.id, VAPOR_TICKS, reflux);
  check(
    'Acid Vapor does not eat Polyethylene',
    vaporKept.powderLeft === vaporKept.powderStart,
    `${vaporKept.powderLeft}/${vaporKept.powderStart} resin left`,
  );
  check(
    'control — the same Acid Vapor eats the whole face of a Sawdust heap',
    vaporControl.powderStart - vaporControl.powderLeft >= W,
    `${vaporControl.powderLeft}/${vaporControl.powderStart} sawdust left ` +
      `(${vaporControl.powderStart - vaporControl.powderLeft} eaten, the ${W}-cell face)`,
  );
  // The scaffolding is load-bearing, so say what this last line does and does not
  // show. That no cell ever took a turn as liquid Acid is true *by construction* —
  // `reflux` runs after every step and before the next, so a condensate is always
  // gone before the sim could reach it — and there is nothing left to measure about
  // it. What is worth measuring is that the confound was real in the first place:
  // if condensation ever stopped happening here, the two checks above would quietly
  // become a weaker test than they look, and this is the line that would notice.
  check(
    'the condensation this scene is scaffolded against really happens',
    refluxed > 0,
    `${refluxed} condensate cells boiled back before they could act`,
  );

  // (c) Acid Slime. Same flag, its own material file — checked rather than assumed
  // to follow from the liquid. (No exact-conservation assertion on the attacker in
  // either of these two: the vapour is being topped up by hand and the slime can
  // be diluted, so only the powder side is a clean count.)
  const slimeKept = bath(POLYETHYLENE.id, ACID_SLIME.id, TICKS);
  const slimeControl = bath(SAWDUST.id, ACID_SLIME.id, TICKS);
  check(
    'Acid Slime does not eat Polyethylene',
    slimeKept.powderLeft === slimeKept.powderStart,
    `${slimeKept.powderLeft}/${slimeKept.powderStart} resin left`,
  );
  check(
    'control — the same Acid Slime eats Sawdust',
    slimeControl.powderLeft < slimeControl.powderStart * 0.7,
    `${slimeControl.powderLeft}/${slimeControl.powderStart} sawdust left`,
  );
}

console.log(failed === 0 ? '\nAll plastics checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
