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
import type { Material } from '../src/game/engine/types';
import { WALL } from '../src/game/materials/wall';
import { BATTERY, PULSE_PERIOD } from '../src/game/materials/battery';
import { LFP_BATTERY } from '../src/game/materials/lfpbattery';
import { FAN } from '../src/game/materials/fan';
import { LASER } from '../src/game/materials/laser';
import { PUMP } from '../src/game/materials/pump';
import { ELECTROMAGNET } from '../src/game/materials/electromagnet';
import { WOOFER } from '../src/game/materials/woofer';
import { CONVEYOR, CONVEYOR_LEFT, CONVEYOR_RIGHT } from '../src/game/materials/conveyor';
import { WATER } from '../src/game/materials/water';
import { SALTWATER } from '../src/game/materials/saltwater';
import { ACID } from '../src/game/materials/acid';
import { IRON } from '../src/game/materials/iron';
import { STONE } from '../src/game/materials/stone';
import { SAND } from '../src/game/materials/sand';
import { WIRE } from '../src/game/materials/wire';
import { SOLAR_PANEL } from '../src/game/materials/solarpanel';
import { TURBINE } from '../src/game/materials/turbine';
import { STEAM } from '../src/game/materials/steam';
import { SLIME } from '../src/game/materials/slime';
import { ACID_SLIME } from '../src/game/materials/acidslime';
import { NICHROME } from '../src/game/materials/nichrome';
import { emitHeatRay } from '../src/game/materials/heatray';
import { AMBIENT_TEMP } from '../src/game/config';
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

// --- 4. electric devices: 전기 세기에 관계없이 연결 부위 전역 즉시 활성화 -------
// The device category's activation contract (see engine/deviceBody.ts): a pulse
// reaching ANY face of a connected device body activates ALL of it, in that same
// tick, at full effect whatever strength the pulse had left. Both halves used to
// be broken by the same 256-cell cap every device carried: a big machine only ran
// near the wire, and — since each pulse restarted the walk from the same entry
// cell — its far side never ran at all, which reads in game as power fading with
// distance through the machine.
//
// A device's body is 20×20 = 400 cells here, comfortably past that old cap, so a
// regression to any per-flood cell limit shows up as "powered < total".

/** One device kind's probe: how to tell an activated cell of it apart from an
 *  idle one. Fan/Laser/Conveyor pack a direction into the low 2 bits and count down
 *  in the rest; Pump/Electromagnet use the whole aux as the countdown; the Woofer stamps
 *  no cell state at all (it fires a shockwave and is done), so its activation is
 *  read from the body-flood memo the pulse filled. Unpacked with literals rather
 *  than by importing each material's constants, same reasoning as the class-field
 *  checks above: these assertions pin the behavior, they don't restate it. */
interface DeviceProbe {
  mat: Material;
  activated: (sim: Simulation, grid: Grid, x: number, y: number) => boolean;
  /** Activation "level" of one cell, for the strength-independence check. */
  level: (grid: Grid, x: number, y: number) => number;
}
const timerAboveDir = (grid: Grid, x: number, y: number): number => grid.getAux(x, y) >> 2;
const wholeAux = (grid: Grid, x: number, y: number): number => grid.getAux(x, y);
const DEVICE_PROBES: DeviceProbe[] = [
  { mat: FAN, activated: (_s, g, x, y) => timerAboveDir(g, x, y) > 0, level: timerAboveDir },
  { mat: LASER, activated: (_s, g, x, y) => timerAboveDir(g, x, y) > 0, level: timerAboveDir },
  { mat: CONVEYOR, activated: (_s, g, x, y) => timerAboveDir(g, x, y) > 0, level: timerAboveDir },
  { mat: PUMP, activated: (_s, g, x, y) => wholeAux(g, x, y) > 0, level: wholeAux },
  { mat: ELECTROMAGNET, activated: (_s, g, x, y) => wholeAux(g, x, y) > 0, level: wholeAux },
  {
    mat: WOOFER,
    activated: (_s, g, x, y) => wavefront(g).has(y * g.width + x),
    level: () => 0, // no per-cell state to grade — a thump is a thump
  },
];

/** Which cells took part in the last shockwave this world emitted. The Woofer
 *  stamps no per-cell state, so its activation is read off the wavefront it hands
 *  the renderer, which is grown from every cell the flood actually reached (see
 *  woofer.ts / Grid.shockwaves) — the honest record of how much of the cabinet
 *  thumped. Cached per grid so probing 400 cells doesn't rebuild it 400 times. */
let wavefrontGrid: Grid | null = null;
let wavefrontSet = new Set<number>();
function wavefront(grid: Grid): Set<number> {
  if (wavefrontGrid !== grid) {
    wavefrontGrid = grid;
    wavefrontSet = new Set<number>();
    for (const wave of grid.shockwaves) {
      for (let i = 0; i < wave.bx.length; i++) {
        wavefrontSet.add(wave.by[i] * grid.width + wave.bx[i]);
      }
    }
  }
  return wavefrontSet;
}

const BLOCK = 20; // 400-cell body: past the 256-cell cap devices used to carry
const BLOCK_X = 5;
const BLOCK_Y = 5;

/** A world holding one BLOCK×BLOCK body of `matId` with a bare wire cell tucked
 *  against its top-left corner, ready to be seeded with a pulse of any strength. */
function deviceScene(matId: number): { grid: Grid; sim: Simulation } {
  const grid = new Grid(BLOCK_X + BLOCK + 6, BLOCK_Y + BLOCK + 6);
  const sim = new Simulation(grid);
  for (let dy = 0; dy < BLOCK; dy++) {
    for (let dx = 0; dx < BLOCK; dx++) grid.set(BLOCK_X + dx, BLOCK_Y + dy, matId);
  }
  return { grid, sim };
}

/** Energize the corner of a device body with a single pulse of `strength`,
 *  delivered the way the game does it — an Iron wire cell touching one corner,
 *  carrying a Spark, whose own arc phase dispatches through spark.ts's shared
 *  `reactToPulse` into the device's `directPulse` hook. Returns how many of the
 *  body's cells came up, and the range of activation levels across them. */
function pulseCorner(
  probe: DeviceProbe,
  strength: number,
): { powered: number; total: number; minLevel: number; maxLevel: number } {
  const { grid, sim } = deviceScene(probe.mat.id);
  grid.set(BLOCK_X - 1, BLOCK_Y, IRON.id);
  grid.set(BLOCK_X - 1, BLOCK_Y, SPARK.id);
  grid.setAux(BLOCK_X - 1, BLOCK_Y, packSpark(strength, conductorClass(IRON.id)));
  sim.step();

  let powered = 0;
  let minLevel = Infinity;
  let maxLevel = -Infinity;
  for (let dy = 0; dy < BLOCK; dy++) {
    for (let dx = 0; dx < BLOCK; dx++) {
      const x = BLOCK_X + dx;
      const y = BLOCK_Y + dy;
      if (probe.activated(sim, grid, x, y)) powered++;
      const lv = probe.level(grid, x, y);
      minLevel = Math.min(minLevel, lv);
      maxLevel = Math.max(maxLevel, lv);
    }
  }
  return { powered, total: BLOCK * BLOCK, minLevel, maxLevel };
}

{
  // Every electric device that accepts power must be probed here, so adding one
  // without extending this harness fails loudly instead of going unguarded.
  const declared = allMaterials()
    .filter((m) => m.directPulse && m.category === 'electric')
    .map((m) => m.name)
    .sort();
  const probed = DEVICE_PROBES.map((p) => p.mat.name).sort();
  check(
    'every electric device with a power hook is covered here',
    declared.join() === probed.join(),
    `declared [${declared.join(', ')}] vs probed [${probed.join(', ')}]`,
  );

  for (const probe of DEVICE_PROBES) {
    // 연결 부위 전역: one corner contact brings the whole body up, this tick.
    const full = pulseCorner(probe, FULL_STRENGTH);
    check(
      `${probe.mat.name}: one contact activates the whole connected body`,
      full.powered === full.total,
      `${full.powered}/${full.total} cells`,
    );
    // 전기 세기에 관계없이: the weakest pulse the packing can express (1 — one more
    // cell of any lossy medium and it would have died on the way) does exactly the
    // same thing, to exactly the same degree. Nothing on this side of the wire
    // reads strength, so a machine at the far end of a long brine run behaves like
    // one bolted to the battery.
    const faint = pulseCorner(probe, 1);
    check(
      `${probe.mat.name}: a strength-1 pulse activates it identically`,
      faint.powered === full.powered &&
        faint.minLevel === full.minLevel &&
        faint.maxLevel === full.maxLevel,
      `${faint.powered}/${faint.total} cells, level ${faint.minLevel}..${faint.maxLevel} ` +
        `vs ${full.minLevel}..${full.maxLevel} at full strength`,
    );
  }
}

// --- 4b. end to end: a battery bolted to a big machine runs all of it ----------
// The same contract through the real source path (battery beat → shared pulseCell
// → device hook) and at a size no build would reach: 900 cells, 3.5× the old cap.
{
  const side = 30;
  const grid = new Grid(side + 8, side + 8);
  const sim = new Simulation(grid);
  for (let dy = 0; dy < side; dy++) {
    for (let dx = 0; dx < side; dx++) grid.set(4 + dx, 4 + dy, FAN.id);
  }
  grid.set(3, 4, BATTERY.id); // one terminal against a single corner cell
  for (let t = 0; t < PULSE_PERIOD + 3; t++) sim.step();

  let powered = 0;
  for (let dy = 0; dy < side; dy++) {
    for (let dx = 0; dx < side; dx++) if (grid.getAux(4 + dx, 4 + dy) >> 2 > 0) powered++;
  }
  check(
    'a battery on one corner spins up a 900-cell fan wall entirely',
    powered === side * side,
    `${powered}/${side * side} cells`,
  );
}

// --- 4c. Conveyor: 전원 공급시에만 작동 ----------------------------------------
// The belt is an appliance, not a slope: an unpowered one is an inert floor and
// carries nothing at all. The activation contract itself is covered by the probe
// above (a corner contact runs the whole run, at any strength); what's checked
// here is the *consequence* — that the cargo moves if and only if the belt has
// power, in the direction its aux says, and that pulling the power actually stops
// it rather than leaving the load coasting forever.
//
// The controls are the point: the unpowered run is the same scene minus the
// battery, so "the sand did not move" can't be a scene that never worked. And the
// coast is measured against POWERED_TICKS rather than merely asserted to end,
// because a belt that quietly re-armed itself would still eventually stop when the
// grain ran off the end of a short belt.

/** A long belt with one sand grain resting on it, optionally with a Battery
 *  clipped to the left end. Returns the grain's column after `ticks`. */
function beltRun(
  dir: number,
  powered: boolean,
  ticks: number,
): { grid: Grid; sim: Simulation; sand: () => number } {
  const grid = new Grid(200, 12);
  const sim = new Simulation(grid);
  for (let x = 2; x < 190; x++) {
    grid.set(x, 8, CONVEYOR.id);
    grid.setAux(x, 8, dir);
  }
  grid.set(95, 7, SAND.id); // mid-run, far from either end
  if (powered) grid.set(2, 7, BATTERY.id);
  const sand = (): number => {
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) if (grid.get(x, y) === SAND.id) return x;
    return -1;
  };
  for (let t = 0; t < ticks; t++) sim.step();
  return { grid, sim, sand };
}
{
  const dead = beltRun(CONVEYOR_RIGHT, false, 60);
  check(
    'an unpowered Conveyor carries nothing — it is an inert floor',
    dead.sand() === 95,
    `sand at ${dead.sand()}, placed at 95`,
  );
  const live = beltRun(CONVEYOR_RIGHT, true, 60);
  check(
    '…while the same belt on a battery carries it (the check can fail)',
    live.sand() > 95,
    `sand at ${live.sand()}, placed at 95`,
  );
  const left = beltRun(CONVEYOR_LEFT, true, 60);
  check(
    'a powered belt drawn leftward carries the other way',
    left.sand() < 95,
    `sand at ${left.sand()}, placed at 95`,
  );

  // Cutting power stops it: the countdown each pulse refreshes runs out, and no
  // cell is left running. 24 is the belt's POWERED_TICKS, read here as a bound on
  // how far one last pulse may carry the load, not restated as a constant.
  const cut = beltRun(CONVEYOR_RIGHT, true, 30);
  const atCut = cut.sand();
  cut.grid.set(2, 7, 0); // pull the battery
  for (let t = 0; t < 200; t++) cut.sim.step();
  let stillRunning = 0;
  for (let x = 2; x < 190; x++) if (cut.grid.getAux(x, 8) >> 2 > 0) stillRunning++;
  check(
    'pulling the power stops the belt within one countdown',
    cut.sand() - atCut <= 24 && stillRunning === 0,
    `coasted ${cut.sand() - atCut} cells (≤24), ${stillRunning} cells still running after 200 ticks`,
  );
  /** The distinct values of `read` across every cell of a 188-cell belt run. */
  const alongBelt = (grid: Grid, read: (aux: number) => number): Set<number> => {
    const seen = new Set<number>();
    for (let x = 2; x < 190; x++) seen.add(read(grid.getAux(x, 8)));
    return seen;
  };
  const countdowns = alongBelt(live.grid, (aux) => aux >> 2);
  check(
    '…and the run holds one countdown across the whole body, not a gradient',
    countdowns.size === 1,
    `${countdowns.size} distinct countdowns along a 188-cell belt`,
  );
  const dirs = alongBelt(left.grid, (aux) => aux & 0b11);
  check(
    '…while every cell keeps its own direction bits through it',
    dirs.size === 1 && dirs.has(CONVEYOR_LEFT),
    `dir bits along the belt: [${[...dirs].join(', ')}] (CONVEYOR_LEFT ${CONVEYOR_LEFT})`,
  );
}

// --- 4d. Conveyor: the staircase is ONE machine (8-connected flood) ------------
// A belt's headline shape is the ascending staircase — steps offset by one cell in
// BOTH axes, so consecutive steps touch only at their corners. Every other device
// is a filled block, which is 4-connected anyway; this one is not, and flooding it
// 4-connected quietly turns a staircase into a heap of one-step machines: a
// battery at the foot powers the first step, the rest of the climb stands dead,
// and a grain rides up exactly one step and stops. That is what `diagonal` in
// floodDeviceBody exists for.
//
// The control is the same scene with every belt cell force-powered by hand,
// bypassing the flood entirely. Measuring against it rather than against a
// hard-coded coordinate is the point: it says "one battery does what powering
// every cell by hand does", which is exactly the property that broke, and it can't
// be satisfied by a staircase that simply doesn't carry.
{
  const W = 34;
  const H = 18;
  const RUN = 3; // belt cells per step

  /** A staircase belt rising to the right, one grain of sand set on its foot.
   *  `force` powers every belt cell by hand each tick instead of using a battery. */
  const staircase = (force: boolean): { x: number; y: number } => {
    const grid = new Grid(W, H);
    const sim = new Simulation(grid);
    let by = H - 2;
    const belts: Array<[number, number]> = [];
    for (let x = 1; x < W - 1; x++) {
      grid.set(x, by, CONVEYOR.id);
      grid.setAux(x, by, CONVEYOR_RIGHT);
      belts.push([x, by]);
      for (let y = by + 1; y < H; y++) grid.set(x, y, WALL.id);
      if ((x - 1) % RUN === RUN - 1 && by > 2) by--;
    }
    for (let y = 0; y < H; y++) {
      grid.set(0, y, WALL.id);
      grid.set(W - 1, y, WALL.id);
    }
    if (!force) grid.set(1, H - 3, BATTERY.id); // one terminal, at the foot
    grid.set(3, H - 3, SAND.id);
    for (let t = 0; t < 300; t++) {
      if (force) for (const [bx, by2] of belts) grid.setAux(bx, by2, (24 << 2) | CONVEYOR_RIGHT);
      sim.step();
    }
    let fx = -1;
    let fy = H;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (grid.get(x, y) === SAND.id) {
          if (x > fx) fx = x;
          if (y < fy) fy = y;
        }
    return { x: fx, y: fy };
  };

  const wired = staircase(false);
  const forced = staircase(true);
  check(
    'one battery at the foot powers the whole staircase belt, not just its first step',
    wired.x === forced.x && wired.y === forced.y,
    `battery carried the grain to (${wired.x},${wired.y}) vs (${forced.x},${forced.y}) with every cell forced on`,
  );
  check(
    '…and that staircase really does climb (the check can fail)',
    forced.x > 25 && forced.y < H - 6,
    `forced-power grain ended at (${forced.x},${forced.y}) from (3,${H - 3})`,
  );
}

// --- 4e. Conveyor: carries a BODY of material, not a skimmed sheet -------------
// 모래 더미 아래의 컨베이어가 모래를 아주 얇게 수송하던 문제. Two things caused it:
// the belt refused to move anything at all while loose matter sat directly ahead
// (so under a pile only the single cell at the toe of the repose slope ever ran),
// and the stack loop stopped at the first cell that couldn't move. Now every cell
// of the column that has room shifts forward, up to LIFT_HEIGHT.
//
// Measured as the steady-state thickness of the moving layer well downstream of a
// silo that is re-stamped full every tick — a drained-pile scene can't show this,
// because given enough ticks a thin sheet delivers the same total.
{
  const W = 200;
  const H = 60;
  const BELT_Y = 50;
  const SILO_X = 6;
  const SILO_W = 6;

  /** Steady-state depth of the load moving along the open belt, fed by a silo
   *  `silo` cells tall whose outlet is `gate` cells high. */
  const movingLayer = (silo: number, gate: number): number => {
    const grid = new Grid(W, H);
    const sim = new Simulation(grid);
    for (let x = 1; x < W - 1; x++) {
      grid.set(x, BELT_Y, CONVEYOR.id);
      grid.setAux(x, BELT_Y, CONVEYOR_RIGHT);
    }
    for (let y = 0; y < H; y++) {
      grid.set(0, y, WALL.id);
      grid.set(W - 1, y, WALL.id);
    }
    for (let y = BELT_Y + 1; y < H; y++) for (let x = 0; x < W; x++) grid.set(x, y, WALL.id);
    for (let dy = 0; dy < silo + 8; dy++) {
      grid.set(SILO_X - 1, BELT_Y - 1 - dy, WALL.id);
      if (dy >= gate) grid.set(SILO_X + SILO_W, BELT_Y - 1 - dy, WALL.id);
    }
    grid.set(1, BELT_Y - 1, BATTERY.id);
    const refill = (): void => {
      for (let dy = 0; dy < silo; dy++)
        for (let dx = 0; dx < SILO_W; dx++) {
          const cx = SILO_X + dx;
          const cy = BELT_Y - 1 - dy;
          if (grid.get(cx, cy) === 0) grid.set(cx, cy, SAND.id);
        }
    };
    for (let t = 0; t < 300; t++) {
      refill();
      sim.step();
    }
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 300; t++) {
      refill();
      sim.step();
      if (t % 10 === 0) {
        for (let x = 100; x < 160; x++) {
          let c = 0;
          for (let y = 0; y < BELT_Y; y++) if (grid.get(x, y) === SAND.id) c++;
          sum += c;
          n++;
        }
      }
    }
    return sum / n;
  };

  // A deep silo with a matching outlet delivers a deep slab. Before the fix this
  // sat at ~9 no matter how deep the load was — LIFT_HEIGHT 10 was the ceiling —
  // and before *that* the belt only nibbled the toe of an open pile at 1–3 cells.
  const deep = movingLayer(40, 40);
  check(
    'a belt under a deep silo moves a deep slab, not a thin sheet',
    deep > 25,
    `moving layer ${deep.toFixed(2)} cells thick (was ~9 with the old LIFT_HEIGHT cap)`,
  );
  // …and the depth genuinely tracks the load rather than being a new fixed number:
  // a narrow outlet still meters the flow, which is what makes a gate a gate.
  const metered = movingLayer(40, 6);
  check(
    '…while a narrow outlet still meters it (the check can fail)',
    metered < deep / 3,
    `gate 6 → ${metered.toFixed(2)} cells vs gate 40 → ${deep.toFixed(2)}`,
  );
}

// --- 4e2. Conveyor: a U-shaped belt ferries its load out instead of trapping it
// The shape a player builds without thinking: descend into a dip, run flat along
// the bottom, climb out the far side. Sand poured into the dip used to ride down
// the near arm fine and then STAY there, with a one-cell layer trickling up the far
// arm — 432 cells poured, 148 out, 108 permanently stuck in the bottom.
//
// The cause is ordering, not the carry rule. A bedded cell can only step forward
// into a landing the cell ahead has already vacated, so a run has to resolve
// downstream-first. The grid scan visits rows bottom-to-top, which is accidentally
// right on a descending belt and exactly backwards on an ascending one — hence a U
// draining in and not out. The belt now walks its own run (see conveyor.ts).
//
// This is the check that shape regressions land on: it is deliberately phrased as
// "the dip ends up EMPTY", which no amount of trickle satisfies inside the budget.
{
  const W = 110;
  const H = 44;
  const TOP = 6;
  const DEPTH = 14; // steps down and back up
  const STEP_RUN = 3; // belt cells per one-cell step — a gentle slope
  const FLAT = 18; // cells along the bottom
  const FILL = 24; // depth of sand poured into the dip

  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  const belt: Array<[number, number]> = [];
  let by = TOP;
  let bx = 3;
  for (let s = 0; s < DEPTH; s++)
    for (let i = 0; i < STEP_RUN; i++, bx++) {
      belt.push([bx, by]);
      if (i === STEP_RUN - 1) by++;
    }
  const flatFrom = bx;
  for (let i = 0; i < FLAT; i++, bx++) belt.push([bx, by]);
  const bottomY = by;
  for (let s = 0; s < DEPTH; s++)
    for (let i = 0; i < STEP_RUN; i++, bx++) {
      belt.push([bx, by]);
      if (i === STEP_RUN - 1) by--;
    }
  for (const [cx, cy] of belt) {
    grid.set(cx, cy, CONVEYOR.id);
    grid.setAux(cx, cy, CONVEYOR_RIGHT);
    for (let yy = cy + 1; yy < H; yy++) grid.set(cx, yy, WALL.id);
  }
  for (let y = 0; y < H; y++) {
    grid.set(0, y, WALL.id);
    grid.set(W - 1, y, WALL.id);
  }
  grid.set(2, TOP, BATTERY.id); // one terminal, on the near rim
  for (let dy = 0; dy < FILL; dy++)
    for (let dx = 0; dx < FLAT; dx++) grid.set(flatFrom + dx, bottomY - 1 - dy, SAND.id);

  const inDip = (): number => {
    let n = 0;
    for (let y = 0; y < H; y++)
      for (let x = flatFrom; x < flatFrom + FLAT; x++) if (grid.get(x, y) === SAND.id) n++;
    return n;
  };
  const poured = inDip();
  for (let t = 0; t < 800; t++) sim.step();
  check(
    'a U-shaped belt carries its load up and out instead of trapping it in the dip',
    inDip() === 0,
    `${inDip()} of ${poured} cells still in the bottom after 800 ticks`,
  );
  // The load has to have gone UP and over the far rim, not merely spread along the
  // bottom of the dip — otherwise "the dip is empty" could be satisfied by sand
  // slumping sideways past the sampled columns.
  let beyond = 0;
  for (let y = 0; y < H; y++) for (let x = bx - 2; x < W; x++) if (grid.get(x, y) === SAND.id) beyond++;
  check(
    '…and it really climbed out the far side (the check can fail)',
    beyond > poured / 3,
    `${beyond} of ${poured} cells made it past the far rim`,
  );
}

// --- 4f. Conveyor: an incompressible load still can't be pushed ---------------
// The looser stack rule must not turn into "matter can be squeezed". A belt buried
// under a load that fills its channel wall to wall has nowhere to put anything, so
// every landing is occupied and nothing may move — the guard is that a target cell
// must be EMPTY, and this is the scene that would catch it being dropped.
{
  const grid = new Grid(30, 30);
  const sim = new Simulation(grid);
  for (let x = 0; x < 30; x++) {
    grid.set(x, 20, CONVEYOR.id);
    grid.setAux(x, 20, CONVEYOR_RIGHT);
    for (let y = 21; y < 30; y++) grid.set(x, y, WALL.id);
  }
  for (let y = 0; y < 30; y++) {
    grid.set(0, y, WALL.id);
    grid.set(29, y, WALL.id);
  }
  for (let y = 5; y < 20; y++) for (let x = 1; x < 29; x++) grid.set(x, y, SAND.id);
  grid.set(1, 4, BATTERY.id);
  const profile = (): string => {
    let s = '';
    for (let x = 1; x < 29; x++) {
      let c = 0;
      for (let y = 0; y < 20; y++) if (grid.get(x, y) === SAND.id) c++;
      s += `${c},`;
    }
    return s;
  };
  const before = profile();
  for (let t = 0; t < 100; t++) sim.step();
  check(
    'a sealed, wall-to-wall load is not compressed or shifted by the belt under it',
    profile() === before,
    `profile changed: ${before} → ${profile()}`,
  );
}

// --- 5. Wire: 피복 — carries the full run, leaks into nothing -------------------
// Wire's promise is *containment*, not reach: a pulse riding it must never cross
// into a bare conductor touching the cable (see Material.insulated), while still
// reaching the far end at no loss and still powering the machine it's wired to.
//
// The scene sandwiches the cable: a full row of Iron above it and a full row of
// Water below, sealed in a Wall channel so the liquid row can't flow (the same
// trick `reach` uses). If the jacket leaks even once, the neighbouring rows show
// a Spark. The control run swaps the cable for bare Iron and must leak, which is
// what proves the scene is actually capable of detecting a leak.

/** Run a pulse down a `coreId` cable flanked by an Iron row and a Water row, and
 *  report how far the pulse got along the core and whether either flanking row
 *  ever carried a Spark. */
function leakScene(coreId: number, len = 60): { coreReach: number; leaked: boolean } {
  const grid = new Grid(len, 5);
  const sim = new Simulation(grid);
  for (let x = 0; x < len; x++) {
    grid.set(x, 0, WALL.id);
    grid.set(x, 1, IRON.id); // bare metal clipped along the top of the run
    grid.set(x, 2, coreId); // the cable under test
    grid.set(x, 3, WATER.id); // a puddle the run passes through
    grid.set(x, 4, WALL.id);
  }
  for (let y = 1; y <= 3; y++) {
    grid.set(0, y, WALL.id); // cap both ends so nothing drains out sideways
    grid.set(len - 1, y, WALL.id);
  }
  grid.set(1, 2, SPARK.id);
  grid.setAux(1, 2, packSpark(FULL_STRENGTH, conductorClass(coreId)));

  let coreReach = 1;
  let leaked = false;
  for (let t = 0; t < len + 20; t++) {
    sim.step();
    for (let x = 0; x < len; x++) {
      if (grid.get(x, 2) === SPARK.id && x > coreReach) coreReach = x;
      if (grid.get(x, 1) === SPARK.id || grid.get(x, 3) === SPARK.id) leaked = true;
    }
  }
  return { coreReach: coreReach - 1, leaked };
}

{
  const wire = leakScene(WIRE.id);
  const bare = leakScene(IRON.id);
  check(
    'a Wire pulse never crosses into the iron/water touching it',
    !wire.leaked,
    wire.leaked ? 'a flanking row carried a spark' : 'no leak in 60 cells of contact',
  );
  check(
    'the same scene DOES leak for a bare conductor (the check can fail)',
    bare.leaked,
    `${bare.leaked}`,
  );
  check(
    'a Wire still carries the pulse the whole run (zero loss)',
    wire.coreReach > 50,
    `${wire.coreReach} cells`,
  );

  // …and the pulse still gets *out* where it's supposed to: into the machine at
  // the end of the cable. A device is a one-way sink (it consumes the pulse rather
  // than relaying it), which is exactly why the jacket doesn't have to stop it.
  const len = 40;
  const grid = new Grid(len + 8, 6);
  const sim = new Simulation(grid);
  for (let x = 2; x < 2 + len; x++) grid.set(x, 2, WIRE.id);
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 4; dx++) grid.set(2 + len + dx, 1 + dy, FAN.id);
  }
  grid.set(2, 2, SPARK.id);
  grid.setAux(2, 2, packSpark(FULL_STRENGTH, conductorClass(WIRE.id)));
  for (let t = 0; t < len + 10; t++) sim.step();
  let fanCells = 0;
  let powered = 0;
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 4; dx++) {
      fanCells++;
      if (grid.getAux(2 + len + dx, 1 + dy) >> 2 > 0) powered++;
    }
  }
  check(
    'a Wire run still powers the device at its far end',
    powered === fanCells,
    `${powered}/${fanCells} fan cells`,
  );
}

// --- 6. Solar Panel: light in, electricity out, no heat ------------------------
// The panel's contract has two halves, and both are easy to break silently: a
// Heat Ray striking it must (a) leave it COLD — the beam is converted, not
// absorbed as heat, so the `lightPulse` branch has to run before heatray.ts's
// ordinary impact heating — and (b) push a pulse into the conductor touching it.
// The control fires the same beam at a Stone wall, which must cook, proving the
// beam really is arriving.

/** Fire one Heat Ray rightward down a corridor into a wall of `targetId` at x=20,
 *  with an Iron lead bolted to the wall's back face. Returns the wall's peak
 *  temperature and whether the lead ever carried a Spark. */
function beamScene(targetId: number): { maxTemp: number; sparked: boolean } {
  const grid = new Grid(30, 9);
  const sim = new Simulation(grid);
  for (let y = 1; y < 8; y++) {
    grid.set(20, y, targetId);
    grid.set(21, y, IRON.id);
  }
  emitHeatRay(sim.context, 3, 4, 1, 0);
  let maxTemp = -Infinity;
  let sparked = false;
  for (let t = 0; t < 20; t++) {
    sim.step();
    for (let y = 1; y < 8; y++) {
      if (grid.get(20, y) === targetId) maxTemp = Math.max(maxTemp, grid.getTemp(20, y));
      if (grid.get(21, y) === SPARK.id) sparked = true;
    }
  }
  return { maxTemp, sparked };
}

{
  const panel = beamScene(SOLAR_PANEL.id);
  const stone = beamScene(STONE.id);
  check(
    'a Heat Ray on a Solar Panel emits a Spark into the conductor behind it',
    panel.sparked,
    `${panel.sparked}`,
  );
  check(
    'a Heat Ray does NOT heat the Solar Panel it strikes',
    panel.maxTemp < AMBIENT_TEMP + 10,
    `peak ${panel.maxTemp.toFixed(1)}° (ambient ${AMBIENT_TEMP}°)`,
  );
  check(
    'the same beam DOES cook an ordinary wall (the check can fail)',
    stone.maxTemp > AMBIENT_TEMP + 50,
    `peak ${stone.maxTemp.toFixed(1)}°`,
  );
  check(
    'and an ordinary wall emits no Spark (the panel is doing the work)',
    !stone.sparked,
    `${stone.sparked}`,
  );
}

// --- 7. Solar Panel: one-way body conduction ----------------------------------
// A panel array is its own busbar, and the direction matters:
//   • 내부 → 내부 / 내부 → 외부 — light landing anywhere conducts through the whole
//     connected slab in that tick, so a lead clipped to the *far* end fires. This
//     is easy to lose silently: drop the flood back to "pulse my own eight
//     neighbours" and a panel still works when you aim at the lead, which is
//     exactly where anyone testing by hand would aim.
//   • 외부 → 내부 — a panel is not a conductor and not an appliance, so current on
//     a wire touching one must NOT cross it. Tagging the panel `conductive` (or
//     giving it a `directPulse`) to "make wiring easier" would turn every array
//     into free cable and break this.
// Both scenes are a long bar with an Iron lead at each end, so the two directions
// are the same geometry driven from opposite sides, and both have a control that
// must come out the other way.

/** Lay a horizontal bar of `barId` along y=4 from x=10 to x=40 with an Iron lead
 *  at each end, cut by a 1-cell `gapId` plug at x=25 when `gap` is set. */
function panelBar(barId: number, gap: boolean, gapId = STONE.id): { grid: Grid; sim: Simulation } {
  const grid = new Grid(46, 9);
  const sim = new Simulation(grid);
  for (let x = 10; x <= 40; x++) grid.set(x, 4, barId);
  if (gap) grid.set(25, 4, gapId);
  grid.set(9, 4, IRON.id); // near lead (the light/pulse end)
  grid.set(41, 4, IRON.id); // far lead, 31 cells away
  return { grid, sim };
}

/** Fire a Heat Ray straight down onto the bar's left end and report whether the
 *  FAR lead ever carried a Spark — i.e. whether the array conducted internally end
 *  to end. Aimed from above rather than along the row so the near lead isn't in
 *  the beam's way: the point of the check is that the light lands *nowhere near*
 *  the lead that fires. */
function farLeadLit(barId: number, gap: boolean): boolean {
  const { grid, sim } = panelBar(barId, gap);
  emitHeatRay(sim.context, 12, 0, 0, 1);
  let lit = false;
  for (let t = 0; t < 30; t++) {
    sim.step();
    if (grid.get(41, 4) === SPARK.id) lit = true;
  }
  return lit;
}

/** Put a live pulse on the NEAR lead and report whether it ever reached the far
 *  one — i.e. whether current got *into* and across the bar. */
function farLeadReached(barId: number): boolean {
  const { grid, sim } = panelBar(barId, false);
  grid.set(9, 4, SPARK.id);
  grid.setAux(9, 4, packSpark(FULL_STRENGTH, conductorClass(IRON.id)));
  let reached = false;
  for (let t = 0; t < 60; t++) {
    sim.step();
    if (grid.get(41, 4) === SPARK.id) reached = true;
  }
  return reached;
}

{
  check(
    'light on one end of a Solar Panel array powers a lead at the other end',
    farLeadLit(SOLAR_PANEL.id, false),
    '29 cells from the lit cell',
  );
  check(
    'a panel array cut in two does NOT carry it across the break (the check can fail)',
    !farLeadLit(SOLAR_PANEL.id, true),
    'severed at x=25',
  );
  check(
    'current on a wire touching a panel never crosses it (외부 → 내부 차단)',
    !farLeadReached(SOLAR_PANEL.id),
    'panel bar between two iron leads',
  );
  check(
    'the same run DOES cross a bar of real conductor (the check can fail)',
    farLeadReached(IRON.id),
    'iron bar between two iron leads',
  );
}

// --- 8. Device floods survive a sandbox resize --------------------------------
// `BodyFlood` (engine/deviceBody.ts) memoizes "this body already flooded this
// tick" in a grid-sized stamp buffer rather than a Set. That buffer has to be
// reallocated when the sandbox is resized in place — Game.ts does exactly that on
// a window/layout change — or the flood indexes a buffer sized for the old grid
// and its dedupe silently stops working past the end of it.
//
// The body is therefore anchored to the grid's TOP-RIGHT corner, not the origin:
// a cell's flat index is y*width + x, so a body in the bottom-left keeps small
// indices that stay inside even a stale buffer, and the check passes whether or
// not the reallocation happens. Measured with the reallocation deliberately
// disabled: a bottom-left body reports a clean 100/100 (the check is useless),
// while this top-right one does not.
//
// The steps are wrapped because the regression's failure mode is a *throw*, not a
// wrong number: a write past the end of a stale Int32Array is a silent no-op in
// JS, so a cell whose flat index falls beyond the old buffer can never be marked,
// gets re-pushed onto the walk stack forever, and `Array.push` eventually throws
// `RangeError: Invalid array length` from deep inside the battery's update. Left
// bare that aborts the whole harness process, which reads like a broken test
// rather than a caught regression; caught, it prints a normal FAIL line.

{
  const grid = new Grid(40, 30);
  const sim = new Simulation(grid);
  // 10×10 fan block in the top-right corner, battery terminal against its left face
  const bx = (): number => grid.width - 15;
  const by = (): number => grid.height - 15;
  const powered = (): number => {
    let n = 0;
    for (let x = bx(); x < bx() + 10; x++) {
      for (let y = by(); y < by() + 10; y++) {
        if (grid.get(x, y) === FAN.id && grid.getAux(x, y) >> 2 > 0) n++;
      }
    }
    return n;
  };
  const runAt = (w: number, h: number): number => {
    if (w !== grid.width || h !== grid.height) grid.resize(w, h);
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) grid.set(x, y, 0);
    for (let x = bx(); x < bx() + 10; x++) {
      for (let y = by(); y < by() + 10; y++) grid.set(x, y, FAN.id);
    }
    grid.set(bx() - 1, by(), BATTERY.id);
    for (let t = 0; t < 30; t++) sim.step();
    return powered();
  };

  /** Run one size, reporting a throw as -1 rather than letting it escape. */
  const tryRunAt = (w: number, h: number): number => {
    try {
      return runAt(w, h);
    } catch (e) {
      console.log(`      (threw: ${e instanceof Error ? e.message : String(e)})`);
      return -1;
    }
  };

  const before = tryRunAt(40, 30);
  const grown = tryRunAt(60, 45);
  const shrunk = tryRunAt(24, 20);
  check(
    'a device body still floods after the sandbox grows',
    before === 100 && grown === 100,
    `${before}/100 before, ${grown}/100 after`,
  );
  check(
    'and after it shrinks',
    shrunk === 100,
    `${shrunk}/100 fan cells`,
  );
}

// --- 9. Turbine: wired output only (전선처럼) ----------------------------------
// A turbine stands in wet machinery by design — steam through the blades,
// condensate draining back down through its pores — so a *bare* terminal was the
// wrong model for it: every beat energized the boiler water touching it, spread a
// pulse through the whole pool, electrolysed it into gas and bled the generated
// strength into a puddle instead of down the cable. Its faces now emit only into
// wiring (the `'wiring'` PulseGate in spark.ts): Wire and the metals yes,
// water/brine/acid/Slime/Acid Slime no — Acid Slime carries a pulse at zero loss
// and is still goo, which is why the gate reads a declared `Material.wiring` tag
// rather than the loss table. What must NOT change is the other branch —
// appliances and charges bolted straight onto a face still fire (도체 없이 직접
// 연결), because those consume a pulse instead of spreading it, exactly like the
// far end of a Wire run.
//
// Every check runs the same scene with a Battery swapped in for the Turbine as
// the control: a bare battery terminal still soaks its surroundings, which proves
// both that the scene really does deliver current and that this is a property of
// the turbine's output rather than something that quietly leaked into the shared
// `pulseCell` for every source.

/** Sealed one-cell channel: two source cells at the left end, then the rest of
 *  the row filled with `mediumId`. Returns whether any medium cell ever carried a
 *  Spark. The channel is capped at both ends and completely full so the liquid
 *  media stay in line instead of draining away (the same trick `reach` uses), and
 *  a Turbine source gets Steam re-stamped into its 겹침 slot every tick — steam
 *  in the body is what gates generation, and re-stamping is what keeps a puff in
 *  the blades for the whole run (it blows on or condenses otherwise). Stamped
 *  before the step, since a cell's own update runs ahead of its 겹침 passenger's.
 *
 *  Deliberately at ambient temperature: an earlier version of this scene held the
 *  turbine at 300° to stop the steam condensing, and quietly boiled the media it
 *  was supposed to be testing — a "does not electrify the water" pass that only
 *  meant the water had already flashed to vapor. */
function sourceFeeds(sourceId: number, mediumId: number): boolean {
  const grid = new Grid(16, 3);
  const sim = new Simulation(grid);
  for (let x = 0; x < grid.width; x++) {
    grid.set(x, 0, WALL.id);
    grid.set(x, 2, WALL.id);
  }
  grid.set(0, 1, WALL.id);
  grid.set(grid.width - 1, 1, WALL.id);
  grid.set(1, 1, sourceId);
  grid.set(2, 1, sourceId);
  for (let x = 3; x < grid.width - 1; x++) grid.set(x, 1, mediumId);

  let sparked = false;
  for (let t = 0; t < PULSE_PERIOD * 6; t++) {
    if (sourceId === TURBINE.id) {
      for (const sx of [1, 2]) grid.setOverlay(sx, 1, STEAM.id);
    }
    sim.step();
    for (let x = 3; x < grid.width - 1; x++) {
      if (grid.get(x, 1) === SPARK.id) sparked = true;
    }
  }
  return sparked;
}

{
  // Wiring — the turbine's output has to reach all of it, or a steam plant simply
  // doesn't work.
  for (const wiring of [WIRE, IRON, NICHROME]) {
    check(
      `a Turbine feeds ${wiring.name} bolted to its face (배선재)`,
      sourceFeeds(TURBINE.id, wiring.id),
      'wired output',
    );
  }
  // Non-wiring conductors — skipped outright, and the battery control proves the
  // scene works. Acid Slime is in this list on purpose: it is a *zero-loss*
  // conductor, so it would pass a "lossless" gate, and only the declared tag keeps
  // a generator from pushing power into a puddle of goo.
  for (const wet of [WATER, SALTWATER, ACID, SLIME, ACID_SLIME]) {
    check(
      `a Turbine does NOT electrify the ${wet.name} it stands in`,
      !sourceFeeds(TURBINE.id, wet.id),
      '13 cells of contact',
    );
    check(
      `  …while a bare Battery terminal still does (the check can fail)`,
      sourceFeeds(BATTERY.id, wet.id),
      `${wet.name}`,
    );
  }
}

{
  // …and the non-conductor branch is untouched: a Fan clipped straight onto a
  // turbine face still runs with no wire between them. This is the half most at
  // risk from a gate on emission — narrow it by material instead of by conductor
  // loss and 직결 가전 stops working.
  const grid = new Grid(14, 8);
  const sim = new Simulation(grid);
  for (let y = 2; y < 6; y++) grid.set(3, y, TURBINE.id);
  for (let y = 2; y < 6; y++) {
    for (let x = 4; x < 8; x++) grid.set(x, y, FAN.id);
  }
  for (let t = 0; t < PULSE_PERIOD * 4; t++) {
    for (let y = 2; y < 6; y++) grid.setOverlay(3, y, STEAM.id);
    sim.step();
  }
  let fanCells = 0;
  let powered = 0;
  for (let y = 2; y < 6; y++) {
    for (let x = 4; x < 8; x++) {
      fanCells++;
      if (grid.getAux(x, y) >> 2 > 0) powered++;
    }
  }
  check(
    'a Fan bolted straight onto a Turbine face still runs (도체 없이 직접 연결)',
    powered === fanCells,
    `${powered}/${fanCells} fan cells`,
  );
}

// --- 10. Solar Panel: battery cadence + active/inactive -----------------------
// The panel used to emit *inside* its light hook, so a lit array fired every single
// tick — the wire's own 3-tick refractory was the only limit, which made a panel
// drive everything downstream several times harder than a Battery or a Turbine
// (지나치게 빠름). Light now only makes the array **active** (a countdown, exactly
// like the Fan/Laser/Pump/Electromagnet's POWERED_TICKS) and an active array beats
// on the shared PULSE_PERIOD, so all three sources are indistinguishable
// downstream. Two things to pin, both of which a plausible refactor breaks quietly:
//   • the beat RATE equals a battery's — measured against a real Battery in the
//     same geometry, not against the constant, so re-phasing bugs that shave a tick
//     off every beat (or a body that fires once per cell) show up as a mismatch;
//   • the panel goes INACTIVE when the light stops, and then does nothing at all.

/** Count the ticks on which the Iron lead beside a source column carries a Spark.
 *  The source is a 4-cell column at x=10; the lead is the column at x=11. When
 *  `lit` is set a Heat Ray is emitted at the source from the left on every tick —
 *  what a powered Laser actually does — for the first `litTicks` ticks only, so the
 *  same helper measures both "in full sun" and "the beam stopped". Returns the beat
 *  count in the first window and in the tail after the light stops. */
function sourceBeats(
  sourceId: number,
  lit: boolean,
  ticks = 240,
  litTicks = ticks,
): { beats: number; tailBeats: number } {
  const grid = new Grid(24, 9);
  const sim = new Simulation(grid);
  for (let y = 3; y <= 6; y++) {
    grid.set(10, y, sourceId);
    grid.set(11, y, IRON.id);
  }
  let beats = 0;
  let tailBeats = 0;
  for (let t = 0; t < ticks; t++) {
    if (lit && t < litTicks) emitHeatRay(sim.context, 3, 4, 1, 0);
    sim.step();
    let sparked = false;
    for (let y = 3; y <= 6; y++) if (grid.get(11, y) === SPARK.id) sparked = true;
    if (!sparked) continue;
    beats++;
    // The tail starts one full active-countdown *and* one beat interval after the
    // light stops — everything after that must be silence.
    if (t >= litTicks + 24 + PULSE_PERIOD) tailBeats++;
  }
  return { beats, tailBeats };
}

{
  const panel = sourceBeats(SOLAR_PANEL.id, true);
  const battery = sourceBeats(BATTERY.id, false);
  const dark = sourceBeats(SOLAR_PANEL.id, false);
  check(
    'a lit Solar Panel beats at the Battery cadence, not once per tick',
    Math.abs(panel.beats - battery.beats) <= 1,
    `panel ${panel.beats} beats vs battery ${battery.beats} over 240 ticks (PULSE_PERIOD ${PULSE_PERIOD})`,
  );
  check(
    '…which is far below the one-per-tick it used to run at (the check can fail)',
    panel.beats > 0 && panel.beats < 240 / 4,
    `${panel.beats}/240 ticks carried a pulse`,
  );
  check(
    'an unlit Solar Panel is inert — no light, no pulse, ever',
    dark.beats === 0,
    `${dark.beats} beats in 240 dark ticks`,
  );

  // Drop the beam a third of the way in: the panel keeps beating through its active
  // countdown and then goes quiet for good.
  const cut = sourceBeats(SOLAR_PANEL.id, true, 240, 80);
  check(
    'a Solar Panel goes inactive once the beam stops (and stays silent)',
    cut.tailBeats === 0 && cut.beats > 0,
    `${cut.beats} beats total, ${cut.tailBeats} after the countdown ran out`,
  );
}

// --- 11. Turbine: the Lithium Battery's frequency ----------------------------
// The turbine used to advance its beat counter only on the ticks a cell *itself*
// had steam in it, which is not a cadence but a duty cycle: real steam is patchy,
// so a turbine in a working boiler beat about four times slower than the Lithium
// Battery it is documented to be indistinguishable from (배터리와 다른 주파수).
// Steam now makes the block *active* (an ACTIVE countdown, like the panel's) and
// an active block beats on the shared PULSE_PERIOD. What that has to buy:
//   • steady steam → beat-for-beat the Lithium Battery's rate, tick-aligned;
//   • GUSTING steam → still the battery's rate. This is the regression itself: a
//     duty cycle sags here and a cadence doesn't, and it's the only check the old
//     code actually failed, so a "simplification" back to counting steam-ticks
//     fails on this line and not on the steady one;
//   • no steam at all → nothing, ever. The countdown is a coast-down, not a
//     trickle source;
//   • the Lithium and LFP batteries agree with each other, so "the battery rate"
//     is one number rather than whichever chemistry the check happened to pick.

/** A source column sealed in Wall with one Iron lead, and the tick numbers on
 *  which that lead carried a Spark.
 *
 *  Sealed, and much more tightly than `sourceFeeds` is: the turbine is porous, so
 *  steam stamped into its 겹침 slot escapes into any open neighbour, condenses
 *  wherever it lands, and leaves puddles that carry the lead's own sparks back
 *  around the outside of the scene on ticks the source never fired. Boxing the
 *  column in (Wall on three sides of the source, Wall around the lead) keeps the
 *  steam in the blades and the sparks on the lead, so a counted tick is a beat.
 *
 *  `steamOn`/`steamPeriod` stamp the steam on a duty cycle: `steamOn` ticks of
 *  every `steamPeriod`. Steady steam is the default; a gap is what a real plume
 *  looks like. `steamTicks` caps how long the steam is supplied at all, so the
 *  same helper measures the silence after it's cut off.
 *
 *  The off ticks *clear* the 겹침 slot rather than just not stamping it. The same
 *  seal that keeps the scene honest also means steam blown into the blades has
 *  nowhere to leave from, so a gap that is merely un-stamped isn't a gap at all —
 *  the turbine stays steamed for the rest of the run and both the gusting check
 *  and the steam-cut check quietly measure steady steam instead. */
function beatTicks(
  sourceId: number,
  ticks: number,
  { steamOn = 1, steamPeriod = 1, steamTicks = ticks } = {},
): number[] {
  const h = 4;
  const y0 = 3;
  const grid = new Grid(16, 9);
  const sim = new Simulation(grid);
  for (let y = y0 - 1; y <= y0 + h; y++) {
    grid.set(9, y, WALL.id); // behind the source
    grid.set(12, y, WALL.id); // beyond the lead
  }
  for (let x = 9; x <= 12; x++) {
    grid.set(x, y0 - 1, WALL.id); // cap above
    grid.set(x, y0 + h, WALL.id); // cap below
  }
  for (let y = y0; y < y0 + h; y++) {
    grid.set(10, y, sourceId);
    grid.set(11, y, IRON.id);
  }

  const at: number[] = [];
  for (let t = 0; t < ticks; t++) {
    if (sourceId === TURBINE.id) {
      // Stamped before the step, since a cell's own update runs ahead of its 겹침
      // passenger's — the same order sourceFeeds uses.
      const on = t < steamTicks && t % steamPeriod < steamOn;
      for (let y = y0; y < y0 + h; y++) grid.setOverlay(10, y, on ? STEAM.id : 0);
    }
    sim.step();
    for (let y = y0; y < y0 + h; y++) {
      if (grid.get(11, y) === SPARK.id) {
        at.push(t);
        break;
      }
    }
  }
  return at;
}

{
  const TICKS = 240;
  const lithium = beatTicks(BATTERY.id, TICKS);
  const lfp = beatTicks(LFP_BATTERY.id, TICKS);
  const steady = beatTicks(TURBINE.id, TICKS);

  check(
    'the two battery chemistries beat identically (the reference rate is one number)',
    lithium.length > 0 && lithium.join(',') === lfp.join(','),
    `${lithium.length} vs ${lfp.length} beats over ${TICKS} ticks`,
  );
  check(
    'a steamed Turbine beats at the Lithium Battery frequency, tick for tick',
    steady.join(',') === lithium.join(','),
    `turbine ${steady.length} beats vs battery ${lithium.length} (PULSE_PERIOD ${PULSE_PERIOD})`,
  );
  // Rate, stated as an interval, so a re-phasing bug that shaves a tick off every
  // beat is legible in the failure message rather than just "a mismatch".
  const gaps = steady.slice(1).map((v, i) => v - steady[i]);
  check(
    '…and that frequency is one beat per PULSE_PERIOD ticks',
    gaps.length > 0 && gaps.every((g) => g === PULSE_PERIOD),
    `gaps ${[...new Set(gaps)].join(',')}`,
  );

  // The regression. One tick of steam in every four: a wheel already spinning
  // coasts through the gaps, so the beat holds. Counting steam-ticks instead
  // stretched every beat by the inverse duty cycle (~4× here) — which is exactly
  // what a working boiler, whose plume is at least this ragged, used to do.
  const gusty = beatTicks(TURBINE.id, TICKS, { steamOn: 1, steamPeriod: 4 });
  check(
    'a Turbine in GUSTING steam still beats at the battery frequency (박자, 듀티 사이클 아님)',
    gusty.length === lithium.length,
    `gusty ${gusty.length} beats vs battery ${lithium.length} over ${TICKS} ticks`,
  );
  // The control that makes the check above mean something: the gap the turbine
  // rides over is genuinely longer than a beat, so a duty-cycled counter really
  // would have fallen behind rather than the scene being steam-fed by accident.
  check(
    '  …and it is riding real gaps — steam is absent on most ticks (the check can fail)',
    gusty.length > 0 && 3 * TICKS / 4 > PULSE_PERIOD,
    'steam on 1 tick in 4',
  );

  // **A stop preserves the phase, and that can never run the turbine fast.** An
  // inactive cell returns before touching either field, so the beat is frozen where
  // it stood rather than zeroed, and a block re-steamed after a full stop can fire on
  // the tick the steam returns. That looks alarming and is the correct half of a
  // trade: only *active* ticks advance the beat, so consecutive beats stay exactly
  // PULSE_PERIOD active ticks apart and dormancy only inserts extra wall-clock. The
  // other half is why zeroing it would be a bug — it would discard up to
  // PULSE_PERIOD-1 ticks of already-served wait on every restart, so a weak boiler
  // puffing on and off pays a fresh full interval each time. That is the duty cycle
  // this material was rewritten to stop having, in miniature.
  //
  // Swept over duty cycles whose OFF stretch is longer than POWERED_TICKS (24), which
  // is the only way to reach a full stop, at several phases each, since which beat
  // value the block freezes on is what varies.
  let tightest = Infinity;
  let tightestAt = '';
  let sawStopAndStart = false;
  for (const on of [1, 3, 7, 20]) {
    for (const off of [25, 41, 97]) {
      const b = beatTicks(TURBINE.id, 600, { steamOn: on, steamPeriod: on + off });
      if (b.length > 1) sawStopAndStart = true;
      for (let i = 1; i < b.length; i++) {
        if (b[i] - b[i - 1] < tightest) {
          tightest = b[i] - b[i - 1];
          tightestAt = `on=${on} off=${off}`;
        }
      }
    }
  }
  check(
    'a Turbine re-steamed after a full stop never beats faster than the battery',
    sawStopAndStart && tightest >= PULSE_PERIOD,
    `tightest interval ${tightest} (${tightestAt}), PULSE_PERIOD ${PULSE_PERIOD}`,
  );
  check(
    '  …and it is exactly PULSE_PERIOD, so the frozen phase is carried, not discarded',
    tightest === PULSE_PERIOD,
    `zeroing the beat on going inactive would push this above ${PULSE_PERIOD}`,
  );

  // **Joining two running blocks resynchronizes them — once.** The invariant above is
  // scoped to a block whose connected shape hasn't changed, and this is the case that
  // needs the scope: build two boilers at different times, then paint a bridge between
  // them, and from that tick they are one machine. The next beat of whichever
  // sub-block is furthest along floods all of it, so a terminal on the lagging side
  // sees one beat sooner than PULSE_PERIOD after its own previous one. What has to
  // hold is that this is a lock-in, not a rate: **one such interval per join**, and
  // once the joining stops, PULSE_PERIOD forever after.
  //
  // Per *join*, emphatically not per run. Two joins close together cost two early
  // beats — build three boiler islands and wire in the third a couple of ticks after
  // the second, and the probe block shows two sub-period intervals back to back. That
  // is why the second scene below exists: an earlier version of this claim said "at
  // most one, always", which the single-join sweep happily confirmed while the chained
  // case quietly broke it.
  //
  // Beats are read off the beat counter itself rather than off sparks on a lead. A
  // body beat can leave part of a lead still refractory from that lead's own previous
  // beat, so the one injected Spark walks the rest of the lead over the next ticks —
  // counting spark-presence scores that single beat as three and the lock-in as a
  // burst, which is exactly how the first measurement of this was misread. The
  // counter reads 0 only on the tick its body fired, *given the block is running*: a
  // cell that has never fired also reads 0, which the spin-up skip below excludes, and
  // so does one frozen mid-dormancy on a beat tick — so don't reuse this detector on a
  // scene that cuts the steam.
  /** Sealed row of `islands` turbine blocks, joined by bridges at the given ticks.
   *  Every cell that isn't a turbine is Wall, so the porous blocks' 겹침 steam can't
   *  escape and condense into stray conductor. Each island is steamed from its own
   *  `skews[i]` so they run out of phase. Returns each island's beat ticks. */
  const islandBeats = (
    skews: number[],
    bridgeAts: number[],
    ticks = 260,
  ): number[][] => {
    const n = skews.length;
    const grid = new Grid(4 * n + 1, 11);
    const sim = new Simulation(grid);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) grid.set(x, y, WALL.id);
    }
    const islandX = skews.map((_, i) => 4 * i + 3);
    for (const x of islandX) for (let y = 4; y < 7; y++) grid.set(x, y, TURBINE.id);
    /** The three cells bridging island i to island i+1. */
    const bridgeX = (i: number): number[] => [islandX[i] + 1, islandX[i] + 2, islandX[i] + 3];
    const beats: number[][] = skews.map(() => []);
    for (let t = 0; t < ticks; t++) {
      for (let i = 0; i < n; i++) {
        if (t >= skews[i]) for (let y = 4; y < 7; y++) grid.setOverlay(islandX[i], y, STEAM.id);
      }
      for (let i = 0; i < bridgeAts.length; i++) {
        if (t === bridgeAts[i]) for (const x of bridgeX(i)) grid.set(x, 5, TURBINE.id);
        if (t >= bridgeAts[i]) for (const x of bridgeX(i)) grid.setOverlay(x, 5, STEAM.id);
      }
      sim.step();
      // Skip the spin-up window: a cell that has never run also reads beat 0.
      if (t < Math.max(...skews) + PULSE_PERIOD) continue;
      for (let i = 0; i < n; i++) {
        if (grid.getAux(islandX[i], 5) >> 8 === 0) beats[i].push(t);
      }
    }
    return beats;
  };
  const gapsOf = (beat: number[]): number[] => beat.slice(1).map((v, i) => v - beat[i]);
  const shortGaps = (beat: number[]): number[] =>
    gapsOf(beat).filter((g) => g < PULSE_PERIOD);

  // Never bridged: two independent machines, each rigidly on its own PULSE_PERIOD.
  // This is the control — it proves the detector doesn't manufacture short intervals
  // on its own, so the counts below come from the join and nothing else.
  const apart = islandBeats([0, 5], []);
  check(
    'two separate Turbine blocks each hold PULSE_PERIOD exactly (the control)',
    apart.every((b) => b.length > 1 && shortGaps(b).length === 0),
    `${apart.map((b) => b.length).join('/')} beats, 0 sub-period intervals`,
  );

  // One join, swept across every skew and three full cycles of join times.
  const JOIN_TIMES = 3 * PULSE_PERIOD;
  let mostShort = 0;
  let settled = true;
  for (let skew = 0; skew < PULSE_PERIOD; skew++) {
    for (let bridgeAt = 60; bridgeAt < 60 + JOIN_TIMES; bridgeAt++) {
      for (const beat of islandBeats([0, skew], [bridgeAt], 200)) {
        const gaps = gapsOf(beat);
        const short = gaps.filter((g) => g < PULSE_PERIOD);
        if (short.length > mostShort) mostShort = short.length;
        // Everything after the last short interval must be a clean PULSE_PERIOD.
        // `lastIndexOf` on that gap's *value* lands on the last short gap: any later
        // index holding the same value would itself be short, and so would be the one
        // `pop()` returned. With no short gaps at all it yields -1 and the whole run
        // is checked, which is what the control wants.
        const last = gaps.lastIndexOf(short.pop() ?? -1);
        if (gaps.slice(last + 1).some((g) => g !== PULSE_PERIOD)) settled = false;
      }
    }
  }
  check(
    'joining two out-of-phase Turbine blocks costs one early beat, not a rate',
    mostShort <= 1,
    `worst block saw ${mostShort} sub-period intervals over ${PULSE_PERIOD} skews × ${JOIN_TIMES} join times`,
  );
  check(
    '  …and the merged block is locked to PULSE_PERIOD from the next beat on',
    settled,
    'every interval after the lock-in equals PULSE_PERIOD',
  );

  // Two joins in quick succession — the case that kills "at most one, always". The
  // cost is one early beat *per* connectivity change, so this must show up to two,
  // and must still settle. The `>= 2` half is the real pin: it proves the sweep above
  // is measuring a per-join cost rather than a global cap that would mask this.
  let chainedMost = 0;
  let chainedSettled = true;
  for (let skewB = 0; skewB < PULSE_PERIOD; skewB++) {
    for (let d = 1; d <= PULSE_PERIOD; d++) {
      for (const beat of islandBeats([0, skewB, skewB], [70, 70 + d])) {
        const gaps = gapsOf(beat);
        const short = gaps.filter((g) => g < PULSE_PERIOD);
        if (short.length > chainedMost) chainedMost = short.length;
        const last = gaps.lastIndexOf(short.pop() ?? -1);
        if (gaps.slice(last + 1).some((g) => g !== PULSE_PERIOD)) chainedSettled = false;
      }
    }
  }
  check(
    'chaining a second join costs a second early beat — one per join, no more',
    chainedMost === 2,
    `worst block saw ${chainedMost} sub-period intervals across two staggered joins`,
  );
  check(
    '  …and a chained merge still settles to PULSE_PERIOD once the joining stops',
    chainedSettled,
    'every interval after the last lock-in equals PULSE_PERIOD',
  );

  // No steam at all: inert, not a slow source. And cut the steam a third of the
  // way in — the turbine coasts through its countdown and then falls silent.
  const dry = beatTicks(TURBINE.id, TICKS, { steamTicks: 0 });
  const cut = beatTicks(TURBINE.id, TICKS, { steamTicks: 80 });
  check(
    'a Turbine with no steam is inert — no steam, no pulse, ever',
    dry.length === 0,
    `${dry.length} beats in ${TICKS} dry ticks`,
  );
  check(
    'a Turbine goes inactive once the steam stops (and stays silent)',
    cut.length > 0 && cut.every((t) => t < 80 + 24 + PULSE_PERIOD),
    `${cut.length} beats, last at ${cut[cut.length - 1]} (steam cut at 80)`,
  );
}

console.log(
  failed === 0 ? '\nOK — electricity packing intact.' : `\n${failed} check(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
