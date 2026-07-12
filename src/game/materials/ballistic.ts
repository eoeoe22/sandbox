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
/** |velocity| clamp per axis: 4 cells/tick. */
export const V_MAX_Q = 16;
/** Encodable velocity values per axis (−V_MAX_Q … +V_MAX_Q). */
const V_SPAN = V_MAX_Q * 2 + 1;
/** One quarter-cell of downward pull — the base gravity step. Ember applies it
 *  on alternate ticks (a gentle droop); the heavier debris/bomblet/gel apply it
 *  every tick for a real parabola. */
export const GRAVITY_Q = 1;

/** Pack (life, vxQ, vyQ) into one float small enough to stay inside Float32's
 *  exact-integer range (max ≈ 30·33² ≈ 33k ≪ 2^24). */
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
