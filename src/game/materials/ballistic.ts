import { EMPTY } from '../engine/types';
import type { SimContext } from '../engine/SimContext';

// Shared ballistic-particle primitives — the reusable core of Ember and its
// derivatives (Debris, Bomblet, Napalm Gel). Every one of these is a cell that
// flies in a nearly straight, drooping line for a handful of ticks and then
// does *something* on impact (smash, restore material, detonate, stick and
// burn). The flight bookkeeping is identical; only that final impact behavior
// differs — so the mechanics live here and each particle owns just its landing
// rule (see the per-material files).
//
// Velocity is stored in fixed-point quarter-cells per tick, packed together with
// the remaining flight time into the cell's `temp`. Every ballistic particle
// therefore declares `thermal.conductivity: 0`, so the heat pass treats `temp`
// as inert per-cell state instead of a real temperature (the same trick Blast
// uses for its flash life). `init: 0` decodes to life 0, so a particle placed
// without a launch dies quietly on its first turn rather than flying with
// garbage velocity.

/** Fixed-point scale: 4 quarter-cells = 1 cell. */
export const Q = 4;
/** |velocity| clamp per axis: 6 cells/tick. Sized for the fastest launch in the
 *  game (a debris fountain's boosted vertical at the epicenter — see debris.ts);
 *  every other particle's launch spec tops out well below it, so for them this
 *  is just headroom, not a behavior change. */
export const V_MAX_Q = 24;
/** Encodable velocity values per axis (−V_MAX_Q … +V_MAX_Q). */
const V_SPAN = V_MAX_Q * 2 + 1;
/** One quarter-cell of downward pull — the base gravity step. Ember applies it
 *  on alternate ticks (a gentle droop); the heavier debris/bomblet/gel apply it
 *  every tick for a real parabola. */
export const GRAVITY_Q = 1;

/** Pack (life, vxQ, vyQ) into one float small enough to stay inside Float32's
 *  exact-integer range (max ≈ 30·49² ≈ 72k ≪ 2^24). */
export function encodeFlight(life: number, vxQ: number, vyQ: number): number {
  return (life * V_SPAN + (vxQ + V_MAX_Q)) * V_SPAN + (vyQ + V_MAX_Q);
}

export function decodeFlight(temp: number): { life: number; vxQ: number; vyQ: number } {
  const vyQ = (temp % V_SPAN) - V_MAX_Q;
  const rest = Math.floor(temp / V_SPAN);
  return { life: Math.floor(rest / V_SPAN), vxQ: (rest % V_SPAN) - V_MAX_Q, vyQ };
}

export function clampV(v: number): number {
  return v < -V_MAX_Q ? -V_MAX_Q : v > V_MAX_Q ? V_MAX_Q : v;
}

/** Whole cells to travel this tick along one axis: the integer part of the
 *  quarter-cell velocity, plus one extra cell with probability equal to the
 *  fractional remainder — sub-cell speeds without a sub-cell position field. */
export function cellsThisTick(sim: SimContext, vQ: number): number {
  const mag = Math.abs(vQ);
  let cells = (mag / Q) | 0;
  if (sim.chance((mag % Q) / Q)) cells++;
  return vQ < 0 ? -cells : cells;
}

/** Tuning for a `launchBallistic` spray. Speed is in quarter-cells/tick along
 *  the launch direction; life in ticks. */
export interface LaunchSpec {
  speedMinQ: number;
  speedVarQ: number;
  jitterQ: number;
  upBiasQ: number;
  lifeMin: number;
  lifeVar: number;
}

/**
 * Spawn a ballistic particle of `id` at (x,y) flying outward along the unit
 * 8-direction (dirX,dirY), with a randomized speed, per-axis jitter, slight
 * upward bias and flight time so a ring of rim cells fans out as an irregular
 * all-directions spray. Written via spawn() so it can transform any cell, with
 * the moved mark keeping that cell from being reprocessed within the same tick.
 * The caller may stash extra state (e.g. Debris' carried material id) in `aux`
 * right after this returns. Returns nothing.
 */
export function launchBallistic(
  sim: SimContext,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  id: number,
  spec: LaunchSpec,
): void {
  let speedQ = spec.speedMinQ + sim.randInt(spec.speedVarQ);
  // Diagonal launches cover √2 more ground per step; scale by ~1/√2 so the
  // spray reads as a circle, not a square with fast corners.
  if (dirX !== 0 && dirY !== 0) speedQ = (speedQ * 3) >> 2;
  const jitterSpan = spec.jitterQ * 2 + 1;
  const vxQ = clampV(dirX * speedQ + sim.randInt(jitterSpan) - spec.jitterQ);
  const vyQ = clampV(dirY * speedQ + sim.randInt(jitterSpan) - spec.jitterQ - spec.upBiasQ);
  sim.spawn(x, y, id);
  sim.setTemp(x, y, encodeFlight(spec.lifeMin + sim.randInt(spec.lifeVar), vxQ, vyQ));
}

/** Callbacks a ballistic particle supplies to `walkFlight` — everything about
 *  the flight *except* the straight-line walk itself, which is identical for
 *  every particle (see walkFlight). */
export interface FlightHandlers {
  /** This particle's own id: a sibling on the path is passed through this tick
   *  (stop short, fly on next) rather than treated as an obstacle. */
  siblingId: number;
  /**
   * The flight ended: either the path ran off a solid (wall) edge, or it reached
   * the first non-empty, non-sibling cell. `cx,cy` is the last open cell on the
   * path (adjacent to whatever stopped it — the natural place to land/deposit).
   * For a real cell hit, `nx,ny,nid` describe it; for a wall edge, `nx` is `-1`
   * (and `nid` is EMPTY). The handler must resolve the particle's own cell.
   */
  onImpact(
    sim: SimContext,
    x: number,
    y: number,
    cx: number,
    cy: number,
    nx: number,
    ny: number,
    nid: number,
  ): void;
  /** Clear flight (or a sibling stop-short): finalize the move to the last open
   *  cell `cx,cy` — typically via `advanceFlight` plus any per-cell state. */
  onArrive(sim: SimContext, x: number, y: number, cx: number, cy: number): void;
  /** The path ran off a *void* edge (open border): by default the particle just
   *  leaves the world (its cell cleared). Override only for unusual cases. */
  onVoidEdge?(sim: SimContext, x: number, y: number): void;
}

/**
 * Walk a ballistic particle at (x,y) along its per-tick displacement (dx,dy),
 * one cell at a time, so it collides with the first thing on its path rather
 * than teleporting to the endpoint. This is the shared skeleton every ballistic
 * particle uses (Ember, Debris, Bomblet, Napalm Gel); each supplies only what to
 * do on impact / on arrival via `h`. Open air is flown through; a sibling of the
 * same material stops the particle short for this tick (it flies on next); a void
 * edge, a wall edge, or any other cell ends the flight through `onImpact`.
 */
export function walkFlight(
  sim: SimContext,
  x: number,
  y: number,
  dx: number,
  dy: number,
  h: FlightHandlers,
): void {
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  let cx = x;
  let cy = y;
  for (let s = 1; s <= steps; s++) {
    const nx = x + Math.round((dx * s) / steps);
    const ny = y + Math.round((dy * s) / steps);
    if (nx === cx && ny === cy) continue;
    if (!sim.inBounds(nx, ny)) {
      if (sim.borderMode === 'void') {
        if (h.onVoidEdge) h.onVoidEdge(sim, x, y);
        else sim.set(x, y, EMPTY);
      } else {
        h.onImpact(sim, x, y, cx, cy, -1, -1, EMPTY); // solid container edge
      }
      return;
    }
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      cx = nx;
      cy = ny;
      continue;
    }
    if (nid === h.siblingId) break; // sibling: stop short this tick, fly on next
    h.onImpact(sim, x, y, cx, cy, nx, ny, nid);
    return;
  }
  h.onArrive(sim, x, y, cx, cy);
}

/** Finalize a clear-flight step: move the particle from (x,y) to the last open
 *  cell (cx,cy) if it travelled, and stamp its new packed flight state. Callers
 *  that carry extra per-cell state (Debris' material id) set it right after. */
export function advanceFlight(
  sim: SimContext,
  x: number,
  y: number,
  cx: number,
  cy: number,
  id: number,
  newTemp: number,
): void {
  if (cx !== x || cy !== y) {
    sim.set(x, y, EMPTY);
    sim.spawn(cx, cy, id);
  }
  sim.setTemp(cx, cy, newTemp);
}
