import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { floodDeviceBody } from '../engine/deviceBody';

// Conveyor Belt (컨베이어) — an electric appliance that transports whatever loose
// matter (powder or liquid) rests on it, in the direction it was drawn. Drag the
// brush left or right while placing a belt and every cell records that direction
// in the low 2 bits of its aux byte; the renderer draws a chevron so which way a
// belt runs is obvious at a glance (see CanvasRenderer). A moving floor that never
// itself moves.
//
// Two things beyond the basic "push one grain sideways":
//   • It carries a stack up to LIFT_HEIGHT cells tall off its surface (위쪽 10픽셀),
//     not just the single grain directly on top — so it grabs a whole slab of
//     poured material and slides it along.
//   • It climbs: when the straight-ahead cell is blocked but the cell one step
//     up-and-forward is open, the load steps up. A belt laid as a shallow
//     staircase therefore carries material UP a gentle (~30°) slope, stably,
//     instead of only moving it along the flat.
//
// **It only runs on power** (전원 공급시에만 작동). A belt is a machine, not a
// slope, so it belongs in the 전기 category with the Fan/Laser/Pump/Electromagnet
// and answers power exactly the way they do — it is deliberately NOT `conductive`
// (a belt run must never double as free wire) and instead declares the shared
// electric-appliance hook (`Material.directPulse` = `energizeConveyorBody`). Any
// pulse source touching any face — a Battery/LFP Battery/Turbine/Solar Panel in
// direct contact, or a Spark relayed down a wire — floods the whole connected belt
// through `floodDeviceBody` and stamps a powered countdown onto every one of its
// cells at once, whatever strength that pulse had left (전기 세기에 관계없이 연결
// 부위 전역 즉시 활성화 — see engine/deviceBody.ts and docs/ELECTRICITY.md). An
// unpowered belt is inert: it carries nothing and its tread stands still, so it
// reads as an ordinary dark floor.
//
// The countdown is POWERED_TICKS long for the same reason the Fan's is — a Battery
// pulses only every PULSE_PERIOD (12) ticks, so a one-tick life would make the belt
// stutter between pulses. Refreshed to a comfortably longer 24, the belt runs
// continuously and coasts to a stop a beat or two after power is genuinely cut.

/** aux direction codes (low 2 bits of a belt cell's aux; 0/unset ⇒ right). */
export const CONVEYOR_RIGHT = 1;
export const CONVEYOR_LEFT = 2;
/** Low-bit mask separating the direction from the packed powered countdown. */
const DIR_MASK = 0b11;

/** Ticks one power pulse keeps the belt running. Same value and same reasoning as
 *  the Fan's: set well above the Battery's PULSE_PERIOD (12) so the tread never
 *  lapses in the gaps between pulses. Fits the 6-bit countdown field
 *  (aux >> 2, ≤ 63). */
const POWERED_TICKS = 24;

const LIFT_HEIGHT = 10; // how many cells above the surface are carried (위쪽 10픽셀)

/** True if `id` is loose matter the belt carries (powder or liquid). */
function isLoose(id: number): boolean {
  if (id === EMPTY) return false;
  const p = getMaterial(id).phase;
  return p === Phase.Powder || p === Phase.Liquid;
}

/** True if `id` is a solid — a "step" the belt can climb over (the next belt
 *  segment, a wall). The belt only climbs over solids, never over loose matter
 *  piled ahead (which would lift grains into floating positions off the belt). */
function isSolidStep(id: number): boolean {
  return id !== EMPTY && getMaterial(id).phase === Phase.Solid;
}

// The belt advances its load one cell EVERY tick (deterministically, not on a
// probability). The scan runs a belt cell before the load resting on it (bottom-
// to-top), so the belt carries a surface grain — and marks it moved — before that
// grain's own gravity update can tumble it off. That's what makes uphill carry
// stable: a grain riding an ascending staircase is stepped up each tick instead
// of getting a chance to roll off the front of a step into the gap below it.
function updateConveyor(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const timer = aux >> 2;
  if (timer <= 0) return; // unpowered: an inert floor, carrying nothing
  // Spin the countdown down one tick before doing any carrying, keeping the
  // direction bits. Done up front so it happens on every powered tick — the
  // carry below has several "nothing to move" early exits, and a belt that only
  // aged while it had a load would keep running forever once it emptied.
  sim.setAux(x, y, ((timer - 1) << 2) | (aux & DIR_MASK));

  const dir = (aux & DIR_MASK) === CONVEYOR_LEFT ? -1 : 1; // 0/unset ⇒ right

  // The load rests on the belt's top surface (the cell against gravity). Nothing
  // to carry if it's empty or not loose, or if it already moved this tick (so a
  // run of belts relays a cell one step per tick, never teleporting it across).
  const sy1 = y - 1;
  if (!sim.inBounds(x, sy1)) return;
  const bottom = sim.get(x, sy1);
  if (!isLoose(bottom) || sim.hasMoved(x, sy1)) return;

  // Decide the step for the whole stack from the bottom cell: straight along the
  // belt if that's open; else, if a SOLID step blocks the way (the next belt
  // segment of an ascending staircase, or a wall) and there's headroom above it,
  // climb one cell up-and-along; else blocked. Only solids are climbed — a grain
  // piled ahead makes the belt wait, never lifts the load over it into a floating
  // spot off the belt.
  if (!sim.inBounds(x + dir, sy1)) return;
  const fwd = sim.get(x + dir, sy1);
  let stepDy: number;
  if (fwd === EMPTY) {
    stepDy = 0; // flat carry
  } else if (
    isSolidStep(fwd) &&
    sim.inBounds(x + dir, sy1 - 1) &&
    sim.get(x + dir, sy1 - 1) === EMPTY
  ) {
    stepDy = -1; // climb the solid step
  } else {
    return; // blocked by loose matter piled ahead (wait) or no headroom to climb
  }

  // Move the contiguous loose stack (up to LIFT_HEIGHT tall) by (dir, stepDy).
  // Source column x and target column x+dir are disjoint, so the cells can't
  // collide as they shift; stop at the first cell that isn't loose / already
  // moved / can't fit, so a solid on the belt or a full landing keeps the stack
  // together rather than tearing it apart.
  for (let h = 1; h <= LIFT_HEIGHT; h++) {
    const sy = y - h;
    if (!sim.inBounds(x, sy)) break;
    const load = sim.get(x, sy);
    if (!isLoose(load) || sim.hasMoved(x, sy)) break;
    const tx = x + dir;
    const ty = sy + stepDy;
    if (!sim.inBounds(tx, ty) || sim.get(tx, ty) !== EMPTY) break;
    // swap carries the load's temp/aux/tint and marks both cells moved.
    sim.swap(x, sy, tx, ty);
  }
}

/**
 * Deliver a power pulse to the connected belt containing (sx,sy): flood the whole
 * thing through conveyor cells (4-connected, `floodDeviceBody`) and refresh every
 * cell's powered countdown to POWERED_TICKS, keeping each cell's own direction
 * bits — so a belt run wired at one end starts moving along its entire length in
 * the tick the pulse lands, at full speed whatever strength that pulse had left.
 * The one-way "outside → inside" sink every electric appliance shares (see the
 * header note and fan.ts): a pulse only ever *arrives* here, never leaves.
 * Memoized per tick via SimContext.conveyorFlood so a belt touched from several
 * faces or sources in one tick still floods exactly once.
 */
export function energizeConveyorBody(sim: SimContext, sx: number, sy: number): void {
  floodDeviceBody(sim, sx, sy, CONVEYOR.id, sim.conveyorFlood, (x, y) => {
    sim.setAux(x, y, (POWERED_TICKS << 2) | (sim.getAux(x, y) & DIR_MASK));
  });
}

export const CONVEYOR = register({
  id: 100,
  name: 'Conveyor',
  phase: Phase.Solid,
  // A dark industrial belt; the direction chevron (drawn per-cell from the aux
  // direction — see CanvasRenderer) shows which way it runs, and **the tread
  // scrolls one cell per tick along that direction while the belt is powered**
  // (the countdown in aux >> 2 is what gates it), so a running belt is obvious at
  // a glance and a dead one visibly stands still.
  color: rgb(64, 66, 74),
  // Bright tread color the direction chevron is drawn in.
  lattice: rgb(126, 132, 148),
  arrow: true,
  density: 1000,
  category: 'electric',
  thermal: { conductivity: 0.3 },
  // One-way "outside → inside" electric sink (see the header note): any pulse
  // source touching a face floods the connected belt and refreshes its run
  // countdown. Declared once here so every source powers it through the shared
  // dispatch (spark.ts reactToPulse), with no per-source id special-casing.
  directPulse: energizeConveyorBody,
  update: updateConveyor,
});
