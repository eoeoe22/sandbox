import type { SimContext } from './SimContext';
import { EMPTY, Phase } from './types';
import { getMaterial } from '../materials/registry';
import { launchDebris } from '../materials/debris';
import { BLAST } from '../materials/blast';
import { MOLTEN_METAL } from '../materials/moltenmetal';
import { METAL_POWDER } from '../materials/metalpowder';

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
  /** Consecutive ticks the footprint has sampled above the burn threshold. Heat
   *  destruction is time-gated (like the drum's melt) so a stray hot pixel
   *  doesn't pop the ball — only sustained exposure does. */
  heatTicks: number;
  /** True while the pointer is dragging this body (보기 모드 grab): its own
   *  physics and all destruction triggers are suspended so it tracks the cursor
   *  and can be pulled out of harm. Shared with SimCapsule via SimBody. */
  held?: boolean;
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
/** Footprint temperature (°) at/above which a rubber ball counts a tick of heat
 *  exposure — rubber scorches far below metal, so a campfire (Fire 1000°) melts
 *  it while a warm room doesn't. Well under the drum's 1200° metal threshold. */
export const BALL_BURN_TEMP = 300;
/** Sustained ticks above BALL_BURN_TEMP before the ball is destroyed. Shorter
 *  than the drum's melt (thin rubber gives way faster than a metal shell). */
export const BALL_BURN_TICKS = 10;

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
    heatTicks: 0,
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
  /** True while the pointer is dragging this body (보기 모드 grab): its own
   *  physics and all destruction triggers are suspended so it tracks the cursor
   *  and can be pulled out of harm. Shared with SimObject via SimBody. */
  held?: boolean;
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

// ── Body-generic geometry (balls and drums share one representation) ─────────
// Every body reduces to a *medial segment + a cap radius*: a ball is the
// degenerate case where the segment is a single point (its center), a drum is a
// real segment. Expressing both this way lets object-object collision, picking,
// and the exposure scan run one code path over `SimBody` instead of per-kind
// branches. Balls carry no rotation, so their inverse inertia is 0 (a contact
// torque can't spin them) — that single difference is all the pair solver needs.

/** The cap radius of any body (ball radius or drum cap radius). */
export function bodyRadius(o: SimBody): number {
  return o.kind === 'ball' ? o.r : o.radius;
}

/** The body's medial segment endpoints [ax,ay,bx,by]. A ball's segment is its
 *  center twice (a point); a drum's is its capsule axis. */
function bodyEnds(o: SimBody): [number, number, number, number] {
  if (o.kind === 'ball') return [o.x, o.y, o.x, o.y];
  return capsuleEnds(o);
}

/** Half-extent from center to the farthest point of the body — the radius of the
 *  smallest circle covering it. Used to size scan/pick bounding boxes. */
export function bodyReach(o: SimBody): number {
  return o.kind === 'ball' ? o.r : o.halfLength + o.radius;
}

/** Inverse mass — 0 while held (the pointer pins it as an immovable anchor, so
 *  it shoves others without being shoved). */
function invMassOf(o: SimBody): number {
  return o.held ? 0 : 1 / o.mass;
}

/** Inverse rotational inertia — 0 for a ball (no rotation) and for any held body. */
function invInertiaOf(o: SimBody): number {
  return o.held || o.kind === 'ball' ? 0 : 1 / o.momentOfInertia;
}

/** Shortest distance from point (px,py) to the body's solid shape (0 if inside).
 *  Distance to the medial segment minus the cap radius, floored at 0. Exported
 *  for pointer picking / eraser hit-testing over the object layer. */
export function distanceToBody(o: SimBody, px: number, py: number): number {
  const [ax, ay, bx, by] = bodyEnds(o);
  const [qx, qy] = closestOnSegment(ax, ay, bx, by, px, py);
  const d = Math.hypot(px - qx, py - qy) - bodyRadius(o);
  return d < 0 ? 0 : d;
}

/** The topmost body whose shape contains (px,py), or null. Iterates from the end
 *  so the most-recently-spawned (drawn last / on top) body wins a pick. */
export function pickBody(objects: SimBody[], px: number, py: number): SimBody | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    if (distanceToBody(objects[i], px, py) <= 0) return objects[i];
  }
  return null;
}

/** Closest points between two segments P1→Q1 and P2→Q2, returned as
 *  [c1x,c1y,c2x,c2y]. Handles degenerate (zero-length) segments, so a ball's
 *  point-segment and point-point cases fall out of the same routine (Ericson,
 *  Real-Time Collision Detection §5.1.9). This is the whole of capsule-capsule
 *  proximity: the two bodies touch iff |c1−c2| < rA+rB. */
function closestBetweenSegments(
  p1x: number, p1y: number, q1x: number, q1y: number,
  p2x: number, p2y: number, q2x: number, q2y: number,
): [number, number, number, number] {
  const d1x = q1x - p1x, d1y = q1y - p1y; // direction of segment 1
  const d2x = q2x - p2x, d2y = q2y - p2y; // direction of segment 2
  const rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y; // squared length of seg 1
  const e = d2x * d2x + d2y * d2y; // squared length of seg 2
  const f = d2x * rx + d2y * ry;
  const EPS = 1e-9;
  const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  return [p1x + d1x * s, p1y + d1y * s, p2x + d2x * t, p2y + d2y * t];
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
 * Scan any body's footprint for the terminal triggers (read-only): a Blast flash
 * cell overlapping it (an explosion swept directly over it — see blast.ts, whose
 * cleared cells become short-lived BLAST cells → instant destruction), the
 * hottest footprint temperature (heat exposure, judged over time by the caller),
 * and the *fraction of the footprint buried in solid* (a wedged/entombed body is
 * crushed). Works for balls and drums alike via the segment+radius footprint.
 */
function scanBodyExposure(
  o: SimBody,
  ctx: SimContext,
): { blast: boolean; maxTemp: number; solidFrac: number } {
  const r = bodyRadius(o);
  const r2 = r * r;
  const [ax, ay, bx, by] = bodyEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  let blast = false;
  let maxTemp = -Infinity;
  let footprint = 0;
  let solid = 0;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      const [spx, spy] = closestOnSegment(ax, ay, bx, by, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      footprint++;
      // Out-of-bounds cells count toward the footprint but NOT as burial: the
      // container's wall border bounces a body off rather than crushing it, so a
      // body resting against the world edge must not read as entombed.
      if (!ctx.inBounds(cx, cy)) continue;
      if (isSolidCell(cx, cy, ctx)) solid++;
      if (ctx.get(cx, cy) === BLAST.id) blast = true;
      const t = ctx.getTemp(cx, cy);
      if (t > maxTemp) maxTemp = t;
    }
  }
  return { blast, maxTemp, solidFrac: footprint > 0 ? solid / footprint : 0 };
}

/**
 * Destroyed by a blast: the shell is torn apart, so fling a few Metal Powder
 * fragments (reusing debris.ts's scatter, count kept low — "몇 조각") that arc up
 * and rain back down as a heap of steel grains rather than the drum vanishing.
 * Metal Powder (metalpowder.ts) — not solid Iron — is the destroyed form: an
 * explosion shatters the metal into dust, and the powder still melts back to
 * Molten Metal if it later lands in heat. Being empty, the drum spills no
 * contents.
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
    launchDebris(ctx, cx, cy, METAL_POWDER.id, i % 2 === 0 ? 1 : -1, -1, 2);
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
 * Advance one drum a tick — physics only. Same order as the ball (gravity →
 * buoyancy/drag → integrate → grid collision) with rotation integrated alongside
 * position and contact torque folded into the collision resolve. Object-object
 * collisions and the terminal-state triggers (blast/heat/crush) are evaluated
 * afterward by stepObjects, so this leaves the drum `intact` — it just moves it.
 */
function stepCapsule(o: SimCapsule, ctx: SimContext, ax: number, ay: number, s: number): void {
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
    // Integrate orientation. The screen y-axis points DOWN, so a positive
    // angularVelocity (from the ω×r / r×J contact solve, which is self-consistent
    // in that frame) corresponds to a *clockwise* visual spin. The capsule axis
    // (sin θ, cos θ) rotates counter-clockwise as θ grows, so θ must DECREASE to
    // track a clockwise spin — hence `-=`. With `+=` the body (and its sprite)
    // rotated opposite to its rolling direction (rolled right but spun as if going
    // left), which read as "rolling the wrong way" on a slope.
    o.angle -= o.angularVelocity * dt;
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
}

// ── Object-object collision, blast knockback, and crush ─────────────────────
// The object layer is fully interactive: bodies collide with one another (an
// impulse solve over the shared segment+radius representation, torque included so
// a thrown ball can spin a drum), a blast that doesn't consume a body shoves it
// hard, and a body entombed in solid is crushed. The pair solve is pure
// object↔object; the knockback and crush read the grid but never write it.

/** Coulomb friction coefficient for object-object contacts — enough grip that a
 *  rolling drum drags a ball along and a stack doesn't instantly slide apart. */
const OBJECT_FRICTION = 0.5;
/** Below this closing speed an object-object contact is treated as inelastic, so
 *  a resting stack doesn't jitter on gravity's per-tick nudge (mirrors REST_EPS). */
const PAIR_REST_EPS = 0.35;
/** Relaxation passes over all overlapping pairs each tick. A handful is plenty
 *  for the small object counts here and keeps a stack from sinking together. */
const PAIR_ITERATIONS = 4;

/** Cells beyond a body's own footprint that a blast flash can still reach to
 *  shove it — the concussion past the crater rim (mirrors blast.ts's pressure
 *  ring, but for the object layer, which the cell-based ring can't touch). */
const BLAST_KNOCK_RADIUS = 12;
/** Peak outward speed (cells/tick) a blast imparts to a body it doesn't destroy.
 *  Applied as a floor on the outward velocity component (not accumulated), so a
 *  flash lingering several ticks gives one strong shove, not an ever-growing one. */
const BLAST_KNOCK_SPEED = 7;
/** Spin (rad/tick) a blast kicks into a drum as it's flung, so it tumbles away
 *  in the direction it's shoved (see stepCapsule's y-down rolling convention). */
const BLAST_KNOCK_SPIN = 0.12;

/** Footprint-solid fraction at/above which a body is judged crushed (entombed in
 *  or pinched by solid it can't be pushed out of) and destroyed. Above ½ so
 *  ordinary ground contact — a thin slice of the footprint — never triggers it.
 *  Evaluated after the post-collision grid re-resolve (phase B.5) frees any
 *  transient shove-into-terrain, so only a genuinely stuck body reaches it. */
const CRUSH_SOLID_FRAC = 0.6;

/** Quick test: does a shockwave flash cell overlap the body's footprint *right
 *  now*? A direct hit is captured at the tick's start (before knockback can move
 *  the body out of the blast) so a body engulfed by an explosion is reliably
 *  destroyed rather than yeeted clear of the destroy check. Footprint-only scan. */
function footprintHasBlast(o: SimBody, ctx: SimContext): boolean {
  const r = bodyRadius(o);
  const r2 = r * r;
  const [ax, ay, bx, by] = bodyEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      if (ctx.get(cx, cy) !== BLAST.id) continue;
      const [spx, spy] = closestOnSegment(ax, ay, bx, by, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy <= r2) return true;
    }
  }
  return false;
}

/**
 * A blast that doesn't consume a body still shoves it. Scan the ring just outside
 * the body's footprint for shockwave flash cells; if any are near, push the body
 * outward along the summed away-from-blast direction. The push is a *floor* on
 * outward speed (capped at BLAST_KNOCK_SPEED), not an accumulating force, so a
 * lingering flash delivers a single punchy shove. A drum also gets a spin so it
 * tumbles. (A blast cell actually overlapping the footprint is the destroy case,
 * handled in evaluateTriggers — this only fires for the near-miss concussion.)
 */
function applyBlastKnockback(o: SimBody, ctx: SimContext): void {
  const reach = bodyReach(o) + BLAST_KNOCK_RADIUS;
  const reach2 = reach * reach;
  const x0 = Math.floor(o.x - reach);
  const x1 = Math.ceil(o.x + reach);
  const y0 = Math.floor(o.y - reach);
  const y1 = Math.ceil(o.y + reach);
  let px = 0;
  let py = 0;
  let found = false;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      if (ctx.get(cx, cy) !== BLAST.id) continue;
      const dx = o.x - (cx + 0.5);
      const dy = o.y - (cy + 0.5);
      const d2 = dx * dx + dy * dy;
      if (d2 > reach2 || d2 < 1e-6) continue;
      // Weight by 1/distance so nearer flash cells dominate the push direction.
      const inv2 = 1 / d2;
      px += dx * inv2;
      py += dy * inv2;
      found = true;
    }
  }
  if (!found) return;
  const plen = Math.hypot(px, py);
  if (plen < 1e-6) return;
  const nx = px / plen;
  const ny = py / plen;
  const outward = o.vx * nx + o.vy * ny;
  if (outward < BLAST_KNOCK_SPEED) {
    const add = BLAST_KNOCK_SPEED - outward;
    o.vx += nx * add;
    o.vy += ny * add;
  }
  // Tumble in the shove's travel sense: rolling right ⇒ ω>0 (see stepCapsule).
  if (o.kind === 'drum') o.angularVelocity += BLAST_KNOCK_SPIN * Math.sign(nx);
}

/**
 * Resolve one overlapping pair with a 2D impulse. Both bodies are stadiums
 * (segment + cap radius), so the contact is the closest points between their
 * medial segments; from there it's a standard normal (restitution) + Coulomb
 * friction impulse, each drum's spin fed by the torque r × J (a ball's inverse
 * inertia is 0, so it only translates). A held body has inverse mass/inertia 0,
 * so it acts as an immovable anchor — you can shove others with the one you drag,
 * but it stays glued to the cursor.
 */
function resolvePair(a: SimBody, b: SimBody): void {
  const imA = invMassOf(a);
  const imB = invMassOf(b);
  if (imA === 0 && imB === 0) return; // both immovable (e.g. two held)
  const iIA = invInertiaOf(a);
  const iIB = invInertiaOf(b);
  const [a1x, a1y, a2x, a2y] = bodyEnds(a);
  const [b1x, b1y, b2x, b2y] = bodyEnds(b);
  const [cax, cay, cbx, cby] = closestBetweenSegments(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y);
  let dx = cbx - cax;
  let dy = cby - cay;
  let dist = Math.hypot(dx, dy);
  const sumR = bodyRadius(a) + bodyRadius(b);
  if (dist >= sumR) return; // not touching
  let nx: number; // contact normal, from A toward B
  let ny: number;
  if (dist > 1e-6) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    nx = 0; // perfectly concentric — pick an arbitrary separating axis
    ny = -1;
    dist = 0;
  }
  const pen = sumR - dist;
  // Split the positional correction by inverse mass (an anchor doesn't move).
  const imSum = imA + imB;
  a.x -= nx * pen * (imA / imSum);
  a.y -= ny * pen * (imA / imSum);
  b.x += nx * pen * (imB / imSum);
  b.y += ny * pen * (imB / imSum);
  // Contact point: midway between the two surface points along the normal.
  const px = (cax + nx * bodyRadius(a) + (cbx - nx * bodyRadius(b))) / 2;
  const py = (cay + ny * bodyRadius(a) + (cby - ny * bodyRadius(b))) / 2;
  const rax = px - a.x;
  const ray = py - a.y;
  const rbx = px - b.x;
  const rby = py - b.y;
  const wA = a.kind === 'drum' ? a.angularVelocity : 0;
  const wB = b.kind === 'drum' ? b.angularVelocity : 0;
  // Contact velocities (v + ω×r, ω×r = ω·(−r_y, r_x)), relative B−A.
  const vrx = b.vx - wB * rby - (a.vx - wA * ray);
  const vry = b.vy + wB * rbx - (a.vy + wA * rax);
  const vn = vrx * nx + vry * ny;
  if (vn >= 0) return; // separating — positional fix already done
  const raCrossN = rax * ny - ray * nx;
  const rbCrossN = rbx * ny - rby * nx;
  const effN = imSum + iIA * raCrossN * raCrossN + iIB * rbCrossN * rbCrossN;
  // Restitution: the softer of the two bodies, dropped to 0 for a slow contact.
  const e = -vn < PAIR_REST_EPS ? 0 : Math.min(restitutionOf(a), restitutionOf(b));
  const jn = (-(1 + e) * vn) / effN;
  a.vx -= jn * nx * imA;
  a.vy -= jn * ny * imA;
  b.vx += jn * nx * imB;
  b.vy += jn * ny * imB;
  if (a.kind === 'drum') a.angularVelocity -= iIA * (rax * (jn * ny) - ray * (jn * nx));
  if (b.kind === 'drum') b.angularVelocity += iIB * (rbx * (jn * ny) - rby * (jn * nx));
  // Friction along the tangent, Coulomb-clamped to μ·jn, from the post-normal
  // relative velocity — the torque source that lets one body spin another.
  const tx = -ny;
  const ty = nx;
  const wA2 = a.kind === 'drum' ? a.angularVelocity : 0;
  const wB2 = b.kind === 'drum' ? b.angularVelocity : 0;
  const vrx2 = b.vx - wB2 * rby - (a.vx - wA2 * ray);
  const vry2 = b.vy + wB2 * rbx - (a.vy + wA2 * rax);
  const vt = vrx2 * tx + vry2 * ty;
  const raCrossT = rax * ty - ray * tx;
  const rbCrossT = rbx * ty - rby * tx;
  const effT = imSum + iIA * raCrossT * raCrossT + iIB * rbCrossT * rbCrossT;
  let jt = -vt / effT;
  const maxF = OBJECT_FRICTION * jn;
  if (jt > maxF) jt = maxF;
  else if (jt < -maxF) jt = -maxF;
  a.vx -= jt * tx * imA;
  a.vy -= jt * ty * imA;
  b.vx += jt * tx * imB;
  b.vy += jt * ty * imB;
  if (a.kind === 'drum') a.angularVelocity -= iIA * (rax * (jt * ty) - ray * (jt * tx));
  if (b.kind === 'drum') b.angularVelocity += iIB * (rbx * (jt * ty) - rby * (jt * tx));
}

/** Restitution of any body (ball or drum). */
function restitutionOf(o: SimBody): number {
  return o.restitution;
}

/** Relax every overlapping pair a few passes (O(n²) per pass — object counts are
 *  small). This is the "완전한 물리적 상호작용" between bodies. */
function resolveObjectPairs(objects: SimBody[]): void {
  const n = objects.length;
  if (n < 2) return;
  for (let iter = 0; iter < PAIR_ITERATIONS; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        resolvePair(objects[i], objects[j]);
      }
    }
  }
}

/**
 * Evaluate a body's terminal triggers after all motion this tick has settled.
 * Priority: a direct blast hit or being crushed in solid destroys it outright;
 * otherwise sustained heat destroys it over time. A drum leaves a byproduct
 * (metal powder when shattered by blast/crush, a molten-metal puddle when melted
 * by heat); a rubber ball leaves nothing. Returns true to KEEP the body, false to
 * drop it (byproducts, if any, already spawned).
 */
/** The byproduct of a body destroyed by blast or crush: a drum shatters into
 *  scattered Metal Powder, a rubber ball leaves nothing behind. */
function destroyByproduct(o: SimBody, ctx: SimContext): void {
  if (o.kind === 'drum') {
    spawnDrumDebris(o, ctx);
    o.state = 'destroyed';
  }
}

function evaluateTriggers(o: SimBody, ctx: SimContext): boolean {
  const exp = scanBodyExposure(o, ctx);
  // Instant destruction: a blast flash overlapping the footprint (직격), or being
  // wedged/entombed in solid it can't escape (끼임). A genuine burial is measured
  // *after* the post-collision grid re-resolve (phase B.5) has popped out any
  // transient collision shove into terrain, so only a body with no open face to
  // exit through — truly stuck — reads as crushed; a momentarily-overlapping one
  // is freed first. Blast is secondary to the phase-A doomed capture (covers a
  // body knocked into a lingering flash).
  if (exp.blast || exp.solidFrac >= CRUSH_SOLID_FRAC) {
    destroyByproduct(o, ctx);
    return false; // ball: no byproduct
  }
  // Sustained heat: drum melts to Molten Metal, ball burns away to nothing.
  const threshold = o.kind === 'drum' ? DRUM_MELT_TEMP : BALL_BURN_TEMP;
  const ticksNeeded = o.kind === 'drum' ? DRUM_MELT_TICKS : BALL_BURN_TICKS;
  if (exp.maxTemp >= threshold) {
    o.heatTicks++;
    if (o.heatTicks >= ticksNeeded) {
      if (o.kind === 'drum') {
        spawnMoltenPuddle(o, ctx);
        o.state = 'melted';
      }
      return false;
    }
  } else if (o.heatTicks > 0) {
    o.heatTicks--; // cools off if pulled from heat before destruction
  }
  return true;
}

/**
 * Advance every free object one tick in three phases: (A) each body's own physics
 * — a near-miss blast shoves it, then gravity/buoyancy/grid-collision integration
 * — skipped while the pointer holds it; (B) resolve collisions *between* bodies so
 * the layer is fully interactive; (C) evaluate terminal triggers (blast/heat/
 * crush) and compact out anything destroyed this tick. Run at the end of
 * Simulation.step(), fully separate from the CA cell scan. Gravity follows the
 * world's gravity vector and strength, so flipping or weakening it carries the
 * objects along with the rest of the sandbox. A held body is never stepped nor
 * destroyed — dragging it suspends its physics and shields it (see 보기 드래그).
 */
export function stepObjects(objects: SimBody[], ctx: SimContext): void {
  if (objects.length === 0) return;
  const s = ctx.gravityStrength;
  const ax = ctx.gravityX * OBJECT_GRAVITY * s;
  const ay = ctx.gravityY * OBJECT_GRAVITY * s;
  // Direct blast hits are captured at the tick's *start* position: a body engulfed
  // by an explosion is destroyed even though the same blast's knockback is about
  // to fling it clear of the destroy check. (A near-miss blast has no footprint
  // overlap here, so it falls through to the knockback shove instead.)
  const doomed = new Set<SimBody>();
  // Phase A — each body's own physics (a held body follows the cursor instead).
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.held) continue;
    if (footprintHasBlast(o, ctx)) {
      doomed.add(o); // destroyed below; don't bother moving it
      continue;
    }
    applyBlastKnockback(o, ctx);
    if (o.kind === 'ball') stepBall(o, ctx, ax, ay, s);
    else stepCapsule(o, ctx, ax, ay, s);
  }
  // Phase B — resolve collisions between bodies (fully interactive layer).
  resolveObjectPairs(objects);
  // Phase B.5 — the inter-object shove can push a light body into terrain; pop it
  // back out so the crush scan sees genuine entombment only, not a transient
  // collision overlap (a no-op for any body not penetrating the grid).
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.held) continue;
    if (o.kind === 'ball') resolveGridCollision(o, ctx);
    else resolveCapsuleCollision(o, ctx);
  }
  // Phase C — terminal triggers, then compact out any body destroyed this tick. A
  // held body is never destroyed (dragging shields it); a directly-hit body spawns
  // its byproduct; everything else is judged by its settled position (heat/crush).
  let w = 0;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.held) {
      objects[w++] = o;
    } else if (doomed.has(o)) {
      destroyByproduct(o, ctx);
    } else if (evaluateTriggers(o, ctx)) {
      objects[w++] = o;
    }
  }
  objects.length = w;
}
