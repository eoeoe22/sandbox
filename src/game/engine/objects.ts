import type { SimContext } from './SimContext';
import { EMPTY, Phase } from './types';
import { AMBIENT_TEMP, SIM_HZ_AT_1X } from '../config';
import { getMaterial } from '../materials/registry';
import { launchDebris } from '../materials/debris';
import { BLAST, detonate } from '../materials/blast';
import { MOLTEN_METAL } from '../materials/moltenmetal';
import { METAL_POWDER } from '../materials/metalpowder';
import { OIL } from '../materials/oil';
import { ACID } from '../materials/acid';
import { ANTIMATTER } from '../materials/antimatter';
import { HEAT_RAY } from '../materials/heatray';
import { SPARK } from '../materials/spark';
import { CO2 } from '../materials/co2';
import { LIQUID_NITROGEN } from '../materials/liquidnitrogen';
import { FIRE } from '../materials/fire';
import { VOID } from '../materials/void';

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
  /** The body's own heat reservoir (°). Relaxes toward the surrounding footprint
   *  temperature each tick and is what the 가열/냉각 brush writes, so heat/cool
   *  reaches a body even where it floats over empty air (which the cell heat brush
   *  can't warm). The burn trigger judges by max(surroundings, this). */
  temp: number;
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
/** Max horizontal jitter — as a fraction of the ball's radius — applied to an
 *  *interactively* spawned rubber ball, kicked a random amount to a random side.
 *  Clicking repeatedly at one spot used to drop every ball on the exact same
 *  column with zero velocity, so each landed square on the apex of the one below
 *  and they balanced into a straight vertical tower (수직으로 쌓임). Nudging each
 *  spawn a random sliver sideways drops it *off-centre* onto the pile, where the
 *  unstable ball-on-ball contact rolls it off to spread into a low heap instead of
 *  a tower. A position offset, not a velocity — a starting velocity would drift
 *  forever on the friction-free floor (balls have no rolling resistance), whereas
 *  an offset lets a lone ball still settle at rest right under the cursor. Scaled
 *  to the radius so it stays proportionate across brush sizes, and small enough
 *  that a single placement still lands essentially where you clicked (편의성). */
export const RUBBER_BALL_SPAWN_SCATTER = 0.5;

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
    temp: AMBIENT_TEMP,
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

/**
 * What a drum is filled with. An empty drum (빈 드럼통) spills nothing; a filled
 * one pours out its liquid contents when destroyed (파괴 시 쏟아짐) — 원유 드럼통
 * gushes Crude Oil, 산 드럼통 gushes Acid — but is otherwise identical to the
 * empty drum in every physical respect (나머지는 드럼통과 동일). Kept separate
 * from `kind` so all drums share one capsule physics path; only the spill
 * byproduct and the sprite tint vary by fill.
 */
export type DrumFill = 'empty' | 'oil' | 'acid';

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
  /** What the drum is carrying — what (if anything) it spills when destroyed.
   *  Does not affect physics; see DrumFill and spawnFillSpill. */
  fill: DrumFill;
  /** Consecutive ticks the footprint has sampled above the melt threshold, so a
   *  brief brush with heat doesn't melt it — only sustained exposure does. */
  heatTicks: number;
  /** The drum's own heat reservoir (°) — see SimObject.temp. Lets the 가열/냉각
   *  brush melt a drum floating in air, and holds heat picked up from a hot
   *  surrounding so it keeps melting briefly after being pulled out. */
  temp: number;
  /** True while the pointer is dragging this body (보기 모드 grab): its own
   *  physics and all destruction triggers are suspended so it tracks the cursor
   *  and can be pulled out of harm. Shared with SimObject via SimBody. */
  held?: boolean;
}

/**
 * A stick of dynamite — a capsule body (it shares the drum's segment+radius
 * physics and 1-axis rotation, so it tumbles and rolls) whose defining trait is a
 * *lit fuse* at one end (the tip). The fuse is a countdown: each tick `fuseTicks`
 * drops, and at zero the stick detonates into the two-zone blast (a strong, tight
 * core + a weak, wide 충격파 — see detonateDynamite). The flame is drawn at the
 * tip and interacts with whatever it touches: ordinary liquid doesn't put it out
 * (it heats/boils the liquid a little instead), but a stronger extinguisher (CO₂,
 * Liquid N₂) or being buried in a non-flammable powder snuffs it to a dud
 * (`lit=false` — no timed explosion, though external heat/blast can still cook it
 * off). Carries no drum `fill`/`state`; its only extra state is the fuse.
 */
export interface SimDynamite {
  kind: 'dynamite';
  /** Center position (float, grid coordinates). */
  x: number;
  y: number;
  /** Velocity (cells/tick). */
  vx: number;
  vy: number;
  /** Orientation of the long axis in radians (0 = upright, fuse pointing up). */
  angle: number;
  /** Spin rate in radians/tick, integrated from contact torque. */
  angularVelocity: number;
  /** Half the straight segment between the two round caps (cells). */
  halfLength: number;
  /** Cap radius (cells). */
  radius: number;
  /** Mass — buoyancy and collision response. */
  mass: number;
  /** Rotational inertia (see SimCapsule). */
  momentOfInertia: number;
  /** Coefficient of restitution (0..1) — a stick barely bounces. */
  restitution: number;
  /** Consecutive ticks the footprint has sampled above the autoignite threshold,
   *  so a stray hot pixel doesn't cook it off — only sustained heat does. */
  heatTicks: number;
  /** The stick's own heat reservoir (°) — see SimObject.temp. The 가열 brush writes
   *  it, so heating a dynamite (even in mid-air) past the autoignite point sets it
   *  off. */
  temp: number;
  /** Whether the fuse is still burning. True from creation; a stronger extinguisher
   *  or a smothering powder flips it false (a dud), which *pauses* the countdown
   *  (fuseTicks is kept, not reset). A flame/heat touched to the fuse re-lights it
   *  (back to true) and the countdown resumes from where it paused. */
  lit: boolean;
  /** Ticks of fuse left before it detonates (only counts down while `lit`; frozen
   *  while a dud, so a snuffed-then-relit fuse resumes rather than restarts). */
  fuseTicks: number;
  /** True while the pointer is dragging this body (see SimObject.held): its physics
   *  and fuse/trigger evaluation are suspended so it tracks the cursor. */
  held?: boolean;
}

/** Anything in the object layer: circles (balls) and capsules (drums, dynamite)
 *  share one array on the Grid, discriminated by `kind`. */
export type SimBody = SimObject | SimCapsule | SimDynamite;

/**
 * The physics-only fields every capsule body shares — a medial segment of
 * half-length `halfLength` with cap radius `radius`, plus 1-axis rotation. The
 * capsule collision / buoyancy / integration routines (capsuleEnds,
 * deepestCapsuleContact, resolveCapsuleCollision, sampleMediumCapsule, stepCapsule)
 * operate through this structural type, so both the drum and the dynamite reuse
 * them with no per-kind branch — only the sprite and the destroy/trigger rules
 * differ by kind. SimCapsule and SimDynamite are both assignable to it.
 */
type CapsuleBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  halfLength: number;
  radius: number;
  mass: number;
  momentOfInertia: number;
  restitution: number;
};

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
 *  exposure. Level with Iron's melt point (1200°) — a thin processed shell — and
 *  above ordinary Fire (1000°), so a campfire won't melt a drum while Lava
 *  (1500°), Blue Flame (1800°), and an oxygen-blown coal fire (≥1300°) will. */
export const DRUM_MELT_TEMP = 1200;
/** Sustained ticks above DRUM_MELT_TEMP before the drum melts. */
export const DRUM_MELT_TICKS = 24;

/**
 * Build a drum centered at (x,y), at rest and upright, carrying `fill` (default
 * an empty blue drum). Mass is the capsule area × density; the moment of inertia
 * uses the bounding-box rectangle approximation I = m(w² + h²)/12 (w=2·radius,
 * h=2·(halfLength+radius)) — a homogeneous-capsule近似 that's cheap and stable,
 * not a real capsule integral. The fill is inert to physics (every drum weighs
 * and moves the same, 나머지는 드럼통과 동일); it only decides the destruction
 * spill and the sprite tint.
 */
export function createDrum(
  x: number,
  y: number,
  fill: DrumFill = 'empty',
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
    temp: AMBIENT_TEMP,
    fill,
  };
}

/**
 * Dynamite defaults. A short, slim stick (clearly smaller than the drum, so it
 * reads apart at a glance) that's *denser than Water* (3), so — unlike the hollow
 * drums — it sinks, and its fuse keeps burning as it goes down (물 안에서는 안 꺼짐).
 * Barely bounces. The fuse is a visible countdown, each stick rolling a random
 * length between DYNAMITE_FUSE_MIN_TICKS and _MAX_TICKS at creation.
 */
export const DYNAMITE_RADIUS = 1.6;
export const DYNAMITE_HALF_LENGTH = 3;
export const DYNAMITE_DENSITY = 3.5;
export const DYNAMITE_RESTITUTION = 0.2;
/** Max magnitude (rad/tick) of the small random spin a freshly-placed stick spawns
 *  with. The stick drops bolt-upright (수직 스폰) but gets a weak torque kicked in a
 *  random left/right direction — a coin-flip sign times a random fraction of this —
 *  so it tips over to one side or the other instead of balancing on its cap. Kept
 *  well under the mix brush's 0.15 so the nudge stays gentle (약한 토크). */
export const DYNAMITE_SPAWN_SPIN = 0.06;
/** Fuse length bounds (ticks). Each stick rolls a random burn time in [MIN, MAX]
 *  at creation (기획: 폭발 시간 3~5초 랜덤). Sized in *seconds* at the default sim rate
 *  — SIM_SPEED ×1 runs at SIM_HZ_AT_1X Hz (see config) — so a stick burns ~3–5 real
 *  seconds at the default speed (a faster/slower sim scales wall-clock time, as it
 *  does for everything). The remaining fuse is *paused*, not reset, whenever the
 *  flame is snuffed, and resumes from where it left off if the fuse is re-lit. */
export const DYNAMITE_FUSE_MIN_TICKS = Math.round(3 * SIM_HZ_AT_1X);
export const DYNAMITE_FUSE_MAX_TICKS = Math.round(5 * SIM_HZ_AT_1X);
/** Tip temperature (°) at/above which a snuffed (dud) fuse catches again and the
 *  countdown resumes — a flame/ember/hot surface touched to the fuse re-lights it.
 *  Above ambient/boiling so warmth alone won't, but any real flame (Fire 1000°,
 *  embers, molten metal) or hotter will; below the autoignite temp, so re-lighting
 *  resumes the timer rather than detonating outright. */
const FUSE_RELIGHT_TEMP = 200;
/** Footprint temperature (°) at/above which an external heat source cooks the
 *  stick off (autoignition). Set deliberately *above ordinary Fire's 1000°* so the
 *  lit fuse's OWN emitted Fire (which sits right beside a resting stick) can never
 *  self-detonate it — the fuse countdown stays the sole timer — while a genuinely
 *  hotter bath (Lava 1500°, Blue Flame 1800°) or the 가열 brush (up to 2000°) still
 *  cooks it off. This also reads true: real dynamite burns rather than detonates
 *  in an open flame; it wants a blasting cap (here: the fuse, a blast, or a crush). */
export const DYNAMITE_AUTOIGNITE_TEMP = 1100;
/** Sustained ticks above the autoignite temp before it goes off, so a single hot
 *  splash (a fleck of flung lava) doesn't instant-pop it — only a sustained bath
 *  does. Short enough that Lava still detonates it promptly. */
const DYNAMITE_HEAT_TICKS = 5;

// The two-zone detonation (see detonateDynamite): a strong, tight core that
// craters, wrapped in a weak, wide 충격파 that only shoves loose matter. Both
// reaches pass through blast.ts's global 2/3 scale, so the actual radii are ~2/3
// of these.
/** Core crater reach — full destructive power (강한 폭발). Widened from 13.5 to 24
 *  (강한 폭발 부분 반경 확대): the full-destruction crater now fills two-thirds of the
 *  total blast radius, so a stick levels a much bigger area up close while the
 *  outer shockwave (below) — the *total* radius — is left unchanged. Still clearly
 *  inside DYNAMITE_WAVE_REACH, so a weak-shockwave ring remains beyond the crater. */
const DYNAMITE_CORE_REACH = 24;
/** Core destructive power — high enough to level any ordinary matter within the
 *  core (matches blast.ts's DEFAULT_DESTRUCTIVE_POWER), forced explicitly so the
 *  core stays strong even if the stick happens to detonate on an explosive. */
const DYNAMITE_CORE_POWER = 100_000;
/** Shockwave reach — a wide ring (넓은 반경) that shoves sand/water/objects outward.
 *  This is the dynamite's *total* blast radius and is deliberately unchanged (폭발
 *  반경 유지); only the strong core inside it was widened. */
const DYNAMITE_WAVE_REACH = 36;
/** Shockwave power — Gunpowder-weak (파괴력 6): heaves loose matter aside but can't
 *  crater tough solids, which shadow it (충격파 = Gunpowder 같은 약한 폭발). */
const DYNAMITE_WAVE_POWER = 6;

// Fuse-tip interactions with the cell it touches.
/** Cell temperature (°) at/below which the surroundings snuff the fuse even
 *  without a named extinguisher — a cryogenic pocket (an LN₂ pool, dry-ice fog).
 *  Well below Water's ambient 20°, so plain water never puts the fuse out. */
const FUSE_SNUFF_TEMP = -20;
/** Hot floor (°) the flame holds the liquid it touches at, just past Water's 100°
 *  boil so a submerged fuse gently steams its immediate surroundings (살짝 끓게).
 *  Held as a *floor* (not a one-shot nudge) each tick so it survives the heat-
 *  diffusion pass bleeding it into the surrounding cold liquid — otherwise a lone
 *  warmed cell averages back below boiling before it can steam. Applied to the tip
 *  cell and its four orthogonal neighbours; the cluster's centre keeps its heat
 *  (its neighbours are heated too) and boils, while the arms shed theirs, so the
 *  boil stays a small wisp. Well under the stick's 1100° autoignition (and the tip
 *  sits cells away from the body's footprint), so it never cooks the stick itself. */
const FUSE_BOIL_FLOOR = 130;

/** Build a lit stick of dynamite centered at (x,y), spawned bolt-upright (수직) but
 *  with a weak random spin kicked in a random left/right direction (see
 *  DYNAMITE_SPAWN_SPIN) so it topples to one side instead of balancing on its cap,
 *  and a random fuse length in [MIN, MAX] ticks (기획: 3~5초 랜덤). Mass and moment of
 *  inertia follow the same capsule formulas as the drum. */
export function createDynamite(
  x: number,
  y: number,
  radius = DYNAMITE_RADIUS,
  halfLength = DYNAMITE_HALF_LENGTH,
): SimDynamite {
  const r = radius > 1 ? radius : 1;
  const l = halfLength > 0 ? halfLength : 0;
  const area = 4 * r * l + Math.PI * r * r;
  const mass = DYNAMITE_DENSITY * area;
  const w = 2 * r;
  const h = 2 * (l + r);
  const momentOfInertia = (mass * (w * w + h * h)) / 12;
  const span = DYNAMITE_FUSE_MAX_TICKS - DYNAMITE_FUSE_MIN_TICKS;
  const fuseTicks = DYNAMITE_FUSE_MIN_TICKS + Math.floor(Math.random() * (span + 1));
  return {
    kind: 'dynamite',
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: (Math.random() * 2 - 1) * DYNAMITE_SPAWN_SPIN,
    halfLength: l,
    radius: r,
    mass,
    momentOfInertia,
    restitution: DYNAMITE_RESTITUTION,
    heatTicks: 0,
    temp: AMBIENT_TEMP,
    lit: true,
    fuseTicks,
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
  // A Spark is a Phase.Solid material only so it sits still on a wire for its one
  // tick of life — it is not a real surface. Objects pass straight through it
  // (오브젝트가 spark 파티클과 물리적으로 상호작용하지 않게: 통과) instead of
  // bouncing off a flickering electric dot as it races along a conductor.
  if (id === SPARK.id) return false;
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
function capsuleAxis(o: CapsuleBody): [number, number] {
  return [Math.sin(o.angle), Math.cos(o.angle)];
}

/** The two segment endpoints A,B = center ∓ halfLength · axis. `scale` (default 1)
 *  optionally lengthens the segment about its center — used by spawnFillSpill to
 *  widen the flood zone past the drum's real shell without a second copy of the
 *  axis math. */
function capsuleEnds(o: CapsuleBody, scale = 1): [number, number, number, number] {
  const [ux, uy] = capsuleAxis(o);
  const h = o.halfLength * scale;
  const hx = h * ux;
  const hy = h * uy;
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
function deepestCapsuleContact(o: CapsuleBody, ctx: SimContext): CapsuleContact | null {
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
function resolveCapsuleCollision(o: CapsuleBody, ctx: SimContext): boolean {
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
function sampleMediumCapsule(o: CapsuleBody, ctx: SimContext): {
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
 * cleared cells become short-lived BLAST cells → instant destruction), a Heat Ray
 * beam cell overlapping it (the searing critical-mass beam — see heatray.ts —
 * which destroys everything it strikes on the CA grid and is no gentler on a
 * free-floating object it grazes: instant destruction, same as a direct blast),
 * the hottest footprint temperature (heat exposure, judged over time by the
 * caller), and the *fraction of the footprint buried in solid* (a wedged/entombed
 * body is crushed). Works for balls and drums alike via the segment+radius
 * footprint.
 */
function scanBodyExposure(
  o: SimBody,
  ctx: SimContext,
): { blast: boolean; heatRay: boolean; maxTemp: number; solidFrac: number } {
  const r = bodyRadius(o);
  const r2 = r * r;
  const [ax, ay, bx, by] = bodyEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  let blast = false;
  let heatRay = false;
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
      const id = ctx.get(cx, cy);
      const m = id === EMPTY ? null : getMaterial(id);
      // Crush counts only *true* solid — a real Solid-phase material or the world
      // Wall, NOT a merely-frozen liquid (끼임 파괴 로직은 고체에만 적용). Collision
      // (isSolidCell) treats a frozen puddle as solid footing, but a body sitting
      // in icy slush at/below its freeze point isn't entombed the way one poured
      // full of Stone is, so it must never read as crushed for it.
      if (m !== null && (m.isWall === true || m.phase === Phase.Solid)) solid++;
      if (id === BLAST.id) blast = true;
      else if (id === HEAT_RAY.id) heatRay = true;
      // Materials whose `temp` holds packed non-thermal bookkeeping (a flying
      // Ember/Debris fragment, a Blast flash's own life counter, …) must not be
      // read as a real degree reading here — a water splash's Debris droplets
      // passing through a floating ball's footprint carry garbage "temperatures"
      // in the tens of thousands that would otherwise instantly "burn" it away
      // (물에 빠지면 공이 사라지는 문제). Skip them; a cell holding only such
      // material contributes nothing to maxTemp, same as an empty footprint cell —
      // so a footprint that is ALL packed cells yields maxTemp −Infinity, which
      // evaluateTriggers already handles like an out-of-world body (freeze the
      // reservoir, no conduction).
      if (m !== null && m.packedTemp) continue;
      const t = ctx.getTemp(cx, cy);
      if (t > maxTemp) maxTemp = t;
    }
  }
  return { blast, heatRay, maxTemp, solidFrac: footprint > 0 ? solid / footprint : 0 };
}

/** Per-cell chance a shattered drum flings a Metal Powder fragment from that
 *  footprint cell. Sparse like the hollow shell's melt puddle (0.3) — a thin
 *  shell, not a solid block — but applied across the whole footprint (~160 cells)
 *  it yields a clearly visible heap of steel grains instead of a few stray specks
 *  (the old 5-point medial scatter left only 1–4 grains, easy to mistake for
 *  nothing). Melt still leaves Molten Metal; only the shatter's yield changed. */
const DRUM_DEBRIS_CHANCE = 0.2;

/**
 * Destroyed by a blast/crush: the shell is torn apart, so fling Metal Powder
 * fragments (reusing debris.ts's scatter) from across the drum's whole footprint,
 * arcing up and raining back down as a visible heap of steel grains rather than
 * the drum vanishing. Metal Powder (metalpowder.ts) — NOT solid Iron — is the
 * destroyed form: an explosion shatters the metal into dust, and the powder still
 * melts back to Molten Metal if it later lands in heat. Being a hollow shell only
 * a fraction of the footprint becomes powder (DRUM_DEBRIS_CHANCE); solid cells are
 * skipped (the object layer is read-only over terrain). The fill spill, if any,
 * is spawned separately (see spawnFillSpill).
 */
function spawnDrumDebris(o: SimCapsule, ctx: SimContext): void {
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
      // Don't fling from (and thereby overwrite) a solid cell — the object layer
      // is read-only over terrain, spawning only into air/loose matter.
      if (isSolidCell(cx, cy, ctx)) continue;
      if (!ctx.chance(DRUM_DEBRIS_CHANCE)) continue;
      // Spray outward from the drum's center (left cells fly left, right fly right).
      launchDebris(ctx, cx, cy, METAL_POWDER.id, cx + 0.5 < o.x ? -1 : 1, -1, 2);
    }
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

/** Per-cell chance a filled drum floods a footprint cell with its contents. Far
 *  denser than the hollow shell's sparse metal (0.3): a full drum is brim-full of
 *  liquid, so it gushes a proper puddle (쏟아짐), not a scatter. */
const FILL_SPILL_CHANCE = 0.7;

/** Radius/half-length scale applied only to the flooded area (spawnFillSpill),
 *  not to the drum's own physical shell — a real 55-gallon drum holds far more
 *  liquid than its own silhouette can display a cell of, so a full drum gushes
 *  past where it stood rather than being capped by its own footprint. Area scales
 *  with the square of a uniform linear scale (4rl + πr²), so √2 doubles the
 *  flooded area and, at the same FILL_SPILL_CHANCE, doubles the expected liquid
 *  spilled (내용물이 있는 원유/산 양 두배 증가) versus flooding just the shell. */
const FILL_SPILL_AREA_SCALE = Math.SQRT2;

/** The liquid a filled drum pours out when destroyed, or null for an empty drum
 *  (which spills nothing). 원유 드럼통 → Crude Oil, 산 드럼통 → Acid. */
function fillSpillId(fill: DrumFill): number | null {
  if (fill === 'oil') return OIL.id;
  if (fill === 'acid') return ACID.id;
  return null;
}

/**
 * Spill a filled drum's liquid contents across its footprint when it's destroyed
 * — the 기름/산 that pours out (쏟아짐). Floods the cells the drum occupied with
 * its fill liquid, but only over air/loose matter — never over solid terrain (the
 * object layer stays read-only over solids, same Phase.Solid guard as the
 * molten-metal puddle; a frozen liquid isn't treated as solid here).
 * The liquid is spawned at ambient temperature, so a spill into a hot zone (an
 * oil drum melted in lava) heats up and ignites/boils on its own the next few
 * ticks rather than vanishing on contact. An empty drum has no fill: no-op.
 */
function spawnFillSpill(o: SimCapsule, ctx: SimContext): void {
  const id = fillSpillId(o.fill);
  if (id === null) return;
  const r = o.radius * FILL_SPILL_AREA_SCALE;
  const r2 = r * r;
  // Scaled capsule ends (capsuleEnds with a >1 scale) — only the flood zone widens,
  // never the drum's real collision shell.
  const [ax, ay, bx, by] = capsuleEnds(o, FILL_SPILL_AREA_SCALE);
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
      const cell = ctx.get(cx, cy);
      if (cell !== EMPTY && getMaterial(cell).phase === Phase.Solid) continue;
      if (!ctx.chance(FILL_SPILL_CHANCE)) continue;
      ctx.spawn(cx, cy, id);
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
function stepCapsule(o: CapsuleBody, ctx: SimContext, ax: number, ay: number, s: number): void {
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
// hard, a Woofer's shockwave shoves one too but never consumes it (see
// applyWooferKnockback — it has no grid cell to scan for, so it rides in on
// its own per-tick event queue instead), and a body entombed in solid is
// crushed. The pair solve is pure object↔object; the knockback and crush read
// the grid but never write it.

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

/** Cells beyond a body's own footprint a queued Woofer pulse can still reach to
 *  shove it (mirrors BLAST_KNOCK_RADIUS above, its own separate knob). */
const WOOFER_KNOCK_RADIUS = 12;
/** Peak outward speed a Woofer's shockwave imparts — gentler than a real
 *  blast's BLAST_KNOCK_SPEED, since it's a gadget's thump, never a warhead. */
const WOOFER_KNOCK_SPEED = 6;
/** Spin a Woofer's pulse kicks into a drum as it's shoved (mirrors BLAST_KNOCK_SPIN). */
const WOOFER_KNOCK_SPIN = 0.1;

/** How far past its own footprint a Fan's gust still reaches (mirrors
 *  fan.ts's own REACH — kept as a separate constant rather than importing it,
 *  the same "own knob" reasoning as WOOFER_KNOCK_RADIUS above). */
const FAN_KNOCK_REACH = 26;
/** Half-width, in cells, of the gust's push zone right at the Fan's own face —
 *  it then widens with distance below (see FAN_KNOCK_CONE_SLOPE), mirroring
 *  the grid beam's own widening cone (fan.ts's CONE_WIDEN_EVERY). */
const FAN_KNOCK_HALF_WIDTH = 1.2;
/** How many extra cells of half-width the gust gains per cell traveled —
 *  1/fan.ts's CONE_WIDEN_EVERY, so an object floating downrange is caught by
 *  the same widening cone the grid's own loose matter is. */
const FAN_KNOCK_CONE_SLOPE = 1 / 3;
/** Floor speed a gust holds a body to along the wind direction — gentle, a
 *  steady breeze rather than a shove (contrast BLAST/WOOFER's harder kicks). */
const FAN_KNOCK_SPEED = 3;

/** Footprint-solid fraction at/above which a body is judged crushed (entombed in
 *  or pinched by solid it can't be pushed out of) and destroyed. Above ½ so
 *  ordinary ground contact — a thin slice of the footprint — never triggers it.
 *  Evaluated after the post-collision grid re-resolve (phase B.5) frees any
 *  transient shove-into-terrain, so only a genuinely stuck body reaches it. */
const CRUSH_SOLID_FRAC = 0.6;

/** Per-tick fraction a body's heat reservoir (SimBody.temp) moves toward its
 *  surrounding footprint temperature — Newtonian conduction between the object
 *  and the medium it sits in. Small, so brush-applied heat/cool lingers a couple
 *  of seconds and a body carries heat briefly after leaving a fire, rather than
 *  snapping to ambient in one tick. Feel knob. */
const OBJECT_HEAT_CONDUCTION = 0.08;

/**
 * Scan the body's footprint once for the three instant-destruction contacts
 * captured at the tick's *start* (before knockback can move the body clear of the
 * check): a shockwave Blast flash cell overlapping it (직격 — an explosion swept
 * over it), a Heat Ray beam cell overlapping it (직격 — the beam grazed it; see
 * scanBodyExposure for why this is instant rather than judged by heat-over-time),
 * and an Antimatter grain touching it (접촉). Reports which were found.
 *
 * Antimatter is *consumed* on contact — each touching grain is annihilated to
 * EMPTY (a body is far bigger than one grain, so contact destroys the whole body
 * while every touched grain dies with it, instead of antimatter.ts's one-for-one
 * swap; Antimatter 접촉시 모든 오브젝트 파괴, no object is antimatter-proof). So this
 * scan mutates the grid, unconditionally over the whole footprint — a body that a
 * Blast/Heat Ray also dooms this tick still annihilates its touching grains.
 * Blast and Heat Ray cells are left alone (they expire on their own). One shared
 * footprint pass rather than separate ones so the bounding-box / culling geometry
 * can't drift between them.
 */
function footprintHazards(
  o: SimBody,
  ctx: SimContext,
): { blast: boolean; heatRay: boolean; antimatter: boolean } {
  const r = bodyRadius(o);
  const r2 = r * r;
  const [ax, ay, bx, by] = bodyEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  let blast = false;
  let heatRay = false;
  let antimatter = false;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      const id = ctx.get(cx, cy);
      if (id !== BLAST.id && id !== HEAT_RAY.id && id !== ANTIMATTER.id) continue;
      const [spx, spy] = closestOnSegment(ax, ay, bx, by, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      if (id === BLAST.id) {
        blast = true;
      } else if (id === HEAT_RAY.id) {
        heatRay = true;
      } else {
        antimatter = true;
        ctx.set(cx, cy, EMPTY); // grain consumed in the annihilation
      }
    }
  }
  return { blast, heatRay, antimatter };
}

/**
 * Does a Void cell lie against this body? Void (materials/void.ts) is a bottomless
 * sink; any object that reaches it is deleted OUTRIGHT — with no byproduct (no
 * debris, spill, molten puddle, or blast), a clean 완전 삭제 that is deliberately NOT
 * a 파괴/용해 trigger. Applies to every body kind. The +1-cell margin catches the Void
 * a body comes to rest *against*: Void is a solid, so grid collision stops the body
 * just shy of overlapping it, which a footprint-only scan (like the blast test
 * above) would miss. Read-only.
 */
function footprintTouchesVoid(o: SimBody, ctx: SimContext): boolean {
  const r = bodyRadius(o) + 1;
  const r2 = r * r;
  const [ax, ay, bx, by] = bodyEnds(o);
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      if (ctx.get(cx, cy) !== VOID.id) continue;
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
  // Any capsule body (drum or dynamite) spins; a ball has no rotation.
  if (o.kind !== 'ball') o.angularVelocity += BLAST_KNOCK_SPIN * Math.sign(nx);
}

/**
 * Push a body away from every Woofer pulse queued this tick (see
 * `SimContext.wooferPulseX/Y`, populated by materials/woofer.ts's
 * `wooferBodyPulse`) — the same inverse-square-weighted-direction +
 * speed-floor shape as `applyBlastKnockback` above, but sourced from an
 * explicit event queue instead of scanning the grid for BLAST cells. Woofer's
 * shockwave never leaves a BLAST cell behind at all (see woofer.ts): reusing
 * that material's id here would make every OTHER material that treats "an
 * adjacent BLAST cell" as a detonation trigger (Gunpowder, TNT, Nitro, C4, …)
 * misfire next to what's supposed to be a completely non-destructive gadget.
 *
 * Unlike `applyBlastKnockback`, this never destroys a body — Woofer's whole
 * identity is 완전한 비파괴성 (completely non-destructive), so however close a
 * body sits to the source it can only ever be shoved, never popped/melted/
 * shattered by this. (A body can still end its life the ordinary way via
 * `evaluateTriggers`'s heat/crush checks — those are unrelated to this push.)
 */
function applyWooferKnockback(o: SimBody, ctx: SimContext): void {
  const xs = ctx.wooferPulseX;
  if (xs.length === 0) return;
  const ys = ctx.wooferPulseY;
  const reach = bodyReach(o) + WOOFER_KNOCK_RADIUS;
  const reach2 = reach * reach;
  let px = 0;
  let py = 0;
  let found = false;
  for (let i = 0; i < xs.length; i++) {
    const dx = o.x - (xs[i] + 0.5);
    const dy = o.y - (ys[i] + 0.5);
    const d2 = dx * dx + dy * dy;
    if (d2 > reach2 || d2 < 1e-6) continue;
    const inv2 = 1 / d2;
    px += dx * inv2;
    py += dy * inv2;
    found = true;
  }
  if (!found) return;
  const plen = Math.hypot(px, py);
  if (plen < 1e-6) return;
  const nx = px / plen;
  const ny = py / plen;
  const outward = o.vx * nx + o.vy * ny;
  if (outward < WOOFER_KNOCK_SPEED) {
    const add = WOOFER_KNOCK_SPEED - outward;
    o.vx += nx * add;
    o.vy += ny * add;
  }
  if (o.kind !== 'ball') o.angularVelocity += WOOFER_KNOCK_SPIN * Math.sign(nx);
}

/**
 * Push a body along every Fan gust queued this tick (see
 * `SimContext.fanPulseX/Y/DirX/DirY`, populated by materials/fan.ts's
 * `fanBodyPulse`). Unlike the radial Blast/Woofer knockbacks above, a gust is
 * a directional *beam*: a body counts as caught by it only while it sits
 * within `FAN_KNOCK_REACH` cells ahead of the firing cell along the wind axis
 * AND within `FAN_KNOCK_HALF_WIDTH` cells to either side of that axis: outside
 * that beam a body feels nothing, exactly like the grid's own loose matter
 * (see fan.ts's `fanPulse`) which the beam also only ever touches in a
 * straight line ahead of the Fan face. A body can be caught by several firing
 * cells in one tick (a wide fan bank); each is applied independently with the
 * same floor-speed shape the other knockbacks use, so overlapping gusts don't
 * stack into something faster than any one of them intends. Never destroys a
 * body — Wind has no destructive power at all, only a gentle steady push.
 */
function applyFanKnockback(o: SimBody, ctx: SimContext): void {
  const xs = ctx.fanPulseX;
  if (xs.length === 0) return;
  const ys = ctx.fanPulseY;
  const dxs = ctx.fanPulseDirX;
  const dys = ctx.fanPulseDirY;
  // Inflate both the along- and perp-axis bounds by the body's own reach (its
  // full center-to-tip extent), the same fudge `bodyReach(o)` gives the radial
  // Blast/Woofer knockbacks above — a capsule can overlap the beam through its
  // length even while its *center* sits just outside it (short on the near/far
  // edge, or lying broadside across the beam), and `bodyRadius` alone (just the
  // cap) undercounts that for a drum/dynamite lying across the wind.
  const reach = bodyReach(o);
  for (let i = 0; i < xs.length; i++) {
    const dx = dxs[i];
    const dy = dys[i];
    const relX = o.x - (xs[i] + 0.5);
    const relY = o.y - (ys[i] + 0.5);
    const along = relX * dx + relY * dy; // distance ahead of the Fan face, along the gust
    if (along < -reach || along > FAN_KNOCK_REACH + reach) continue;
    const perp = relX * -dy + relY * dx; // signed distance off the gust's own axis
    // The cone widens with distance (clamp `along` to 0 first so a body
    // slightly behind the face, `along` inflated negative by `reach`, doesn't
    // get a *narrower* zero-or-negative allowance).
    const halfWidth = FAN_KNOCK_HALF_WIDTH + reach + Math.max(0, along) * FAN_KNOCK_CONE_SLOPE;
    if (Math.abs(perp) > halfWidth) continue;
    const outward = o.vx * dx + o.vy * dy;
    if (outward < FAN_KNOCK_SPEED) {
      const add = FAN_KNOCK_SPEED - outward;
      o.vx += dx * add;
      o.vy += dy * add;
    }
  }
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
  // Any capsule body (drum or dynamite) carries spin; a ball's ω is always 0.
  const wA = a.kind !== 'ball' ? a.angularVelocity : 0;
  const wB = b.kind !== 'ball' ? b.angularVelocity : 0;
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
  if (a.kind !== 'ball') a.angularVelocity -= iIA * (rax * (jn * ny) - ray * (jn * nx));
  if (b.kind !== 'ball') b.angularVelocity += iIB * (rbx * (jn * ny) - rby * (jn * nx));
  // Friction along the tangent, Coulomb-clamped to μ·jn, from the post-normal
  // relative velocity — the torque source that lets one body spin another.
  const tx = -ny;
  const ty = nx;
  const wA2 = a.kind !== 'ball' ? a.angularVelocity : 0;
  const wB2 = b.kind !== 'ball' ? b.angularVelocity : 0;
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
  if (a.kind !== 'ball') a.angularVelocity -= iIA * (rax * (jt * ty) - ray * (jt * tx));
  if (b.kind !== 'ball') b.angularVelocity += iIB * (rbx * (jt * ty) - rby * (jt * tx));
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
/**
 * Detonate a stick of dynamite at its current cell — the two-zone blast (기획): a
 * strong, tight *core* that craters everything close (강한 폭발 / 작은 반경), fired
 * first, then a weak, wide *shockwave* (충격파) that only shoves loose matter
 * (sand/water/objects) radially outward and is shadowed by solids it can't crack
 * (넓은 반경 / Gunpowder 같은 약한 폭발). Both reaches pass through blast.ts's global
 * 2/3 scale. The power overrides keep the core strong and the wave weak regardless
 * of what the stick sits on (so detonating on a charge pile can't weaken the core).
 * A stick drifted out of a `void` world just vanishes with no blast.
 */
function detonateDynamite(o: SimDynamite, ctx: SimContext): void {
  const cx = Math.floor(o.x);
  const cy = Math.floor(o.y);
  if (!ctx.inBounds(cx, cy)) return;
  detonate(ctx, cx, cy, 0, {
    reach: DYNAMITE_CORE_REACH,
    power: DYNAMITE_CORE_POWER,
    pressure: false, // the wide wave below is this blast's concussion
  });
  detonate(ctx, cx, cy, 0, {
    reach: DYNAMITE_WAVE_REACH,
    power: DYNAMITE_WAVE_POWER,
    pressure: false,
  });
}

/** Does the material/temperature at the fuse tip snuff a burning fuse? A stronger
 *  extinguisher (CO₂, Liquid N₂), a cryogenic pocket (an LN₂ pool, dry-ice fog),
 *  or being buried under an *inert* non-flammable powder puts it out; ordinary
 *  water does NOT (warm, and not a listed extinguisher) — the flame heats it
 *  instead (see heatFuseLiquid). Explosive powders (Gunpowder, Ammonium Nitrate,
 *  Sodium) do NOT smother it — a fuse buried in them should burn down and set the
 *  pile off (chain), not fizzle. */
function fuseSnuffed(id: number, temp: number): boolean {
  if (id === CO2.id || id === LIQUID_NITROGEN.id) return true;
  if (temp <= FUSE_SNUFF_TEMP) return true;
  if (id !== EMPTY) {
    const m = getMaterial(id);
    if (m.phase === Phase.Powder && m.combustible !== true && m.explosive !== true) return true;
  }
  return false;
}

/** Hold one cell of liquid at the boiling-hot fuse floor — the heat the flame
 *  gives off into the liquid it touches (살짝 끓게). No-op off a non-frozen liquid,
 *  and never cools a cell that's already hotter (max, not set). */
function heatFuseLiquid(ctx: SimContext, x: number, y: number): void {
  if (!ctx.inBounds(x, y)) return;
  const id = ctx.get(x, y);
  if (id === EMPTY) return;
  if (getMaterial(id).phase !== Phase.Liquid || ctx.isFrozen(x, y)) return;
  if (ctx.getTemp(x, y) < FUSE_BOIL_FLOOR) ctx.setTemp(x, y, FUSE_BOIL_FLOOR);
}

/**
 * Per-tick fuse + heat evaluation for a dynamite stick, after this tick's heat
 * conduction (called from evaluateTriggers with the resolved `heat`). Order:
 *   1. External heat cooks it off (autoignition), time-gated so only sustained
 *      fire/lava/brush heat — not a stray hot pixel — sets it off; fires even for
 *      a snuffed dud.
 *   2. The tip meets the cell it touches: a stronger extinguisher or a smothering
 *      inert powder snuffs the fuse to a dud (PAUSES the countdown); a flame/heat
 *      touched to a snuffed fuse re-lights it (RESUMES, no reset). While lit it
 *      throws a real Fire particle in open air, or — submerged — heats/boils the
 *      liquid a little (an ordinary liquid never puts it out).
 *   3. The lit fuse burns down; at zero the stick detonates.
 * Returns true to keep the stick, false once it has detonated.
 */
function stepDynamite(o: SimDynamite, ctx: SimContext, heat: number): boolean {
  if (heat >= DYNAMITE_AUTOIGNITE_TEMP) {
    o.heatTicks++;
    if (o.heatTicks >= DYNAMITE_HEAT_TICKS) {
      detonateDynamite(o, ctx);
      return false;
    }
  } else if (o.heatTicks > 0) {
    o.heatTicks--;
  }
  // The flame sits just past the top cap along the stick's long axis (which
  // rotates as the stick tumbles), so it tracks the fuse end at any orientation.
  const [ux, uy] = capsuleAxis(o);
  const reach = o.halfLength + o.radius + 0.5;
  const tcx = Math.floor(o.x - ux * reach);
  const tcy = Math.floor(o.y - uy * reach);
  if (ctx.inBounds(tcx, tcy)) {
    const tipId = ctx.get(tcx, tcy);
    const tipTemp = ctx.getTemp(tcx, tcy);
    if (fuseSnuffed(tipId, tipTemp)) {
      o.lit = false; // a dud — countdown PAUSED (fuseTicks kept); heat can still cook it off
    } else if (!o.lit && tipTemp >= FUSE_RELIGHT_TEMP) {
      // A flame/ember/hot surface touched to the fuse re-lights a dud, and the
      // countdown resumes from where it paused (not reset — 재개, 초기화 아님).
      o.lit = true;
    }
    if (o.lit) {
      if (tipId === EMPTY) {
        // In open air the lit fuse throws a real Fire particle (not a painted-on
        // flame): it flickers, rises, and can ignite whatever the fuse leads to —
        // a Gunpowder trail, a charge, a puddle of fuel. The tip sits cells beyond
        // the body's footprint and the fire rises away from it, so the stick's own
        // fuse doesn't cook it off early (the countdown stays the authority).
        ctx.spawn(tcx, tcy, FIRE.id);
      } else if (getMaterial(tipId).phase === Phase.Liquid && !ctx.isFrozen(tcx, tcy)) {
        // Submerged/wet: the flame doesn't die — instead it heats the liquid it
        // touches, boiling the tip cell and its neighbours a little (살짝 끓게). A
        // real Fire particle can't live underwater, so this is the "flame" there.
        heatFuseLiquid(ctx, tcx, tcy);
        heatFuseLiquid(ctx, tcx + 1, tcy);
        heatFuseLiquid(ctx, tcx - 1, tcy);
        heatFuseLiquid(ctx, tcx, tcy + 1);
        heatFuseLiquid(ctx, tcx, tcy - 1);
      }
    }
  }
  if (o.lit && --o.fuseTicks <= 0) {
    detonateDynamite(o, ctx);
    return false;
  }
  return true;
}

/** The byproduct of a body destroyed by blast or crush: a drum shatters into
 *  scattered Metal Powder and, if it was carrying anything, gushes its contents
 *  (원유/산) across the wreckage; a stick of dynamite detonates (a knock or a
 *  passing blast sets it off — chain reactions); a rubber ball leaves nothing. */
function destroyByproduct(o: SimBody, ctx: SimContext): void {
  if (o.kind === 'drum') {
    spawnFillSpill(o, ctx); // pour contents first; the shell fragments then launch
    spawnDrumDebris(o, ctx); // out through the spill (each from its own footprint cell)
    o.state = 'destroyed';
  } else if (o.kind === 'dynamite') {
    detonateDynamite(o, ctx);
  }
}

function evaluateTriggers(o: SimBody, ctx: SimContext): boolean {
  // Void (특수 물질) swallows any body whole: deleted with NO byproduct — not a
  // 파괴/용해 judgement. Checked before every other trigger so a stick doesn't
  // explode (nor a drum shatter/spill) as it's drawn into the sink.
  if (footprintTouchesVoid(o, ctx)) return false;
  const exp = scanBodyExposure(o, ctx);
  // Instant destruction: a blast flash or a Heat Ray beam overlapping the
  // footprint (직격 — the ray destroys everything it touches on the CA grid, and
  // an object it grazes is no exception), or being wedged/entombed in solid it
  // can't escape (끼임). A genuine burial is measured *after* the post-collision
  // grid re-resolve (phase B.5) has popped out any transient collision shove into
  // terrain, so only a body with no open face to exit through — truly stuck —
  // reads as crushed; a momentarily-overlapping one is freed first. Blast/Heat Ray
  // are secondary to the phase-A doomed capture (covers a body knocked into a
  // lingering flash or into the beam's path).
  if (exp.blast || exp.heatRay || exp.solidFrac >= CRUSH_SOLID_FRAC) {
    destroyByproduct(o, ctx);
    return false; // ball: no byproduct
  }
  // The body's own heat reservoir relaxes toward its surroundings each tick
  // (Newtonian conduction): a body in a hot medium warms up, one in cool air (or
  // cooled by the 냉각 brush) sheds heat back toward ambient — so brush-applied
  // heat/cool fades naturally and a hot body pulled from a fire keeps melting only
  // briefly. `maxTemp` is -Infinity only when the footprint has NO in-bounds cell
  // — a body that has drifted fully out of a `void` border — in which case we
  // freeze the reservoir (skip conduction) rather than let it decay to −Infinity
  // (then NaN the next such tick), which would permanently break the max() heat
  // test if the body re-entered the world.
  if (Number.isFinite(exp.maxTemp)) {
    o.temp += (exp.maxTemp - o.temp) * OBJECT_HEAT_CONDUCTION;
  }
  // Judge heat by the hotter of the surroundings and the body's own reservoir:
  // ambient heat (lava/fire under the footprint) still triggers instantly as
  // before — no regression — while the 가열 brush, which writes only `temp`, can
  // now melt/burn a body floating over empty air the cell heat brush can't warm.
  // (An out-of-world body has maxTemp −Inf, so this picks its finite reservoir.)
  const heat = exp.maxTemp > o.temp ? exp.maxTemp : o.temp;
  // A dynamite stick has its own terminal logic (fuse countdown + heat cook-off +
  // tip interactions); it never melts or burns away like a drum/ball.
  if (o.kind === 'dynamite') return stepDynamite(o, ctx, heat);
  // Sustained heat: drum melts to Molten Metal, ball burns away to nothing.
  const threshold = o.kind === 'drum' ? DRUM_MELT_TEMP : BALL_BURN_TEMP;
  const ticksNeeded = o.kind === 'drum' ? DRUM_MELT_TICKS : BALL_BURN_TICKS;
  if (heat >= threshold) {
    o.heatTicks++;
    if (o.heatTicks >= ticksNeeded) {
      if (o.kind === 'drum') {
        spawnFillSpill(o, ctx); // contents pour out, then the shell melts over them
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
 * — a near-miss blast (or a Woofer's shockwave, or a Fan's gust — see
 * applyWooferKnockback/applyFanKnockback) shoves it, then gravity/buoyancy/
 * grid-collision integration — skipped while the
 * pointer holds it; (B) resolve collisions *between* bodies so
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
  // Direct blast/Heat Ray hits are captured at the tick's *start* position: a body
  // engulfed by an explosion or grazed by the beam is destroyed even though the
  // same blast's knockback is about to fling it clear of the destroy check. (A
  // near-miss blast has no footprint overlap here, so it falls through to the
  // knockback shove instead; the beam has no knockback to fall through to.)
  const doomed = new Set<SimBody>();
  // Phase A — each body's own physics (a held body follows the cursor instead).
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.held) continue;
    // One footprint pass captures a direct Blast/Heat Ray hit and consumes any
    // touching Antimatter grain; any of the three dooms the body this tick (see
    // footprintHazards).
    const hz = footprintHazards(o, ctx);
    if (hz.blast || hz.heatRay || hz.antimatter) {
      doomed.add(o); // destroyed below; don't bother moving it
      continue;
    }
    applyBlastKnockback(o, ctx);
    applyWooferKnockback(o, ctx);
    applyFanKnockback(o, ctx);
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
      // A blast or Heat Ray reached it this tick — spawn its byproduct, UNLESS
      // it's also being swallowed by Void, which deletes it cleanly (no
      // byproduct) and wins.
      if (!footprintTouchesVoid(o, ctx)) destroyByproduct(o, ctx);
    } else if (evaluateTriggers(o, ctx)) {
      objects[w++] = o;
    }
  }
  objects.length = w;
}
