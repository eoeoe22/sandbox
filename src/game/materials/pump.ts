import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';

// Pump (펌프) — an electric appliance that moves LIQUID against gravity. Until
// now the only ways to get a fluid somewhere were gravity, a Conveyor, or a Fan's
// gust, so there was effectively no way to lift a liquid at all: every process toy
// the sandbox already has (정유·제련·냉각수 순환·수조 배수) dead-ended at "redraw
// it by hand". The pump is the missing verb, and unlike the Fan — which shoves
// whatever is loose in a cone of wind — it makes a *path*: liquid enters the back
// face and leaves the front face, so a pipe the player builds out of Wall/Mesh
// actually carries flow and the structure they drew means something.
//
// Which way it pumps is chosen at placement time by the direction you *drag* the
// brush (Fan/Laser/Conveyor 방식 — 상하좌우 4방향), recorded in the low 2 bits of
// each cell's `aux` byte; it shares the Fan's placement path and direction codes
// (see PointerPainter), and the renderer draws the same brightening chevron.
//
// Powering it is the Fan's one-way "outside → inside" electric sink, verbatim (see
// fan.ts, and the pattern write-up in woofer.ts): the Pump is deliberately NOT
// `conductive`, so a Spark can never travel into or across it (a pump wall would
// otherwise be a free wire, and the conductor-class field in spark.ts has only a
// handful of slots left). Instead it declares the electric-appliance hook
// (`Material.directPulse` = `energizePumpBody`), and every pulse source — a
// Battery/LFP Battery/Turbine in contact or a Spark relayed down a wire —
// dispatches it through the shared `reactToPulse` (spark.ts). Current reaching any
// face floods the connected pump body (4-connected) and refreshes a *powered
// countdown* on every cell at once, generous enough (POWERED_TICKS) to bridge the
// quiet ticks between a Battery's periodic pulses so the flow doesn't stutter.

/** aux direction codes (low 2 bits) — identical to the Fan's so the shared
 *  drag-to-place path (PointerPainter.fanDir) stamps a Pump the same way. */
export const PUMP_UP = 0;
export const PUMP_DOWN = 1;
export const PUMP_LEFT = 2;
export const PUMP_RIGHT = 3;
/** Low-bit mask separating the direction from the packed powered countdown. */
const DIR_MASK = 0b11;

/** Unit flow vector for each direction code (intake is the opposite side). */
const DIRV: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // up
  [0, 1], // down
  [-1, 0], // left
  [1, 0], // right
];

/** Ticks a single power pulse keeps the pump running. Set well above the
 *  Battery's PULSE_PERIOD (12) so the flow never lapses between pulses — it winds
 *  down only a beat or two after power is genuinely cut. Fits the 6-bit countdown
 *  field (aux >> 2, ≤ 63). Matches the Fan/Laser. */
const POWERED_TICKS = 24;

/** Backstop on how far one flood walks the connected pump body in a single pass —
 *  mirrors the Fan/Laser/Turbine/Woofer MAX_BODY so a giant pump wall can't make
 *  one pulse unbounded (a larger body is covered across several capped floods a
 *  tick, each memoized in SimContext.pumpFlooded). */
const MAX_BODY = 256;

/** How many of its own cells one pump cell will walk through, along the flow
 *  axis, looking for the body's intake and outlet faces. A pump drawn thicker
 *  than a single cell in the flow direction would otherwise be inert — the
 *  interior cells' immediate neighbors are all pump — so each cell instead tunnels
 *  along the axis to the first non-pump cell on each side. Bounded so a pump slab
 *  drawn the width of the world stays O(1)-ish per cell; past that depth the cell
 *  simply doesn't pump. */
const MAX_SPAN = 16;

/** How far past the outlet face the pump looks for somewhere to put the liquid,
 *  travelling along the *column of liquid it is pushing on* (see `updatePump`).
 *  Long enough for a pipe worth building — a full-height standpipe on the default
 *  grid — and bounded so a world-spanning canal can't make one cell's tick walk
 *  the whole row. */
const MAX_PUSH = 64;

/** True if the cell at (x,y) is liquid the pump can draw in. Frozen liquid is
 *  excluded: below its freeze point a liquid acts solid (see SimContext.isFrozen),
 *  and a pump has no business sucking a block of it through the impeller. */
function isIntake(sim: SimContext, x: number, y: number): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return false;
  if (getMaterial(id).phase !== Phase.Liquid) return false;
  return !sim.isFrozen(x, y);
}

/** True if the outlet cell can take the pumped liquid. Empty air always can; a gas
 *  can too, and is displaced back to the intake by the swap — that's what lets a
 *  pump prime a pipe that's full of air/steam instead of stalling against it. A
 *  `packedTemp` gas is excluded: those are self-propelled ballistic/beam particles
 *  whose `temp` holds flight state, not heat (Ember/Debris/Blast/Nuclear Ray/Heat
 *  Ray — see Material.packedTemp), and teleporting one backwards through the pump
 *  would corrupt its arc. Anything else doesn't take the cell *here*: a liquid
 *  standing in the way is pushed along as a column instead (see `deliveryPoint`),
 *  while a powder plug or a solid cap stops the pump until it's cleared. */
function acceptsOutflow(sim: SimContext, x: number, y: number): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return true;
  const m = getMaterial(id);
  return m.phase === Phase.Gas && !m.packedTemp;
}

/**
 * Where the pumped cell actually lands: the first cell at or past the outlet face
 * that can take it, travelling along the flow direction through the column of
 * liquid already standing in front of the pump. Returns a flat index, or -1 if the
 * column is capped (a closed pipe, a full tank) or runs longer than MAX_PUSH.
 *
 * Walking the column is what makes a pump able to *fill* a pipe rather than only
 * prime one. Delivering strictly into the adjacent outlet cell stalls the instant
 * that cell is occupied — one cell of water enters the standpipe, sits on the
 * pump, and the pump is done forever. Real plumbing doesn't work that way and
 * neither should this: a liquid column is incompressible, so pushing a cell in at
 * the bottom is the same event as a cell leaving at the top. That's exactly what
 * this does, and it's why the delivery reads as instant over a long pipe — it is
 * the far end of the column moving, not the pumped cell teleporting.
 *
 * A column of *mixed* liquids (oil floating on water) is walked all the same and
 * the cell is delivered past all of it, which does shuffle which liquid sits where
 * within the pipe. That's the honest reading of "push a column along" at one-cell
 * resolution and it keeps the pump from mysteriously stalling under a slick.
 */
function deliveryPoint(sim: SimContext, ox: number, oy: number, dx: number, dy: number): number {
  let cx = ox;
  let cy = oy;
  for (let n = 0; n <= MAX_PUSH; n++) {
    if (!sim.inBounds(cx, cy)) return -1;
    if (acceptsOutflow(sim, cx, cy)) return cy * sim.width + cx;
    // Only a liquid column is pushed through; a solid cap, a powder plug or a
    // frozen slug stops the pump dead (it can't shove those aside).
    if (!isIntake(sim, cx, cy)) return -1;
    cx += dx;
    cy += dy;
  }
  return -1;
}

/**
 * Where the pumped cell is actually drawn *from*: the far end of the liquid column
 * standing behind the intake face, walking back along the flow axis. Returns a flat
 * index; the caller has already checked that the intake face itself holds liquid,
 * so this always returns a liquid cell (the intake face at minimum).
 *
 * This is the suction-side mirror of `deliveryPoint`, and it is what makes the pump
 * actually run rather than cough. Taking the cell at the intake face leaves the
 * hole *at* the face, pressed under the pump's own solid body — the one place a
 * falling-sand fluid is worst at refilling, since nothing can drop into it and only
 * a sideways shuffle can reach it. Measured, that starved a fully submerged pump
 * down to a few cells a hundred ticks and stalled a sealed duct outright. Taking
 * the cell from the *back* of the column instead puts the hole where the fluid can
 * collapse into it — for an upward pump that's the bottom of the pool, exactly
 * where gravity does the work — and the liquid in between simply stays put, which
 * is what a column shifting by one cell looks like anyway.
 */
function sourcePoint(sim: SimContext, ix: number, iy: number, bx: number, by: number): number {
  let cx = ix;
  let cy = iy;
  for (let n = 0; n < MAX_PUSH; n++) {
    const nx = cx + bx;
    const ny = cy + by;
    if (!sim.inBounds(nx, ny) || !isIntake(sim, nx, ny)) break;
    cx = nx;
    cy = ny;
  }
  return cy * sim.width + cx;
}

/** Walk from (x,y) along (dx,dy) through this pump's own body and return the first
 *  non-pump cell, or -1 if the walk leaves the grid or runs past MAX_SPAN cells of
 *  pump. Returned as a flat index so both faces come back in one number. */
function faceBeyondBody(sim: SimContext, x: number, y: number, dx: number, dy: number): number {
  let cx = x + dx;
  let cy = y + dy;
  for (let n = 0; n <= MAX_SPAN; n++) {
    if (!sim.inBounds(cx, cy)) return -1;
    if (sim.get(cx, cy) !== PUMP.id) return cy * sim.width + cx;
    cx += dx;
    cy += dy;
  }
  return -1; // deeper than MAX_SPAN of solid pump — this cell doesn't pump
}

/**
 * One pump cell's tick: while its countdown is live, draw a single liquid cell in
 * at the body's intake face (behind it) and deliver it out the front — into the
 * outlet cell if that's open, or, if a liquid column already stands there, out the
 * far end of that column (see `deliveryPoint`).
 *
 * Throughput is therefore one cell per tick *per pump cell*, which is the whole
 * rate model: a wider pump (more cells across the flow) pushes proportionally more
 * liquid, while making one thicker along the flow changes nothing — every cell of
 * a thick column shares the same intake and outlet, and once the first one has
 * moved the liquid the rest find the intake empty. That's the "틱당 상한" the
 * design called for, expressed as geometry the player can see rather than a hidden
 * constant.
 *
 * Deliberately does NOT skip an intake cell that already moved this tick (the
 * `hasMoved` discipline a Conveyor follows). A pool sloshes constantly, so the
 * exact cell sitting at the intake has usually already flowed somewhere this scan,
 * and honoring the guard would make an otherwise-fed pump run at a fraction of its
 * rate for no visible reason. The pump's rate limit is its own one-transfer-per-
 * tick, not the liquid's move budget; the cost is that a pumped cell can travel
 * its own step *and* the pump's in one tick, which reads as the pump being brisk.
 */
function updatePump(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const timer = aux >> 2;
  if (timer <= 0) return; // idle until a pulse energizes the body
  const dir = aux & DIR_MASK;
  // Spin the countdown down one tick, preserving the direction bits.
  sim.setAux(x, y, ((timer - 1) << 2) | dir);

  const [dx, dy] = DIRV[dir];
  const inlet = faceBeyondBody(sim, x, y, -dx, -dy);
  if (inlet < 0) return;
  const w = sim.width;
  const ix = inlet % w;
  const iy = (inlet / w) | 0;
  if (!isIntake(sim, ix, iy)) return;

  const outlet = faceBeyondBody(sim, x, y, dx, dy);
  if (outlet < 0) return;
  const drop = deliveryPoint(sim, outlet % w, (outlet / w) | 0, dx, dy);
  if (drop < 0) return;
  const ox = drop % w;
  const oy = (drop / w) | 0;

  // Draw from the back of the suction column rather than from the intake face, so
  // the hole this leaves lands where the fluid can actually collapse into it (see
  // `sourcePoint`).
  const src = sourcePoint(sim, ix, iy, -dx, -dy);
  // swap carries the liquid's temp/aux/tint and its 겹침 overlay, and marks both
  // ends moved — so pumped coolant stays cold and pumped lava stays molten.
  sim.swap(src % w, (src / w) | 0, ox, oy);
}

/**
 * Deliver a power pulse to the connected pump body containing (sx,sy): flood it
 * through pump cells (4-connected) and refresh every cell's powered countdown to
 * POWERED_TICKS, keeping each cell's own direction bits. A one-way sink — a pulse
 * only ever *arrives* here (see the header) — so power reaching any face energizes
 * the whole structure. Memoized per tick via SimContext.pumpFlooded so a body
 * touched from several faces/sources in one tick still floods exactly once. Called
 * from the pulse sources (battery.ts, spark.ts) via the shared reactToPulse, the
 * same way the Fan's and Laser's body pulses are.
 */
export function energizePumpBody(sim: SimContext, sx: number, sy: number): void {
  if (sim.tick !== sim.pumpFloodTick) {
    sim.pumpFloodTick = sim.tick;
    sim.pumpFlooded.clear();
  }
  const w = sim.width;
  const startIdx = sy * w + sx;
  if (sim.pumpFlooded.has(startIdx)) return;

  const seen = new Set<number>([startIdx]);
  const stack: number[] = [sx, sy];
  let count = 0;
  while (stack.length > 0 && count < MAX_BODY) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    count++;
    sim.pumpFlooded.add(cy * w + cx);
    sim.setAux(cx, cy, (POWERED_TICKS << 2) | (sim.getAux(cx, cy) & DIR_MASK));
    for (const [dx, dy] of DIR4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== PUMP.id) continue;
      const k = ny * w + nx;
      if (seen.has(k) || sim.pumpFlooded.has(k)) continue;
      seen.add(k);
      stack.push(nx, ny);
    }
  }
}

export const PUMP = register({
  id: 122,
  name: 'Pump',
  phase: Phase.Solid,
  // A dark machine housing with a bright teal impeller chevron pointing the way it
  // pushes (drawn from the aux direction; brightens while powered — the same
  // windArrow path the Fan and Laser use).
  color: rgb(58, 74, 82),
  lattice: rgb(110, 225, 215),
  windArrow: true,
  density: 1000,
  category: 'electric',
  // Doesn't burn or corrode away underfoot, like the other electric machines.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  // One-way "outside → inside" electric sink (see the header): any pulse source
  // touching a face — Battery/LFP Battery/Turbine direct, or a relayed Spark —
  // floods the connected body and refreshes its run countdown. Declared once here
  // so every source powers it through the shared dispatch (spark.ts reactToPulse),
  // with no per-source id special-casing.
  directPulse: energizePumpBody,
  update: updatePump,
});
