import type { SimContext } from './SimContext';
import { EMPTY, Phase } from './types';
import { getMaterial } from '../materials/registry';

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
 * Largest position step (in cells) taken before re-checking collision. The
 * per-tick displacement is split into substeps no longer than this so a fast
 * object can't tunnel through thin terrain in one jump — collision is resolved
 * between each substep. Half a cell is comfortably finer than the smallest ball.
 */
const MAX_SUBSTEP = 0.5;

/**
 * Per-tick velocity damping applied to a fully-submerged object (scaled down by
 * how much of its footprint is actually in fluid). Bleeds off the bobbing an
 * undamped buoyancy spring would sustain forever, and slows sideways drift
 * through liquid, so a floating ball settles at the waterline instead of
 * oscillating. Purely a feel knob.
 */
const OBJECT_FLUID_DRAG = 0.12;

/**
 * Below this outward normal speed (cells/tick) a bounce is treated as a rest:
 * the normal velocity is zeroed instead of bouncing. Without it, gravity would
 * re-inject a hair of downward speed every tick and a "resting" ball would
 * micro-bounce forever. Sized above a single tick's gravity-driven rebound
 * (OBJECT_GRAVITY × restitution ≈ 0.2) so genuine drops still bounce.
 */
const REST_EPS = 0.4;

/**
 * Is the grid cell (x,y) solid to an object — something it bounces off rather
 * than sinks into? Walls, ordinary solids, and frozen liquids all count; a
 * powder (sand) and a flowing liquid do NOT (those are buoyancy / penetration,
 * handled in later steps). Out of bounds reads as solid only under a `wall`
 * border (the container), and open under a `void` border. Read-only.
 */
function isSolidCell(x: number, y: number, ctx: SimContext): boolean {
  if (!ctx.inBounds(x, y)) return ctx.borderMode === 'wall';
  const id = ctx.get(x, y);
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.isWall || m.phase === Phase.Solid) return true;
  return ctx.isFrozen(x, y); // a frozen liquid acts solid
}

interface Contact {
  nx: number;
  ny: number;
  pen: number;
}

/**
 * Find the deepest real contact between the circle and the solid grid, or null
 * if it's free. For each solid cell overlapping the circle we take the closest
 * point on the cell square to the center; the outward vector to the center is
 * the contact normal and `r − dist` the penetration.
 *
 * The catch with a tile grid is *internal* faces — the shared edge between two
 * adjacent solid cells isn't a real surface, and colliding against it makes a
 * ball rattle as it rolls across a flat floor or up stairs. So a contact is
 * culled when the face it touches is buried: a top/side face contact whose
 * neighbor in the normal direction is solid, or a corner contact where either
 * orthogonal neighbor is solid. What survives are only exposed surfaces.
 */
function deepestContact(o: SimObject, ctx: SimContext): Contact | null {
  const r = o.r;
  const x0 = Math.floor(o.x - r);
  const x1 = Math.floor(o.x + r);
  const y0 = Math.floor(o.y - r);
  const y1 = Math.floor(o.y + r);
  let best: Contact | null = null;
  let bestPen = 0;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!isSolidCell(cx, cy, ctx)) continue;
      // Closest point on the unit cell square [cx,cx+1]×[cy,cy+1] to the center.
      const qx = o.x < cx ? cx : o.x > cx + 1 ? cx + 1 : o.x;
      const qy = o.y < cy ? cy : o.y > cy + 1 ? cy + 1 : o.y;
      const dx = o.x - qx;
      const dy = o.y - qy;
      const d2 = dx * dx + dy * dy;

      let nx: number;
      let ny: number;
      let pen: number;
      if (d2 > 1e-9) {
        const dist = Math.sqrt(d2);
        if (dist >= r) continue; // just touching / outside
        nx = dx / dist;
        ny = dy / dist;
        pen = r - dist;
        // Face vs. corner culling. A face contact is aligned on one axis — the
        // center lies within the cell's span there, so the closest point shares
        // that coordinate (dx or dy is exactly 0) and the normal is axis-aligned.
        // A corner contact is aligned on neither. (Testing dx/dy — not whether
        // the closest point is strictly *interior* to an edge — is what keeps a
        // center sitting exactly on a cell boundary, e.g. an integer coordinate,
        // classified as the face contact it physically is instead of a spurious
        // culled corner.)
        const onX = dx === 0;
        const onY = dy === 0;
        if (onX && !onY) {
          // Top/bottom face: buried if the cell in the normal (dy) dir is solid.
          if (isSolidCell(cx, cy + (dy > 0 ? 1 : -1), ctx)) continue;
        } else if (onY && !onX) {
          // Left/right face: buried if the cell in the normal (dx) dir is solid.
          if (isSolidCell(cx + (dx > 0 ? 1 : -1), cy, ctx)) continue;
        } else {
          // Corner: buried if either orthogonal neighbor toward the center is solid.
          if (
            isSolidCell(cx + (dx > 0 ? 1 : -1), cy, ctx) ||
            isSolidCell(cx, cy + (dy > 0 ? 1 : -1), ctx)
          )
            continue;
        }
      } else {
        // Center sits inside this solid cell (deep penetration) — push out along
        // the shallowest face whose outward neighbor is open, so it never gets
        // shoved deeper into an adjacent solid.
        const toLeft = o.x - cx;
        const toRight = cx + 1 - o.x;
        const toTop = o.y - cy;
        const toBottom = cy + 1 - o.y;
        let bp = Infinity;
        nx = 0;
        ny = 0;
        if (!isSolidCell(cx - 1, cy, ctx) && toLeft < bp) {
          bp = toLeft;
          nx = -1;
          ny = 0;
        }
        if (!isSolidCell(cx + 1, cy, ctx) && toRight < bp) {
          bp = toRight;
          nx = 1;
          ny = 0;
        }
        if (!isSolidCell(cx, cy - 1, ctx) && toTop < bp) {
          bp = toTop;
          nx = 0;
          ny = -1;
        }
        if (!isSolidCell(cx, cy + 1, ctx) && toBottom < bp) {
          bp = toBottom;
          nx = 0;
          ny = 1;
        }
        if (bp === Infinity) continue; // fully enclosed — nowhere to push
        pen = bp + r;
      }

      if (pen > bestPen) {
        bestPen = pen;
        best = { nx, ny, pen };
      }
    }
  }
  return best;
}

/**
 * Resolve the circle out of the solid grid: push it to just-touching along the
 * deepest contact normal and reflect the inbound normal velocity by the
 * restitution, leaving the tangential (rolling) velocity untouched. Iterated a
 * few times so an object wedged into a corner is separated from both faces. A
 * very small rebound is damped to rest so a settled ball doesn't jitter.
 */
function resolveGridCollision(o: SimObject, ctx: SimContext): void {
  for (let iter = 0; iter < 3; iter++) {
    const c = deepestContact(o, ctx);
    if (!c) break;
    o.x += c.nx * c.pen;
    o.y += c.ny * c.pen;
    const vn = o.vx * c.nx + o.vy * c.ny;
    if (vn < 0) {
      // Reflect the normal component, scaled by restitution.
      o.vx -= (1 + o.restitution) * vn * c.nx;
      o.vy -= (1 + o.restitution) * vn * c.ny;
      // Damp a tiny residual bounce to a rest (kills gravity-driven jitter).
      const out = o.vx * c.nx + o.vy * c.ny;
      if (out > 0 && out < REST_EPS) {
        o.vx -= out * c.nx;
        o.vy -= out * c.ny;
      }
    }
  }
}

/**
 * Sample the fluid the circle's footprint sits in, for buoyancy. Walk the cells
 * whose center is inside the circle (the same footprint the renderer fills) and,
 * for each that holds a (non-frozen) liquid, add its density and count it as
 * submerged. Returns the density sum (the Archimedes term — displaced fluid per
 * unit cell), the submerged cell count, and the total footprint cell count (for
 * the drag fraction). Read-only: buoyancy never disturbs the fluid cells.
 */
function fluidSample(o: SimObject, ctx: SimContext): {
  densitySum: number;
  submerged: number;
  footprint: number;
} {
  const r = o.r;
  const r2 = r * r;
  const x0 = Math.floor(o.x - r);
  const x1 = Math.ceil(o.x + r);
  const y0 = Math.floor(o.y - r);
  const y1 = Math.ceil(o.y + r);
  let densitySum = 0;
  let submerged = 0;
  let footprint = 0;
  for (let cy = y0; cy < y1; cy++) {
    const dy = cy + 0.5 - o.y;
    for (let cx = x0; cx < x1; cx++) {
      const dx = cx + 0.5 - o.x;
      if (dx * dx + dy * dy > r2) continue;
      footprint++;
      if (!ctx.inBounds(cx, cy)) continue;
      const id = ctx.get(cx, cy);
      if (id === EMPTY) continue;
      const m = getMaterial(id);
      if (m.phase === Phase.Liquid && !ctx.isFrozen(cx, cy)) {
        densitySum += m.density;
        submerged++;
      }
    }
  }
  return { densitySum, submerged, footprint };
}

/**
 * Advance every free object one tick: apply gravity, then integrate position in
 * collision-safe substeps, resolving against the solid grid after each. Run as
 * its own pass at the end of Simulation.step(), fully separate from the CA cell
 * scan. Gravity follows the world's gravity vector and strength (the same knobs
 * the CA movement primitives read), so flipping or weakening gravity carries the
 * objects along with the rest of the sandbox.
 *
 * Buoyancy/drag (fluid), splash, and sand penetration layer into this same pass
 * in later steps, in the order: gravity → buoyancy/drag → integrate → collision.
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
    // Buoyancy (Archimedes) + fluid drag. The buoyant acceleration opposes
    // gravity with magnitude (Σ displaced-fluid density · g) / mass — since mass
    // is the object's own density × footprint area, a body lighter than the
    // fluid (rubber ball vs. water) nets upward and floats, settling where the
    // submerged fraction balances the density ratio. Drag (scaled by how much of
    // the footprint is actually in fluid) damps the bob and sideways drift.
    const fs = fluidSample(o, ctx);
    if (fs.densitySum > 0) {
      const ab = (fs.densitySum * OBJECT_GRAVITY * s) / o.mass;
      o.vx -= ctx.gravityX * ab;
      o.vy -= ctx.gravityY * ab;
      const drag = OBJECT_FLUID_DRAG * (fs.submerged / (fs.footprint || 1));
      o.vx -= o.vx * drag;
      o.vy -= o.vy * drag;
    }
    // Integrate position over substeps ≤ MAX_SUBSTEP so nothing tunnels, with a
    // read-only solid-grid collision resolve after each. Time-based, so a bounce
    // mid-tick changes direction for the remainder of the tick.
    let remaining = 1;
    let guard = 0;
    while (remaining > 1e-4 && guard++ < 64) {
      const speed = Math.hypot(o.vx, o.vy);
      if (speed < 1e-6) break;
      const dt = Math.min(remaining, MAX_SUBSTEP / speed);
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      resolveGridCollision(o, ctx);
      remaining -= dt;
    }
  }
}
