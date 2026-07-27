import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';

// Pump (펌프) — a porous machine block that moves LIQUID and POWDER against
// gravity. Gravity, a Conveyor and a Fan's gust were the only ways to move
// anything, so there was effectively no way to *lift* a fluid at all: every
// process toy the sandbox has (정유·제련·냉각수 순환·수조 배수) dead-ended at
// "redraw it by hand". The pump is the missing verb.
//
// ## It's a sieve, not a wall
//
// The pump is a **porous solid** (`Material.porous`, like the Mesh and Turbine)
// that also opts into passing powders (`porousPowder` — the only material that
// does). Matter entering it slips into the cell's 겹침 (overlap) slot and keeps
// travelling through under its own rules, so with the power off a pump block is
// something water and sand simply *fall through*, as if it were a grate. That is
// the whole placement story: you don't aim it, you drop it into the pipe/tank
// wall you already built, and it does nothing until it's wired.
//
// Switch the power on and every pore turns into a riser: each cell hands its
// occupant to the cell above, so a column of pump lifts whatever is inside it one
// cell per tick — water, oil, molten metal, sand, gunpowder — and the bottom of
// the column sucks the cell directly beneath it in to refill. Matter climbs a
// pump block visibly, cell by cell, instead of teleporting from face to face.
//
// This replaced a directional intake/outlet pump (placement-drag chose one of
// 상하좌우 and it teleported a cell from the back face to the front). Two reasons
// it's better: an unpowered machine that matter falls *through* is a legible
// second state instead of an inert block, and lifting the payload cell by cell
// through the machine's own body is something you can watch happening — the old
// one moved liquid you never saw inside the pump at all.
//
// ## Powering
//
// The Fan's one-way "outside → inside" electric sink, verbatim (see fan.ts, and
// the pattern write-up in woofer.ts): the Pump is deliberately NOT `conductive`,
// so a Spark can never travel into or across it (a pump wall would otherwise be a
// free wire, and the conductor-class field in spark.ts has only a handful of
// slots left). Instead it declares the electric-appliance hook
// (`Material.directPulse` = `energizePumpBody`), and every pulse source — a
// Battery/LFP Battery/Turbine in contact or a Spark relayed down a wire —
// dispatches it through the shared `reactToPulse` (spark.ts). Current reaching any
// face floods the connected pump body (4-connected) and refreshes a *powered
// countdown* on every cell at once, generous enough (POWERED_TICKS) to bridge the
// quiet ticks between a Battery's periodic pulses so the flow doesn't stutter.
//
// Like the Electromagnet — and unlike the Fan/Laser — the pump has no direction to
// record, so its whole `aux` byte is the countdown and the renderer draws
// brightening vertical channel stripes instead of a chevron (Material.stripePattern).

/** Ticks a single power pulse keeps the pump running. Set well above the
 *  Battery's PULSE_PERIOD (12) so the flow never lapses between pulses — it winds
 *  down only a beat or two after power is genuinely cut. Matches the Fan/Laser/
 *  Electromagnet; the whole aux byte is the countdown here, so there's no packing
 *  limit to respect. */
const POWERED_TICKS = 24;

/** Backstop on how far one flood walks the connected pump body in a single pass —
 *  mirrors the Fan/Laser/Turbine/Woofer MAX_BODY so a giant pump wall can't make
 *  one pulse unbounded (a larger body is covered across several capped floods a
 *  tick, each memoized in SimContext.pumpFlooded). */
const MAX_BODY = 256;

/** How far down the intake reaches through the column of matter standing under
 *  the pump's foot to take its cell (see `sourceY`). Long enough for a tank worth
 *  building — a full-height one on the default grid — and bounded so a
 *  world-spanning pool can't make one cell's tick walk the whole column. */
const MAX_PULL = 64;

/** How far up the column standing on the pump's mouth the discharge looks for an
 *  open cell (see `deliveryY`). Long enough for a standpipe worth building — a
 *  full-height one on the default grid — and bounded so a world-tall pipe can't
 *  make one column's tick walk the whole thing. */
const MAX_PUSH = 64;

/** How far below its foot the intake reaches *through open air* to find something
 *  to draw (see `intakeHead`). Zero would mean a pump stops the moment the level
 *  it's draining falls one cell below its foot — every drain build would stall
 *  with a puddle left in it — so the foot gets a short suction reach instead, the
 *  one deliberately unphysical concession in the machine (재미 우선). Short enough
 *  that a pump hung in the air is still just a pump hung in the air. */
const SUCTION_REACH = 8;

/** True if the cell holds matter the intake can suck up into the pump: a liquid
 *  or a powder, the two phases the body passes. Frozen liquid is excluded — below
 *  its freeze point a liquid acts solid everywhere else too (see
 *  SimContext.isFrozen), and a pump has no business drawing a block of it in.
 *  Gases aren't drawn: they get in on their own (they rise into the pores), and
 *  sucking one down out of the air below would be daft. */
function isIntake(sim: SimContext, x: number, y: number): boolean {
  if (!sim.inBounds(x, y)) return false; // the run runs into the world's floor
  const id = sim.get(x, y);
  if (id === EMPTY) return false;
  const phase = getMaterial(id).phase;
  if (phase !== Phase.Liquid && phase !== Phase.Powder) return false;
  return !sim.isFrozen(x, y);
}

/** The head of the column the intake will draw from: the first drawable cell at
 *  or under (x,y), reaching down through open air up to SUCTION_REACH cells, or
 *  -1 if there's nothing to draw. Anything that isn't air and isn't drawable — a
 *  solid floor, a gas-filled pipe, a frozen slug — caps the intake where it
 *  stands, so a pump sealed off from its supply simply stops. */
function intakeHead(sim: SimContext, x: number, y: number): number {
  for (let n = 0; n <= SUCTION_REACH; n++) {
    const cy = y + n;
    if (!sim.inBounds(x, cy)) return -1;
    if (isIntake(sim, x, cy)) return cy;
    if (sim.get(x, cy) !== EMPTY) return -1;
  }
  return -1;
}

/**
 * Which cell the intake actually takes: the far (bottom) end of the column of
 * drawable matter standing under the pump's foot, not the cell touching it.
 *
 * This is the one piece of the old face-to-face pump worth keeping, and it was
 * measured rather than guessed. Taking the cell right under the foot leaves the
 * hole *directly beneath the pump body* — the one place a falling-sand fluid is
 * worst at refilling, since nothing can drop into it and, in a pipe, no sideways
 * shuffle can reach it either — so a pump standing in a sealed duct drew exactly
 * one cell and then starved forever. Taking the bottom cell instead leaves the
 * hole where gravity fills it immediately: the whole column above simply falls
 * one cell, which is what "a column shifted by one" looks like anyway.
 *
 * A column of *mixed* matter (oil over water, sand under water) is walked all the
 * same and the far cell is what rides up, which does shuffle what sits where in
 * the tank. That's the honest reading of "push a column along" at one-cell
 * resolution, and it keeps the pump from mysteriously starving under a slick.
 */
function sourceY(sim: SimContext, x: number, y: number): number {
  let cy = y;
  for (let n = 1; n < MAX_PULL; n++) {
    if (!isIntake(sim, x, cy + 1)) break;
    cy++;
  }
  return cy;
}

/**
 * Where the mouth's discharge lands when the cell right above the pump is already
 * taken: the first open cell up the column standing on it, or -1 if that column is
 * capped or runs longer than MAX_PUSH.
 *
 * Without this a pump fills a pipe with exactly one cell and stops forever — the
 * discharge sits on the mouth and blocks the next one, which is precisely the
 * deadlock a real column doesn't have. A column of one liquid is incompressible,
 * so pushing a cell in at the bottom *is* a cell leaving at the top: the cells are
 * interchangeable, and putting the pumped one at the far end is that same event
 * written the cheap way — nothing in between has to be touched.
 *
 * **Only a column of the payload's own phase is walked.** That interchangeability
 * is exactly what breaks down against a *different* kind of matter: walking a sand
 * plug would deliver water above it without the sand ever moving, i.e. the pump
 * would quietly cheat matter through a plug it should be stopped by. So a powder
 * plug caps a liquid discharge and a liquid pool caps a powder discharge, the same
 * way a solid cap, a frozen slug or trapped gas does — while a pipe of the payload
 * itself (water into water, sand onto sand) still fills to the top.
 *
 * Two liquids of the same phase but different materials (oil floating on water)
 * are still walked as one column, so the pumped cell arrives above the slick
 * rather than under it. That's the honest reading of "push a column along" at
 * one-cell resolution, and it keeps a pump from stalling under an oil film.
 */
function deliveryY(sim: SimContext, x: number, y: number, phase: Phase): number {
  for (let n = 0; n < MAX_PUSH; n++) {
    const cy = y - n;
    if (!sim.inBounds(x, cy)) return -1;
    if (sim.get(x, cy) === EMPTY) return cy;
    // Only a column of what's being pushed is pushed along; anything else — a
    // solid cap, a plug of the other phase, a frozen slug, trapped gas — stops
    // the discharge where it stands.
    if (!isIntake(sim, x, cy) || getMaterial(sim.get(x, cy)).phase !== phase) return -1;
  }
  return -1;
}

/**
 * Lift one vertical run of pump cells: walking from its top cell downward, each
 * cell hands its 겹침 occupant to the cell above — into the next pump cell's freed
 * pore, or out into open air above the run, where it surfaces as an ordinary
 * particle again (see SimContext.pushOverlay). Then the bottom cell refills its
 * own now-free pore from the column standing beneath the run — the intake, which
 * takes that column's far end rather than the cell it touches (see `sourceY`).
 *
 * **Top-down is what makes it a lift rather than a shuffle.** The cell above has
 * always vacated before the cell below pushes into it, so a *saturated* column
 * still advances every cell it holds, one cell per tick — a full pipe of water
 * climbs at the same speed as a single drop. Bottom-up (or per-cell, in scan
 * order) the first push would find the pore above occupied and fail, and a full
 * column would crawl up at one cell per tick *total*.
 *
 * Runs are walked whole, and only from their top cell, so the work is O(pump
 * cells) per tick no matter how the scan reaches them. Vertical runs are the right
 * unit precisely because the lift is vertical: two columns of one pump body don't
 * interact, so there's nothing to gain from walking the body as a whole (as the
 * Fan/Magnet's area effects must).
 *
 * Throughput is therefore **one cell per tick per column, per column of width** —
 * a wider pump lifts proportionally more, a taller one lifts the same amount
 * higher. Visible structure is the rate model, not a hidden constant.
 */
function liftColumn(x: number, topY: number, sim: SimContext): void {
  const h = sim.height;
  // The mouth first: out into the open cell above, into a host sitting on top
  // (a Mesh cap, another machine), or else up the column already standing on it
  // (see `deliveryY`). A failed discharge leaves the pore full — held, not
  // percolating, since every powered cell pins its occupant in updatePump — and
  // the column below simply doesn't advance this tick.
  if (!sim.pushOverlay(x, topY, x, topY - 1)) {
    const payload = sim.getOverlay(x, topY);
    if (payload !== EMPTY) {
      const drop = deliveryY(sim, x, topY - 1, getMaterial(payload).phase);
      if (drop >= 0) sim.pushOverlay(x, topY, x, drop);
    }
  }
  // Then the rest of the run, each cell into the pore the one above just freed.
  let y = topY + 1;
  for (; y < h && sim.get(x, y) === PUMP.id; y++) sim.pushOverlay(x, y, x, y - 1);
  // y stopped one past the run's bottom cell — the intake face. Suck in the
  // column standing (or puddled a little way) below it, from its far end.
  const head = intakeHead(sim, x, y);
  if (head >= 0) sim.drawIntoOverlay(x, y - 1, x, sourceY(sim, x, head));
}

/**
 * One pump cell's tick: spin its powered countdown down, pin whatever is in its
 * pore so gravity doesn't drain it back out between lifts, and — if this is the
 * top cell of a vertical run — lift the whole run (see `liftColumn`).
 *
 * The lift is toward screen-up regardless of which way gravity is set, matching
 * the 겹침 layer's own screen-relative percolation (see SimContext.updateOverlay):
 * "the pump pushes it up" stays one rule the player can hold in their head, and
 * under inverted gravity a pump simply reads as pushing matter down into the floor
 * instead of holding it up.
 *
 * Only the run's *top* cell lifts, so the run is walked exactly once per tick
 * whatever order the scan reaches its cells in (the scan runs bottom-up under
 * default gravity, and flips with the gravity setting). All cells of a run share
 * one countdown — the power flood is 4-connected, so it can't energize part of a
 * column — which is why the top cell's own timer stands in for the whole run's.
 *
 * Deliberately does NOT skip an intake cell that already moved this tick (the
 * `hasMoved` discipline a Conveyor follows). A pool sloshes constantly, so the
 * exact cell under the intake has usually already flowed somewhere this scan, and
 * honoring the guard would make an otherwise-fed pump run at a fraction of its
 * rate for no visible reason. The pump's rate limit is its own one-cell-per-tick,
 * not the liquid's move budget.
 */
function updatePump(x: number, y: number, sim: SimContext): void {
  const timer = sim.getAux(x, y);
  if (timer <= 0) return; // idle until a pulse energizes the body — a plain sieve
  sim.setAux(x, y, timer - 1);

  // Hold this pore's contents for the tick: without it a cell scanned before the
  // run's top cell would percolate its occupant back down (into the pore below,
  // or out of the pump's underside) and the lift would only ever undo the drop.
  sim.markOverlayMoved(x, y);

  // Not the top of this vertical run? The top cell will lift the whole thing.
  if (sim.inBounds(x, y - 1) && sim.get(x, y - 1) === PUMP.id) return;
  liftColumn(x, y, sim);
}

/**
 * Deliver a power pulse to the connected pump body containing (sx,sy): flood it
 * through pump cells (4-connected) and refresh every cell's powered countdown to
 * POWERED_TICKS. A one-way sink — a pulse only ever *arrives* here (see the
 * header) — so power reaching any face energizes the whole structure. Memoized per
 * tick via SimContext.pumpFlooded so a body touched from several faces/sources in
 * one tick still floods exactly once. Called from the pulse sources (battery.ts,
 * spark.ts) via the shared reactToPulse, the same way the Fan's, Laser's and
 * Electromagnet's body pulses are.
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
    // The whole aux byte is the countdown — a pump has no direction to preserve.
    sim.setAux(cx, cy, POWERED_TICKS);
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
  // A dark machine housing cut by bright teal vertical channels — the risers
  // matter climbs — which brighten while the pump is powered (see
  // Material.stripePattern).
  color: rgb(58, 74, 82),
  lattice: rgb(110, 225, 215),
  stripePattern: true,
  density: 1000,
  category: 'electric',
  // Liquids and gases pass through it via the 겹침 overlap layer like any porous
  // solid, and powders do too (porousPowder) — with the power off it's a grate.
  // Every cell admits: no `latticeFilter`, so the stripes are decoration rather
  // than a Mesh-style half-density filter weave.
  porous: true,
  porousPowder: true,
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
