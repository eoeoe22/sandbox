import type { SimContext } from './SimContext';

/**
 * A free rigid object — a self-contained body carrying its own position,
 * velocity, and physics in a layer *separate* from the cellular-automata grid
 * (see the 독립 오브젝트 신설 plan). The grid is read-only to an object (solid
 * collision, buoyancy sampling); the one exception is a discrete splash spawn on
 * water entry (a later step).
 *
 * This milestone models CIRCLES ONLY — the rubber ball. A circle looks the same
 * at every orientation, so it deliberately carries no angle / angular velocity.
 * Do NOT add rotation fields here: capsule objects (drums, etc.) that genuinely
 * need 1-axis rotation are a separate type in a later milestone and must not be
 * wedged into this one.
 */
export interface SimObject {
  /** Center position in grid coordinates (float, same units as the cell grid). */
  x: number;
  y: number;
  /** Velocity in cells per tick. */
  vx: number;
  vy: number;
  /** Radius in cells. */
  r: number;
  /** Mass — buoyancy and collision response. */
  mass: number;
  /** Coefficient of restitution (0..1) — how much speed it keeps bouncing off
   *  solid terrain. A rubber ball sets this high. */
  restitution: number;
}

/**
 * Gravity acceleration for the object layer, in cells/tick². Matched to the
 * heavy ballistic particles' pull (GRAVITY_Q = 1 quarter-cell/tick applied every
 * tick = 0.25 cells/tick²; see ballistic.ts), so a dropped object accelerates at
 * the same rate as the world's other falling matter. Objects integrate in plain
 * floats rather than through the quantized ballistic core, which is for
 * ephemeral debris.
 */
export const OBJECT_GRAVITY = 0.25;

/**
 * Rubber-ball defaults for the validation object. Density is well below Water
 * (3) so a ball floats; restitution is high so it bounces (see the plan's
 * 고무공 spec). Mass is derived from the disc area so a bigger ball is heavier,
 * which keeps buoyancy (mass vs. displaced fluid) consistent across sizes.
 */
export const RUBBER_BALL_DENSITY = 1.2;
export const RUBBER_BALL_RESTITUTION = 0.82;

/** Build a rubber ball centered at (x,y) with radius `r` cells, at rest. */
export function createRubberBall(x: number, y: number, r = 4): SimObject {
  const area = Math.PI * r * r;
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    mass: RUBBER_BALL_DENSITY * area,
    restitution: RUBBER_BALL_RESTITUTION,
  };
}

/**
 * Advance every free object one tick: apply gravity, then integrate position.
 * Run as its own pass at the end of Simulation.step(), fully separate from the
 * CA cell scan. Gravity follows the world's gravity vector and strength (the
 * same knobs the CA movement primitives read), so flipping or weakening gravity
 * carries the objects along with the rest of the sandbox.
 *
 * This is the skeleton integrator. Buoyancy/drag, grid solid-collision, splash,
 * and sand penetration are layered into this same pass in later steps, in the
 * order: gravity → buoyancy/drag → integrate → collision resolve.
 */
export function stepObjects(objects: SimObject[], ctx: SimContext): void {
  if (objects.length === 0) return;
  const s = ctx.gravityStrength;
  const ax = ctx.gravityX * OBJECT_GRAVITY * s;
  const ay = ctx.gravityY * OBJECT_GRAVITY * s;
  for (const o of objects) {
    // Gravity (gated by the world's gravity strength, so weightless mode holds
    // objects in the air just like it holds powders).
    o.vx += ax;
    o.vy += ay;
    // Integrate position (semi-implicit Euler: velocity was updated first).
    o.x += o.vx;
    o.y += o.vy;
  }
}
