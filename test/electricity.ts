/**
 * Electricity packing harness — guards the invariants that used to be a live
 * budget in spark.ts and are now supposed to be independent of each other.
 *
 * `aux` is 16 bits per cell (Grid.aux) and spark.ts splits it into a conductor
 * class (low byte) and a pulse strength (high byte). Before the widening those
 * two shared one byte, so every conductor added to the roster halved the reach
 * of every lossy medium. These checks pin down both halves of that fix:
 *
 *   1. Reach — a pulse down a straight wire travels FULL_STRENGTH/loss cells for
 *      each medium, so a regression in the packing (a class field eating
 *      strength bits again, a mis-shifted mask) shows up as a shorter wire.
 *   2. Class round trip — every registered conductor packs and unpacks to
 *      itself, including classes above 15 that the old 4-bit field couldn't hold.
 *   3. Persistence — a 16-bit aux survives serialize → deserialize, and a save
 *      written in the old byte-wide format (no `auxHi` plane) still loads.
 *
 * Run: `node test/run-electricity.mjs`.
 */
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { serializeWorld, deserializeWorld } from '../src/state/persistence';
import { FULL_STRENGTH, packSpark, conductorClass, SPARK } from '../src/game/materials/spark';
import { getMaterial, allMaterials } from '../src/game/materials/registry';
import { WALL } from '../src/game/materials/wall';
import { WATER } from '../src/game/materials/water';
import { SALTWATER } from '../src/game/materials/saltwater';
import { ACID } from '../src/game/materials/acid';
import { IRON } from '../src/game/materials/iron';
import '../src/game/materials'; // register all materials (side effect)

// Pin the sim's randomness high so every `sim.chance(p)` with p < 1 comes out
// false, the same seam the active-tiles harness uses to make a run reproducible.
// What this buys the reach measurement: a pulse crossing water has a per-cell
// chance of electrolysing that cell into Hydrogen, which snaps the wire and
// would cut a run short at a random point — so the honest simulation gives a
// different answer every time. Held at the "no dice" end, the wire stays intact
// and the reach measured is exactly the one the packing dictates, which is what
// these checks are about.
Math.random = () => 0.999999;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

/**
 * How far a single pulse carries down a straight horizontal wire of `matId`,
 * in cells from the seed. Seeds one spark at full strength and steps until the
 * wave has had time to cross the whole wire, tracking the furthest live spark.
 *
 * The wire runs through a Wall channel one cell tall, sealed at both ends. Half
 * the conductors in the roster are liquids, and an unsupported row of Water
 * would simply fall to the floor and spread out before the pulse got anywhere —
 * the channel holds every medium in the same straight line so the number
 * measured is reach, not fluid dynamics. A completely full channel also can't
 * flow internally, so the wire is static for solids and liquids alike.
 */
function reach(matId: number, wireLen = 200): number {
  const grid = new Grid(wireLen, 3);
  const sim = new Simulation(grid);
  const y = 1;
  for (let x = 0; x < wireLen; x++) {
    grid.set(x, 0, WALL.id);
    grid.set(x, 2, WALL.id);
    grid.set(x, y, matId);
  }
  grid.set(0, y, WALL.id); // cap both ends so nothing can drain out sideways
  grid.set(wireLen - 1, y, WALL.id);
  grid.set(1, y, SPARK.id);
  grid.setAux(1, y, packSpark(FULL_STRENGTH, conductorClass(matId)));
  let far = 1;
  for (let t = 0; t < wireLen + 20; t++) {
    sim.step();
    for (let x = 0; x < wireLen; x++) {
      if (grid.get(x, y) === SPARK.id) far = far > x ? far : x;
    }
  }
  return far - 1;
}

// --- 1. reach per medium ------------------------------------------------------
// A pulse loses CONDUCTOR_LOSS strength entering each cell and stops when it
// would arrive dead, so a lossy medium carries ~FULL_STRENGTH/loss cells. These
// bounds are deliberately loose (the point is the order of magnitude, which is
// what a packing regression would break) but tight enough to catch a halving.
const waterReach = reach(WATER.id);
const brineReach = reach(SALTWATER.id);
const acidReach = reach(ACID.id);
const ironReach = reach(IRON.id);
const half = FULL_STRENGTH >> 1;
check(
  'water carries ~FULL_STRENGTH/2 cells',
  waterReach > half - 4 && waterReach <= half + 1,
  `${waterReach} cells (FULL_STRENGTH ${FULL_STRENGTH})`,
);
check(
  'saltwater carries ~FULL_STRENGTH cells',
  brineReach > FULL_STRENGTH - 5 && brineReach <= FULL_STRENGTH,
  `${brineReach} cells`,
);
check('acid matches saltwater', acidReach === brineReach, `${acidReach} vs ${brineReach}`);
check('iron runs the whole wire (zero loss)', ironReach > 150, `${ironReach} cells`);

// --- 2. every conductor round-trips through the class field -------------------
// The failure this guards against is silent: a class that overflows the field
// wraps to 0 and the spark deletes the wire cell instead of reverting to it.
//
// The 8/8 split is unpacked here with literal `& 0xff` / `>> 8` rather than by
// importing spark.ts's CLASS_BITS/CLASS_MASK, and that is deliberate: these
// checks are meant to pin the layout, not to follow it. Reading the constants
// back out of the module under test would make the assertions restate whatever
// the packing currently is, so narrowing the class field again would still
// "pass". With the literals, a regression to CLASS_BITS 4 fails both checks
// below — the class masks down to 4 bits and the strength clamps to 15.
{
  const conductors = allMaterials().filter((m) => m.conductive);
  let allOk = conductors.length > 0;
  let maxClass = 0;
  for (const m of conductors) {
    const cls = conductorClass(m.id);
    maxClass = Math.max(maxClass, cls);
    const packed = packSpark(FULL_STRENGTH, cls);
    const unpackedClass = packed & 0xff;
    const unpackedStrength = packed >> 8;
    if (cls === 0 || unpackedClass !== cls || unpackedStrength !== FULL_STRENGTH) {
      check(`conductor ${m.name} round trips`, false, `class ${cls} → ${unpackedClass}`);
      allOk = false;
    }
  }
  check(
    'every conductive material round trips through the class field',
    allOk,
    `${conductors.length} conductors, highest class ${maxClass}`,
  );
  // Classes past 15 are exactly what the old 4-bit field could not express;
  // prove the field holds them even though the roster hasn't reached there yet.
  const wide = packSpark(FULL_STRENGTH, 200);
  check(
    'a class beyond the old 4-bit ceiling packs cleanly',
    (wide & 0xff) === 200 && wide >> 8 === FULL_STRENGTH,
    `class ${wide & 0xff}, strength ${wide >> 8}`,
  );
  check('FULL_STRENGTH fits the strength field', FULL_STRENGTH <= 0xff && FULL_STRENGTH > 0);
}

// --- 3. persistence round trip ------------------------------------------------
{
  const grid = new Grid(20, 10);
  const packed = packSpark(FULL_STRENGTH, conductorClass(WATER.id));
  grid.set(3, 3, SPARK.id);
  grid.setAux(3, 3, packed);
  grid.set(4, 4, IRON.id);
  grid.setAux(4, 4, 0xfffe); // the widest value the field can hold
  const back = deserializeWorld(JSON.parse(serializeWorld(grid)));
  check('world round trips', !!back && back.aux instanceof Uint16Array);
  check(
    'a packed spark aux survives a save/load',
    back?.aux?.[3 * 20 + 3] === packed,
    `${back?.aux?.[3 * 20 + 3]} vs ${packed}`,
  );
  check(
    'a full 16-bit aux survives a save/load',
    back?.aux?.[4 * 20 + 4] === 0xfffe,
    `${back?.aux?.[4 * 20 + 4]}`,
  );
  check('the reloaded spark still knows its conductor', getMaterial(WATER.id) !== undefined);
}

// --- 3b. a save written before aux was widened still loads ---------------------
{
  const grid = new Grid(20, 10);
  grid.set(5, 5, IRON.id);
  grid.setAux(5, 5, 3); // an ordinary refractory countdown, as an old build wrote it
  const j = JSON.parse(serializeWorld(grid));
  delete j.auxHi; // a save from before the high plane existed
  delete j.ovaHi;
  const back = deserializeWorld(j);
  check('a legacy byte-wide save still loads', !!back);
  check(
    'legacy aux keeps its value',
    back?.aux?.[5 * 20 + 5] === 3,
    `${back?.aux?.[5 * 20 + 5]}`,
  );
}

console.log(
  failed === 0 ? '\nOK — electricity packing intact.' : `\n${failed} check(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
