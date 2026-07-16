import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';

// Conveyor Belt (컨베이어) — a static solid that transports whatever loose matter
// (powder or liquid) rests on it, in the direction it was drawn. Drag the brush
// left or right while placing a belt and every cell records that direction in its
// aux byte; the renderer draws a chevron so which way a belt runs is obvious at a
// glance (see CanvasRenderer). A moving floor that never itself moves.
//
// Two things beyond the basic "push one grain sideways":
//   • It carries a stack up to LIFT_HEIGHT cells tall off its surface (위쪽 10픽셀),
//     not just the single grain directly on top — so it grabs a whole slab of
//     poured material and slides it along.
//   • It climbs: when the straight-ahead cell is blocked but the cell one step
//     up-and-forward is open, the load steps up. A belt laid as a shallow
//     staircase therefore carries material UP a gentle (~30°) slope, stably,
//     instead of only moving it along the flat.

/** aux values encoding a belt cell's travel direction (0/unset ⇒ right). */
export const CONVEYOR_RIGHT = 1;
export const CONVEYOR_LEFT = 2;

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
  const dir = sim.getAux(x, y) === CONVEYOR_LEFT ? -1 : 1; // 0/unset ⇒ right

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

export const CONVEYOR = register({
  id: 100,
  name: 'Conveyor',
  phase: Phase.Solid,
  // A dark industrial belt; the direction chevron (drawn per-cell from the aux
  // direction — see CanvasRenderer) shows which way it runs.
  color: rgb(64, 66, 74),
  // Bright tread color the direction chevron is drawn in.
  lattice: rgb(126, 132, 148),
  arrow: true,
  density: 1000,
  category: '특수',
  // Belts don't burn or corrode away underfoot.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  update: updateConveyor,
});
