import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { floodDeviceBody } from '../engine/deviceBody';
import type { SimContext } from '../engine/SimContext';

// Electromagnet (전자석) — an electric appliance that PULLS. Every force in the
// sandbox so far pushes: explosions, the Woofer's thump, the Fan's gust, the
// Conveyor. Nothing gathers. The magnet is the missing sign, and it doesn't just
// pull — it pulls *selectively*: where wind shoves anything loose, the field only
// takes ferromagnetic matter (`Material.magnetic` — Metal Powder, Rust Powder,
// Iron Ore, Nanobot). That selectivity is the whole toy. Hang one over a mixed
// heap and it lifts the iron filings out of the sand and slag, fishes metal back
// out of a tank of water, and plucks crawling Nanobots off the floor and holds
// them — a 자력 선별기 you build rather than a button you press.
//
// ## The field
//
// The pull is a breadth-first sweep out of the magnet body's own outline (the
// same geodesic-distance idea the Woofer's shockwave uses, see woofer.ts), not a
// radius from a point. Two consequences fall out of that and both are wanted:
//
//   • **Solids block it.** The sweep only spreads through matter it could pull
//     something *through* — air, gas, liquid, powder, crawlers — so a structural
//     solid casts a shadow. Sink a magnet behind an iron plate and it reaches
//     nothing; box it in and it's inert. (Real ferromagnetic shielding does about
//     the same thing, which is a pleasant coincidence rather than the reason.)
//   • **Shape matters.** A long magnet bar pulls along its whole length, because
//     the field grows from every body cell at once instead of from a centre.
//     The outer boundary is the body's bounding box grown by REACH, so a wide
//     magnet has a wide field rather than a circular one that misses its own ends.
//
// Each swept cell remembers the neighbor it was reached *from*, so pulling is just
// "step one cell back along the path to the magnet" — which is what makes the pull
// follow the field around a corner instead of dragging a grain into the wall it's
// behind. Cells are pulled nearest-first so the grain in front vacates before the
// grain behind it steps up, and a whole column creeps in rather than jamming.
//
// ## Holding
//
// A grain that *can't* step closer — it's already against the magnet, or the cell
// ahead is occupied by another grain that's also clinging — is marked moved for the
// tick instead. That's what makes a magnet hold a clump against gravity rather than
// juggle it: without it, every grain would fall a cell and be re-pulled a cell,
// forever, and nothing would ever collect. The `moved` flag also gates the reaction
// pass (see Simulation.updateCell), so matter held on a live magnet doesn't react
// while it's held — iron filings stuck to an energized magnet won't rust until you
// cut the power. That's a real cost, accepted deliberately: "the magnet freezes
// what it grips" is a legible rule, and a jittering cloud that never clumps would
// have made the whole material pointless.
//
// ## Powering
//
// The Fan's one-way "outside → inside" electric sink, verbatim (see fan.ts, and
// the pattern write-up in woofer.ts): deliberately NOT `conductive` (a magnet wall
// would otherwise be a free wire, and spark.ts's conductor-class field has only a
// handful of slots left), just a `Material.directPulse` hook, so a Battery/LFP
// Battery/Turbine in contact or a Spark relayed down a wire all energize it
// through the one shared dispatch (`reactToPulse`) with no per-source special
// casing. A pulse floods the whole connected body (`floodDeviceBody` — 전기 세기에
// 관계없이 연결 부위 전역 즉시 활성화, see engine/deviceBody.ts) and refreshes a
// powered countdown generous enough to bridge the quiet ticks between a Battery's
// periodic pulses, so the field holds steadily instead of strobing its grip on and
// off.
//
// Unlike the Fan and Laser the magnet has no direction, so its whole `aux` byte is
// the countdown and the renderer draws brightening coil windings rather than a
// chevron (see Material.coilPattern).

/** Ticks a single power pulse keeps the field up. Set well above the Battery's
 *  PULSE_PERIOD (12) so the grip never lapses between pulses — a held clump would
 *  visibly drop and be re-caught otherwise. Matches the Fan/Laser/Pump; the whole
 *  aux byte is the countdown here, so there's no packing limit to respect. */
const POWERED_TICKS = 24;

/** How far the field reaches past the magnet body, in cells. Comparable to the
 *  Woofer's effective shove radius (~8) — far enough to sweep a heap poured under
 *  it, short enough that a magnet is a local tool you position rather than a
 *  world-wide vacuum. */
const REACH = 10;

/** Ceiling on how many cells one field sweep visits. A REACH-10 field around an
 *  ordinary magnet is a few hundred cells; the cap only bites for a long bar
 *  magnet in open air, where it trims the far end of the field rather than letting
 *  one tick's sweep grow with the body.
 *
 *  Note what this caps and what it doesn't: the *field* (an effect swept through
 *  open space every tick the countdown is live), never the magnet's activation.
 *  The body itself — which cells are powered, and which cells the field is grown
 *  out of — is always walked in full (see `floodDeviceBody`, engine/deviceBody.ts:
 *  전기 세기에 관계없이 연결 부위 전역 즉시 활성화). */
const MAX_FIELD = 1024;

// ── Sweep scratch ────────────────────────────────────────────────────────────
// Reused across sweeps to keep a per-tick pull from allocating three containers
// per magnet (the field runs EVERY tick the countdown is live, unlike the flood,
// which only runs on a pulse). Safe as module state precisely because it never
// outlives a single synchronous `pullField` call: it is cleared on entry and read
// only before returning, so two Simulations sharing this module can't leak state
// into each other the way a tick-keyed cache would (see SimContext.wooferFlood's
// note on exactly that hazard).
/** Swept cell → the flat index of the cell it was reached from (-1 = the magnet
 *  body itself, i.e. this cell is a clinging position). */
const visited = new Map<number, number>();
/** Swept cells in breadth-first (nearest-first) order, with their step depth. */
const sweptX: number[] = [];
const sweptY: number[] = [];
const sweptD: number[] = [];

/** True if the field spreads *through* this cell: air, or any matter loose enough
 *  that a grain could be dragged through it — gas, liquid, powder, and the
 *  `shockLoose` crawlers (a Termite is a Solid only because it walks instead of
 *  piling, so it shouldn't shield a magnet any more than it shields a shockwave).
 *  Structural solids stop the sweep and shadow whatever is behind them; a frozen
 *  liquid counts as one, since below its freeze point it acts solid everywhere
 *  else too (see SimContext.isFrozen). */
function isFieldPassable(sim: SimContext, x: number, y: number): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return true;
  const m = getMaterial(id);
  if (m.shockLoose) return true;
  const p = m.phase;
  if (p !== Phase.Powder && p !== Phase.Liquid && p !== Phase.Gas) return false;
  return !sim.isFrozen(x, y);
}

/** True if the cell holds ferromagnetic matter this field can actually move.
 *  `magnetic` alone isn't enough: a structural solid is never dragged, so tagging
 *  one (a future magnetized wall/rail) can't tear a player's build off its mounts
 *  — the same rule the Fan's gust follows for solids. Only loose phases and
 *  `shockLoose` crawlers are pulled. */
function isPullable(sim: SimContext, x: number, y: number): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (!m.magnetic) return false;
  return m.phase !== Phase.Solid || m.shockLoose === true;
}

/** True if a pulled grain can step into this cell, displacing whatever is there
 *  back into the grain's own spot. Empty air always takes it; so does gas, liquid
 *  and (non-magnetic) powder — that last one is what lets the field draw iron
 *  filings *up through* a heap of sand, which is the whole separator toy. Blocked
 *  by: another magnetic grain (it's clinging too — the column waits), a frozen
 *  liquid or any structural solid, and a `packedTemp` particle (Ember/Debris/
 *  Blast/Nuclear Ray/Heat Ray), whose `temp` holds flight state rather than heat
 *  and which must not be teleported out of its own arc. */
function acceptsPull(sim: SimContext, x: number, y: number): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return true;
  const m = getMaterial(id);
  if (m.magnetic || m.packedTemp) return false;
  const p = m.phase;
  if (p !== Phase.Powder && p !== Phase.Liquid && p !== Phase.Gas) return false;
  return !sim.isFrozen(x, y);
}

/**
 * Sweep the field around one connected magnet body and pull everything
 * ferromagnetic in it one cell closer (or hold it, if it can't get closer). See
 * the header for why it's a breadth-first sweep and not a radius.
 *
 * `bx`/`by` are the body's cells and `minX..maxY` its bounding box; the field's
 * outer boundary is that box grown by REACH (Euclidean distance to the box, so an
 * elongated magnet gets an elongated field with rounded ends rather than a circle
 * centred on nothing in particular).
 */
function pullField(
  sim: SimContext,
  bx: readonly number[],
  by: readonly number[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const w = sim.width;
  visited.clear();
  sweptX.length = 0;
  sweptY.length = 0;
  sweptD.length = 0;

  /** Euclidean distance from (x,y) to the body's bounding box, 0 inside it. */
  const outsideReach = (x: number, y: number): boolean => {
    const ox = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    const oy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
    return ox * ox + oy * oy > REACH * REACH;
  };

  /** Enqueue (x,y) at depth `d`, reached from flat index `from` (-1 = the body). */
  const enqueue = (x: number, y: number, d: number, from: number): void => {
    if (sweptX.length >= MAX_FIELD || !sim.inBounds(x, y)) return;
    const k = y * w + x;
    if (visited.has(k)) return;
    if (outsideReach(x, y) || !isFieldPassable(sim, x, y)) return;
    visited.set(k, from);
    sweptX.push(x);
    sweptY.push(y);
    sweptD.push(d);
  };

  // Seed: every cell touching the body (8-connected, so a grain sitting on a
  // corner clings too) is at depth 1 and its "path back" is the magnet itself.
  for (let i = 0; i < bx.length; i++) {
    for (const [dx, dy] of DIR8) enqueue(bx[i] + dx, by[i] + dy, 1, -1);
  }

  // Grow the field outward. Nearest-first ordering is what the pull below relies
  // on, so this must stay a queue (breadth-first), not a stack.
  for (let head = 0; head < sweptX.length; head++) {
    const d = sweptD[head];
    if (d >= REACH) continue;
    const x = sweptX[head];
    const y = sweptY[head];
    const from = y * w + x;
    for (const [dx, dy] of DIR8) enqueue(x + dx, y + dy, d + 1, from);
  }

  // Pull, nearest-first: the grain in front vacates before the one behind it steps
  // up, so a column creeps toward the magnet instead of jamming against itself.
  for (let i = 0; i < sweptX.length; i++) {
    let cx = sweptX[i];
    let cy = sweptY[i];
    if (!isPullable(sim, cx, cy)) continue;
    // How many cells the grain travels along the field path this tick. Normally
    // one — but a grain that has ALREADY resolved its own motion this scan gets
    // two, and that second step is not a speed boost, it's the scan-order
    // correction that makes the magnet work at all. The CA scans in the gravity
    // direction first, so everything *below* a magnet takes its own gravity step
    // before the magnet's cell is ever reached: pull it one cell and it has fallen
    // one and risen one, hovering forever a cell above the floor instead of
    // climbing. Spending the extra step there measures the pull from where the
    // grain started the tick rather than from where gravity left it, so the field
    // gains exactly one cell per tick from every direction — and a grain that fell
    // off the magnet's face is put straight back onto it, which is what makes a
    // clump *cling* rather than shiver.
    let steps = sim.hasMoved(cx, cy) ? 2 : 1;
    while (steps-- > 0) {
      const from = visited.get(cy * w + cx);
      // undefined can't happen (every position walked here was swept), and -1 means
      // the grain is already against the magnet — either way there's nowhere closer.
      if (from === undefined || from < 0) break;
      const tx = from % w;
      const ty = (from / w) | 0;
      if (!acceptsPull(sim, tx, ty)) break; // blocked by the clump in front
      // swap carries the grain's temp/aux/tint (and marks both ends moved), so a
      // red-hot filing arrives still hot.
      sim.swap(cx, cy, tx, ty);
      cx = tx;
      cy = ty;
    }
    // Hold it wherever it ended up, so the clump doesn't slide off the magnet on
    // the next tick's gravity turn (see the header on holding).
    sim.markMoved(cx, cy);
  }
}

/** True if this body cell touches anything that isn't the magnet itself — the only
 *  cells a field sweep can seed from (see `pullField`'s seeding round and the note
 *  in updateElectromagnet). In-bounds is required both ways: an off-grid neighbor
 *  is nothing to seed into, so a cell hard against the world edge is "interior" as
 *  far as that edge is concerned. */
function isBodySurface(sim: SimContext, x: number, y: number): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) !== ELECTROMAGNET.id) return true;
  }
  return false;
}

/**
 * One magnet cell's tick. The countdown is per-cell (every cell of the body was
 * refreshed together by the last pulse), but the *field* belongs to the body as a
 * whole, so only the first cell of a given body to be scanned this tick sweeps it
 * — the rest find themselves already recorded in `SimContext.magnetField` and
 * just spin their own countdown down. Without that memo an N-cell magnet would
 * sweep the same field N times a tick.
 */
function updateElectromagnet(x: number, y: number, sim: SimContext): void {
  const timer = sim.getAux(x, y);
  if (timer <= 0) return; // idle until a pulse energizes the body
  sim.setAux(x, y, timer - 1);

  // Walk the connected body in full (4-connected, the shared `floodDeviceBody`
  // every device's activation uses), recording its bounding box and its *surface*
  // cells, and claiming all of it for this tick — so the field is grown out of the
  // magnet's whole outline, not just the corner of it nearest the scan.
  //
  // Only surface cells are collected because only they can seed anything: pullField
  // seeds by trying each body cell's 8 neighbors, and a neighbor that is itself
  // magnet is never field-passable, so an interior cell's whole seeding round is
  // rejected. Handing over the interior anyway made a solid block pay 8 dead
  // enqueues per cell — the dominant cost of a big magnet's tick, and one it paid
  // every tick it was powered (the pre-existing 256-cell cap didn't help: the cells
  // it left unclaimed each started their own capped walk and their own sweep). A
  // 300×300 block drops from 90,000 seeds to ~1,200 this way, with the swept field
  // — and so the pull — bit-identical. The bounding box is still taken over every
  // cell (its extremes are surface cells regardless, but this way the box can't
  // drift if the surface rule is ever narrowed).
  const bx: number[] = [];
  const by: number[] = [];
  let minX = x;
  let minY = y;
  let maxX = x;
  let maxY = y;
  const swept = floodDeviceBody(sim, x, y, ELECTROMAGNET.id, sim.magnetField, (cx, cy) => {
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
    if (!isBodySurface(sim, cx, cy)) return;
    bx.push(cx);
    by.push(cy);
  });
  if (!swept) return; // another cell of this body already swept the field this tick

  pullField(sim, bx, by, minX, minY, maxX, maxY);
}

/**
 * Deliver a power pulse to the connected magnet body containing (sx,sy): flood the
 * whole thing through magnet cells (4-connected, `floodDeviceBody`) and refresh
 * every cell's powered countdown to POWERED_TICKS. A one-way sink — a pulse only
 * ever *arrives* here (see the header) — so power reaching any face energizes the
 * entire magnet at once, at full effect whatever strength the arriving pulse had
 * left. Memoized per tick via SimContext.magnetFlood so a body touched from
 * several faces/sources in one tick still floods exactly once. Called from the
 * pulse sources (battery.ts, spark.ts) via the shared reactToPulse, the same way
 * the Fan's, Laser's and Pump's body pulses are.
 */
export function energizeElectromagnetBody(sim: SimContext, sx: number, sy: number): void {
  floodDeviceBody(sim, sx, sy, ELECTROMAGNET.id, sim.magnetFlood, (x, y) => {
    // The whole aux byte is the countdown — a magnet has no direction to preserve.
    sim.setAux(x, y, POWERED_TICKS);
  });
}

export const ELECTROMAGNET = register({
  id: 123,
  name: 'Electromagnet',
  phase: Phase.Solid,
  // A dark iron core wrapped in copper windings — horizontal coil stripes in the
  // lattice colour that brighten while the field is up (see Material.coilPattern).
  color: rgb(52, 54, 62),
  lattice: rgb(196, 122, 58),
  coilPattern: true,
  density: 1000,
  category: 'electric',
  // Doesn't burn or corrode away underfoot, like the other electric machines.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  // One-way "outside → inside" electric sink (see the header): any pulse source
  // touching a face — Battery/LFP Battery/Turbine direct, or a relayed Spark —
  // floods the connected body and refreshes its field countdown. Declared once
  // here so every source powers it through the shared dispatch (spark.ts
  // reactToPulse), with no per-source id special-casing.
  directPulse: energizeElectromagnetBody,
  update: updateElectromagnet,
});
