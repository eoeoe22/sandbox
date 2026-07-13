import type { SimContext } from './SimContext';
import { EMPTY, Phase } from './types';
import { getMaterial } from '../materials/registry';
import { launchDebris } from '../materials/debris';
import { BLAST } from '../materials/blast';
import { MOLTEN_METAL } from '../materials/moltenmetal';
import { IRON } from '../materials/iron';

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
  /** Discriminant so the object array can hold circles and capsules together
   *  (see SimBody). A ball looks the same at every orientation, so it stays the
   *  no-rotation type; capsules (drums) are a separate `kind`. */
  kind: 'ball';
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

/** Build a rubber ball centered at (x,y) with radius `r` cells, at rest. `r` is
 *  clamped to a small positive minimum so mass is never zero (buoyancy divides
 *  by it). */
export function createRubberBall(x: number, y: number, r = 4): SimObject {
  const rr = r > 0.5 ? r : 0.5;
  const area = Math.PI * rr * rr;
  return {
    kind: 'ball',
    x,
    y,
    vx: 0,
    vy: 0,
    r: rr,
    mass: RUBBER_BALL_DENSITY * area,
    restitution: RUBBER_BALL_RESTITUTION,
  };
}

/**
 * A capsule object — a body with a *long axis*, so unlike the circle it must
 * carry an orientation (1-axis rotation is mandatory for capsules; see the
 * 독립 오브젝트 후보 plan). Its physics shape is a segment of half-length
 * `halfLength` with a cap radius `radius` (a stadium/capsule), NOT a polygon:
 * contact reduces to the shortest distance from that segment to the solid grid,
 * and rotation is the minimal `angle` + `angularVelocity` scalars driven by
 * contact torque (r × J) — no inertia tensor, no SAT, no polygon rasterization.
 * The display (a drum sprite) is separate from this collision shape.
 */
export type DrumState = 'intact' | 'destroyed' | 'melted';

export interface SimCapsule {
  kind: 'drum';
  /** Center position (float, grid coordinates). */
  x: number;
  y: number;
  /** Velocity (cells/tick). */
  vx: number;
  vy: number;
  /** Orientation of the long axis in radians. 0 = upright (long axis vertical,
   *  matching how the drum sprite is drawn). */
  angle: number;
  /** Spin rate in radians/tick, integrated from contact torque. */
  angularVelocity: number;
  /** Half the straight segment between the two round caps (cells). */
  halfLength: number;
  /** Cap radius (cells). */
  radius: number;
  /** Mass — buoyancy and collision response. */
  mass: number;
  /** Rotational inertia (angular accel = torque / momentOfInertia). Homogeneous
   *  capsule approximation, computed at creation. */
  momentOfInertia: number;
  /** Coefficient of restitution (0..1) — a drum barely bounces. */
  restitution: number;
  /** Lifecycle: intact until a trigger removes it. Both non-intact states are
   *  terminal — the object is dropped from the array the tick it reaches one. */
  state: DrumState;
  /** Consecutive ticks the footprint has sampled above the melt threshold, so a
   *  brief brush with heat doesn't melt it — only sustained exposure does. */
  heatTicks: number;
}

/** Anything in the object layer: circles (balls) and capsules (drums) share one
 *  array on the Grid, discriminated by `kind`. */
export type SimBody = SimObject | SimCapsule;

/**
 * Blue-drum defaults (the 빈 파란 드럼통). As an *empty* (hollow) drum its
 * effective density is well under Water (3) so it floats; restitution is low so
 * it thuds rather than bounces, and contact friction is high enough to convert
 * sliding into rolling. Size follows the 24×32 sprite's aspect (2·radius wide by
 * 2·(halfLength+radius) tall ⇒ 12×16 cells at these values), medium in the world.
 */
export const DRUM_RADIUS = 6;
export const DRUM_HALF_LENGTH = 2;
export const DRUM_DENSITY = 1.6;
export const DRUM_RESTITUTION = 0.26;
/** Contact friction coefficient (μ): the tangential impulse cap as a fraction of
 *  the normal impulse. High enough that a landing drum grabs and rolls instead
 *  of skating — the historically-missing piece was torque, supplied here. */
export const DRUM_FRICTION = 0.7;
/** Footprint temperature (°) at/above which the drum counts a tick of heat
 *  exposure. Below Iron's 1400° melt point (a thin processed shell melts a touch
 *  easier) but above ordinary Fire (1000°), so a campfire won't melt a drum while
 *  Lava (1500°) and Blue Flame (1800°) will. */
export const DRUM_MELT_TEMP = 1200;
/** Sustained ticks above DRUM_MELT_TEMP before the drum melts. */
export const DRUM_MELT_TICKS = 24;

/**
 * Build an empty blue drum centered at (x,y), at rest and upright. Mass is the
 * capsule area × density; the moment of inertia uses the bounding-box rectangle
 * approximation I = m(w² + h²)/12 (w=2·radius, h=2·(halfLength+radius)) — a
 * homogeneous-capsule近似 that's cheap and stable, not a real capsule integral.
 */
export function createBlueDrum(
  x: number,
  y: number,
  radius = DRUM_RADIUS,
  halfLength = DRUM_HALF_LENGTH,
): SimCapsule {
  const r = radius > 1 ? radius : 1;
  const l = halfLength > 0 ? halfLength : 0;
  // Capsule area = central rectangle (2r × 2l) + the two end caps (a full disc).
  const area = 4 * r * l + Math.PI * r * r;
  const mass = DRUM_DENSITY * area;
  const w = 2 * r;
  const h = 2 * (l + r);
  const momentOfInertia = (mass * (w * w + h * h)) / 12;
  return {
    kind: 'drum',
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    halfLength: l,
    radius: r,
    mass,
    momentOfInertia,
    restitution: DRUM_RESTITUTION,
    state: 'intact',
    heatTicks: 0,
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
 * Minimum entry speed (cells/tick, along gravity) for a water-surface entry to
 * throw a splash. Below it the object slips in without one, so gently lowering a
 * ball onto water doesn't spray. See spawnSplash.
 */
const SPLASH_MIN_SPEED = 1.2;

/** Upper bound on droplets a single splash throws — the "narrow the scope"
 *  reuse of the blast-fragment scatter: a handful of drops, not a fountain. */
const SPLASH_MAX_DROPLETS = 6;

/**
 * Granular-bearing support (cells/tick², per unit of submerged footprint
 * fraction), how hard an embedded object is held up by the powder it sits in.
 * Always capped at exactly canceling gravity, so the medium is *plastic*: it
 * arrests the object and holds it, and never springs it back out. Sized so a
 * gently-set ball needs only ≈ OBJECT_GRAVITY / POWDER_BEARING of its footprint
 * embedded (~1/6) to be borne — it rests lightly on the surface rather than
 * sinking, while a fast one punches deeper and stays there.
 */
const POWDER_BEARING = 1.5;

/**
 * Granular drag (per-tick velocity damping per unit submerged fraction). Powder
 * bleeds momentum far harder than water, so penetration depth tracks entry speed
 * — a fast drop drives deep before stopping, a slow one barely dents the surface.
 * Read-only: the object samples the grains to resist, it doesn't shove them.
 */
const POWDER_DRAG = 0.34;

/** Minimum entry speed (along gravity) to throw a powder scatter on impact. */
const POWDER_IMPACT_MIN_SPEED = 1.0;

/** Upper bound on grains a powder-impact scatter throws — deliberately fewer and
 *  slower than a water splash (물보다 약하게). */
const POWDER_SCATTER_MAX = 4;

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
        if (bp === Infinity) {
          // Fully enclosed inside solid (spawned into a wall, or terrain painted
          // around it): no open face to exit through. Rather than freezing the
          // object inside the terrain, nudge it against gravity so it squeezes
          // out the top over the next few ticks instead of getting stuck.
          nx = -ctx.gravityX;
          ny = -ctx.gravityY;
          pen = 1;
        } else {
          pen = bp + r;
        }
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
 * Sample the medium the circle's footprint sits in — for buoyancy (liquid) and
 * granular penetration (powder). Walk the cells whose center is inside the circle
 * (the same footprint the renderer fills) and bucket them: non-frozen liquid adds
 * its density (the Archimedes term) and a submerged count; powder adds a count.
 * Returns those plus the total footprint cell count (for the drag fractions).
 * Read-only: neither buoyancy nor penetration disturbs the sampled cells.
 */
function sampleMedium(o: SimObject, ctx: SimContext): {
  liquidDensity: number;
  liquidCells: number;
  powderCells: number;
  footprint: number;
} {
  const r = o.r;
  const r2 = r * r;
  const x0 = Math.floor(o.x - r);
  const x1 = Math.ceil(o.x + r);
  const y0 = Math.floor(o.y - r);
  const y1 = Math.ceil(o.y + r);
  let liquidDensity = 0;
  let liquidCells = 0;
  let powderCells = 0;
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
      if (m.phase === Phase.Liquid) {
        if (!ctx.isFrozen(cx, cy)) {
          liquidDensity += m.density;
          liquidCells++;
        }
      } else if (m.phase === Phase.Powder) {
        powderCells++;
      }
    }
  }
  return { liquidDensity, liquidCells, powderCells, footprint };
}

/**
 * Throw a splash on water entry — a *discrete* one-shot event fired the tick an
 * object first breaks the surface, NOT a continuous per-tick coupling. It reuses
 * the blast-fragment scatter (launchDebris): a handful of surface liquid cells
 * around the entry point are relaunched as ballistic droplets that arc up and
 * out carrying their own liquid, then rain back down — the crown of a splash,
 * with the fragment count/speed scaled to the entry speed and capped small. The
 * only place the object layer writes fluid cells; everywhere else it reads.
 */
function spawnSplash(o: SimObject, ctx: SimContext, entrySpeed: number): void {
  const r = o.r;
  const n = Math.min(SPLASH_MAX_DROPLETS, 2 + Math.floor(entrySpeed));
  const outB = Math.min(3, entrySpeed * 0.6); // launchDebris speed budget
  const yTop = Math.floor(o.y - r);
  const yBot = Math.floor(o.y + r);
  for (let i = 0; i < n; i++) {
    // Spread the droplets across the entry rim (−r … +r around the center).
    const frac = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const sx = Math.round(o.x + frac * r);
    // Topmost non-frozen liquid cell in this column, within the ball's span —
    // the surface the ball is punching through.
    let surfY = -1;
    let id = 0;
    for (let yy = yTop; yy <= yBot; yy++) {
      if (!ctx.inBounds(sx, yy)) continue;
      const cid = ctx.get(sx, yy);
      if (cid === EMPTY) continue;
      const m = getMaterial(cid);
      if (m.phase === Phase.Liquid && !ctx.isFrozen(sx, yy)) {
        surfY = yy;
        id = cid;
        break;
      }
    }
    if (surfY < 0) continue;
    // Relaunch that liquid cell as a droplet, spraying up and out to its side.
    launchDebris(ctx, sx, surfY, id, frac >= 0 ? 1 : -1, -1, outB);
  }
}

/**
 * Throw a scatter of grains on powder impact — the same discrete, one-shot,
 * on-impact reuse of the blast-fragment scatter (launchDebris) as the water
 * splash, but deliberately weaker (물보다 약하게): fewer grains, lower launch
 * speed. A handful of surface grains around the entry point are flung up and out
 * carrying their own powder, then rain back down as a little crater rim. Fires
 * only on the impact tick; the resting penetration below never moves grains.
 */
function spawnPowderScatter(o: SimObject, ctx: SimContext, entrySpeed: number): void {
  const r = o.r;
  const n = Math.min(POWDER_SCATTER_MAX, 1 + Math.floor(entrySpeed / 2));
  const outB = Math.min(1.5, entrySpeed * 0.35); // weaker than a splash's budget
  const yTop = Math.floor(o.y - r);
  const yBot = Math.floor(o.y + r);
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const sx = Math.round(o.x + frac * r);
    // Topmost powder cell in this column, within the ball's span — the surface
    // the ball is punching into.
    let surfY = -1;
    let id = 0;
    for (let yy = yTop; yy <= yBot; yy++) {
      if (!ctx.inBounds(sx, yy)) continue;
      const cid = ctx.get(sx, yy);
      if (cid === EMPTY) continue;
      if (getMaterial(cid).phase === Phase.Powder) {
        surfY = yy;
        id = cid;
        break;
      }
    }
    if (surfY < 0) continue;
    launchDebris(ctx, sx, surfY, id, frac >= 0 ? 1 : -1, -1, outB);
  }
}

/**
 * Advance one rubber ball a tick: gravity → buoyancy/drag → integrate position
 * in collision-safe substeps (resolving against the solid grid after each) →
 * discrete surface-entry splash/scatter. `ax,ay` is the pre-scaled gravity
 * acceleration for this tick (computed once by the caller).
 */
function stepBall(o: SimObject, ctx: SimContext, ax: number, ay: number, s: number): void {
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
  const ms = sampleMedium(o, ctx);
  const footprint = ms.footprint || 1;
  if (ms.liquidDensity > 0) {
    const ab = (ms.liquidDensity * OBJECT_GRAVITY * s) / o.mass;
    o.vx -= ctx.gravityX * ab;
    o.vy -= ctx.gravityY * ab;
    const drag = OBJECT_FLUID_DRAG * (ms.liquidCells / footprint);
    o.vx -= o.vx * drag;
    o.vy -= o.vy * drag;
  }
  if (ms.powderCells > 0) {
    const frac = ms.powderCells / footprint;
    // Granular bearing: a static support opposing gravity that grows with how
    // embedded the ball is, capped at exactly canceling gravity so the medium
    // is plastic — it arrests and holds the ball, never springs it back out. A
    // gently-set ball sinks only until enough grains bear it (rests on top).
    const bearing = Math.min(OBJECT_GRAVITY * s, POWDER_BEARING * frac * s);
    o.vx -= ctx.gravityX * bearing;
    o.vy -= ctx.gravityY * bearing;
    // Granular drag: bleeds momentum hard, so penetration depth tracks entry
    // speed (fast → deep, slow → shallow). Grains aren't moved (read-only).
    const drag = Math.min(0.9, POWDER_DRAG * frac);
    o.vx -= o.vx * drag;
    o.vy -= o.vy * drag;
  }
  // Impact speed along gravity, captured before integration — the speed the
  // object hits a medium's surface at (drives the splash / scatter tests below).
  const entrySpeed = o.vx * ctx.gravityX + o.vy * ctx.gravityY;
  // Which surface, if any, this object breaks *this* tick: it must have been
  // clear of that medium at tick start (edge-triggered) and moving in fast
  // enough. Prioritize liquid when a cell somehow holds both interpretations.
  const enteredLiquid = ms.liquidCells === 0 && entrySpeed >= SPLASH_MIN_SPEED;
  const enteredPowder = ms.powderCells === 0 && entrySpeed >= POWDER_IMPACT_MIN_SPEED;
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
  // Surface-entry scatter: a discrete edge event, detected statelessly by
  // comparing the medium before (ms, clear this tick) and after the move. It
  // fires only on the tick the object first breaks a surface fast enough — next
  // tick it's already inside, so it can't retrigger (no continuous coupling, no
  // extra per-object state). Water throws a splash; powder throws a weaker
  // grain scatter (물보다 약하게).
  if (enteredLiquid || enteredPowder) {
    const after = sampleMedium(o, ctx);
    if (enteredLiquid && after.liquidCells > 0) spawnSplash(o, ctx, entrySpeed);
    else if (enteredPowder && after.powderCells > 0) spawnPowderScatter(o, ctx, entrySpeed);
  }
}

// ───────────────────────── Capsule (drum) physics ───────────────────────────
//
// Everything below generalizes the circle machinery above to a capsule: a
// segment (the medial axis) with a cap radius. Contact is the shortest distance
// from that segment to the solid grid — the point→segment reduction the plan
// calls for, NOT a new manifold/SAT solver. The one genuinely new ingredient is
// rotation: a contact impulse applied off-center produces a torque r × J that
// integrates into `angularVelocity`, so a dropped drum actually rolls instead of
// sliding (the failure mode of the earlier "capsule = no rotation" attempt).
// Named `capsule*` (not `drum*`) so future capsule objects reuse the physics;
// only the sprite and the destroy/melt triggers are drum-specific.

/** Below this outward normal speed a capsule contact is treated as inelastic
 *  (no bounce), so a settling drum doesn't micro-bounce on gravity's per-tick
 *  re-injection. Mirrors the circle's REST_EPS. */
const CAPSULE_REST_EPS = 0.35;

/** Per-tick rolling resistance applied to a grounded drum's spin (and a matching
 *  sliver of linear damping), so it rolls to a stop rather than forever like an
 *  ideal frictionless wheel. Feel knob. */
const ROLL_RESISTANCE = 0.04;

/** The capsule's long-axis unit vector for orientation `angle`. angle 0 ⇒ (0,1),
 *  i.e. upright (long axis vertical), matching the drum sprite. */
function capsuleAxis(o: SimCapsule): [number, number] {
  return [Math.sin(o.angle), Math.cos(o.angle)];
}

/** The two segment endpoints A,B = center ∓ halfLength · axis. */
function capsuleEnds(o: SimCapsule): [number, number, number, number] {
  const [ux, uy] = capsuleAxis(o);
  const hx = o.halfLength * ux;
  const hy = o.halfLength * uy;
  return [o.x - hx, o.y - hy, o.x + hx, o.y + hy];
}

/** Closest point on segment A→B to point P (clamped to the segment). */
function closestOnSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + t * dx, ay + t * dy];
}

interface CapsuleContact {
  nx: number;
  ny: number;
  pen: number;
  /** Contact point (on the cell surface), for the lever arm r = contact − center. */
  px: number;
  py: number;
}

/**
 * Deepest contact between the capsule and the solid grid, or null if free. The
 * point→segment generalization of `deepestContact`: for each solid cell, take
 * the closest point P on the medial segment to the cell center, then — exactly
 * as the circle does from its center — the closest point q on the cell square to
 * P. The outward vector P−q is the normal and radius−|P−q| the penetration; q is
 * the contact point that gives the torque lever arm. The same buried-internal-
 * face culling as the circle keeps a drum from rattling across a flat floor.
 */
function deepestCapsuleContact(o: SimCapsule, ctx: SimContext): CapsuleContact | null {
  const r = o.radius;
  const [ax, ay, bx, by] = capsuleEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.floor(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.floor(Math.max(ay, by) + r);
  let best: CapsuleContact | null = null;
  let bestPen = 0;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!isSolidCell(cx, cy, ctx)) continue;
      // Segment point nearest this cell's center, then the cell-square point
      // nearest that — the circle's contact test, re-based on the segment.
      const [spx, spy] = closestOnSegment(ax, ay, bx, by, cx + 0.5, cy + 0.5);
      const qx = spx < cx ? cx : spx > cx + 1 ? cx + 1 : spx;
      const qy = spy < cy ? cy : spy > cy + 1 ? cy + 1 : spy;
      const dx = spx - qx;
      const dy = spy - qy;
      const d2 = dx * dx + dy * dy;

      let nx: number;
      let ny: number;
      let pen: number;
      let px = qx;
      let py = qy;
      if (d2 > 1e-9) {
        const dist = Math.sqrt(d2);
        if (dist >= r) continue;
        nx = dx / dist;
        ny = dy / dist;
        pen = r - dist;
        // Cull buried internal faces (same reasoning as the circle): an
        // axis-aligned face contact whose neighbor in the normal direction is
        // solid, or a corner whose orthogonal neighbor is solid, isn't a real
        // surface — skip it so a drum rolls smoothly instead of catching seams.
        const onX = dx === 0;
        const onY = dy === 0;
        if (onX && !onY) {
          if (isSolidCell(cx, cy + (dy > 0 ? 1 : -1), ctx)) continue;
        } else if (onY && !onX) {
          if (isSolidCell(cx + (dx > 0 ? 1 : -1), cy, ctx)) continue;
        } else {
          if (
            isSolidCell(cx + (dx > 0 ? 1 : -1), cy, ctx) ||
            isSolidCell(cx, cy + (dy > 0 ? 1 : -1), ctx)
          )
            continue;
        }
      } else {
        // Segment point sits inside this solid cell — push out along the
        // shallowest face whose outward neighbor is open (mirrors the circle).
        const toLeft = spx - cx;
        const toRight = cx + 1 - spx;
        const toTop = spy - cy;
        const toBottom = cy + 1 - spy;
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
        if (bp === Infinity) {
          nx = -ctx.gravityX;
          ny = -ctx.gravityY;
          pen = 1;
        } else {
          pen = bp + r;
        }
        px = spx;
        py = spy;
      }

      if (pen > bestPen) {
        bestPen = pen;
        best = { nx, ny, pen, px, py };
      }
    }
  }
  return best;
}

/**
 * Resolve the capsule out of the solid grid with rotation. For the deepest
 * contact each iteration: push out along the normal, then apply a contact
 * impulse at the contact point. The impulse has a normal part (restitution) and
 * a Coulomb-clamped tangential (friction) part; BOTH feed `angularVelocity`
 * through the torque r × J (r = contact − center). Friction at an off-center
 * contact is exactly what turns a drop into a roll — the piece the earlier
 * capsule attempt lacked. Returns true if any contact was resolved (grounded),
 * so the caller can apply rolling resistance.
 */
function resolveCapsuleCollision(o: SimCapsule, ctx: SimContext): boolean {
  const invMass = 1 / o.mass;
  const invI = 1 / o.momentOfInertia;
  let grounded = false;
  for (let iter = 0; iter < 4; iter++) {
    const c = deepestCapsuleContact(o, ctx);
    if (!c) break;
    grounded = true;
    // Positional correction along the contact normal.
    o.x += c.nx * c.pen;
    o.y += c.ny * c.pen;
    // Lever arm and the surface velocity at the contact point (2D rigid body:
    // v_p = v + ω × r, where ω × r = ω·(−r_y, r_x)).
    const rx = c.px - o.x;
    const ry = c.py - o.y;
    const vpx = o.vx - o.angularVelocity * ry;
    const vpy = o.vy + o.angularVelocity * rx;
    const vn = vpx * c.nx + vpy * c.ny;
    if (vn >= 0) continue; // separating — no impulse
    // Slow contacts don't bounce (kills gravity-driven micro-bounce at rest).
    const e = -vn < CAPSULE_REST_EPS ? 0 : o.restitution;
    // Normal impulse: jn = −(1+e)·v_n / (1/m + (r×n)²/I).
    const rnCross = rx * c.ny - ry * c.nx;
    const jn = (-(1 + e) * vn) / (invMass + invI * rnCross * rnCross);
    o.vx += jn * c.nx * invMass;
    o.vy += jn * c.ny * invMass;
    o.angularVelocity += invI * (rx * (jn * c.ny) - ry * (jn * c.nx));
    // Tangential (friction) impulse, Coulomb-clamped to μ·jn, recomputed from
    // the post-normal contact velocity for stability. This is the torque source
    // that spins the drum into a roll.
    const tx = -c.ny;
    const ty = c.nx;
    const vpx2 = o.vx - o.angularVelocity * ry;
    const vpy2 = o.vy + o.angularVelocity * rx;
    const vt = vpx2 * tx + vpy2 * ty;
    const rtCross = rx * ty - ry * tx;
    let jt = -vt / (invMass + invI * rtCross * rtCross);
    const maxF = DRUM_FRICTION * jn;
    if (jt > maxF) jt = maxF;
    else if (jt < -maxF) jt = -maxF;
    o.vx += jt * tx * invMass;
    o.vy += jt * ty * invMass;
    o.angularVelocity += invI * (rx * (jt * ty) - ry * (jt * tx));
  }
  return grounded;
}

/**
 * Sample the medium under the capsule's footprint (cells whose center is within
 * `radius` of the medial segment — the capsule generalization of the circle's
 * disc footprint), bucketed for buoyancy (liquid density + submerged count) and
 * granular penetration (powder count), plus the total footprint. Read-only.
 */
function sampleMediumCapsule(o: SimCapsule, ctx: SimContext): {
  liquidDensity: number;
  liquidCells: number;
  powderCells: number;
  footprint: number;
} {
  const r = o.radius;
  const r2 = r * r;
  const [ax, ay, bx, by] = capsuleEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  let liquidDensity = 0;
  let liquidCells = 0;
  let powderCells = 0;
  let footprint = 0;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      const [spx, spy] = closestOnSegment(ax, ay, bx, by, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      footprint++;
      if (!ctx.inBounds(cx, cy)) continue;
      const id = ctx.get(cx, cy);
      if (id === EMPTY) continue;
      const m = getMaterial(id);
      if (m.phase === Phase.Liquid) {
        if (!ctx.isFrozen(cx, cy)) {
          liquidDensity += m.density;
          liquidCells++;
        }
      } else if (m.phase === Phase.Powder) {
        powderCells++;
      }
    }
  }
  return { liquidDensity, liquidCells, powderCells, footprint };
}

/**
 * Scan the capsule's footprint for the two terminal triggers (read-only): a
 * Blast flash cell touching it (an explosion swept over it — see blast.ts, whose
 * cleared cells become short-lived BLAST cells), and the hottest footprint
 * temperature (heat exposure). Blast is edge-y and instant; heat is judged over
 * time by the caller. Reuses the same segment footprint as sampleMediumCapsule.
 */
function scanCapsuleExposure(o: SimCapsule, ctx: SimContext): { blast: boolean; maxTemp: number } {
  const r = o.radius;
  const r2 = r * r;
  const [ax, ay, bx, by] = capsuleEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  let blast = false;
  let maxTemp = -Infinity;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      const [spx, spy] = closestOnSegment(ax, ay, bx, by, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      if (ctx.get(cx, cy) === BLAST.id) blast = true;
      const t = ctx.getTemp(cx, cy);
      if (t > maxTemp) maxTemp = t;
    }
  }
  return { blast, maxTemp };
}

/**
 * Destroyed by a blast: fling a few Iron fragments (reusing debris.ts's scatter,
 * count kept low — "몇 조각") so the drum bursts into shrapnel rather than
 * vanishing. Being empty, it spills no contents. Fragments carry Iron so they
 * fly metallic and rain back as small iron bits.
 */
function spawnDrumDebris(o: SimCapsule, ctx: SimContext): void {
  const n = 5;
  const [ax, ay, bx, by] = capsuleEnds(o);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); // 0..1 along the segment (n is fixed > 1)
    const cx = Math.round(ax + (bx - ax) * t);
    const cy = Math.round(ay + (by - ay) * t);
    if (!ctx.inBounds(cx, cy)) continue;
    // Don't fling from (and thereby overwrite) a solid cell — the object layer is
    // read-only over terrain, spawning only into air/loose matter. Mirrors the
    // guard in spawnMoltenPuddle; a launch point buried in stone/wall is skipped.
    if (isSolidCell(cx, cy, ctx)) continue;
    launchDebris(ctx, cx, cy, IRON.id, i % 2 === 0 ? 1 : -1, -1, 2);
  }
}

/**
 * Melted by sustained heat: leave a Molten Metal puddle where the drum was — a
 * pure-metal melt (moltenmetal.ts), NOT smelting-line Molten Iron Ore. A drum is
 * a hollow shell, so only a fraction of the footprint becomes metal (a modest
 * glowing puddle that then flows), and only over cells that aren't solid terrain
 * — the object writes the grid solely on this melt event.
 */
function spawnMoltenPuddle(o: SimCapsule, ctx: SimContext): void {
  const r = o.radius;
  const r2 = r * r;
  const [ax, ay, bx, by] = capsuleEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      const [spx, spy] = closestOnSegment(ax, ay, bx, by, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      // Only over air/fluid, and only some cells (hollow shell → sparse metal).
      const id = ctx.get(cx, cy);
      if (id !== EMPTY && getMaterial(id).phase === Phase.Solid) continue;
      if (!ctx.chance(0.3)) continue;
      ctx.spawn(cx, cy, MOLTEN_METAL.id);
    }
  }
}

/**
 * Advance one drum a tick and evaluate its triggers. Same order as the ball
 * (gravity → buoyancy/drag → integrate → collision) with rotation integrated
 * alongside position and contact torque folded into the collision resolve, then
 * a read-only exposure scan that can flip the drum to a terminal state. Returns
 * the drum's state so the caller can drop it when it's no longer intact.
 */
function stepCapsule(o: SimCapsule, ctx: SimContext, ax: number, ay: number, s: number): DrumState {
  o.vx += ax;
  o.vy += ay;
  const ms = sampleMediumCapsule(o, ctx);
  const footprint = ms.footprint || 1;
  if (ms.liquidDensity > 0) {
    const ab = (ms.liquidDensity * OBJECT_GRAVITY * s) / o.mass;
    o.vx -= ctx.gravityX * ab;
    o.vy -= ctx.gravityY * ab;
    const drag = OBJECT_FLUID_DRAG * (ms.liquidCells / footprint);
    o.vx -= o.vx * drag;
    o.vy -= o.vy * drag;
    o.angularVelocity -= o.angularVelocity * drag; // fluid damps spin too
  }
  if (ms.powderCells > 0) {
    const frac = ms.powderCells / footprint;
    const bearing = Math.min(OBJECT_GRAVITY * s, POWDER_BEARING * frac * s);
    o.vx -= ctx.gravityX * bearing;
    o.vy -= ctx.gravityY * bearing;
    const drag = Math.min(0.9, POWDER_DRAG * frac);
    o.vx -= o.vx * drag;
    o.vy -= o.vy * drag;
    o.angularVelocity -= o.angularVelocity * drag;
  }
  // Integrate position AND orientation in tunneling-safe substeps. The substep
  // budget accounts for the rim's linear speed from spin (|ω|·(halfLength+radius))
  // so a fast-spinning drum still resolves contacts each fraction of a cell.
  const reach = o.halfLength + o.radius;
  let remaining = 1;
  let guard = 0;
  let grounded = false;
  while (remaining > 1e-4 && guard++ < 64) {
    const speed = Math.hypot(o.vx, o.vy) + Math.abs(o.angularVelocity) * reach;
    if (speed < 1e-6) break;
    const dt = Math.min(remaining, MAX_SUBSTEP / speed);
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    o.angle += o.angularVelocity * dt;
    if (resolveCapsuleCollision(o, ctx)) grounded = true;
    remaining -= dt;
  }
  // Rolling resistance: a grounded drum sheds a little spin (and a matching sliver
  // of linear speed) each tick so it rolls to a stop instead of forever.
  if (grounded) {
    o.angularVelocity -= o.angularVelocity * ROLL_RESISTANCE;
    o.vx -= o.vx * ROLL_RESISTANCE;
    o.vy -= o.vy * ROLL_RESISTANCE;
  }
  // Keep the angle wrapped to [−π, π) so it never grows to a precision-losing
  // magnitude, even after a very fast spin (a plain ±2π shift would only fix one
  // wrap; the modulo handles any number of turns in a tick).
  const TWO_PI = 2 * Math.PI;
  o.angle = ((((o.angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;

  // Terminal triggers (read-only scan): a blast sweeping over it destroys it
  // instantly; sustained heat melts it. Blast wins if both fire the same tick.
  const exp = scanCapsuleExposure(o, ctx);
  if (exp.blast) {
    spawnDrumDebris(o, ctx);
    o.state = 'destroyed';
    return 'destroyed';
  }
  if (exp.maxTemp >= DRUM_MELT_TEMP) {
    o.heatTicks++;
    if (o.heatTicks >= DRUM_MELT_TICKS) {
      spawnMoltenPuddle(o, ctx);
      o.state = 'melted';
      return 'melted';
    }
  } else if (o.heatTicks > 0) {
    o.heatTicks--; // cools off if pulled away from heat before melting
  }
  return 'intact';
}

/**
 * Advance every free object one tick, then drop any that reached a terminal
 * state this tick (a drum destroyed or melted). Balls and drums live in one
 * array discriminated by `kind`; each is stepped by its own path. Run as a pass
 * at the end of Simulation.step(), fully separate from the CA cell scan. Gravity
 * follows the world's gravity vector and strength, so flipping or weakening
 * gravity carries the objects along with the rest of the sandbox.
 */
export function stepObjects(objects: SimBody[], ctx: SimContext): void {
  if (objects.length === 0) return;
  const s = ctx.gravityStrength;
  const ax = ctx.gravityX * OBJECT_GRAVITY * s;
  const ay = ctx.gravityY * OBJECT_GRAVITY * s;
  // Compact in place: step each object, keep only the survivors (an intact drum
  // or any ball). Terminal drums have already spawned their debris/molten trail.
  let w = 0;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.kind === 'ball') {
      stepBall(o, ctx, ax, ay, s);
      objects[w++] = o;
    } else {
      const state = stepCapsule(o, ctx, ax, ay, s);
      if (state === 'intact') objects[w++] = o;
    }
  }
  objects.length = w;
}
