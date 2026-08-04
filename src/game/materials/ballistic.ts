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
/** |velocity| clamp per axis: 6 cells/tick. This is the *encoding* ceiling,
 *  sized for the fastest motion in the game (a debris fountain's boosted
 *  vertical — see debris.ts). It is NOT the ceiling legacy particles saturate
 *  at: Ember/Bomblet/Gel were tuned when the clamp was 4 cells/tick, and their
 *  extreme launch rolls (and gravity build-up on a long fall) used to flatten
 *  against it — so they keep clamping to LEGACY_V_MAX_Q below and are
 *  bit-for-bit unchanged by this headroom. */
export const V_MAX_Q = 24;
/** The old per-axis ceiling (4 cells/tick) every pre-existing ballistic
 *  particle was tuned against. Ember/Bomblet/Gel launches and their in-flight
 *  gravity clamps still saturate here; only Debris' boosted vertical column
 *  (debris.ts) uses the full V_MAX_Q. */
export const LEGACY_V_MAX_Q = 16;
/** Encodable velocity values per axis (−V_MAX_Q … +V_MAX_Q). */
const V_SPAN = V_MAX_Q * 2 + 1;
/** One quarter-cell of pull along gravity — the base gravity step. Ember applies
 *  it on alternate ticks (a gentle droop); the heavier debris/bomblet/gel apply
 *  it every tick for a real parabola. Always fed through `applyFlightGravity`,
 *  never added to `vyQ` directly — see that function. */
export const GRAVITY_Q = 1;

/** Scratch for applyFlightGravity's (vxQ, vyQ) result. Module-level because that
 *  runs once per ballistic particle per tick and a burst can be hundreds of them,
 *  so it must not allocate; destructuring the return copies the two numbers out
 *  immediately, so it never escapes the call. */
const FLIGHT_G: [number, number] = [0, 0];

/**
 * One tick of gravitational pull on a ballistic particle's packed velocity —
 * `pullQ` quarter-cells along the world's gravity vector, gated by the world's
 * gravity strength, each component saturating at `maxQ`.
 *
 * Every ballistic particle used to write `vyQ + GRAVITY_Q` itself, i.e. pull
 * toward the bottom of the *screen* at a fixed rate. That was invisible while
 * gravity was a constant, and wrong in both of the ways it could be once the
 * gravity control existed: under up/left/right gravity a spark's arc still
 * drooped toward the screen's bottom edge (against the direction everything
 * else in the world was falling), and at reduced or zero strength it drooped
 * just as hard as ever — a weightless explosion still rained its sparks down.
 * The object layer already got this right (`objects.ts` scales OBJECT_GRAVITY
 * by `ctx.gravityX/Y` and `ctx.gravityStrength`), so the particle layer was the
 * odd one out.
 *
 * Strength is applied as a probability gate (SimContext.gravityPass), not a
 * multiplier, because velocity is stored as whole quarter-cells with no
 * fractional field to accumulate into — the same trick the movement primitives
 * use, and it averages to the right acceleration over a flight. At strength 0
 * the pull never lands, so sparks and fragments fly in dead-straight lines
 * until their flight time runs out and they settle where they are.
 *
 * Gravity is always axis-aligned (see GRAVITY_VECTORS), so exactly one of the
 * two components is nonzero and the other is returned untouched.
 */
export function applyFlightGravity(
  sim: SimContext,
  vxQ: number,
  vyQ: number,
  pullQ: number,
  maxQ: number,
): readonly [number, number] {
  // A zero pull is a no-op on both axes, so it doesn't spend a gate roll —
  // Ember passes 0 on its off-ticks (see ember.ts) rather than branching around
  // the call, and that must stay as cheap as the branch it replaced.
  if (pullQ !== 0 && sim.gravityPass()) {
    FLIGHT_G[0] = clampTo(vxQ + sim.gravityX * pullQ, maxQ);
    FLIGHT_G[1] = clampTo(vyQ + sim.gravityY * pullQ, maxQ);
  } else {
    FLIGHT_G[0] = vxQ;
    FLIGHT_G[1] = vyQ;
  }
  return FLIGHT_G;
}

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

/** Clamp a velocity component to an explicit per-axis ceiling (≤ V_MAX_Q so the
 *  result always encodes) — the legacy particles' LEGACY_V_MAX_Q saturation and
 *  the debris skirt's cap both go through here. */
export function clampTo(v: number, maxQ: number): number {
  return v < -maxQ ? -maxQ : v > maxQ ? maxQ : v;
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
  // The loft (`upBiasQ`) is a kick *against gravity*, not toward the top of the
  // screen — under flipped or sideways gravity a star has to climb the way that
  // world's things climb, and it especially has to agree with the in-flight pull
  // applyFlightGravity now applies along the same axis. At the default
  // down-gravity this is exactly the old `- spec.upBiasQ` on vy and nothing on
  // vx, so every launch spec's tuning is untouched there.
  const liftX = -sim.gravityX * spec.upBiasQ;
  const liftY = -sim.gravityY * spec.upBiasQ;
  // Saturate at the legacy ceiling, not V_MAX_Q: every launchBallistic user
  // (Ember, Bomblet, Gel) was tuned against the old 4 cells/tick clamp, and
  // their extreme rolls must keep flattening there — the wider encoding
  // headroom exists only for Debris' boosted column (its own launcher).
  const vxQ = clampTo(
    dirX * speedQ + sim.randInt(jitterSpan) - spec.jitterQ + liftX,
    LEGACY_V_MAX_Q,
  );
  const vyQ = clampTo(
    dirY * speedQ + sim.randInt(jitterSpan) - spec.jitterQ + liftY,
    LEGACY_V_MAX_Q,
  );
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
