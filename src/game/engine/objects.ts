import type { SimContext } from './SimContext';
import { EMPTY, Phase } from './types';
import { AMBIENT_TEMP, SIM_HZ_AT_1X } from '../config';
import { getMaterial } from '../materials/registry';
import { launchDebris } from '../materials/debris';
import { BLAST, detonate } from '../materials/blast';
import { MOLTEN_IRON } from '../materials/molteniron';
import { METAL_POWDER } from '../materials/metalpowder';
import { OIL } from '../materials/oil';
import { ACID } from '../materials/acid';
import { ANTIMATTER } from '../materials/antimatter';
import { NUCLEAR_RAY } from '../materials/nuclearray';
import { HEAT_RAY, absorbHeatRayCell } from '../materials/heatray';
import { SPARK } from '../materials/spark';
import { CO2 } from '../materials/co2';
import { LIQUID_NITROGEN } from '../materials/liquidnitrogen';
import { FIRE } from '../materials/fire';
import { SMOKE } from '../materials/smoke';
import { SAWDUST } from '../materials/sawdust';
import { ALCOHOL } from '../materials/alcohol';
import { BROKEN_GLASS } from '../materials/brokenglass';
import { FUEL_BURN_TEMP } from '../materials/combustion';
import { VOID } from '../materials/void';
import { WOOD_BOX_SPRITES } from '../render/woodenBoxSprite';
import { drumPieceSpriteFor } from '../render/drumSprite';
import { MOLOTOV_SPRITE_W, MOLOTOV_SPRITE_H } from '../render/molotovSprite';

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

/**
 * Which piece of a drum a body is. `drum` is the whole barrel — the only one the
 * palette can spawn — and the three `piece*` shards exist ONLY as the wreckage a
 * burst drum leaves (드럼통을 부술 때만 소환), exactly as the wooden crate's shards
 * do (see WoodBoxPart, which this mirrors deliberately: 드럼통 3종도 나무 상자처럼
 * 부서진다). Kept as a field rather than as separate `kind`s for the same reason
 * DrumFill is: every part runs one physics path, is steel to the electromagnet and
 * melts the same way; only its size, its sprite and what it leaves behind vary —
 * the barrel comes apart into the three shards, a shard shatters into Metal Powder.
 */
export type DrumPart = 'drum' | 'piece1' | 'piece2' | 'piece3';

/** Just the shards — the parts that only ever exist as wreckage. */
export type DrumPiecePart = Exclude<DrumPart, 'drum'>;

export interface SimCapsule {
  kind: 'drum';
  /** Whole barrel, or which shard of one (see DrumPart). */
  part: DrumPart;
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
  /** Half the straight segment between the two ends (cells), and the half-width
   *  of the barrel. Together they are the sprite's box — 2·radius wide by
   *  2·(halfLength+radius) tall — which is where `halfW`/`halfH` below come from
   *  and, through them, the rounded rectangle the drum collides as. A SHARD's
   *  halfLength is 0: its box comes from its own torn art instead. Neither field
   *  is read by the contact solve any more (see bodyCore); the renderer still
   *  draws the barrel from them. */
  halfLength: number;
  radius: number;
  /** Half-extents of the body's box (cells): the sprite is drawn into
   *  2·halfW × 2·halfH and rotated by `angle`, and — since a drum is a BOXY body
   *  (see bodyCore) — this is also the rectangle it collides as, rounded off by
   *  `cornerRadius`. The whole barrel's is simply its silhouette
   *  (radius × halfLength+radius); a shard's is its own art's pixel box, which
   *  (unlike the barrel's) is a genuine rectangle that differs per part. */
  halfW: number;
  halfH: number;
  /** Corner radius (cells) of the rounded rectangle the drum collides as — the
   *  amount its four corners are filed off (see boxCornerRadius). A barrel's flat
   *  lid and flat wall are what let other bodies be STACKED on it; the rounding is
   *  what keeps it from catching on grid seams and lets a shoved one tip. */
  cornerRadius: number;
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
   *  Does not affect physics; see DrumFill and spawnFillSpill. A shard inherits it
   *  from the barrel it came off for the sprite tint alone: the contents already
   *  poured out when the barrel burst, and spawnFillSpill never fires twice. */
  fill: DrumFill;
  /** Consecutive ticks the footprint has sampled above the melt threshold, so a
   *  brief brush with heat doesn't melt it — only sustained exposure does. */
  heatTicks: number;
  /** The drum's own heat reservoir (°) — see SimObject.temp. Lets the 가열/냉각
   *  brush melt a drum floating in air, and holds heat picked up from a hot
   *  surrounding so it keeps melting briefly after being pulled out. */
  temp: number;
  /** Ticks left of a fresh shard's blast grace — see DRUM_PIECE_BLAST_GRACE. 0 on
   *  a whole barrel, which has no such window. */
  blastGraceTicks: number;
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

/**
 * A smoke bomb — a capsule body (it shares the drum/dynamite segment+radius
 * physics and 1-axis rotation, so it tumbles and rolls) that is a *smoke source*
 * rather than an explosive. Thrown, it immediately starts trickling a wisp of
 * Smoke from around itself; four seconds later the canister lets go and pours out a
 * dense cloud for two and a half seconds, and then it is spent and gone (소환 시
 * 소량의 연기를 뿜다가 4초 후 대량의 연기를 2.5초간 발산 → 소멸).
 *
 * That's the whole lifecycle, and the two counters below are all the state it
 * takes: `fuseTicks` runs the quiet trickle down, then `ventTicks` runs the
 * discharge down, then the body is dropped. Nothing about it detonates — it
 * carries no blast at all, which is exactly what distinguishes it from the
 * dynamite it otherwise resembles structurally.
 */
export interface SimSmokeBomb {
  kind: 'smokebomb';
  /** Center position (float, grid coordinates). */
  x: number;
  y: number;
  /** Velocity (cells/tick). */
  vx: number;
  vy: number;
  /** Orientation of the long axis in radians (0 = upright, nozzle pointing up). */
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
  /** Coefficient of restitution (0..1) — a steel canister barely bounces. */
  restitution: number;
  /** Consecutive ticks the footprint has sampled above the cook-off threshold, so
   *  a stray hot pixel doesn't pop it early — only sustained heat does. */
  heatTicks: number;
  /** The canister's own heat reservoir (°) — see SimObject.temp. The 가열 brush
   *  writes it, so heating one (even in mid-air) sets the charge off early. */
  temp: number;
  /** Ticks left of the quiet trickle before the heavy discharge starts. Reaching
   *  0 — or a sustained bath of heat — opens the vent. */
  fuseTicks: number;
  /** Ticks left of the heavy discharge. 0 while still on the fuse; set the moment
   *  the vent opens, and the body is dropped when it runs back down to 0. */
  ventTicks: number;
  /** True while the pointer is dragging this body (see SimObject.held): its physics
   *  and its countdown alike are suspended so it tracks the cursor. */
  held?: boolean;
}

/**
 * Which piece of the wooden box a body is. `crate` is the whole box — the only
 * one the palette can spawn (나무 상자만 팔레트에서 소환 가능) — and the three
 * `piece*` shards exist ONLY as the wreckage a crate leaves when it is broken
 * (나무 상자를 부술 때만 소환). Kept as a field rather than as separate `kind`s for
 * the same reason DrumFill is: every part runs one physics path and one
 * flammability path, and only its size, its sprite and its destruction byproduct
 * vary — the crate falls apart into the three shards, a shard crumbles to Sawdust.
 */
export type WoodBoxPart = 'crate' | 'piece1' | 'piece2' | 'piece3';

/**
 * A wooden box — the crate, or one of the three shards it breaks into. Like the
 * drum, the dynamite and the smoke bomb it is a **body with 1-axis rotation**, so
 * contact torque (r × J) spins it: a crate shoved along the ground tips and
 * tumbles, one landing on a slope runs down it, a blast sends the shards spinning
 * off.
 *
 * It is a BOXY body (see bodyCore): the shape it collides with is its own
 * rectangle `halfW`×`halfH` with the corners filed off by `cornerRadius`, so all
 * four of its faces are genuinely FLAT. That is what lets crates be stacked —
 * one set on another rests on a flat face and stays there, rather than balancing
 * on the apex of the inscribed disc this used to collide as and sliding off. The
 * flat face also sits exactly flush on flat ground and flush against a wall.
 *
 * A box resting at an odd angle would poke its corners through the floor, which is
 * why a settled box is eased back upright (see settleBodyUpright) — it tumbles
 * freely while it's moving and squares up once it has stopped.
 *
 * `radius` survives as the half-width of the box's SHORTER side (the disc that
 * used to be the collision shape); the contact solve reads `halfW`/`halfH`/
 * `cornerRadius` instead.
 *
 * The genuinely new ingredient over the earlier bodies is that it *burns*
 * (가연성). Sustained heat sets it alight; while alight it emits real Fire
 * particles into the grid and `burnTicks` counts down to collapse; a good soaking
 * puts it out again.
 *
 * The one material that ends it without heat is Acid: timber has nothing to resist
 * it with, so a second of contact eats through the body (산에 닿으면 파괴 — see
 * `acidTicks` and WOOD_BOX_ACID_TICKS). No other body reacts to a puddle at all.
 */
export interface SimWoodBox {
  kind: 'woodbox';
  /** Whole crate, or which shard of one (see WoodBoxPart). */
  part: WoodBoxPart;
  /** Center position (float, grid coordinates). */
  x: number;
  y: number;
  /** Velocity (cells/tick). */
  vx: number;
  vy: number;
  /** Orientation in radians. 0 = upright, the way the sprite is drawn. */
  angle: number;
  /** Spin rate in radians/tick, integrated from contact torque (see SimCapsule). */
  angularVelocity: number;
  /** Always 0 — a box has no medial segment. Kept so the body is assignable to
   *  CapsuleBody and reuses the shared capsule routines. */
  halfLength: number;
  /** Half-width of the box's shorter side (cells) — the disc that used to be the
   *  collision shape. Not read by the contact solve; see bodyCore. */
  radius: number;
  /** Half-extents of the box (cells): the sprite is drawn into 2·halfW × 2·halfH
   *  and rotated by `angle`, and this same rectangle — rounded off by
   *  `cornerRadius` — is what the world collides with. */
  halfW: number;
  halfH: number;
  /** Corner radius (cells) of that rounded rectangle (see boxCornerRadius). */
  cornerRadius: number;
  /** Mass — buoyancy and collision response. */
  mass: number;
  /** Rotational inertia of the real rectangle (not of the collision disc), so a
   *  long shard is harder to spin end-over-end than a compact one. */
  momentOfInertia: number;
  /** Coefficient of restitution (0..1) — timber thuds, it doesn't bounce. */
  restitution: number;
  /** Consecutive ticks the body has sampled at/above its ignition point. Time-
   *  gated like every other body's heat trigger so a stray hot pixel doesn't set
   *  a crate alight — only a sustained flame does. Reset once it catches. */
  heatTicks: number;
  /** The body's own heat reservoir (°) — see SimObject.temp. The 가열 brush writes
   *  it, so a crate can be set alight in mid-air where the cell heat brush can't
   *  reach. */
  temp: number;
  /** Ticks of fire left before the body burns through and collapses. 0 means it
   *  isn't alight; set when it catches, cleared back to 0 if it's doused. */
  burnTicks: number;
  /** Consecutive ticks the body has been in contact with Acid (산에 닿으면 파괴).
   *  Its own counter rather than a share of `heatTicks`, because a crate can be
   *  standing in acid *and* heating toward its ignition point at the same time —
   *  see WOOD_BOX_ACID_TICKS. Bleeds back down once it's pulled out of the acid. */
  acidTicks: number;
  /** True while the pointer is dragging this body (see SimObject.held): its
   *  physics and its fire alike are suspended so it tracks the cursor. */
  held?: boolean;
}

/**
 * Which bottle a molotov is showing — and, in one field, how much of it is left.
 * `full` is the thrown firebomb (fuel behind the glass, cloth wick); `empty` is
 * what's left once the wick has burnt the fuel away (빈 유리병). Derived from
 * `fuelTicks` rather than stored (see molotovBottle), so the art can never
 * disagree with the state that decides what shatters out of it.
 */
export type MolotovBottle = 'full' | 'empty';

/**
 * A Molotov cocktail — a capsule body (it shares the drum/dynamite/smoke-bomb
 * segment+radius physics and 1-axis rotation, so it tumbles and rolls) that is
 * defined by being FRAGILE and by being ALIGHT. It is the first body meant to be
 * broken: where a wooden crate needs a genuine hurl to burst (WOOD_BOX_SMASH_SPEED
 * 9), a glass bottle gives way at a fraction of that (MOLOTOV_SMASH_SPEED), so
 * dropping one off a ledge is enough — which is the whole point of the object.
 *
 * What comes out is decided by two pieces of state and nothing else:
 *   - `lit` — the wick. It spawns burning, ANY real soaking puts it out (a pond
 *     will do it, unlike the dynamite's fuse, which water can't touch), and a
 *     flame touched to a doused-but-fuelled bottle lights it again.
 *   - `fuelTicks` — how much fuel is left. It only runs down while lit (a doused
 *     bottle keeps what it has, exactly like the dynamite's paused fuse), and at
 *     zero the bottle is a spent 빈 유리병: no wick, no fuel, nothing to light.
 *
 * Shattered, it drops Broken Glass either way, plus its Alcohol if it still had
 * any — burning if the wick was lit (see breakMolotov). It carries no blast at
 * all: everything it does to the world it does through the fuel it spills.
 */
export interface SimMolotov {
  kind: 'molotov';
  /** Center position (float, grid coordinates). */
  x: number;
  y: number;
  /** Velocity (cells/tick). */
  vx: number;
  vy: number;
  /** Orientation of the long axis in radians (0 = upright, wick pointing up). */
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
  /** Coefficient of restitution (0..1) — glass thuds; it also rarely survives to
   *  bounce twice. */
  restitution: number;
  /** Consecutive ticks the body has sampled at/above MOLOTOV_BURST_TEMP, so a
   *  stray hot pixel doesn't pop the bottle — only a sustained bath does. */
  heatTicks: number;
  /** The bottle's own heat reservoir (°) — see SimObject.temp. The 가열 brush and
   *  the Laser's heat ray write it, so either can re-light a doused wick or, held
   *  long enough, burst the bottle in mid-air. */
  temp: number;
  /** Whether the wick is burning. True from creation; a soaking puts it out, a
   *  flame lights it again, and it goes out for good when the fuel runs out. */
  lit: boolean;
  /** Ticks of fuel left (only counts down while `lit`, so a doused bottle keeps
   *  what it has). 0 = a spent 빈 유리병: it can't be lit and spills no Alcohol. */
  fuelTicks: number;
  /** True while the pointer is dragging this body (see SimObject.held): its physics
   *  and its wick alike are suspended so it tracks the cursor. */
  held?: boolean;
}

/** Anything in the object layer: circles (balls) and capsules (drums, dynamite,
 *  smoke bombs, wooden boxes, molotovs) share one array on the Grid, discriminated
 *  by `kind`. */
export type SimBody = SimObject | SimCapsule | SimDynamite | SimSmokeBomb | SimWoodBox | SimMolotov;

/**
 * The physics-only fields every rotating (non-ball) body shares, plus 1-axis
 * rotation. The collision / buoyancy / integration routines
 * (gridContacts, resolveCapsuleCollision, sampleMediumCapsule,
 * stepCapsule) operate through this structural type, so the drum, the dynamite,
 * the smoke bomb, the crate and the molotov all reuse them with no per-kind
 * branch — only the sprite and the destroy/trigger rules differ by kind.
 *
 * The shape those routines actually read is the body's CORE (see bodyCore), and
 * the last three fields are what pick it: a body carrying `halfW`/`halfH`/
 * `cornerRadius` is boxy (flat faces — the drums and the crate), one without them
 * falls back to the stadium its `halfLength`/`radius` describe (the dynamite, the
 * smoke bomb, the molotov). Structural, like the rest of this type: nothing here
 * branches on `kind`.
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
  halfW?: number;
  halfH?: number;
  cornerRadius?: number;
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
 * Shard melt point (°), and how long it has to be held there. Deliberately a
 * NOTCH above the whole barrel's 1200° rather than level with it, so the two
 * stages of a melt are distinguishable: whatever melts the barrel down into its
 * three shards very nearly always melts the shards too, and the shard stage is a
 * quick glowing beat on the way to the puddle (조각 단계를 빠르게 거치도록) — but a
 * heat source sitting in the 1200–1300° band (an oxygen-blown coal fire, the 가열
 * brush held just so) melts the barrel open and then leaves the wreckage lying
 * there, which is a more interesting outcome than one threshold could give. The
 * hold is much shorter than the barrel's 24 ticks for the same reason: a torn
 * scrap of shell gives way far faster than a sealed drum does.
 */
export const DRUM_PIECE_MELT_TEMP = 1300;
export const DRUM_PIECE_MELT_TICKS = 8;

/** Melt point (°) / sustained ticks for this part of a drum. */
function drumMeltTemp(part: DrumPart): number {
  return part === 'drum' ? DRUM_MELT_TEMP : DRUM_PIECE_MELT_TEMP;
}
function drumMeltTicks(part: DrumPart): number {
  return part === 'drum' ? DRUM_MELT_TICKS : DRUM_PIECE_MELT_TICKS;
}

/** Cells per shard-sprite pixel — the same 1:2 mapping the whole drum has (its
 *  24×32 sprite spans 12×16 cells at DRUM_RADIUS/DRUM_HALF_LENGTH), so the shards
 *  come out at exactly the size they were inside the barrel. A drum built at a
 *  non-default radius scales its shards by the same ratio (see createDrumPiece). */
export const DRUM_CELLS_PER_PX = 0.5;

/** Shard density. NOT the barrel's 1.6: that figure is the *effective* density of
 *  a sealed hollow drum, which is why an empty one floats. Burst it open and there
 *  is no trapped air left — a shard is a torn plate of steel, so it takes Metal
 *  Powder's density (7, materials/metalpowder.ts) and sinks like the scrap it is. */
export const DRUM_PIECE_DENSITY = 7;

/** Outward speed (cells/tick) the three shards are thrown at as the barrel comes
 *  apart, plus the lift that pops them out of the wreckage, plus the max magnitude
 *  (rad/tick) of the random spin each is kicked with. Applies to an IMPACT break
 *  only (see BreakCause) — a barrel that merely melted or was crushed drops its
 *  shards where it stood. A shade livelier than the crate's (1.4) since what threw
 *  these is always an explosion, never a fall. */
const DRUM_SHATTER_SPEED = 1.6;
const DRUM_SHATTER_LIFT = 0.6;
const DRUM_SHATTER_SPIN = 0.09;

/**
 * Ticks a freshly-made drum shard ignores Blast flash cells for.
 *
 * A shockwave flash lives 3–6 ticks (materials/blast.ts), and the shards of a
 * barrel it just opened are spawned right inside it. Without this window the
 * explosion would pulverize its own wreckage on the very next tick — measured:
 * the three shards lasted exactly one tick at every blast size — and a bombed drum
 * would go straight from barrel to Metal Powder without ever visibly coming apart,
 * which is the whole thing this is for. Long enough to outlast the flash that made
 * them (and for their outward throw to carry them clear of the crater), short
 * enough that a SECOND charge dropped on the wreckage still shatters it.
 *
 * Narrow on purpose: only the Blast flash is waved off. Being crushed, touched by
 * Antimatter, grazed by a Nuclear Ray, swallowed by Void or melted all still work
 * on a shard the tick it is born.
 *
 * The wooden crate has no such window — its shards ARE consumed by the blast that
 * burst them, which is the behaviour it shipped with. Giving the crate one is a
 * separate tuning call, deliberately not made here so this can't regress it.
 */
const DRUM_PIECE_BLAST_GRACE = 8;

/** Is this body waving off Blast flash cells right now (see DRUM_PIECE_BLAST_GRACE)?
 *  Only ever true for a drum shard in the first few ticks of its life. */
function blastImmune(o: SimBody): boolean {
  return o.kind === 'drum' && o.blastGraceTicks > 0;
}

/** The three shards a drum bursts into, in sprite draw order. */
const DRUM_PIECES: readonly DrumPiecePart[] = ['piece1', 'piece2', 'piece3'];

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
  // The barrel's box IS its silhouette — the sprite was authored at that aspect
  // (see render/drumSprite.ts) — and that box, corners filed off, is what it
  // collides as: a barrel has flat LIDS, so things stack on it (see bodyCore).
  const halfW = r;
  const halfH = l + r;
  const cornerRadius = boxCornerRadius(halfW, halfH);
  const mass = DRUM_DENSITY * roundedBoxArea(halfW - cornerRadius, halfH - cornerRadius, cornerRadius);
  const w = 2 * halfW;
  const h = 2 * halfH;
  const momentOfInertia = (mass * (w * w + h * h)) / 12;
  return {
    kind: 'drum',
    part: 'drum',
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    halfLength: l,
    radius: r,
    halfW,
    halfH,
    cornerRadius,
    mass,
    momentOfInertia,
    restitution: DRUM_RESTITUTION,
    state: 'intact',
    heatTicks: 0,
    temp: AMBIENT_TEMP,
    blastGraceTicks: 0, // a sealed barrel has no newborn-wreckage window
    fill,
  };
}

/**
 * Build one shard of a burst drum, centered at (x,y), at rest and upright. Only
 * breakDrum calls this — a shard is wreckage, never something the palette places.
 *
 * The geometry comes straight from that shard's art (render/drumSprite.ts
 * PIECE_ART), the wooden crate's rule rather than the barrel's: the sprite's pixel
 * box scaled into cells is BOTH the display box and — with the corners filed off
 * by `cornerRadius` — the shape the world collides with (see bodyCore), so the
 * picture and the physics can't drift apart. A torn scrap of plate therefore lies
 * flat on the ground it landed on and can be stacked on like anything else, and
 * it needs no medial segment to do it: its `halfLength` is 0.
 *
 * `scale` carries a non-default barrel size through to its wreckage (1 for the
 * palette's drums), so the shards always add back up to the drum they came off.
 */
export function createDrumPiece(
  x: number,
  y: number,
  fill: DrumFill,
  part: DrumPiecePart,
  scale = 1,
): SimCapsule {
  const art = drumPieceSpriteFor(fill, part);
  const px = DRUM_CELLS_PER_PX * scale;
  const halfW = (art.w * px) / 2;
  const halfH = (art.h * px) / 2;
  // Its own pixel box with the corners filed off is what it collides as, so a
  // settled shard sits flush on the ground it landed on and carries a load.
  const cornerRadius = boxCornerRadius(halfW, halfH);
  const radius = halfW < halfH ? halfW : halfH;
  // Mass follows that shape, because the same shape is the footprint buoyancy
  // samples — pairing them is what makes the density ratio (steel 7 vs Water 3)
  // come out as the submerged fraction it should, i.e. straight down.
  const mass = DRUM_PIECE_DENSITY * roundedBoxArea(halfW - cornerRadius, halfH - cornerRadius, cornerRadius);
  // Inertia follows the REAL rectangle (I = m(w² + h²)/12): how hard a shard is to
  // spin should depend on how long it actually is.
  const w = 2 * halfW;
  const h = 2 * halfH;
  return {
    kind: 'drum',
    part,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    halfLength: 0, // a shard has no medial segment: its box comes from its art
    radius,
    halfW,
    halfH,
    cornerRadius,
    mass,
    momentOfInertia: (mass * (w * w + h * h)) / 12,
    restitution: DRUM_RESTITUTION,
    state: 'intact',
    heatTicks: 0,
    temp: AMBIENT_TEMP,
    // Born already inside the fireball that made it: wave the flash off while it
    // gets clear (see DRUM_PIECE_BLAST_GRACE).
    blastGraceTicks: DRUM_PIECE_BLAST_GRACE,
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
 *  embers, molten iron) or hotter will; below the autoignite temp, so re-lighting
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
 * Smoke-bomb defaults. A small steel canister — denser than Water (3) so it sinks,
 * barely bouncy. Its capsule box (2·radius wide × 2·(halfLength+radius) tall =
 * 6.5 × 10 cells) matches the 13×20 sprite's aspect, so display and collision
 * agree exactly as they do for the drum and the dynamite.
 */
export const SMOKE_BOMB_RADIUS = 3.25;
export const SMOKE_BOMB_HALF_LENGTH = 1.75;
export const SMOKE_BOMB_DENSITY = 3.2;
export const SMOKE_BOMB_RESTITUTION = 0.25;
/** Max magnitude (rad/tick) of the small random spin a freshly-placed canister
 *  spawns with, so it topples off its cap to one side instead of balancing —
 *  the same gentle nudge the dynamite gets (see DYNAMITE_SPAWN_SPIN). */
export const SMOKE_BOMB_SPAWN_SPIN = 0.06;
/** How long the quiet trickle lasts before the canister lets go (기획: 4초). Sized
 *  in *seconds* at the default sim rate, like the dynamite's fuse, so a faster or
 *  slower sandbox scales the wall-clock delay along with everything else. */
export const SMOKE_BOMB_FUSE_TICKS = Math.round(4 * SIM_HZ_AT_1X);
/** How long the heavy discharge lasts before the spent canister vanishes (기획:
 *  연기 생성 시간 2.5초). Sized in seconds like the fuse, so the sandbox's speed
 *  dial scales it too. */
export const SMOKE_BOMB_VENT_TICKS = Math.round(2.5 * SIM_HZ_AT_1X);
// Both stages seed Smoke over a disc (see puffDisc); they differ only in where
// that disc sits, how wide it is and how densely it fills. The numbers are sized
// so the two stages read as different *events*, not as one turned up: the fuse
// wisp is a marker, the discharge is a wall of smoke.
/** How far the fuse-stage wisp reaches from the canister. Small and fixed — it
 *  should read as a thin plume seeping off the can, not as a cloud. Sized a little
 *  past the body's own half-height so the wisp clears the sprite instead of being
 *  drawn entirely behind it. */
const SMOKE_BOMB_TRICKLE_RADIUS = 6.5;
/** Per-cell, per-tick fill chance of that wisp — a couple of new cells a tick. The first four seconds are meant to be a thin plume
 *  marking where the canister landed (소량의 연기), so the discharge that follows
 *  is a clear step change rather than more of the same. */
const SMOKE_BOMB_TRICKLE_DENSITY = 0.1;
/** Per-cell, per-tick chance the open vent seeds a Smoke cell somewhere in its
 *  cloud radius, and it keeps that up for 2.5 seconds while the cloud rises and
 *  spreads well past the area it was seeded into — a canister genuinely blankets
 *  its surroundings (대량의 연기). Only cells the front can actually REACH are
 *  seeded (see puffDisc), so a bomb wedged in a crevice vents through the gaps it
 *  has and a bomb behind a wall doesn't smoke through it. */
const SMOKE_BOMB_VENT_DENSITY = 0.22;
/** How far the discharge's front travels, as a multiple of the body's own reach
 *  (≈5 cells) — so ~30 cells of travel, a cloud tens of cells across before the gas
 *  starts drifting on its own. It erupts around the whole canister rather than
 *  a thin plume the way the fuse-stage wisp does. */
const SMOKE_BOMB_VENT_SPREAD = 6;
/** Footprint/reservoir temperature (°) at/above which external heat cooks the
 *  charge off early, cutting the fuse short and opening the vent now. Set at the
 *  rubber ball's scorch point (300°) rather than the dynamite's 1100°: a smoke
 *  composition is meant to be *lit*, so any real fire should set one off, and
 *  there's no blast for an early trigger to make dangerous. */
export const SMOKE_BOMB_IGNITE_TEMP = 300;
/** Sustained ticks above SMOKE_BOMB_IGNITE_TEMP before the early trigger fires, so
 *  a single hot splash doesn't pop it. */
const SMOKE_BOMB_HEAT_TICKS = 5;

/**
 * Build a smoke bomb centered at (x,y), at rest and upright with its fuse already
 * running, plus the same weak random spin the dynamite spawns with so it topples
 * to one side. Mass and moment of inertia follow the shared capsule formulas.
 */
export function createSmokeBomb(
  x: number,
  y: number,
  radius = SMOKE_BOMB_RADIUS,
  halfLength = SMOKE_BOMB_HALF_LENGTH,
): SimSmokeBomb {
  const r = radius > 1 ? radius : 1;
  const l = halfLength > 0 ? halfLength : 0;
  const area = 4 * r * l + Math.PI * r * r;
  const mass = SMOKE_BOMB_DENSITY * area;
  const w = 2 * r;
  const h = 2 * (l + r);
  const momentOfInertia = (mass * (w * w + h * h)) / 12;
  return {
    kind: 'smokebomb',
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: (Math.random() * 2 - 1) * SMOKE_BOMB_SPAWN_SPIN,
    halfLength: l,
    radius: r,
    mass,
    momentOfInertia,
    restitution: SMOKE_BOMB_RESTITUTION,
    heatTicks: 0,
    temp: AMBIENT_TEMP,
    fuseTicks: SMOKE_BOMB_FUSE_TICKS,
    ventTicks: 0,
  };
}

/**
 * Wooden-box defaults. Cells per sprite pixel matches the drum's 1:2 mapping
 * (24×32 sprite ⇒ 12×16 cells), so the 24×24 crate is 12×12 cells — a solid,
 * clearly-readable box, and each shard is whatever fraction of that its own art
 * occupies. Timber is light (density well under Water's 3), so a crate and every
 * shard of it FLOAT — a raft of crates is a real thing to build.
 */
export const WOOD_BOX_CELLS_PER_PX = 0.5;
export const WOOD_BOX_DENSITY = 1.4;
/** A wooden box thuds and stays put rather than bouncing. */
export const WOOD_BOX_RESTITUTION = 0.15;
/** Footprint/reservoir temperature (°) at/above which the timber catches fire.
 *  Level with the Wood material's own autoignition point (500°, see
 *  materials/wood.ts), so a crate ignites under exactly the conditions a wooden
 *  beam does — ordinary Fire (1000°), Lava, embers and the 가열 브러시 all light
 *  it, while a merely warm room never does. */
export const WOOD_BOX_IGNITE_TEMP = 500;
/** Sustained ticks at/above the ignition point before it actually catches, so a
 *  single hot fleck brushing past doesn't set a crate alight. */
const WOOD_BOX_IGNITE_TICKS = 5;
/** How long the whole crate burns before it gives way, and how long a single
 *  shard does. Sized in *seconds* at the default sim rate like the dynamite fuse
 *  and the smoke bomb's stages, so the sandbox's speed dial scales the burn along
 *  with everything else. The crate outlasts a shard — there's more of it — and the
 *  two together make a burning crate a ~8-second event: it flames, falls apart
 *  into three burning shards, and those crumble to Sawdust. */
const WOOD_BOX_CRATE_BURN_TICKS = Math.round(5 * SIM_HZ_AT_1X);
const WOOD_BOX_PIECE_BURN_TICKS = Math.round(3 * SIM_HZ_AT_1X);
/** Per-cell, per-tick chance a burning body seeds a real Fire cell in an open
 *  footprint cell. Like the dynamite's fuse flame, the fire is genuine Fire
 *  particles rather than something painted on the sprite, so a burning crate
 *  actually lights the wood pile it was stacked on. Small — a 113-cell crate
 *  footprint puts out a couple of flames a tick, which the CA then carries.
 *  Seeded over the body's INSCRIBED DISC rather than its full collision box: the
 *  rate is a tuned figure, and a scatter quoted per cell would have silently grown
 *  with the footprint when the box gained its flat faces (see spawnSawdust, which
 *  is scattered over the same disc for the same reason). */
const WOOD_BOX_FLAME_CHANCE = 0.02;
/** Fraction of the footprint that has to be quenching matter (liquid, CO₂) for
 *  the fire to go out. Above a stray splash, below the ~47% a floating crate is
 *  submerged by — so dunking a burning crate really does save it. */
const WOOD_BOX_DOUSE_FRAC = 0.25;
/** Sustained ticks of Acid contact before the timber dissolves through (산에 닿으면
 *  파괴). Sized in *seconds* at the default sim rate like the burn timers, so the
 *  speed dial scales it too. One second — much quicker than the 5-second burn,
 *  because acid eating a crate should read as a distinct, decisive way to lose one
 *  rather than a slow cook — but still long enough that a crate hauled through a
 *  splash and straight back out survives (the counter bleeds back down at the same
 *  rate it built up). The shards it leaves are timber too, so each of them then
 *  takes its own second in the same puddle: a crate dropped in acid is a ~2-second
 *  chain down to Sawdust, which the acid itself goes on to corrode on the grid. */
const WOOD_BOX_ACID_TICKS = Math.round(1 * SIM_HZ_AT_1X);
/** How far past its own footprint a body feels acid (cells). Half a cell, so a
 *  crate resting *against* a puddle counts as touching it and not only one
 *  wading in it. */
const ACID_CONTACT_MARGIN = 0.5;
/** Per-cell chance a shattered shard leaves Sawdust, scattered over the body's
 *  INSCRIBED DISC rather than its full collision box — a tuned yield, not a
 *  property of the shape, so it must not grow just because the box gained flat
 *  faces (a shard's box is ~2.5× the disc inside it). Denser than the drum's
 *  hollow-shell scatter (0.2): a shard is solid timber all the way through, so it
 *  crumbles into a proper heap of shavings. */
const WOOD_BOX_SAWDUST_CHANCE = 0.5;
/** Outward speed (cells/tick) the three shards are thrown at as the crate comes
 *  apart, plus the lift that pops them up out of the wreckage. Enough that they
 *  visibly scatter instead of settling in a neat stack of the box they were.
 *  Applies to an IMPACT break only — see BreakCause. */
const WOOD_BOX_SHATTER_SPEED = 1.4;
const WOOD_BOX_SHATTER_LIFT = 0.6;
/** Max magnitude (rad/tick) of the random spin each shard is kicked with as the
 *  crate bursts, on top of the spin its own outward throw earns from contact.
 *  Splinters tumble; they don't sail out flat. Comfortably under the mix brush's
 *  0.15 so the burst reads as debris rather than as a blender. Impact break only. */
const WOOD_BOX_SHATTER_SPIN = 0.09;
/**
 * Normal closing speed (cells/tick) at which meeting a wall or any solid stops
 * being a landing and becomes a CRASH: the box is destroyed on impact (매우 빠른
 * 속도로 벽/고체에 부딪히면 파괴). Measured as the speed the body actually arrived
 * at the surface with — the contact solve's own closing speed — not as a raw
 * velocity, so a box skimming *along* a wall or rolling fast over flat ground is
 * never mistaken for one slamming into it.
 *
 * Set above every INDIVIDUAL shove the sandbox hands out, so no single ordinary
 * force can shatter a box on its own: a blast's knockback floor (7), a Woofer's
 * (6), a Fan's wind (3.75) and the 섞기 brush (gated at 4) are each below it, and
 * free-fall reaches it only after ~160 cells of drop (v = √(h/2) at
 * OBJECT_GRAVITY). What clears it is a genuine hurl — flinging a box with the
 * 보기 모드 drag, or dropping one from the top of a tall world.
 *
 * Two shoves in the SAME tick can still combine past it, because each knockback
 * sets a floor on its own direction rather than capping the total: a near-miss
 * blast (7) plus a Woofer pulse (6) at right angles resolves to ~9.2. That is
 * deliberate rather than a leak — an explosion that flings a crate into a wall
 * hard enough to burst it is the behaviour you'd want. What the threshold does
 * guarantee is the promise each source makes on its own: a Woofer alone can never
 * break a box no matter how close (see applyWooferKnockback's 완전한 비파괴성),
 * and neither can wind or a near miss.
 *
 * Crashing yields the same wreckage as any other break — a crate bursts into its
 * three shards, a shard into Sawdust — and, being a blow, it is the case that
 * throws that wreckage clear (see BreakCause).
 */
export const WOOD_BOX_SMASH_SPEED = 9;
/** Rest gates for settleBodyUpright: a body is "settled" only when it is both
 *  barely spinning and barely moving, so nothing that is still tumbling, rolling
 *  or flying is ever squared up mid-flight. */
const SETTLE_SPIN = 0.02;
const SETTLE_SPEED = 0.25;
/** Fraction of the remaining tilt a settled box sheds per tick — a visible ease
 *  onto square (a few tenths of a second), not a snap. */
const SETTLE_RATE = 0.12;
/** What a settled body's leftover spin is multiplied by each tick, so the rock a
 *  corner contact keeps feeding it dies out instead of running forever (see
 *  settleBodyUpright). Only ever applied under the two rest gates above. */
const SETTLE_SPIN_DECAY = 0.5;
/** The three shards a crate breaks into, in sprite draw order. */
const WOOD_BOX_PIECES: readonly WoodBoxPart[] = ['piece1', 'piece2', 'piece3'];

/** How long this part burns once alight (ticks). */
function woodBoxBurnTicks(part: WoodBoxPart): number {
  return part === 'crate' ? WOOD_BOX_CRATE_BURN_TICKS : WOOD_BOX_PIECE_BURN_TICKS;
}

/**
 * Build a wooden box centered at (x,y) — the whole crate by default, or one of
 * the three shards. The body's size comes straight from that part's art (see
 * render/woodenBoxSprite.ts): the sprite's pixel box scaled into cells is BOTH the
 * display box and — with the corners filed off by `cornerRadius` — the shape the
 * world collides with (see bodyCore), so the picture and the physics can't drift
 * apart, and every face the sprite shows is a face other bodies can rest on. Mass
 * follows that shape's area × the timber density, so the crate is heavier than any
 * single shard of it. Spawned cold and unlit.
 */
export function createWoodBox(x: number, y: number, part: WoodBoxPart = 'crate'): SimWoodBox {
  const sprite = WOOD_BOX_SPRITES[part];
  const halfW = (sprite.w * WOOD_BOX_CELLS_PER_PX) / 2;
  const halfH = (sprite.h * WOOD_BOX_CELLS_PER_PX) / 2;
  // The box collides as its OWN rectangle with the corners filed off, so every one
  // of its four faces is flat: it sits flush on flat ground, flush against a wall,
  // and — the point of the shape — flat enough on another crate to be stacked.
  const cornerRadius = boxCornerRadius(halfW, halfH);
  const radius = halfW < halfH ? halfW : halfH;
  // Mass follows that shape's area, because the same shape is the footprint
  // buoyancy samples — pairing them is what makes the density ratio (timber 1.4
  // vs Water 3) come out as the submerged fraction it should.
  const mass = WOOD_BOX_DENSITY * roundedBoxArea(halfW - cornerRadius, halfH - cornerRadius, cornerRadius);
  // Inertia follows the REAL rectangle (I = m(w² + h²)/12): how hard a shard is to
  // spin should depend on how long it actually is.
  const w = 2 * halfW;
  const h = 2 * halfH;
  return {
    kind: 'woodbox',
    part,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    halfLength: 0, // a box has no medial segment: its box comes from its sprite
    radius,
    halfW,
    halfH,
    cornerRadius,
    mass,
    momentOfInertia: (mass * (w * w + h * h)) / 12,
    restitution: WOOD_BOX_RESTITUTION,
    heatTicks: 0,
    temp: AMBIENT_TEMP,
    burnTicks: 0,
    acidTicks: 0,
  };
}

/**
 * Ease a settled boxy body back onto a face — and bleed off the last of its
 * jitter while doing it.
 *
 * A box that rolls to a stop stops at whatever angle it happened to reach, and
 * balanced part-way onto a corner it rests on that ONE corner, with the rest of
 * the face hanging in the air and its other corner poking down. So once it has
 * actually come to rest — barely translating AND barely spinning — its angle is
 * eased toward the nearest quarter turn, a fraction of the remaining tilt per
 * tick, until it is sitting flat on a face.
 *
 * The spin damping in the same breath is not cosmetic; without it a settled box
 * never actually settles. Perched on a corner it lands each tick on that one
 * contact, whose off-centre impulse spins it (measured: ~0.025 rad/tick), it
 * rocks through square onto the opposite corner, and the cycle repeats forever —
 * an undamped rock the tilt easing alone can't win against, that walks the box
 * sideways as its contact friction changes sign with it. Halving the residual
 * spin each settled tick kills that oscillation in a few ticks and lets the tilt
 * easing finish the job. It is unreachable for anything genuinely in motion: the
 * gate is a twentieth of the spin a shoved crate reaches.
 *
 * The gates matter: this never touches a body that is still moving, so tumbling,
 * rolling down a slope and being flung by a blast all play out in full. It only
 * decides how the body comes to rest *after* it has stopped.
 *
 * Applies to the boxy bodies — the wooden crate and its shards, and every drum.
 */
function settleBodyUpright(o: {
  angle: number;
  angularVelocity: number;
  vx: number;
  vy: number;
}): void {
  if (Math.abs(o.angularVelocity) > SETTLE_SPIN) return;
  if (Math.hypot(o.vx, o.vy) > SETTLE_SPEED) return;
  o.angularVelocity *= SETTLE_SPIN_DECAY;
  const QUARTER_TURN = Math.PI / 2;
  const target = Math.round(o.angle / QUARTER_TURN) * QUARTER_TURN;
  const tilt = target - o.angle;
  if (Math.abs(tilt) < 1e-4) {
    o.angle = target;
    return;
  }
  o.angle += tilt * SETTLE_RATE;
}

/**
 * Molotov defaults. The body's size comes straight from its art (see
 * render/molotovSprite.ts) the way the wooden box's does — the 12×28 sprite
 * scaled by MOLOTOV_CELLS_PER_PX is a 6×14-cell box, and the capsule inscribed in
 * it (2·radius wide × 2·(halfLength+radius) tall) is what the world collides
 * with, so the bottle can never be drawn off its own collision shape.
 */
export const MOLOTOV_CELLS_PER_PX = 0.5;
/** A glass bottle brim-full of spirit: lighter than Water (3), so it floats —
 *  but only just, riding low with most of itself under the surface, which is what
 *  makes 물에 빠지면 소화 read as an obvious dunking rather than a sinking. Heavier
 *  than a hollow drum (1.6) or timber (1.4), lighter than a stick of dynamite (3.5). */
export const MOLOTOV_DENSITY = 2.6;
/** Glass doesn't bounce. */
export const MOLOTOV_RESTITUTION = 0.1;
/** Max magnitude (rad/tick) of the small random spin a freshly-placed bottle
 *  spawns with, so it topples off its base to one side instead of balancing —
 *  the same gentle nudge the dynamite and the smoke bomb get. */
export const MOLOTOV_SPAWN_SPIN = 0.06;
/**
 * Normal closing speed (cells/tick) at which meeting a wall or any solid shatters
 * the bottle. Measured exactly as the wooden box's crash is (the contact solve's
 * own closing speed — see WOOD_BOX_SMASH_SPEED), so sliding along a wall or
 * rolling fast over flat ground still isn't a crash.
 *
 * Set at a bit over a quarter of the crate's 9 (충돌 시 파괴되지만 나무 상자보다 훨씬
 * 더 쉽게, 느린 충돌에도): free fall reaches it after ~12 cells of drop at
 * OBJECT_GRAVITY, so simply dropping a bottle from any real height breaks it,
 * whereas the crate needs ~160 cells. It still sits above every gentle placement —
 * a bottle set down a few cells above the floor lands intact — and above a Fan's
 * wind (3.75 is a *shove*, not a closing speed against a wall, but the ordering is
 * what matters). Being this low is the object: a molotov you cannot break by
 * throwing it isn't one.
 */
export const MOLOTOV_SMASH_SPEED = 2.5;
/** Footprint/reservoir temperature (°) at/above which a flame lights (or re-lights)
 *  the wick. Just above Alcohol's own 250° autoignition, so anything that would set
 *  the fuel off sets the wick off: ordinary Fire, embers, Lava, the 가열 브러시. A
 *  merely warm room never does. */
export const MOLOTOV_IGNITE_TEMP = 300;
/** How long the wick burns through the bottle's fuel before it is spent and only
 *  the 빈 유리병 is left (기획: 불붙은 상태 15초 지속 시). Sized in *seconds* at the
 *  default sim rate like the dynamite's fuse and the crate's burn, so the
 *  sandbox's speed dial scales it too. Counts down only while lit. */
export const MOLOTOV_FUEL_TICKS = Math.round(15 * SIM_HZ_AT_1X);
/** Fraction of the footprint that has to be quenching matter (liquid, CO₂) for the
 *  wick to go out. Well under the wooden crate's 0.25 — 소화 기준이 다이너마이트보다
 *  훨씬 쉽다: a splash is enough, and a bottle that has actually fallen in water is
 *  submerged far past this (it floats at ~87% under). The dynamite's fuse, by
 *  contrast, water can't touch at all. */
const MOLOTOV_DOUSE_FRAC = 0.1;
/** Footprint/reservoir temperature (°) at/above which the bottle itself bursts
 *  from heat — the fuel boils and the glass lets go. Set at the dynamite's cook-off
 *  point and for the same reason: it is deliberately *above ordinary Fire's 1000°*,
 *  so the wick's OWN emitted Fire (which sits right beside the neck) can never burst
 *  the bottle it belongs to, while a genuinely hotter bath (Lava 1500°, Blue Flame
 *  1800°), the 가열 brush or a held Heat Ray does. */
export const MOLOTOV_BURST_TEMP = 1100;
/** Sustained ticks above MOLOTOV_BURST_TEMP before it bursts, so a single hot
 *  splash doesn't pop it. */
const MOLOTOV_BURST_TICKS = 5;
/** Per-cell chance a shattered bottle throws a Broken Glass shard, and — if it
 *  still had fuel — leaves Alcohol in the cells the shards didn't take. The
 *  footprint is only the bottle's own silhouette, so even at these rates a broken
 *  molotov is a puddle and a scatter of shards, not a drum's flood. */
const MOLOTOV_GLASS_CHANCE = 0.22;
const MOLOTOV_ALCOHOL_CHANCE = 0.55;
/** How hard the shards are thrown (the `out` budget launchDebris scales its speed
 *  from). Level with the wooden crate's Sawdust scatter — a bursting bottle sprays
 *  glass the way a bursting shard sprays shavings. */
const MOLOTOV_GLASS_SCATTER = 1.5;

/** Which bottle to draw and to shatter: it still has fuel, or it's a spent shell. */
export function molotovBottle(o: SimMolotov): MolotovBottle {
  return o.fuelTicks > 0 ? 'full' : 'empty';
}

/**
 * Build a Molotov cocktail centered at (x,y) — spawned upright with its wick
 * already lit (불붙은 상태로 스폰) and a full charge of fuel, plus the same weak
 * random spin the dynamite and the smoke bomb get so it topples to one side
 * instead of balancing on its base. Mass and moment of inertia follow the shared
 * capsule formulas; the geometry comes from the sprite (see MOLOTOV_CELLS_PER_PX).
 */
export function createMolotov(x: number, y: number): SimMolotov {
  const radius = (MOLOTOV_SPRITE_W * MOLOTOV_CELLS_PER_PX) / 2;
  const halfLength = (MOLOTOV_SPRITE_H * MOLOTOV_CELLS_PER_PX) / 2 - radius;
  const area = 4 * radius * halfLength + Math.PI * radius * radius;
  const mass = MOLOTOV_DENSITY * area;
  const w = 2 * radius;
  const h = 2 * (halfLength + radius);
  return {
    kind: 'molotov',
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: (Math.random() * 2 - 1) * MOLOTOV_SPAWN_SPIN,
    halfLength,
    radius,
    mass,
    momentOfInertia: (mass * (w * w + h * h)) / 12,
    restitution: MOLOTOV_RESTITUTION,
    heatTicks: 0,
    temp: AMBIENT_TEMP,
    lit: true,
    fuelTicks: MOLOTOV_FUEL_TICKS,
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
 *  reuse of the blast-fragment scatter: a handful of drops, not a fountain.
 *  Sized for the default 4-cell rubber ball and scaled up for wider bodies by
 *  SPLASH_REF_HALF_WIDTH, so the drops-per-cell density is the same for all. */
const SPLASH_MAX_DROPLETS = 6;
/** The rim half-width (cells) the two caps above are quoted at — a rubber ball's
 *  radius. A body twice as wide across its waterline throws twice as many
 *  drops/grains, so a chunky wooden crate belly-flopping into a pond makes a
 *  properly bigger splash than a marble, and a drum that lands flat makes a wider
 *  one than a drum that lands on its end, at the same visual density. Bodies at
 *  or under this width are unaffected — see rimFragments, where the cap is a
 *  floor, so no ball's splash ever got smaller than it was. */
const SPLASH_REF_HALF_WIDTH = 4;

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
 * The rim a surface-entry effect works over: how far the footprint reaches
 * sideways from the centre (where the droplets are spread), and the vertical span
 * to search for the surface the body is punching through. Straight off the body's
 * core (bodyCore), so a ball's rim is simply its radius and a drum that comes down
 * flat presents a wider waterline than one that comes down on its end.
 */
function bodyRim(o: SimObject | CapsuleBody): { halfW: number; yTop: number; yBot: number } {
  const core = bodyCore(o);
  const [spanX, spanY] = coreHalfSpan(core);
  return {
    halfW: spanX,
    yTop: Math.floor(o.y - spanY),
    yBot: Math.floor(o.y + spanY),
  };
}

/** How many fragments a body of this rim throws, from a cap quoted for a
 *  ball-sized body (see SPLASH_REF_HALF_WIDTH). The cap is a FLOOR, not a
 *  proportion: every ball keeps exactly the spray the effect was tuned at — the
 *  palette spawns them at the brush size (radius 2 and up, 3 by default), so
 *  scaling proportionally would have quietly shrunk the common ball's splash —
 *  and only a body wider than that reference throws more. */
function rimFragments(cap: number, halfW: number): number {
  return Math.max(cap, Math.round((cap * halfW) / SPLASH_REF_HALF_WIDTH));
}

/**
 * Throw a splash on water entry — a *discrete* one-shot event fired the tick an
 * object first breaks the surface, NOT a continuous per-tick coupling. It reuses
 * the blast-fragment scatter (launchDebris): a handful of surface liquid cells
 * around the entry point are relaunched as ballistic droplets that arc up and
 * out carrying their own liquid, then rain back down — the crown of a splash,
 * with the fragment count/speed scaled to the entry speed and capped small. The
 * only place the object layer writes fluid cells; everywhere else it reads.
 *
 * Body-generic (bodyRim): the ball, the drums, the dynamite, the smoke bomb and
 * the wooden crate all splash through this one path.
 */
function spawnSplash(o: SimObject | CapsuleBody, ctx: SimContext, entrySpeed: number): void {
  const { halfW, yTop, yBot } = bodyRim(o);
  const n = Math.min(rimFragments(SPLASH_MAX_DROPLETS, halfW), 2 + Math.floor(entrySpeed));
  const outB = Math.min(3, entrySpeed * 0.6); // launchDebris speed budget
  for (let i = 0; i < n; i++) {
    // Spread the droplets across the entry rim (−halfW … +halfW around the center).
    const frac = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const sx = Math.round(o.x + frac * halfW);
    // Topmost non-frozen liquid cell in this column, within the body's span —
    // the surface it is punching through.
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
 * Body-generic in exactly the same way as the splash (see bodyRim).
 */
function spawnPowderScatter(o: SimObject | CapsuleBody, ctx: SimContext, entrySpeed: number): void {
  const { halfW, yTop, yBot } = bodyRim(o);
  const n = Math.min(rimFragments(POWDER_SCATTER_MAX, halfW), 1 + Math.floor(entrySpeed / 2));
  const outB = Math.min(1.5, entrySpeed * 0.35); // weaker than a splash's budget
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const sx = Math.round(o.x + frac * halfW);
    // Topmost powder cell in this column, within the body's span — the surface
    // it is punching into.
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

// ── Body-generic geometry: the rounded-box core ──────────────────────────────
// Every body reduces to ONE shape — a *medial rectangle* swept by a cap radius,
// i.e. an oriented rounded rectangle. The three silhouettes the sandbox needs are
// the three ways that rectangle is allowed to degenerate:
//
//   hx = 0, hy = 0  →  a disc     — the rubber ball
//   hx = 0, hy > 0  →  a stadium  — the dynamite, the smoke bomb, the molotov
//   hx > 0, hy > 0  →  a box      — the drums (barrel and shards) and the crate
//
// The last case is why this exists. A capsule has no flat face anywhere: a
// barrel's lid was a dome and a crate collided as the disc inscribed in its own
// sprite, so anything set on top of either met a curve and slid straight off —
// you could not stack them (드럼통·나무 상자 쌓기). Giving those bodies their real
// rectangle, with the corners filed off, hands them four genuinely FLAT faces to
// rest on and to carry a load with, and costs nothing anywhere else: the ball and
// the bottles keep cores that degenerate back to exactly the point and segment
// they always were, so every routine below returns for them precisely what it
// returned before.
//
// Expressing all of it this way lets object-object collision, picking, the
// footprint scans and the exposure scan run one code path over `SimBody` instead
// of per-kind branches. Balls carry no rotation, so their inverse inertia is 0 (a
// contact torque can't spin them) — that single difference is all the pair solver
// needs.

/**
 * How much of a boxy body's corner is filed off, as a fraction of its SHORTER
 * half-extent. A tuning knob between two failure modes rather than a physical
 * figure: at 0 the box is a hard-cornered rectangle that catches on every grid
 * seam it slides over and can never tip (its corner has no radius to roll over),
 * and at 1 the shorter pair of faces vanishes back into the disc this replaced.
 * A quarter leaves the faces long and flat — a crate's flat top is three quarters
 * of its width, plenty to stack on — while keeping enough curve that a shoved
 * crate still rolls up onto its corner and tips over it.
 */
const BOX_CORNER_FRAC = 0.25;

/** The corner radius of a boxy body of these half-extents (see BOX_CORNER_FRAC).
 *  Taken off the shorter side so a long thin shard is rounded in proportion to its
 *  thickness and never has its whole width swallowed by the rounding. */
export function boxCornerRadius(halfW: number, halfH: number): number {
  return (halfW < halfH ? halfW : halfH) * BOX_CORNER_FRAC;
}

/**
 * Area of a rounded box of core half-extents `hx`,`hy` and corner radius `r` —
 * the central rectangle, the four flat flanks, and the four corner quarters that
 * add up to one full disc. Every body's MASS is its density times this, because
 * the very same shape is the footprint buoyancy samples: pairing them is what
 * makes a density ratio (timber 1.4 vs Water 3) come out as the submerged
 * fraction it should, whatever shape the body is. The degenerate cores give back
 * the old formulas exactly — πr² for a ball, 4rl + πr² for a stadium.
 */
function roundedBoxArea(hx: number, hy: number, r: number): number {
  return 4 * hx * hy + 4 * r * (hx + hy) + Math.PI * r * r;
}

/**
 * A body's collision core: the medial rectangle (half-extents `hx`,`hy` measured
 * along the body's OWN axes) plus the cap radius `r` swept around it. `ux,uy` is
 * the body's local width axis in world space and `lx,ly` its local length axis —
 * carried here so the callers never re-derive sin/cos.
 */
interface BodyCore {
  x: number;
  y: number;
  hx: number;
  hy: number;
  r: number;
  ux: number;
  uy: number;
  lx: number;
  ly: number;
}

/**
 * The collision core of any body. Boxy bodies (those carrying `halfW`/`halfH`/
 * `cornerRadius` — the drums and the wooden crate) give their own rectangle with
 * the corners filed off; everything else gives the stadium/disc its
 * `halfLength`/`radius` always described. Structural, not a `kind` switch, so a
 * new body opts into flat faces purely by carrying the three fields.
 *
 * `scale` (default 1) blows the whole core up about its center without touching
 * the body — spawnFillSpill uses it to flood past the drum's real shell.
 */
function bodyCore(o: SimObject | CapsuleBody, scale = 1): BodyCore {
  if ('r' in o) {
    // A ball: no orientation and no medial extent at all — a plain disc.
    return { x: o.x, y: o.y, hx: 0, hy: 0, r: o.r * scale, ux: 1, uy: 0, lx: 0, ly: 1 };
  }
  // The length axis is the capsule axis (sin θ, cos θ) — angle 0 = upright, the
  // way every sprite is drawn — and the width axis is its perpendicular.
  const sin = Math.sin(o.angle);
  const cos = Math.cos(o.angle);
  const boxy = o.cornerRadius !== undefined && o.halfW !== undefined && o.halfH !== undefined;
  const r = boxy ? (o.cornerRadius as number) : o.radius;
  const hx = boxy ? (o.halfW as number) - r : 0;
  const hy = boxy ? (o.halfH as number) - r : o.halfLength;
  return {
    x: o.x,
    y: o.y,
    hx: (hx > 0 ? hx : 0) * scale,
    hy: (hy > 0 ? hy : 0) * scale,
    r: r * scale,
    ux: cos,
    uy: -sin,
    lx: sin,
    ly: cos,
  };
}

/** Closest point on the core's medial rectangle to (px,py) — the generalization
 *  of closestOnSegment, and identical to it when `hx` is 0. Project into the
 *  body's own frame, clamp to the rectangle, project back. */
function coreClosest(c: BodyCore, px: number, py: number): [number, number] {
  const dx = px - c.x;
  const dy = py - c.y;
  let u = dx * c.ux + dy * c.uy;
  let l = dx * c.lx + dy * c.ly;
  u = u < -c.hx ? -c.hx : u > c.hx ? c.hx : u;
  l = l < -c.hy ? -c.hy : l > c.hy ? c.hy : l;
  return [c.x + u * c.ux + l * c.lx, c.y + u * c.uy + l * c.ly];
}

/** World-space AABB half-extents of the whole rounded shape (core + cap radius) —
 *  what every footprint scan sizes its cell loop from. */
function coreHalfSpan(c: BodyCore): [number, number] {
  return [
    c.hx * Math.abs(c.ux) + c.hy * Math.abs(c.lx) + c.r,
    c.hx * Math.abs(c.uy) + c.hy * Math.abs(c.ly) + c.r,
  ];
}

/** Radius of the smallest circle covering the core's shape. */
function coreReach(c: BodyCore): number {
  return Math.hypot(c.hx, c.hy) + c.r;
}

/** Half-extent from center to the farthest point of the body — the radius of the
 *  smallest circle covering it. Used to size scan/pick bounding boxes. */
export function bodyReach(o: SimBody): number {
  return coreReach(bodyCore(o));
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
 *  Distance to the medial rectangle minus the cap radius, floored at 0. Exported
 *  for pointer picking / eraser hit-testing over the object layer. */
export function distanceToBody(o: SimBody, px: number, py: number): number {
  const c = bodyCore(o);
  const [qx, qy] = coreClosest(c, px, py);
  const d = Math.hypot(px - qx, py - qy) - c.r;
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

/**
 * The closest pair of points between two cores — one on each — returned as
 * [ax,ay,bx,by]. Both cores are convex rectangles (possibly degenerate to a
 * segment or a point), and for two convex sets *alternating projection* — clamp
 * onto B, clamp the result back onto A, repeat — converges on that pair. Boxes
 * converge almost immediately: two parallel faces land on it in a single round,
 * which is exactly the case that matters for a stack.
 *
 * This is the whole of body-body proximity while the cores are APART: the two
 * bodies touch iff |a−b| < rA+rB, and a→b is the exact contact normal of the two
 * rounded shapes. Once the cores actually overlap the pair collapses to a point
 * and carries no direction, which is what coreSat is for.
 */
function closestBetweenCores(a: BodyCore, b: BodyCore): [number, number, number, number] {
  let [px, py] = coreClosest(b, a.x, a.y);
  let qx = a.x;
  let qy = a.y;
  for (let i = 0; i < 4; i++) {
    [qx, qy] = coreClosest(a, px, py);
    const [nx, ny] = coreClosest(b, qx, qy);
    const settled = Math.abs(nx - px) < 1e-9 && Math.abs(ny - py) < 1e-9;
    px = nx;
    py = ny;
    if (settled) break;
  }
  return [qx, qy, px, py];
}

/**
 * Minimum-penetration separating axis for two OVERLAPPING cores, oriented from A
 * toward B. Only reached when the cores have interpenetrated far enough that their
 * closest points coincide and the direction is lost — a deep, rare case (bodies
 * normally stay a cap radius apart). Four candidate axes, the two of each core:
 * for boxes that is the complete SAT axis set, and for the degenerate cores it is
 * a serviceable fallback rather than an exact one, which is all a recovery push
 * needs to be.
 */
function coreSat(a: BodyCore, b: BodyCore): { nx: number; ny: number; depth: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const axes = [
    [a.ux, a.uy],
    [a.lx, a.ly],
    [b.ux, b.uy],
    [b.lx, b.ly],
  ];
  let depth = Infinity;
  let nx = 0;
  let ny = -1;
  for (const [axx, axy] of axes) {
    const d = dx * axx + dy * axy;
    const ra = a.hx * Math.abs(axx * a.ux + axy * a.uy) + a.hy * Math.abs(axx * a.lx + axy * a.ly);
    const rb = b.hx * Math.abs(axx * b.ux + axy * b.uy) + b.hy * Math.abs(axx * b.lx + axy * b.ly);
    const overlap = ra + rb - Math.abs(d);
    if (overlap < depth) {
      depth = overlap;
      nx = d >= 0 ? axx : -axx;
      ny = d >= 0 ? axy : -axy;
    }
  }
  return { nx, ny, depth: depth > 0 ? depth : 0 };
}

/**
 * The core's extreme FEATURE along (nx,ny) — the face it presents to a contact
 * coming from that direction — written into `out` as x,y pairs and returned as a
 * count of 1 or 2. A rectangle offers a whole edge when the normal is square to
 * one of its axes and a single corner otherwise; a stadium's core offers its whole
 * segment side-on and one end otherwise; a ball's core is always the one point.
 *
 * Two points instead of one is what makes stacking hold still. A single contact
 * has to act somewhere along the face, and wherever that is, any offset from the
 * body's centre is a lever the impulse torques it around — a crate resting square
 * on another crate would rock. Two contacts spanning the overlap apply equal and
 * opposite levers that cancel, so a supported face just sits there.
 */
function coreSupport(c: BodyCore, nx: number, ny: number, out: number[]): number {
  /** How square to an axis the normal must be for that whole edge to count as the
   *  contact face (≈0.06 rad of tilt). Wider than a settled body's residual tilt,
   *  narrow enough that a genuinely tipped body still contacts on its corner. */
  const FACE_EPS = 0.06;
  const du = nx * c.ux + ny * c.uy;
  const dl = nx * c.lx + ny * c.ly;
  const su = du >= 0 ? c.hx : -c.hx;
  const sl = dl >= 0 ? c.hy : -c.hy;
  if (Math.abs(du) < FACE_EPS && c.hx > 1e-9) {
    out[0] = c.x - c.hx * c.ux + sl * c.lx;
    out[1] = c.y - c.hx * c.uy + sl * c.ly;
    out[2] = c.x + c.hx * c.ux + sl * c.lx;
    out[3] = c.y + c.hx * c.uy + sl * c.ly;
    return 2;
  }
  if (Math.abs(dl) < FACE_EPS && c.hy > 1e-9) {
    out[0] = c.x + su * c.ux - c.hy * c.lx;
    out[1] = c.y + su * c.uy - c.hy * c.ly;
    out[2] = c.x + su * c.ux + c.hy * c.lx;
    out[3] = c.y + su * c.uy + c.hy * c.ly;
    return 2;
  }
  out[0] = c.x + su * c.ux + sl * c.lx;
  out[1] = c.y + su * c.uy + sl * c.ly;
  return 1;
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
 * Every contact between the body and the solid grid that matters this iteration —
 * a manifold of one to three points, deepest first, or empty if the body is free.
 *
 * Per solid cell it is the point→core generalization of `deepestContact`: take the
 * closest point P on the medial rectangle to the cell center, then — exactly as
 * the circle does from its center — the closest point q on the cell square to P.
 * The outward vector P−q is the normal and radius−|P−q| the penetration; q is the
 * contact point that gives the torque lever arm. The same buried-internal-face
 * culling as the circle keeps a body from rattling across a flat floor.
 *
 * Why more than the deepest one, now that bodies have flat faces: a disc resting
 * on flat ground touches at a single point under its centre, so one contact is the
 * whole truth about it. A crate's flat bottom instead meets a whole ROW of cells,
 * and resolving that row through any single one of them puts the impulse out at
 * some offset from the centre — a lever the crate is then torqued around. Measured:
 * a settled crate picked up ~0.025 rad/tick of spin from that, every tick, and
 * rocked from corner to corner forever instead of coming to rest.
 *
 * So the deepest contact fixes the NORMAL, and the manifold is then the two
 * extreme contacts sharing that normal — the far ends of the face actually in
 * touch — each keeping its own penetration, plus the deepest itself if it lies
 * between them. A squarely supported face gives a symmetric pair whose torques
 * cancel exactly; a tilted one gives a lopsided pair that rights it; and a crate
 * overhanging a ledge finds contacts only on its supported side, so it still tips
 * off, which is the behaviour worth keeping.
 */
function gridContacts(o: CapsuleBody, ctx: SimContext): CapsuleContact[] {
  const core = bodyCore(o);
  const r = core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.floor(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.floor(o.y + spanY);
  const all: CapsuleContact[] = [];
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!isSolidCell(cx, cy, ctx)) continue;
      // Core point nearest this cell's center, then the cell-square point
      // nearest that — the circle's contact test, re-based on the core.
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
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

      all.push({ nx, ny, pen, px, py });
    }
  }
  if (all.length < 2) return all;
  // The deepest contact fixes the normal the whole manifold is resolved along.
  let deepest = 0;
  for (let i = 1; i < all.length; i++) if (all[i].pen > all[deepest].pen) deepest = i;
  const primary = all[deepest];
  // Walk the contacts that share that normal and keep the two extremes along the
  // contact tangent — the far ends of the face genuinely in touch.
  const tx = -primary.ny;
  const ty = primary.nx;
  /** How parallel a contact's normal must be to the deepest one's to belong to the
   *  same face (≈8°). Loose enough to gather a whole flat row, tight enough that a
   *  perpendicular wall never joins the floor's manifold. */
  const SAME_NORMAL = 0.99;
  let lo = primary;
  let hi = primary;
  let loT = (primary.px - o.x) * tx + (primary.py - o.y) * ty;
  let hiT = loT;
  for (const c of all) {
    if (c === primary) continue;
    if (c.nx * primary.nx + c.ny * primary.ny < SAME_NORMAL) continue;
    const t = (c.px - o.x) * tx + (c.py - o.y) * ty;
    if (t < loT) {
      loT = t;
      lo = c;
    } else if (t > hiT) {
      hiT = t;
      hi = c;
    }
  }
  // Both ends answer along the deepest contact's normal — they are within 8° of it
  // by construction, and one shared normal is what lets the two impulses be solved
  // together (see solveNormalPair).
  lo.nx = primary.nx;
  lo.ny = primary.ny;
  hi.nx = primary.nx;
  hi.ny = primary.ny;
  // Deepest of the two leads: the caller clears its penetration positionally, and
  // anything still buried after that is caught by the next relaxation iteration.
  if (lo === hi) return [lo];
  return lo.pen >= hi.pen ? [lo, hi] : [hi, lo];
}

/**
 * Normal impulses for a TWO-point manifold, solved together rather than one after
 * the other. `aIK` is the manifold's effective-mass matrix (how much contact K's
 * impulse changes the closing speed at contact I) and `bI` the closing speed each
 * contact has to shed.
 *
 * Sequential impulses get this wrong in exactly the case that matters: applied
 * first, contact 1 spins the body, which makes contact 2 look like it is closing
 * harder than it was, so contact 2 over-answers and the body ends the tick with a
 * residual rock. Solving the 2×2 system instead gives a squarely-landed flat body
 * two equal impulses whose torques cancel to nothing.
 *
 * An impulse may only PUSH, so the both-active solution is taken only when both
 * come out non-negative; otherwise the manifold really is a one-point contact and
 * whichever single contact is consistent (its own impulse leaves the other one
 * separating) is used — the standard two-contact enumeration.
 */
function solveNormalPair(
  a11: number,
  a12: number,
  a22: number,
  b1: number,
  b2: number,
): [number, number] {
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) > 1e-12) {
    const j1 = (b1 * a22 - b2 * a12) / det;
    const j2 = (a11 * b2 - a12 * b1) / det;
    if (j1 >= 0 && j2 >= 0) return [j1, j2];
  }
  const only1 = a11 > 0 ? b1 / a11 : 0;
  if (only1 >= 0 && a12 * only1 >= b2) return [only1, 0];
  const only2 = a22 > 0 ? b2 / a22 : 0;
  if (only2 >= 0 && a12 * only2 >= b1) return [0, only2];
  return [0, 0];
}

/**
 * Resolve the body out of the solid grid with rotation. Each iteration takes the
 * grid manifold (gridContacts): push out along the deepest contact's normal, then
 * apply a contact impulse at EVERY point of the manifold. Each impulse has a
 * normal part (restitution) and a Coulomb-clamped tangential (friction) part;
 * BOTH feed `angularVelocity` through the torque r × J (r = contact − center).
 * Friction at an off-center contact is exactly what turns a drop into a roll —
 * the piece the earlier capsule attempt lacked — while the manifold's opposite
 * ends are what let a flat-bottomed crate rest without rocking (see gridContacts).
 * The impulse budget is split across the points so a two-point landing lands the
 * same total blow a one-point landing does.
 *
 * Returns HOW HARD the body met the grid: the largest normal closing speed it
 * resolved (cells/tick), 0 if it was touching but not closing (resting on the
 * floor), and −1 if it wasn't touching the grid at all. The caller reads `>= 0`
 * as "grounded" for rolling resistance, and the magnitude as impact hardness —
 * which is what lets a wooden box tell a landing from a crash (see
 * WOOD_BOX_SMASH_SPEED). The FIRST iteration's closing speed is the real one:
 * later iterations see a velocity the earlier impulse already reflected, so the
 * running max is naturally the speed the body actually arrived at.
 */
function resolveCapsuleCollision(o: CapsuleBody, ctx: SimContext): number {
  const invMass = 1 / o.mass;
  const invI = 1 / o.momentOfInertia;
  let impact = -1;
  for (let iter = 0; iter < 4; iter++) {
    const contacts = gridContacts(o, ctx);
    if (contacts.length === 0) break;
    if (impact < 0) impact = 0; // in contact — at minimum, grounded
    // Positional correction along the deepest contact's normal.
    const deepest = contacts[0];
    const nx = deepest.nx;
    const ny = deepest.ny;
    o.x += nx * deepest.pen;
    o.y += ny * deepest.pen;
    // Lever arms and the surface velocity at each contact point (2D rigid body:
    // v_p = v + ω × r, where ω × r = ω·(−r_y, r_x)).
    const n = contacts.length;
    const rx: number[] = [];
    const ry: number[] = [];
    const cross: number[] = [];
    const vn: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = contacts[i];
      rx[i] = c.px - o.x;
      ry[i] = c.py - o.y;
      cross[i] = rx[i] * ny - ry[i] * nx;
      vn[i] = (o.vx - o.angularVelocity * ry[i]) * nx + (o.vy + o.angularVelocity * rx[i]) * ny;
      if (vn[i] < 0 && -vn[i] > impact) impact = -vn[i]; // hardest closing speed
    }
    // Slow contacts don't bounce (kills gravity-driven micro-bounce at rest), and
    // the manifold shares one restitution so its two impulses stay comparable.
    const closing = Math.min(vn[0], n > 1 ? vn[1] : 0);
    const e = -closing < CAPSULE_REST_EPS ? 0 : o.restitution;
    // Normal impulses: jn = −(1+e)·v_n / (1/m + (r×n)²/I), solved TOGETHER when the
    // manifold has two points so a flat landing produces no net torque.
    const jn: number[] = [];
    const eff = (i: number, k: number): number => invMass + invI * cross[i] * cross[k];
    if (n === 1) {
      jn[0] = vn[0] < 0 ? (-(1 + e) * vn[0]) / eff(0, 0) : 0;
    } else {
      const [j0, j1] = solveNormalPair(
        eff(0, 0), eff(0, 1), eff(1, 1),
        vn[0] < 0 ? -(1 + e) * vn[0] : 0,
        vn[1] < 0 ? -(1 + e) * vn[1] : 0,
      );
      jn[0] = j0;
      jn[1] = j1;
    }
    for (let i = 0; i < n; i++) {
      if (jn[i] <= 0) continue;
      o.vx += jn[i] * nx * invMass;
      o.vy += jn[i] * ny * invMass;
      o.angularVelocity += invI * cross[i] * jn[i];
    }
    // Tangential (friction) impulse per contact, Coulomb-clamped to μ·jn and
    // recomputed from the post-normal contact velocity for stability. This is the
    // torque source that spins the drum into a roll.
    const tx = -ny;
    const ty = nx;
    for (let i = 0; i < n; i++) {
      if (jn[i] <= 0) continue;
      const vt =
        (o.vx - o.angularVelocity * ry[i]) * tx + (o.vy + o.angularVelocity * rx[i]) * ty;
      const rtCross = rx[i] * ty - ry[i] * tx;
      let jt = -vt / (invMass + invI * rtCross * rtCross);
      const maxF = DRUM_FRICTION * jn[i];
      if (jt > maxF) jt = maxF;
      else if (jt < -maxF) jt = -maxF;
      o.vx += jt * tx * invMass;
      o.vy += jt * ty * invMass;
      o.angularVelocity += invI * rtCross * jt;
    }
  }
  return impact;
}

/**
 * Sample the medium under the body's footprint (cells whose center is within the
 * cap radius of the medial rectangle — see bodyCore), bucketed for buoyancy
 * (liquid density + submerged count) and granular penetration (powder count),
 * plus the total footprint. Read-only.
 */
function sampleMediumCapsule(o: CapsuleBody, ctx: SimContext): {
  liquidDensity: number;
  liquidCells: number;
  powderCells: number;
  footprint: number;
} {
  const core = bodyCore(o);
  const r2 = core.r * core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.ceil(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.ceil(o.y + spanY);
  let liquidDensity = 0;
  let liquidCells = 0;
  let powderCells = 0;
  let footprint = 0;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
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
 * cleared cells become short-lived BLAST cells → instant destruction), a Nuclear Ray
 * beam cell overlapping it (the searing critical-mass beam — see nuclearray.ts —
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
): { blast: boolean; nuclearRay: boolean; maxTemp: number; solidFrac: number } {
  const core = bodyCore(o);
  const r2 = core.r * core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.ceil(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.ceil(o.y + spanY);
  let blast = false;
  let nuclearRay = false;
  let maxTemp = -Infinity;
  let footprint = 0;
  let solid = 0;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
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
      else if (id === NUCLEAR_RAY.id) nuclearRay = true;
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
      // A `decorTemp` cell (the Firework Burst flower) is skipped for the
      // opposite reason: its reading is real but purely cosmetic, so a volley
      // bursting over a wooden box must not cook it (see Material.decorTemp).
      if (m !== null && (m.packedTemp || m.decorTemp)) continue;
      const t = ctx.getTemp(cx, cy);
      if (t > maxTemp) maxTemp = t;
    }
  }
  return { blast, nuclearRay, maxTemp, solidFrac: footprint > 0 ? solid / footprint : 0 };
}

/** Per-cell chance a shattered drum SHARD flings a Metal Powder fragment from that
 *  footprint cell. Denser than the hollow barrel's old whole-body scatter (0.2)
 *  because a shard's footprint is much smaller than the whole barrel's:
 *  at 0.35 the three shards together still yield the same clearly visible heap of
 *  steel grains the drum used to leave in one go, rather than a few stray specks.
 *  Melt still leaves Molten Iron; this is the shatter path only. */
const DRUM_DEBRIS_CHANCE = 0.35;

/**
 * A shard shattered by a blast/crush crumbles to Metal Powder across its footprint
 * — the end of the drum's wreckage chain (barrel → three shards → powder), and the
 * exact counterpart of a wooden shard crumbling to Sawdust. Reuses debris.ts's
 * scatter so the grains arc up and rain back down as a visible heap rather than
 * the shard vanishing. Metal Powder (metalpowder.ts) — NOT solid Iron — is the
 * destroyed form: an explosion shatters the metal into dust, and the powder still
 * melts back to Molten Iron if it later lands in heat. Only a fraction of the
 * footprint becomes powder (DRUM_DEBRIS_CHANCE); solid cells are skipped (the
 * object layer is read-only over terrain). The barrel's fill spill, if any, went
 * out one step earlier, when the barrel itself burst (see spawnFillSpill).
 */
function spawnDrumDebris(o: SimCapsule, ctx: SimContext): void {
  const core = bodyCore(o);
  const r2 = core.r * core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.ceil(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.ceil(o.y + spanY);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
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
 * Melted by sustained heat: leave a Molten Iron puddle where the shard was — a
 * pure-metal melt (molteniron.ts), NOT smelting-line Molten Iron Ore. This is the
 * *second* stage of a drum melting: the barrel first sags open into its three
 * shards, and it is the shards that run to liquid (가열로 녹을 때도 조각 → 녹은 금속
 * 단계를 거친다). Steel plate is thin, so only a fraction of the footprint becomes
 * metal (a modest glowing puddle that then flows), and only over cells that aren't
 * solid terrain — the object writes the grid solely on this melt event.
 */
function spawnMoltenPuddle(o: SimCapsule, ctx: SimContext): void {
  const core = bodyCore(o);
  const r2 = core.r * core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.ceil(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.ceil(o.y + spanY);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      // Only over air/fluid, and only some cells (hollow shell → sparse metal).
      const id = ctx.get(cx, cy);
      if (id !== EMPTY && getMaterial(id).phase === Phase.Solid) continue;
      if (!ctx.chance(0.3)) continue;
      ctx.spawn(cx, cy, MOLTEN_IRON.id);
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

/** Does this body still hold its contents? Only a whole barrel does: the moment it
 *  bursts, everything in it pours out (조각으로 나눠질 때 내용물이 쏟아진다), and the
 *  shards that survive that are empty scrap carrying the tint alone. Without this,
 *  breaking the three shards afterwards would conjure a second drum's worth of oil
 *  — three times over. */
function drumHoldsContents(o: SimCapsule): boolean {
  return o.part === 'drum';
}

/**
 * Spill a filled drum's liquid contents across its footprint when it's destroyed
 * — the 기름/산 that pours out (쏟아짐). Floods the cells the drum occupied with
 * its fill liquid, but only over air/loose matter — never over solid terrain (the
 * object layer stays read-only over solids, same Phase.Solid guard as the
 * molten-iron puddle; a frozen liquid isn't treated as solid here).
 * The liquid is spawned at ambient temperature, so a spill into a hot zone (an
 * oil drum melted in lava) heats up and ignites/boils on its own the next few
 * ticks rather than vanishing on contact. An empty drum has no fill: no-op — and
 * neither does a shard, which spilled everything it had when the barrel it was
 * part of burst (see drumHoldsContents).
 */
function spawnFillSpill(o: SimCapsule, ctx: SimContext): void {
  if (!drumHoldsContents(o)) return;
  const id = fillSpillId(o.fill);
  if (id === null) return;
  // A blown-up copy of the drum's own core (bodyCore's `scale`) — only the flood
  // zone widens, never the drum's real collision shell.
  const core = bodyCore(o, FILL_SPILL_AREA_SCALE);
  const r2 = core.r * core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.ceil(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.ceil(o.y + spanY);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
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
 * The surface-entry splash/scatter is here too, detected exactly as the ball's is
 * (edge-triggered on the medium sampled before vs. after the move), so a drum, a
 * stick of dynamite, a smoke bomb or a wooden crate dropped into a pond or a sand
 * pit throws the same one-shot spray a ball does.
 * Returns the hardest normal closing speed it resolved against the grid this tick
 * (0 if it never met it), which is what a wooden box's smash test reads.
 */
function stepCapsule(o: CapsuleBody, ctx: SimContext, ax: number, ay: number, s: number): number {
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
  // Impact speed along gravity, captured before integration, and the edge test
  // for each medium: the body must have been CLEAR of it at tick start and be
  // moving in fast enough. Same stateless before/after comparison the ball uses,
  // so it fires once — on the tick the surface actually breaks — and can't
  // retrigger while the body sits in the pond.
  const entrySpeed = o.vx * ctx.gravityX + o.vy * ctx.gravityY;
  const enteredLiquid = ms.liquidCells === 0 && entrySpeed >= SPLASH_MIN_SPEED;
  const enteredPowder = ms.powderCells === 0 && entrySpeed >= POWDER_IMPACT_MIN_SPEED;
  // Integrate position AND orientation in tunneling-safe substeps. The substep
  // budget accounts for the rim's linear speed from spin (|ω|·reach, reach being
  // the distance from the centre to the farthest point of the shape) so a
  // fast-spinning body still resolves contacts each fraction of a cell. Taken from
  // the CORE and not from halfLength+radius, which is the old capsule's figure and
  // now falls short of a boxy body's corner — by ~15% for a barrel and ~24% for a
  // crate, i.e. exactly the part of the rim that would tunnel first.
  const reach = coreReach(bodyCore(o));
  let remaining = 1;
  let guard = 0;
  let grounded = false;
  let impact = 0; // hardest normal closing speed against the grid this tick
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
    const hit = resolveCapsuleCollision(o, ctx);
    if (hit >= 0) grounded = true;
    if (hit > impact) impact = hit;
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
  // Surface-entry spray, now that the body has moved: water throws a splash,
  // powder a weaker grain scatter (물보다 약하게). Liquid wins if a body somehow
  // broke both this tick, matching the ball.
  if (enteredLiquid || enteredPowder) {
    const after = sampleMediumCapsule(o, ctx);
    if (enteredLiquid && after.liquidCells > 0) spawnSplash(o, ctx, entrySpeed);
    else if (enteredPowder && after.powderCells > 0) spawnPowderScatter(o, ctx, entrySpeed);
  }
  return impact;
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
/** Rounds of the whole contact graph — pairs, then everything against the grid —
 *  run each tick. One round only passes a stack's weight down one link of its
 *  contact chain; see the phase B comment in stepObjects for why that is not
 *  enough and what each further round buys. */
const CONTACT_ROUNDS = 3;
/** Relaxation passes over all overlapping pairs within one round. A handful is
 *  plenty for the small object counts here and keeps a stack from sinking
 *  together. */
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

/** Cells beyond a body's footprint a Fan's Wind trail can reach to push it. Small
 *  — a body only rides the gust when it's actually sitting in the stream. */
const WIND_KNOCK_RADIUS = 2;
/** Target drift speed (cells/tick) the wind carries a body along its blow
 *  direction. Applied as a floor on the along-wind velocity (not accumulated), so
 *  a body in the stream steadily drifts downwind rather than being rocketed. Raised
 *  half again (was 2.5) to match the 1.5× stronger matter push (밀어내기 효과 1.5배
 *  상향 — see materials/fan.ts WIND_PUSH_BOOST), so blown drums/balls keep pace. */
const WIND_PUSH_SPEED = 3.75;
/** Spin the wind kicks into a capsule body as it's blown, so a drum tumbles along. */
const WIND_KNOCK_SPIN = 0.04;
/** Speed (cells/tick) a live Electromagnet field drags a ferrous body toward
 *  itself at. Applied as a *floor* on the body's speed along the pull direction
 *  — the same shape as the Fan's wind push, not an accumulating force — which is
 *  also what makes the magnet HOLD rather than juggle: the floor is re-imposed
 *  every tick, so gravity's OBJECT_GRAVITY (0.25/tick) never gets to build up and
 *  a drum stays stuck to the magnet's underside instead of sagging off it.
 *
 *  Deliberately kept under CAPSULE_REST_EPS divided by the capsule restitutions
 *  (1.3 × 0.26 = 0.34 < 0.35): a body arriving at this speed rebounds below the
 *  grid collision's rest epsilon, so it's treated as an inelastic contact and
 *  clings quietly instead of chattering against the magnet face — the object
 *  layer's counterpart of the cell field's `holdMagnetically` (see
 *  materials/electromagnet.ts). Raise it and clinging drums start to buzz. */
const MAGNET_PULL_SPEED = 1.3;

/** Unit blow vector per Wind aux direction code (0 up / 1 down / 2 left / 3 right —
 *  see materials/fan.ts). */
const WIND_DIRV: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

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
 * Scan the body's footprint once for the contacts captured at the tick's *start*
 * (before knockback can move the body clear of the check). Three of them are
 * instant destruction: a shockwave Blast flash cell overlapping it (직격 — an
 * explosion swept over it), a Nuclear Ray beam cell overlapping it (직격 — the beam
 * grazed it; see scanBodyExposure for why this is instant rather than judged by
 * heat-over-time), and an Antimatter grain touching it (접촉). The fourth is not
 * destruction at all: a Laser's Heat Ray beam cell (열선), which merely *heats* —
 * see below. Reports which were found, plus the heat the beams delivered.
 *
 * Antimatter is *consumed* on contact — each touching grain is annihilated to
 * EMPTY (a body is far bigger than one grain, so contact destroys the whole body
 * while every touched grain dies with it, instead of antimatter.ts's one-for-one
 * swap; Antimatter 접촉시 모든 오브젝트 파괴, no object is antimatter-proof). So this
 * scan mutates the grid, unconditionally over the whole footprint — a body that a
 * Blast/Nuclear Ray also dooms this tick still annihilates its touching grains.
 * Blast and Nuclear Ray cells are left alone (they expire on their own).
 *
 * A Heat Ray cell is likewise consumed, but as an *absorption* rather than an
 * annihilation: the body blocks the beam the same way an opaque solid on the grid
 * does (materials/heatray.ts), so the beam visibly stops at the crate instead of
 * flying through it, and the strike's heat (returned by `absorbHeatRayCell`, which
 * also puts back any glass pane the beam was resting in) is summed into `rayHeat`
 * for the caller to pour into the body's own reservoir. Objects are invisible to
 * the beam's own walk — they don't live on the grid — so this footprint read is
 * the only place the two layers can meet, in the same object-reads-grid direction
 * every other object↔cell interaction runs. A body being *dragged* is shielded
 * from its whole physics phase and so never absorbs a beam either (보기 드래그).
 *
 * One shared footprint pass rather than separate ones so the bounding-box /
 * culling geometry can't drift between them.
 */
function footprintHazards(
  o: SimBody,
  ctx: SimContext,
): { blast: boolean; nuclearRay: boolean; antimatter: boolean; rayHeat: number } {
  const core = bodyCore(o);
  const r2 = core.r * core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.ceil(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.ceil(o.y + spanY);
  let blast = false;
  let nuclearRay = false;
  let antimatter = false;
  let rayHeat = 0;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      const id = ctx.get(cx, cy);
      if (id !== BLAST.id && id !== NUCLEAR_RAY.id && id !== ANTIMATTER.id && id !== HEAT_RAY.id)
        continue;
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      if (id === BLAST.id) {
        blast = true;
      } else if (id === NUCLEAR_RAY.id) {
        nuclearRay = true;
      } else if (id === HEAT_RAY.id) {
        rayHeat += absorbHeatRayCell(ctx, cx, cy); // beam stopped by the body, heat kept
      } else {
        antimatter = true;
        ctx.set(cx, cy, EMPTY); // grain consumed in the annihilation
      }
    }
  }
  return { blast, nuclearRay, antimatter, rayHeat };
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
  const core = bodyCore(o);
  const r = core.r + 1;
  const r2 = r * r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX - 1);
  const x1 = Math.ceil(o.x + spanX + 1);
  const y0 = Math.floor(o.y - spanY - 1);
  const y1 = Math.ceil(o.y + spanY + 1);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      if (ctx.get(cx, cy) !== VOID.id) continue;
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy <= r2) return true;
    }
  }
  return false;
}

/**
 * Is there liquid Acid against this body? The wooden crate is the only body that
 * cares (산에 닿으면 파괴 — timber has nothing to resist it with, where the drum's
 * steel and the ball's rubber both shrug the puddle off), and it dissolves only
 * after sustained contact rather than the instant it lands (WOOD_BOX_ACID_TICKS),
 * so this reports contact and lets the caller run the clock.
 *
 * The margin catches the puddle a body has come to rest *against* as well as the
 * one it is wading in, which matters because acid is a liquid a crate FLOATS on:
 * buoyancy leaves it riding the surface, and a hair of tilt or wave can put the
 * footprint just clear of the topmost acid cell for a tick.
 *
 * Frozen acid deliberately does NOT count — a puddle chilled below its freeze
 * point is a block of ice, structure rather than liquid, and the rest of the
 * engine already treats it that way (the same call `bodyQuenchFrac` makes when it
 * refuses to let an icy puddle douse a fire). So freezing an acid bath is a real
 * way to park a crate in one.
 *
 * Read-only, including the acid: unlike a corroded *cell*, which the shared
 * corrosion pass (materials/corrosion.ts) spends the puddle 1:1 over, a dissolved body takes nothing out of the puddle. The object
 * layer stays read-only over terrain it didn't put there, and the alternative —
 * a splash that runs out halfway through and leaves the crate standing — trades
 * away the one thing this rule is for (닿으면 파괴). The puddle still gets its
 * bill: the Sawdust the wreckage leaves behind IS corrodible, so the acid spends
 * itself eating that.
 */
function footprintTouchesAcid(o: SimBody, ctx: SimContext): boolean {
  const core = bodyCore(o);
  const r = core.r + ACID_CONTACT_MARGIN;
  const r2 = r * r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX - ACID_CONTACT_MARGIN);
  const x1 = Math.ceil(o.x + spanX + ACID_CONTACT_MARGIN);
  const y0 = Math.floor(o.y - spanY - ACID_CONTACT_MARGIN);
  const y1 = Math.ceil(o.y + spanY + ACID_CONTACT_MARGIN);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      if (ctx.get(cx, cy) !== ACID.id || ctx.isFrozen(cx, cy)) continue;
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
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
 * Carry a body along on a Fan's wind (see materials/fan.ts). Scan the cells around
 * the body's footprint for stamped wind-field cells (Grid.wind — a transient,
 * one-way effect layer, NOT a particle), sum each one's blow direction (a single
 * fan's cells all agree, crossing gusts partly cancel), and push the body along the
 * resultant as a *floor* on its along-wind speed (capped at WIND_PUSH_SPEED, not
 * accumulated), so it drifts steadily downwind instead of being flung. Directional,
 * unlike the radial blast/Woofer knockback — the push is the wind's own direction,
 * not "away from the cell". Never destroys a body; it only ever nudges it, and
 * gravity reclaims it the moment it leaves the stream.
 */
function applyWindPush(o: SimBody, ctx: SimContext): void {
  const reach = bodyReach(o) + WIND_KNOCK_RADIUS;
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
      const wv = ctx.getWind(cx, cy); // 0 = none, else direction + 1
      if (wv === 0) continue;
      const dx = cx + 0.5 - o.x;
      const dy = cy + 0.5 - o.y;
      if (dx * dx + dy * dy > reach2) continue;
      const [wdx, wdy] = WIND_DIRV[wv - 1];
      px += wdx;
      py += wdy;
      found = true;
    }
  }
  if (!found) return;
  const plen = Math.hypot(px, py);
  if (plen < 1e-6) return;
  const nx = px / plen;
  const ny = py / plen;
  const along = o.vx * nx + o.vy * ny;
  if (along < WIND_PUSH_SPEED) {
    const add = WIND_PUSH_SPEED - along;
    o.vx += nx * add;
    o.vy += ny * add;
  }
  if (o.kind !== 'ball') o.angularVelocity += WIND_KNOCK_SPIN * Math.sign(nx);
}

// ── Electromagnet attraction (자력) on the object layer ───────────────────────
//
// The magnet's selectivity is its whole toy (see materials/electromagnet.ts): the
// field only takes ferromagnetic matter. On the grid that's `Material.magnetic`;
// up here it's the body's *kind*, because a body is a thing, not a substance —
// and the object layer already keys every material judgement off `kind` this way
// (a drum melts to Molten Iron, a crate burns, a ball scorches).
//
// A body has no grid cell, so the magnet's own sweep (`pullField`) can never see
// one — it walks cells. The object layer therefore reads the field the magnet
// *publishes* each powered tick (Grid.magnetFields, the same list the renderer's
// 자기력선 rings are drawn from) and pulls itself in, exactly as the Woofer's body
// shove rides its own event queue rather than the shockwave's cell sweep.

/** True if the Electromagnet's field can grab this body. Steel bodies only: the
 *  드럼통 (every fill — an empty, an oil and an acid drum are one steel shell, so
 *  they behave identically here as they do everywhere else) and the 연막탄's steel
 *  canister. A rubber ball, a wooden crate and a wax-and-paper stick of dynamite
 *  are not ferrous and sail right past a live magnet — which is the point: the
 *  magnet must stay a 자력 선별기 you can sort a pile with, not a vacuum. */
function isMagneticBody(o: SimBody): boolean {
  return o.kind === 'drum' || o.kind === 'smokebomb';
}

/** True if the magnet's pull can travel *through* this cell — `isFieldPassable`
 *  (materials/electromagnet.ts) verbatim, deliberately including the magnet
 *  material itself. Magnet is an ordinary structural solid here, exactly as it is
 *  to the cell sweep, so an Electromagnet plate shadows a drum behind it just like
 *  a stone one. It is tempting to make magnet cells transparent (a ray to the far
 *  face of a thick body crosses its own near face, and those contributions are
 *  lost) — but keying that on the *material* would make any OTHER magnet block,
 *  live or dead, connected or not, silently stop shielding, which is precisely the
 *  promise "고체가 그림자를 만든다" makes. The lost contributions cost nothing that
 *  shows: the 1/d² weighting is already dominated by the near face the body can
 *  actually see. */
function magnetRayPassable(ctx: SimContext, x: number, y: number): boolean {
  const id = ctx.get(x, y);
  if (id === EMPTY) return true;
  const m = getMaterial(id);
  if (m.shockLoose) return true;
  const p = m.phase;
  if (p !== Phase.Powder && p !== Phase.Liquid && p !== Phase.Gas) return false;
  return !ctx.isFrozen(x, y);
}

/** Is the straight line from a body's centre to the magnet cell (cx,cy) clear of
 *  structure? A straight ray rather than the cell field's geodesic sweep: a body
 *  is a rigid lump metres across that can't thread its way around a corner the
 *  way a single grain of iron filing does, so "can I see it" is both the cheaper
 *  test and the more honest one.
 *
 *  The target cell itself is exempt (it's the magnet we're measuring), and a
 *  diagonal hop needs at least one of its two flanking cells open — without that,
 *  a ray slips through the point where two solids merely touch at a corner and any
 *  1-cell-thick 45° wall stops shielding. Same rule, and the same reason, as the
 *  smoke flood's own no-corner-cutting check in `puffDisc`. */
function magnetRayClear(ctx: SimContext, ox: number, oy: number, cx: number, cy: number): boolean {
  const dx = cx + 0.5 - ox;
  const dy = cy + 0.5 - oy;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
  let px = Math.floor(ox);
  let py = Math.floor(oy);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const sx = Math.floor(ox + dx * t);
    const sy = Math.floor(oy + dy * t);
    if (sx === px && sy === py) continue; // same cell as the last sample
    if (sx !== cx || sy !== cy) {
      // arrived is exempt — the magnet isn't its own shield
      if (!ctx.inBounds(sx, sy) || !magnetRayPassable(ctx, sx, sy)) return false;
      if (sx !== px && sy !== py) {
        const openX = ctx.inBounds(sx, py) && magnetRayPassable(ctx, sx, py);
        const openY = ctx.inBounds(px, sy) && magnetRayPassable(ctx, px, sy);
        if (!openX && !openY) return false; // squeezed through a corner — not a path
      }
    }
    px = sx;
    py = sy;
  }
  return true;
}

/**
 * Drag a ferrous body toward every live Electromagnet field it sits in (see
 * `SimContext.liveMagnetFields`, published by materials/electromagnet.ts each
 * powered tick). Same inverse-square-weighted-direction + speed-floor shape as
 * the blast/Woofer knockback, with the sign flipped — this is the one force in
 * the sandbox that GATHERS — and with the reach the field itself published rather
 * than a constant of its own, so re-tuning the magnet moves both layers together.
 *
 * Weighting every in-range body cell by 1/d² (rather than aiming at the nearest
 * one) is what makes a long magnet bar pull along its whole length instead of
 * yanking everything at one end of it, matching what the cell sweep does for
 * powders. The range is measured from the body's centre against `bodyReach`, the
 * same crude-but-consistent footprint the wind and blast knockbacks use, so a
 * wide drum enters the field when its *shell* does rather than when its centre
 * finally arrives.
 *
 * Never destroys or heats anything: a magnet only ever moves a body.
 */
function applyMagnetPull(o: SimBody, ctx: SimContext): void {
  const fields = ctx.liveMagnetFields;
  if (fields.length === 0) return;
  const span = bodyReach(o);
  let px = 0;
  let py = 0;
  let found = false;
  for (let f = 0; f < fields.length; f++) {
    const field = fields[f];
    const bx = field.bx;
    const by = field.by;
    const range = field.reach + span;
    const range2 = range * range;
    for (let i = 0; i < bx.length; i++) {
      const dx = bx[i] + 0.5 - o.x;
      const dy = by[i] + 0.5 - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > range2 || d2 < 1e-6) continue;
      if (!magnetRayClear(ctx, o.x, o.y, bx[i], by[i])) continue;
      // 1/d² so the nearest stretch of the magnet dominates the direction.
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
  const toward = o.vx * nx + o.vy * ny;
  if (toward < MAGNET_PULL_SPEED) {
    const add = MAGNET_PULL_SPEED - toward;
    o.vx += nx * add;
    o.vy += ny * add;
  }
  // No spin kick here, unlike the wind/blast shoves: those fling a body away and
  // are gone, while the magnet keeps gripping — a per-tick torque would spin a
  // clinging drum up forever against a face it can't roll along.
}

/**
 * Resolve one overlapping pair with a 2D impulse, over a contact MANIFOLD of one
 * or two points.
 *
 * Both bodies are rounded boxes (see bodyCore), so the contact normal is the
 * direction between the closest points of their two cores, and the penetration is
 * how far short of the two cap radii that distance falls. From there it is a
 * standard normal (restitution) + Coulomb friction impulse at each contact point,
 * each rotating body's spin fed by the torque r × J (a ball's inverse inertia is
 * 0, so it only translates). A held body has inverse mass/inertia 0, so it acts as
 * an immovable anchor — you can shove others with the one you drag, but it stays
 * glued to the cursor.
 *
 * The manifold is what makes 쌓기 work. Two flat faces meeting share a whole
 * overlap span, and resolving that through a single point somewhere along it would
 * torque the pair apart — the top crate would rock and walk off. So when both
 * bodies present a face (coreSupport), the impulse is applied at BOTH ends of the
 * span they share, and the two levers cancel for a squarely-supported body while
 * still tipping one that overhangs.
 *
 * Returns HOW HARD the two met: the largest normal closing speed it resolved
 * (cells/tick), 0 if they were touching without closing, and −1 if they were not
 * touching at all (the same three-way report resolveCapsuleCollision makes against
 * the grid, and read the same way — `>= 0` means "in contact"). The magnitude is
 * the object↔object twin of the grid's arrival speed and feeds the same smash
 * thresholds: a crate hurled into another crate breaks on exactly the terms it
 * breaks on against a wall.
 */
function resolvePair(a: SimBody, b: SimBody): number {
  const imA = invMassOf(a);
  const imB = invMassOf(b);
  if (imA === 0 && imB === 0) return -1; // both immovable (e.g. two held)
  const iIA = invInertiaOf(a);
  const iIB = invInertiaOf(b);
  const ca = bodyCore(a);
  const cb = bodyCore(b);
  const sumR = ca.r + cb.r;
  // Cheap circle reject before the closest-point walk (object counts are small but
  // this runs n²·PAIR_ITERATIONS times a tick).
  const gap = Math.hypot(cb.x - ca.x, cb.y - ca.y) - (coreReach(ca) + coreReach(cb));
  if (gap >= 0) return -1;
  const [cax, cay, cbx, cby] = closestBetweenCores(ca, cb);
  const dx = cbx - cax;
  const dy = cby - cay;
  const dist = Math.hypot(dx, dy);
  let nx: number; // contact normal, from A toward B
  let ny: number;
  let pen: number;
  if (dist > 1e-4) {
    if (dist >= sumR) return -1; // not touching
    nx = dx / dist;
    ny = dy / dist;
    pen = sumR - dist;
  } else {
    // The cores themselves have interpenetrated, so the closest pair carries no
    // direction any more — recover along the shallowest separating axis.
    const sat = coreSat(ca, cb);
    nx = sat.nx;
    ny = sat.ny;
    pen = sat.depth + sumR;
  }
  // Split the positional correction by inverse mass (an anchor doesn't move).
  const imSum = imA + imB;
  a.x -= nx * pen * (imA / imSum);
  a.y -= ny * pen * (imA / imSum);
  b.x += nx * pen * (imB / imSum);
  b.y += ny * pen * (imB / imSum);
  // Build the manifold: the face (or corner) each body turns toward the other,
  // clipped to the span they share along the contact tangent.
  const fa: number[] = [0, 0, 0, 0];
  const fb: number[] = [0, 0, 0, 0];
  const na = coreSupport(ca, nx, ny, fa);
  const nb = coreSupport(cb, -nx, -ny, fb);
  const tx = -ny;
  const ty = nx;
  // Tangential span of each feature, and the overlap of the two.
  const a0 = fa[0] * tx + fa[1] * ty;
  const a1 = na === 2 ? fa[2] * tx + fa[3] * ty : a0;
  const b0 = fb[0] * tx + fb[1] * ty;
  const b1 = nb === 2 ? fb[2] * tx + fb[3] * ty : b0;
  let lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  let hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  if (hi < lo) {
    // No shared span (a corner just past the end of a face) — fall back to the
    // closest-point pair, which is always a valid single contact.
    lo = hi = ((cax + cbx) / 2) * tx + ((cay + cby) / 2) * ty;
  }
  // Where the two surfaces meet along the normal: midway between A's outer skin
  // and B's, which (both features being square to the normal) is one figure for
  // the whole span.
  const cn = ((fa[0] * nx + fa[1] * ny + ca.r) + (fb[0] * nx + fb[1] * ny - cb.r)) / 2;
  const twoPoint = hi - lo > 1e-6;
  const count = twoPoint ? 2 : 1;
  // Lever arms and closing speed at each contact point.
  const rax: number[] = [];
  const ray: number[] = [];
  const rbx: number[] = [];
  const rby: number[] = [];
  const crossA: number[] = [];
  const crossB: number[] = [];
  const vn: number[] = [];
  // Any rotating body carries spin; a ball's ω is always 0.
  const wA = a.kind !== 'ball' ? a.angularVelocity : 0;
  const wB = b.kind !== 'ball' ? b.angularVelocity : 0;
  for (let k = 0; k < count; k++) {
    const s = twoPoint ? (k === 0 ? lo : hi) : (lo + hi) / 2;
    const px = nx * cn + tx * s;
    const py = ny * cn + ty * s;
    rax[k] = px - a.x;
    ray[k] = py - a.y;
    rbx[k] = px - b.x;
    rby[k] = py - b.y;
    crossA[k] = rax[k] * ny - ray[k] * nx;
    crossB[k] = rbx[k] * ny - rby[k] * nx;
    // Contact velocities (v + ω×r, ω×r = ω·(−r_y, r_x)), relative B−A.
    const vrx = b.vx - wB * rby[k] - (a.vx - wA * ray[k]);
    const vry = b.vy + wB * rbx[k] - (a.vy + wA * rax[k]);
    vn[k] = vrx * nx + vry * ny;
  }
  let impact = 0;
  for (let k = 0; k < count; k++) if (vn[k] < 0 && -vn[k] > impact) impact = -vn[k];
  if (impact === 0) return 0; // touching but separating — positional fix is enough
  // Restitution: the softer of the two bodies, dropped to 0 for a slow contact.
  const e = impact < PAIR_REST_EPS ? 0 : Math.min(restitutionOf(a), restitutionOf(b));
  const eff = (i: number, k: number): number =>
    imSum + iIA * crossA[i] * crossA[k] + iIB * crossB[i] * crossB[k];
  const jn: number[] = [];
  if (count === 1) {
    jn[0] = vn[0] < 0 ? (-(1 + e) * vn[0]) / eff(0, 0) : 0;
  } else {
    // Solved together, so a crate set squarely on another crate takes two equal
    // impulses whose torques cancel and the stack simply holds (see the header).
    const [j0, j1] = solveNormalPair(
      eff(0, 0), eff(0, 1), eff(1, 1),
      vn[0] < 0 ? -(1 + e) * vn[0] : 0,
      vn[1] < 0 ? -(1 + e) * vn[1] : 0,
    );
    jn[0] = j0;
    jn[1] = j1;
  }
  for (let k = 0; k < count; k++) {
    if (jn[k] <= 0) continue;
    a.vx -= jn[k] * nx * imA;
    a.vy -= jn[k] * ny * imA;
    b.vx += jn[k] * nx * imB;
    b.vy += jn[k] * ny * imB;
    if (a.kind !== 'ball') a.angularVelocity -= iIA * crossA[k] * jn[k];
    if (b.kind !== 'ball') b.angularVelocity += iIB * crossB[k] * jn[k];
  }
  // Friction along the tangent, Coulomb-clamped to μ·jn, from the post-normal
  // relative velocity — the torque source that lets one body spin another.
  for (let k = 0; k < count; k++) {
    if (jn[k] <= 0) continue;
    const wA2 = a.kind !== 'ball' ? a.angularVelocity : 0;
    const wB2 = b.kind !== 'ball' ? b.angularVelocity : 0;
    const vrx2 = b.vx - wB2 * rby[k] - (a.vx - wA2 * ray[k]);
    const vry2 = b.vy + wB2 * rbx[k] - (a.vy + wA2 * rax[k]);
    const vt = vrx2 * tx + vry2 * ty;
    const raCrossT = rax[k] * ty - ray[k] * tx;
    const rbCrossT = rbx[k] * ty - rby[k] * tx;
    const effT = imSum + iIA * raCrossT * raCrossT + iIB * rbCrossT * rbCrossT;
    let jt = -vt / effT;
    const maxF = OBJECT_FRICTION * jn[k];
    if (jt > maxF) jt = maxF;
    else if (jt < -maxF) jt = -maxF;
    a.vx -= jt * tx * imA;
    a.vy -= jt * ty * imA;
    b.vx += jt * tx * imB;
    b.vy += jt * ty * imB;
    if (a.kind !== 'ball') a.angularVelocity -= iIA * raCrossT * jt;
    if (b.kind !== 'ball') b.angularVelocity += iIB * rbCrossT * jt;
  }
  return impact;
}

/** Restitution of any body (ball or drum). */
function restitutionOf(o: SimBody): number {
  return o.restitution;
}

/**
 * Relax every overlapping pair a few passes (O(n²) per pass — object counts are
 * small). This is the "완전한 물리적 상호작용" between bodies.
 *
 * Fills `impacts` with, per body, the hardest normal closing speed it met another
 * body at this tick — the object↔object counterpart of the arrival speed
 * stepCapsule reports against the grid, and read by exactly the same smash
 * thresholds (see stepObjects). Only the FIRST relaxation pass writes it: by the
 * later passes the bodies are looking at velocities the first pass's impulses
 * already reflected, so a crash would read as a much softer touch than it was.
 */
function resolveObjectPairs(
  objects: SimBody[],
  impacts: Map<SimBody, number> | null,
  touched: Set<SimBody>,
): void {
  const n = objects.length;
  if (n < 2) return;
  for (let iter = 0; iter < PAIR_ITERATIONS; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const hit = resolvePair(objects[i], objects[j]);
        if (hit < 0) continue; // not touching
        touched.add(objects[i]);
        touched.add(objects[j]);
        if (impacts === null || iter > 0 || hit === 0) continue;
        // Both halves of a collision feel it: a crate slammed into a parked crate
        // bursts, and so does the one it hit (둘 다 파괴).
        for (const o of [objects[i], objects[j]]) {
          if (hit > (impacts.get(o) ?? 0)) impacts.set(o, hit);
        }
      }
    }
  }
}

/**
 * Evaluate a body's terminal triggers after all motion this tick has settled.
 * Priority: a direct blast hit or being crushed in solid destroys it outright;
 * otherwise sustained heat destroys it over time. A drum leaves a byproduct
 * (metal powder when shattered by blast/crush, a molten-iron puddle when melted
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
    // A cosmetic reading is not a flame: a Firework Burst flower drifting across
    // the fuse must neither re-light a dud nor otherwise count as heat, so it
    // reads as plain ambient air here (see Material.decorTemp).
    const tipTemp =
      tipId !== EMPTY && getMaterial(tipId).decorTemp ? AMBIENT_TEMP : ctx.getTemp(tcx, tcy);
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

/** Place one Smoke cell at (x,y) if that cell is open. Smoke is a gas the CA
 *  already knows how to move (it rises, diffuses and fades on its own timer), so
 *  the canister's whole job is seeding cells and letting the grid take it from
 *  there. spawn() marks the cell moved, so a fresh puff isn't re-processed the
 *  same tick. Silently skipped on an occupied cell — a bomb buried in sand vents
 *  through whatever gaps it has rather than carving them — with ONE exception:
 *  liquid, which the charge shoves aside instead of being stopped by (see below). */
function puffSmoke(ctx: SimContext, cx: number, cy: number): void {
  if (!ctx.inBounds(cx, cy)) return;
  const id = ctx.get(cx, cy);
  if (id === EMPTY) {
    ctx.spawn(cx, cy, SMOKE.id);
    return;
  }
  // 액체 속에서도 연기 발생. A smoke composition doesn't need air — it makes its own
  // gas — so water is not a lid on it, only something in the way. The plume used
  // to travel *through* a pond (smokePassable) and yet only ever surface above it,
  // which read as a canister that goes quiet the moment it sinks. Now the gas
  // forms down there too: it takes the liquid's cell and the liquid it evicted
  // goes up the column (displaceLiquidUp — the level rises to make room, nothing
  // is destroyed), then bubbles up through the water on its own buoyancy like any
  // other gas. A canister thrown in a pond now boils it and blooms at the surface.
  const m = getMaterial(id);
  if (m.phase !== Phase.Liquid || ctx.isFrozen(cx, cy)) return; // ice is a wall, not a pond
  if (!ctx.chance(SMOKE_SUBMERGED_CHANCE)) return;
  if (!displaceLiquidUp(ctx, cx, cy)) return;
  // If the sandbox's smoke level thins this puff away (SimContext.spawn), the cell
  // is simply left empty and the water that moved up falls straight back into it —
  // no smoke, nothing lost.
  ctx.spawn(cx, cy, SMOKE.id);
}

/** Per-cell chance a puff that lands on a LIQUID cell actually forms there, on
 *  top of the stage's own density. Well under 1 on purpose: underwater smoke has
 *  to shove real water out of the way to exist, and at full density a 2.5-second
 *  discharge would heave an entire pond out of its basin in a couple of seconds.
 *  At this rate a submerged canister reads as a rolling boil of bubbles that
 *  blooms into a proper cloud once it reaches the surface — which is what a smoke
 *  grenade dropped in water actually looks like. */
const SMOKE_SUBMERGED_CHANCE = 0.35;

/** How far up the column the evicted liquid may travel to find room, in cells.
 *  Deep enough for any ordinary pond; a canister sealed in a brim-full tank with
 *  nowhere for the water to go simply doesn't smoke inside it, which is the right
 *  answer for an incompressible liquid. */
const SMOKE_DISPLACE_REACH = 64;

/**
 * Make room for one cell of smoke inside a body of liquid by shoving that liquid
 * *up* the column (against gravity, so a flipped or sideways sandbox works too)
 * into the first open cell it finds. The water level rises to make room, which is
 * both what really happens when a charge gasses off underwater and what keeps the
 * pond conserved — no liquid is deleted anywhere in this path. Returns false, and
 * changes nothing, when there is nowhere for it to go.
 *
 * The walk passes through liquid AND gas. Gas matters: within a tick or two the
 * plume has laid its own Smoke over the pond, and stopping the search at it would
 * shut the bubbling off just as it got going. A liquid parked above a gas cell
 * falls straight back down through it under the ordinary density sort, so the only
 * cost is a cell of water briefly riding high.
 */
function displaceLiquidUp(ctx: SimContext, x: number, y: number): boolean {
  const ux = -ctx.gravityX;
  const uy = -ctx.gravityY;
  let cx = x;
  let cy = y;
  for (let i = 0; i < SMOKE_DISPLACE_REACH; i++) {
    cx += ux;
    cy += uy;
    if (!ctx.inBounds(cx, cy)) return false; // out of the world — no room that way
    const id = ctx.get(cx, cy);
    if (id === EMPTY) {
      ctx.swap(x, y, cx, cy); // the liquid (with its temp/aux/tint) rises; its cell frees up
      return true;
    }
    const p = getMaterial(id).phase;
    if (p === Phase.Gas) continue;
    if (p === Phase.Liquid && !ctx.isFrozen(cx, cy)) continue;
    return false; // solid, powder or ice caps the column
  }
  return false;
}

// Chamfer step costs for the smoke flood below, so the cloud grows as a round
// front rather than a diamond (a diagonal step is ~√2 orthogonal ones) — the same
// metric blast.ts uses for its crater.
const SMOKE_STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [1, 0, 1],
  [-1, -1, 1.4142],
  [1, -1, 1.4142],
  [-1, 1, 1.4142],
  [1, 1, 1.4142],
];

// Reused scratch for that flood, keyed by flat cell index: a monotonic stamp id
// marks the cells this call has already queued, so nothing is allocated per tick
// and the buffer never needs clearing between calls. Same trick as blast.ts's
// visited buffer.
let smokeStamp: Int32Array | null = null;
let smokeStampW = 0;
let smokeStampH = 0;
let smokeStampId = 0;

/** Fetch the flood's visited buffer (reallocating on a grid resize) and advance
 *  to a fresh stamp id for this call. */
function nextSmokeStamp(ctx: SimContext): Int32Array {
  if (!smokeStamp || smokeStampW !== ctx.width || smokeStampH !== ctx.height) {
    smokeStampW = ctx.width;
    smokeStampH = ctx.height;
    smokeStamp = new Int32Array(smokeStampW * smokeStampH); // all zero; ids start at 1
    smokeStampId = 0;
  }
  smokeStampId++;
  if (smokeStampId >= 0x7fffffff) {
    smokeStamp.fill(0);
    smokeStampId = 1;
  }
  return smokeStamp;
}

/**
 * True if the smoke front can travel *through* this cell. Only *structure* stops
 * smoke — a wall, a stone block, a machine. Everything loose it seeps through:
 *
 *   - other gas, which crucially includes the Smoke it laid down on earlier ticks
 *     (otherwise a venting canister's own cloud walls its front in after a tick);
 *   - powder, because a sand bed is grains with gaps between them, not a seal;
 *   - liquid, so a canister dropped in a pond still sends its plume up through
 *     the water instead of going silent — but only while it's actually *liquid*.
 *     A frozen one (`SimContext.isFrozen`: a `freeze` material at or below its
 *     point) is a block of ice, and every other system in the engine already
 *     treats it as structure — movement refuses to displace it, and the object
 *     layer's own `solidLike` bounces bodies off it. Smoke is no different: an
 *     ice wall shelters what's behind it exactly like a stone one, so freezing a
 *     pond over is a real way to seal a room (언 액체가 고체 벽으로 취급되지 않던
 *     문제). It thaws back to a passable pond the moment it warms up;
 *   - a `porous` solid (Mesh, Turbine, Pump), which is built to let fluids pass
 *     through as if it weren't there — the engine's own overlap rule already says
 *     such a host admits a gas.
 *
 * Passing through is NOT the same as filling: `puffSmoke` decides separately what
 * a reached cell can actually take. Empty air always takes a puff; a LIQUID cell
 * takes one at a reduced rate, by shoving its liquid up the column to make room
 * (액체 속에서도 연기 발생 — see puffSmoke/displaceLiquidUp), so a submerged canister
 * boils the pond it sits in as well as blooming at the surface; a powder bed only
 * takes puffs in the pockets between its grains, so a buried canister fills the
 * gaps it has and the space above rather than being smothered outright.
 *
 * Deliberately not written into the 겹침 (overlay) slot of a host that could take
 * it: SimContext's movement seam is the sole enforcer of the (host, overlay)
 * invariant (see its `canHostOverlap` note), and the object layer is read-only
 * over the grid apart from the discrete spawns it already makes.
 */
function smokePassable(ctx: SimContext, x: number, y: number): boolean {
  const id = ctx.get(x, y);
  if (id === EMPTY) return true;
  const m = getMaterial(id);
  if (m.phase === Phase.Solid) return m.porous === true;
  // Frozen liquid is ice: a wall, not a pond. Gated on the material even being
  // freezable so the common cell (air, gas, water, a grain of sand) doesn't pay
  // for the temperature read.
  return m.freeze === undefined || !ctx.isFrozen(x, y);
}

/**
 * Seed Smoke outward from (ox,oy) up to `radius` cells, each open cell reached
 * taking a puff with probability `density`. `density` 1 fills every open cell at
 * once.
 *
 * This is a FLOOD, not a radial scan, and that distinction is the whole point:
 * smoke has to travel to where it ends up, so a solid wall stops it and shelters
 * what's behind. A plain "every empty cell within r" scan (what this used to be)
 * let a canister sealed in a box fill the room outside it, and let one on the far
 * side of a wall smoke straight through it. The front spreads only through open
 * air, loose matter and existing gas (see smokePassable), so it rounds corners,
 * seeps through a sand bed or a pond, and pours out of a container's mouth
 * instead of ignoring it — the same geodesic treatment the Woofer's shockwave
 * gets, for the same reason. Only *structure* stops it.
 *
 * Both of the smoke bomb's stages are this one call with different numbers: a
 * small radius for the fuse-stage wisp, a large one for the discharge — both
 * anchored on the canister itself. Cost is bounded by the reachable area within `radius`,
 * so even the full-density rupture is one pass over a few thousand cells.
 */
function puffDisc(
  ctx: SimContext,
  ox: number,
  oy: number,
  radius: number,
  density: number,
): void {
  if (density <= 0 || radius <= 0) return;
  const w = ctx.width;
  const h = ctx.height;
  const cx0 = Math.floor(ox);
  const cy0 = Math.floor(oy);
  const stamp = nextSmokeStamp(ctx);
  const id_s = smokeStampId;
  const qx: number[] = [];
  const qy: number[] = [];
  const qb: number[] = [];

  // Seed the source cell and ONLY the source cell. Seeding its neighbours as a
  // fallback (for a source whose own cell is occupied) is what let the front hop a
  // 1-cell wall: a source sitting against a wall has a neighbour on the *far*
  // side, and starting there put smoke outside a sealed room. The fallback also
  // isn't needed any more — matter is passable now (see smokePassable), so the
  // only thing that can occupy the source cell is solid structure, and a body
  // can't come to rest inside that (collision resolution pushes it out). A source
  // genuinely walled in emits nothing, which is the right answer.
  if (!ctx.inBounds(cx0, cy0) || !smokePassable(ctx, cx0, cy0)) return;
  stamp[cy0 * w + cx0] = id_s;
  qx.push(cx0);
  qy.push(cy0);
  qb.push(radius);

  let head = 0;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    const budget = qb[head];
    head++;
    if (density >= 1 || ctx.chance(density)) puffSmoke(ctx, x, y);
    for (let i = 0; i < SMOKE_STEPS.length; i++) {
      const dx = SMOKE_STEPS[i][0];
      const dy = SMOKE_STEPS[i][1];
      const nx = x + dx;
      const ny = y + dy;
      const left = budget - SMOKE_STEPS[i][2];
      if (left < 0) continue;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nidx = ny * w + nx;
      if (stamp[nidx] === id_s) continue;
      if (!smokePassable(ctx, nx, ny)) continue; // structure stops the front and shelters what's behind
      // No corner-cutting: a diagonal step needs at least one of its two flanking
      // orthogonal cells open, so the front can't squeeze through the point where
      // two solids merely touch at a corner. Without this the wall guarantee is
      // only true for orthogonally-contiguous walls — smoke poured straight
      // through any 1-cell-thick 45° wall or ramp (an ordinary thing to build),
      // because every step crossing such a wall has BOTH flanks inside it.
      // "At least one" rather than "both" is deliberate: it still lets the front
      // round an ordinary convex corner, which is the behaviour that makes a
      // cloud pour out of a doorway.
      if (dx !== 0 && dy !== 0 && !smokePassable(ctx, x + dx, y) && !smokePassable(ctx, x, y + dy)) {
        continue;
      }
      stamp[nidx] = id_s;
      qx.push(nx);
      qy.push(ny);
      qb.push(left);
    }
  }
}

/** The heavy discharge: a dense puff over the whole canister's cloud radius (not
 *  just a thin plume — a venting or ruptured can gushes from everywhere at once). */
function ventSmoke(o: SimSmokeBomb, ctx: SimContext, density: number): void {
  puffDisc(ctx, o.x, o.y, bodyReach(o) * SMOKE_BOMB_VENT_SPREAD, density);
}

/**
 * Per-tick lifecycle for a smoke bomb, after this tick's heat conduction (called
 * from evaluateTriggers with the resolved `heat`). Two stages and nothing else:
 *   1. FUSE — a thin wisp seeps off the canister while `fuseTicks` runs down.
 *      Sustained external heat (fire, lava, the 가열 brush) cooks the charge off
 *      early and opens the vent now, cutting the rest of the fuse.
 *   2. VENT — the canister pours out a dense cloud every tick while `ventTicks`
 *      runs down (2.5s worth), and is dropped when it hits 0 (소멸).
 * Returns true to keep the canister, false once it's spent.
 */
function stepSmokeBomb(o: SimSmokeBomb, ctx: SimContext, heat: number): boolean {
  if (o.ventTicks <= 0) {
    // --- Stage 1: the fuse. ---
    if (heat >= SMOKE_BOMB_IGNITE_TEMP) {
      o.heatTicks++;
      if (o.heatTicks >= SMOKE_BOMB_HEAT_TICKS) o.fuseTicks = 0; // cooked off early
    } else if (o.heatTicks > 0) {
      o.heatTicks--;
    }
    if (o.fuseTicks > 0) {
      o.fuseTicks--;
      // A wisp seeping from around the canister. Deliberately anchored at the
      // BODY, not at the nozzle tip: the tip sits 5.5 cells off-centre along the
      // capsule's axis, and a canister lying against a wall can point it straight
      // *into* (or through) that wall — which put the wisp on the far side of a
      // sealed room. The body centre is always the canister's actual location, so
      // the plume can only ever start where the canister really is.
      puffDisc(ctx, o.x, o.y, SMOKE_BOMB_TRICKLE_RADIUS, SMOKE_BOMB_TRICKLE_DENSITY);
      return true;
    }
    o.ventTicks = SMOKE_BOMB_VENT_TICKS; // fuse spent (or cooked off) — open the vent
  }
  // --- Stage 2: the discharge. ---
  ventSmoke(o, ctx, SMOKE_BOMB_VENT_DENSITY);
  return --o.ventTicks > 0;
}

// ───────────────────── Wooden box: burning and breaking ─────────────────────
//
// The wooden box is the first *flammable* body (가연성). Everything above either
// ignores fire (the drums melt) or is set off by it (the dynamite, the smoke
// bomb); a crate instead catches, burns for a while as a real fire that spreads,
// and then gives way. What it leaves behind is the other new idea: a crate does
// not vanish when it breaks, it becomes THREE MORE BODIES — the three shards of
// its own art — and each of those, broken in turn, crumbles into Sawdust cells on
// the grid. So one click's worth of crate can end as a burning pile of shavings.

/** Uniform float in [-1, 1), drawn through SimContext's randomness seam (which
 *  offers only integers) rather than reaching for Math.random directly. */
function randSigned(ctx: SimContext): number {
  return ctx.randInt(2001) / 1000 - 1;
}

/**
 * How much of the body's footprint is matter that puts a fire out, as a fraction
 * of the footprint (so the test is size-independent — the same soaking douses a
 * shard, the crate it came from, and a molotov). Read-only.
 *
 * Quenching matter is CO₂ / Liquid N₂ (the engine's named extinguishers, same
 * pair the dynamite's fuse recognizes) or a non-frozen liquid that is genuinely
 * capable of putting a fire out. That last qualifier does real work: a *liquid*
 * is not automatically wet-blanket. A pool of Lava or Molten Iron is a liquid
 * and would otherwise "douse" the crate floating on it — the exact opposite of
 * what should happen — so a liquid only counts when it is cooler than `hotLimit`
 * (the caller's own ignition point), and Gasoline/Oil/Alcohol are excluded
 * outright for being fuel rather than water. The last exclusion is what keeps a
 * molotov's own spilt Alcohol from putting its own wick out.
 *
 * Frozen liquid deliberately does NOT count either: a block of ice isn't wet, and
 * the rest of the engine already treats a frozen cell as structure, not fluid.
 *
 * Written over the shared core footprint (bodyCore) rather than a disc so it
 * serves both burning bodies with one scan — the crate's rounded box and the
 * molotov's stadium alike.
 */
function bodyQuenchFrac(o: CapsuleBody, ctx: SimContext, hotLimit: number): number {
  const core = bodyCore(o);
  const r2 = core.r * core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.ceil(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.ceil(o.y + spanY);
  let footprint = 0;
  let quench = 0;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      footprint++;
      if (!ctx.inBounds(cx, cy)) continue;
      const id = ctx.get(cx, cy);
      if (id === EMPTY) continue;
      if (id === CO2.id || id === LIQUID_NITROGEN.id) {
        quench++;
        continue;
      }
      const m = getMaterial(id);
      if (m.phase !== Phase.Liquid || ctx.isFrozen(cx, cy)) continue;
      if (m.combustible === true || m.explosive === true) continue; // fuel, not water
      if (ctx.getTemp(cx, cy) >= hotLimit) continue; // lava/molten iron: not a dousing
      quench++;
    }
  }
  return footprint > 0 ? quench / footprint : 0;
}

/**
 * Throw real Fire cells off a burning body — the flame is genuine CA fire (the
 * dynamite fuse's approach), not something drawn on the sprite, so it flickers,
 * rises, heats what's above it and ignites whatever the crate was resting
 * against. Seeded only into open footprint cells, so a crate buried in sand burns
 * through whatever gaps it has instead of carving them (the object layer stays
 * read-only over matter it didn't put there).
 */
function emitWoodBoxFlames(o: SimWoodBox, ctx: SimContext): void {
  const r = o.radius;
  const r2 = r * r;
  const x0 = Math.floor(o.x - r);
  const x1 = Math.ceil(o.x + r);
  const y0 = Math.floor(o.y - r);
  const y1 = Math.ceil(o.y + r);
  for (let cy = y0; cy < y1; cy++) {
    const dy = cy + 0.5 - o.y;
    for (let cx = x0; cx < x1; cx++) {
      const dx = cx + 0.5 - o.x;
      if (dx * dx + dy * dy > r2) continue;
      if (!ctx.inBounds(cx, cy) || !ctx.isEmpty(cx, cy)) continue;
      if (!ctx.chance(WOOD_BOX_FLAME_CHANCE)) continue;
      ctx.spawn(cx, cy, FIRE.id);
    }
  }
}

/**
 * What broke a body that breaks into pieces (the wooden crate and the drum) — and
 * therefore whether the wreckage FLIES.
 *
 *   - 'impact' (충격): something hit it. A crash into a wall or the ground at
 *     smashing speed, an explosion's direct hit, an Antimatter touch. There is a
 *     real shock to pass on, so the shards are thrown clear and a shard's own
 *     crumbs (Sawdust / Metal Powder) are flung across the scene.
 *   - 'collapse': nothing struck it — it simply gave way. It burnt through, it
 *     melted open, it was eaten through by Acid, it was crushed/entombed in solid
 *     with nowhere to go, or a Nuclear Ray ate it away. Wreckage from a collapse
 *     just DROPS where the body stood: the shards fall apart in place carrying
 *     only the motion the body already had, and the crumbs settle into a heap
 *     instead of spraying (불타거나 끼인 경우엔 튀지 않고 그냥 부서짐).
 */
export type BreakCause = 'impact' | 'collapse';

/**
 * Place a freshly-built shard `piece` into the slot it occupied inside `parent`
 * and give it its parting motion — the one piece of arithmetic the wooden crate
 * and the drum genuinely share when they come apart.
 *
 * `lx`/`ly` are the shard's offset from the parent's center in the parent's
 * UPRIGHT frame (cells), straight out of its art. Carrying it through the parent's
 * own rotation is what makes a body that broke while tumbling scatter along the
 * axis it was actually lying on rather than along the screen's.
 *
 * On an 'impact' the shard is thrown outward from the parent's center with a lift
 * against gravity (so it pops out of the wreckage instead of sliding out of it), a
 * little random spread, and a random spin — for the first instant the wreckage
 * still reads as the body that just burst. On a 'collapse' it inherits exactly the
 * motion the parent had and drops out of the wreck under gravity. Either way it
 * inherits the parent's angle and heat (`temp`), so a red-hot barrel leaves red-hot
 * shards; anything else the caller sets afterwards (the crate's burn timer).
 */
function placeShard(
  parent: { x: number; y: number; vx: number; vy: number; angle: number; angularVelocity: number; temp: number },
  piece: { x: number; y: number; vx: number; vy: number; angle: number; angularVelocity: number; temp: number },
  lx: number,
  ly: number,
  ctx: SimContext,
  cause: BreakCause,
  kick: number,
  lift: number,
  spin: number,
): void {
  const cos = Math.cos(parent.angle);
  const sin = Math.sin(parent.angle);
  const dx = lx * cos + ly * sin;
  const dy = -lx * sin + ly * cos;
  piece.x = parent.x + dx;
  piece.y = parent.y + dy;
  piece.angle = parent.angle; // it starts as the part of the body it just was
  piece.temp = parent.temp;
  if (cause === 'impact') {
    const d = Math.hypot(dx, dy) || 1;
    piece.vx = parent.vx + (dx / d) * kick + randSigned(ctx) * kick * 0.3 - ctx.gravityX * lift;
    piece.vy = parent.vy + (dy / d) * kick + randSigned(ctx) * kick * 0.3 - ctx.gravityY * lift;
    // Splinters tumble: the parent's own spin plus a random kick of its own.
    piece.angularVelocity = parent.angularVelocity + randSigned(ctx) * spin;
  } else {
    piece.vx = parent.vx;
    piece.vy = parent.vy;
    piece.angularVelocity = parent.angularVelocity;
  }
}

/**
 * Break a drum, whatever broke it (an explosion, a crush, heat melting it open).
 * The drum's half of the 2차 오브젝트 rule, and the exact shape of the crate's
 * (breakWoodBox):
 *
 *   - a whole BARREL comes apart into its three shards, each spawned at exactly the
 *     spot it occupied inside the drum (see drumSprite.ts PIECE_OFFSET). They
 *     inherit its velocity, its rotation and its heat, and they are steel scrap
 *     from here on: they sink, they still answer the electromagnet, and they melt
 *     at a slightly higher temperature than the barrel did. The shards exist ONLY
 *     through this path.
 *   - a SHARD has nothing left to break into, so it shatters into Metal Powder.
 *
 * `cause` decides how violently that happens (see BreakCause). What it does NOT
 * decide is whether the contents pour out: that happens the moment the barrel
 * opens, however it opened (spawnFillSpill, called by the two callers before this).
 *
 * New bodies go into `spawn` rather than straight into the live object array:
 * stepObjects is compacting that array in place when this runs, so appending to it
 * mid-pass would clobber the compaction. The caller appends them afterwards.
 */
function breakDrum(o: SimCapsule, ctx: SimContext, spawn: SimBody[], cause: BreakCause): void {
  if (o.part !== 'drum') {
    spawnDrumDebris(o, ctx);
    return;
  }
  // Carry a non-default barrel size through to its wreckage, so the shards always
  // add back up to the drum they came off.
  const scale = o.radius / DRUM_RADIUS;
  const px = DRUM_CELLS_PER_PX * scale;
  for (const part of DRUM_PIECES) {
    const art = drumPieceSpriteFor(o.fill, part);
    const piece = createDrumPiece(o.x, o.y, o.fill, part, scale);
    placeShard(
      o, piece, art.ox * px, art.oy * px, ctx, cause,
      DRUM_SHATTER_SPEED, DRUM_SHATTER_LIFT, DRUM_SHATTER_SPIN,
    );
    spawn.push(piece);
  }
}

/**
 * A shard crumbles to Sawdust (materials/sawdust.ts) across its footprint, so it
 * leaves a visible heap of shavings rather than simply vanishing. Sawdust is itself
 * combustible, so a shard that crumbles while alight leaves a pile the surrounding
 * fire happily takes over.
 *
 * An IMPACT crumble reuses the blast-fragment scatter (launchDebris), so the
 * shavings arc out and rain back down; it may take over any non-solid cell, the way
 * a blast does (the object layer stays read-only over terrain). A COLLAPSE just
 * deposits the shavings where the shard was, into open air only — nothing pushed
 * them, so they fall straight down as a pile and never displace the water or sand
 * the body was sitting in.
 */
function spawnSawdust(o: SimWoodBox, ctx: SimContext, cause: BreakCause): void {
  const impact = cause === 'impact';
  const r = o.radius;
  const r2 = r * r;
  const x0 = Math.floor(o.x - r);
  const x1 = Math.ceil(o.x + r);
  const y0 = Math.floor(o.y - r);
  const y1 = Math.ceil(o.y + r);
  for (let cy = y0; cy < y1; cy++) {
    const dy = cy + 0.5 - o.y;
    for (let cx = x0; cx < x1; cx++) {
      const dx = cx + 0.5 - o.x;
      if (dx * dx + dy * dy > r2) continue;
      if (!ctx.inBounds(cx, cy)) continue;
      if (impact ? isSolidCell(cx, cy, ctx) : !ctx.isEmpty(cx, cy)) continue;
      if (!ctx.chance(WOOD_BOX_SAWDUST_CHANCE)) continue;
      if (impact) launchDebris(ctx, cx, cy, SAWDUST.id, cx + 0.5 < o.x ? -1 : 1, -1, 1.5);
      else ctx.spawn(cx, cy, SAWDUST.id);
    }
  }
}

/**
 * Break a wooden box, whatever broke it (fire burning through, a blast, a crush).
 * This is the 2차 오브젝트 rule and the one place it lives:
 *
 *   - a CRATE comes apart into its three shards, each spawned at exactly the spot
 *     it occupied inside the box (see WoodBoxSprite.ox/oy). They inherit the
 *     crate's velocity and its heat, and — if the crate was alight — they spawn
 *     already burning, which is what makes a burning crate a chain rather than a
 *     single event. The shards exist ONLY through this path: nothing else can
 *     create one (조각은 나무 상자를 부술 때만 소환).
 *   - a SHARD has nothing left to break into, so it crumbles to Sawdust cells.
 *
 * `cause` decides how violently that happens (see BreakCause and placeShard, the
 * scatter this shares with the drum): an impact throws the shards outward from the
 * crate's centre with a little lift and a spin each, so for the first instant the
 * wreckage still reads as the box that just burst; a collapse leaves them exactly
 * where they were, carrying only the motion the crate already had, so the box
 * slumps into three pieces on the spot.
 *
 * New bodies go into `spawn` rather than straight into the live object array:
 * stepObjects is compacting that array in place when this runs, so appending to
 * it mid-pass would clobber the compaction. The caller appends them afterwards.
 */
function breakWoodBox(
  o: SimWoodBox,
  ctx: SimContext,
  spawn: SimBody[],
  alight: boolean,
  cause: BreakCause,
): void {
  if (o.part !== 'crate') {
    spawnSawdust(o, ctx, cause);
    return;
  }
  for (const part of WOOD_BOX_PIECES) {
    const art = WOOD_BOX_SPRITES[part];
    const piece = createWoodBox(o.x, o.y, part);
    placeShard(
      o, piece, art.ox * WOOD_BOX_CELLS_PER_PX, art.oy * WOOD_BOX_CELLS_PER_PX, ctx, cause,
      WOOD_BOX_SHATTER_SPEED, WOOD_BOX_SHATTER_LIFT, WOOD_BOX_SHATTER_SPIN,
    );
    if (alight) piece.burnTicks = woodBoxBurnTicks(part);
    spawn.push(piece);
  }
}

/**
 * Per-tick chemistry and flammability for a wooden box, after this tick's heat
 * conduction (called from evaluateTriggers with the resolved `heat`).
 *
 * ACID first, because it is the one end that doesn't care what state the timber is
 * in: touching a puddle for WOOD_BOX_ACID_TICKS eats through the body whether it
 * is cold, warm or alight (산에 닿으면 파괴). Ordinary contact is enough — where the
 * crate's other break needs a genuine hurl and its burn needs a real fire, acid
 * only has to be there. It is a 'collapse': nothing struck the box, it was eaten,
 * so a crate slumps into its three shards on the spot and a shard settles into a
 * heap of Sawdust (which the acid then corrodes on the grid, as it would any
 * powder). A crate carried through a splash and back out survives — the counter
 * bleeds back down.
 *
 * Then the fire, which is three states and nothing else:
 *   1. NOT ALIGHT — sustained heat at/above the timber's ignition point sets it
 *      burning; anything less lets the counter bleed back down.
 *   2. ALIGHT — a good soaking (a pond, a poured bucket, CO₂ over a quarter of the
 *      footprint) puts it straight back out, otherwise it throws real Fire cells
 *      and its burn timer runs down. Acid is a liquid and cool, so a bath of it
 *      douses the crate on the way to dissolving it — which is why an acid break
 *      normally hands the shards no fire, and a mere splash (too little to douse
 *      with, enough to touch) is the case where a burning crate does pass its
 *      flames on.
 *   3. BURNT THROUGH — the body gives way: a crate into its three shards, a shard
 *      into Sawdust (see breakWoodBox). Nothing struck it, so the wreckage falls
 *      apart in place rather than being thrown ('collapse').
 * Returns true to keep the body, false once it has broken.
 */
function stepWoodBox(
  o: SimWoodBox,
  ctx: SimContext,
  heat: number,
  spawn: SimBody[],
): boolean {
  if (footprintTouchesAcid(o, ctx)) {
    if (++o.acidTicks >= WOOD_BOX_ACID_TICKS) {
      breakWoodBox(o, ctx, spawn, o.burnTicks > 0, 'collapse');
      return false;
    }
  } else if (o.acidTicks > 0) {
    o.acidTicks--;
  }
  if (o.burnTicks <= 0) {
    if (heat >= WOOD_BOX_IGNITE_TEMP) {
      o.heatTicks++;
      if (o.heatTicks >= WOOD_BOX_IGNITE_TICKS) {
        o.heatTicks = 0;
        o.burnTicks = woodBoxBurnTicks(o.part);
      }
    } else if (o.heatTicks > 0) {
      o.heatTicks--;
    }
    if (o.burnTicks <= 0) return true;
  }
  if (bodyQuenchFrac(o, ctx, WOOD_BOX_IGNITE_TEMP) >= WOOD_BOX_DOUSE_FRAC) {
    o.burnTicks = 0; // doused — back to plain, unlit timber (it can catch again)
    return true;
  }
  emitWoodBoxFlames(o, ctx);
  if (--o.burnTicks > 0) return true;
  breakWoodBox(o, ctx, spawn, true, 'collapse');
  return false;
}

// ───────────────────── Molotov: the wick and the shatter ─────────────────────
//
// The molotov is the first body whose *destruction is the feature*. Every other
// one is built to survive: the crate wants a real hurl, the drum wants sustained
// heat, the ball wants a fire. A bottle wants to be thrown at something, so it
// breaks at under a third of the crate's speed (MOLOTOV_SMASH_SPEED) and everything
// interesting happens in what it leaves behind.

/**
 * Throw a real Fire cell off the lit wick — the flame is genuine CA fire (the
 * dynamite fuse's approach, and for the same reason: a painted-on flame would be
 * a lie the world can't act on), so a burning bottle actually lights the oil
 * slick it is lying in.
 *
 * The wick sits just past the top cap along the bottle's long axis, which rotates
 * as the bottle tumbles, so the flame tracks the neck at any orientation. Only
 * open air takes it: a bottle lying in water or buried in sand keeps its `lit`
 * flag (the douse check below is the sole authority on that) but has nowhere to
 * put a flame, which is exactly what a smothered wick looks like.
 */
function emitMolotovFlame(o: SimMolotov, ctx: SimContext): void {
  const [ux, uy] = capsuleAxis(o);
  const reach = o.halfLength + o.radius + 0.5;
  const cx = Math.floor(o.x - ux * reach);
  const cy = Math.floor(o.y - uy * reach);
  if (!ctx.inBounds(cx, cy) || !ctx.isEmpty(cx, cy)) return;
  ctx.spawn(cx, cy, FIRE.id);
}

/**
 * Shatter the bottle across its own footprint. Two byproducts, and they leave in
 * deliberately different ways:
 *
 *   - BROKEN GLASS **flies**. Each shard launches as a blast fragment
 *     (`launchDebris`, the crate's Sawdust scatter), thrown outward from the
 *     bottle's centre so the left half sprays left and the right half right, then
 *     arcs and rains back down (깨진 부위에서 사방으로 튄다). Like a blast's ejecta it
 *     may take over any non-solid cell.
 *   - ALCOHOL **stays**. It is spawned in place, and only if the bottle still HAD
 *     fuel — so a spent 빈 유리병 leaves nothing but shards (알콜 생성 없이). If the
 *     wick was lit the fuel is born already burning (불붙은 alcohol): pinned to
 *     FUEL_BURN_TEMP, which is what combustion.ts reads as a cell that is alight,
 *     so the puddle wreathes itself in flame and spreads on its own next tick.
 *
 * The fuel cannot be flung, and that is a hard constraint rather than a taste
 * call: a Debris grain packs its flight state into the cell's `temp`
 * (materials/debris.ts) and deposits its cargo at that material's own *initial*
 * temperature, so a launched fuel grain would always land cold and the burning
 * molotov would be indistinguishable from the doused one. It also reads better —
 * a bottle bursting against a wall paints it rather than arcing the fuel away.
 * Glass carries no state to lose, so it is free to fly.
 *
 * Neither writes over solid terrain (the object layer stays read-only over
 * anything it didn't put there). The two use the drum's established pair of
 * guards for exactly these two roles: `isSolidCell` for the thrown fragments
 * (spawnDrumDebris) and the Phase.Solid test for the poured liquid
 * (spawnFillSpill). Those two disagree in exactly the two narrow cases their
 * originals already disagree in: over a frozen puddle (which isSolidCell counts as
 * footing, so shards skitter off the ice while the fuel spreads across it) and
 * over a live Spark (which isSolidCell deliberately treats as no surface at all
 * even though its phase is Solid — see its note — so a shard may launch from a
 * cell the fuel is turned away from).
 *
 * However the bottle died, this is what it leaves: there is no impact/collapse
 * split (contrast BreakCause), because a crate can give way without being
 * struck whereas glass only ever ends one way.
 */
function breakMolotov(o: SimMolotov, ctx: SimContext): void {
  const fuelled = o.fuelTicks > 0;
  const alight = fuelled && o.lit;
  const core = bodyCore(o);
  const r2 = core.r * core.r;
  const [spanX, spanY] = coreHalfSpan(core);
  const x0 = Math.floor(o.x - spanX);
  const x1 = Math.ceil(o.x + spanX);
  const y0 = Math.floor(o.y - spanY);
  const y1 = Math.ceil(o.y + spanY);
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!ctx.inBounds(cx, cy)) continue;
      const [spx, spy] = coreClosest(core, cx + 0.5, cy + 0.5);
      const dx = cx + 0.5 - spx;
      const dy = cy + 0.5 - spy;
      if (dx * dx + dy * dy > r2) continue;
      if (ctx.chance(MOLOTOV_GLASS_CHANCE)) {
        if (isSolidCell(cx, cy, ctx)) continue;
        launchDebris(ctx, cx, cy, BROKEN_GLASS.id, cx + 0.5 < o.x ? -1 : 1, -1, MOLOTOV_GLASS_SCATTER);
        continue;
      }
      if (!fuelled || !ctx.chance(MOLOTOV_ALCOHOL_CHANCE)) continue;
      const cell = ctx.get(cx, cy);
      if (cell !== EMPTY && getMaterial(cell).phase === Phase.Solid) continue;
      ctx.spawn(cx, cy, ALCOHOL.id);
      // spawn() resets the cell to the material's own initial temperature, so the
      // burning pin has to go on afterwards.
      if (alight) ctx.setTemp(cx, cy, FUEL_BURN_TEMP);
    }
  }
}

/**
 * Per-tick wick logic for a molotov, after this tick's heat conduction (called
 * from evaluateTriggers with the resolved `heat`). Four steps:
 *   1. A sustained bath far hotter than its own flame bursts the bottle outright
 *      (see MOLOTOV_BURST_TEMP) — lava, a Blue Flame jet, a held Heat Ray.
 *   2. Any real soaking puts the wick out (물에 빠져도 소화). This is checked before
 *      the re-light, so a bottle sitting in a burning pool of its own fuel *in
 *      water* stays out rather than flickering on and off.
 *   3. Otherwise a flame or hot surroundings light a doused-but-fuelled wick
 *      again, immediately (the dynamite's fuse re-lights the same way).
 *   4. A lit wick throws a real flame and eats a tick of fuel; when the fuel runs
 *      out the bottle is a spent 빈 유리병 — still a body, still breakable, but
 *      with nothing left to spill or to light.
 * Returns true to keep the bottle, false once it has burst.
 */
function stepMolotov(o: SimMolotov, ctx: SimContext, heat: number): boolean {
  if (heat >= MOLOTOV_BURST_TEMP) {
    o.heatTicks++;
    if (o.heatTicks >= MOLOTOV_BURST_TICKS) {
      breakMolotov(o, ctx);
      return false;
    }
  } else if (o.heatTicks > 0) {
    o.heatTicks--;
  }
  if (bodyQuenchFrac(o, ctx, MOLOTOV_IGNITE_TEMP) >= MOLOTOV_DOUSE_FRAC) {
    o.lit = false; // doused — it keeps its remaining fuel and can be lit again
  } else if (!o.lit && o.fuelTicks > 0 && heat >= MOLOTOV_IGNITE_TEMP) {
    o.lit = true;
  }
  if (!o.lit) return true;
  emitMolotovFlame(o, ctx);
  if (--o.fuelTicks <= 0) {
    o.fuelTicks = 0;
    o.lit = false; // 15초 지속 → 빈 유리병
  }
  return true;
}

/** The byproduct of a body destroyed by blast or crush: a drum bursts into its
 *  three shards and, if it was carrying anything, gushes its contents (원유/산)
 *  across the wreckage — and a shard, having nothing left to break into, shatters
 *  into scattered Metal Powder (see breakDrum); a stick of dynamite detonates (a
 *  knock or a passing blast sets it off — chain reactions); a smoke bomb's canister
 *  ruptures and dumps its whole remaining charge at once; a wooden crate bursts
 *  into its three shards (and a shard into Sawdust — see breakWoodBox), carrying
 *  its fire over to the wreckage if it was burning; a rubber ball leaves nothing.
 *  `cause` matters only to the two bodies that break into pieces, and only for how
 *  far their wreckage travels (see BreakCause): a blast or a crash throws it, being
 *  crushed doesn't. `spawn` collects any *bodies* the byproduct creates (the crate
 *  and the barrel); see breakWoodBox for why they aren't pushed straight into the
 *  live array. */
function destroyByproduct(
  o: SimBody,
  ctx: SimContext,
  spawn: SimBody[],
  cause: BreakCause,
): void {
  if (o.kind === 'woodbox') {
    breakWoodBox(o, ctx, spawn, o.burnTicks > 0, cause);
  } else if (o.kind === 'drum') {
    spawnFillSpill(o, ctx); // pour the contents out first; the shell comes apart
    breakDrum(o, ctx, spawn, cause); // over the spill (barrel → shards → powder)
    o.state = 'destroyed';
  } else if (o.kind === 'dynamite') {
    detonateDynamite(o, ctx);
  } else if (o.kind === 'smokebomb') {
    // Blown open rather than burned down: the charge that would have vented over a
    // whole second goes up at once, filling the cloud disc in a single tick.
    ventSmoke(o, ctx, 1);
  } else if (o.kind === 'molotov') {
    // Glass shatters the same way whatever broke it, and its contents land where
    // it stood — hence no `cause` here (see breakMolotov).
    breakMolotov(o, ctx);
  }
}

function evaluateTriggers(o: SimBody, ctx: SimContext, spawn: SimBody[]): boolean {
  // Void (특수 물질) swallows any body whole: deleted with NO byproduct — not a
  // 파괴/용해 judgement. Checked before every other trigger so a stick doesn't
  // explode (nor a drum shatter/spill) as it's drawn into the sink.
  if (footprintTouchesVoid(o, ctx)) return false;
  const exp = scanBodyExposure(o, ctx);
  // Instant destruction: a blast flash or a Nuclear Ray beam overlapping the
  // footprint (직격 — the ray destroys everything it touches on the CA grid, and
  // an object it grazes is no exception), or being wedged/entombed in solid it
  // can't escape (끼임). A genuine burial is measured *after* the post-collision
  // grid re-resolve (phase B.5) has popped out any transient collision shove into
  // terrain, so only a body with no open face to exit through — truly stuck —
  // reads as crushed; a momentarily-overlapping one is freed first. Blast/Nuclear Ray
  // are secondary to the phase-A doomed capture (covers a body knocked into a
  // lingering flash or into the beam's path).
  // Fresh drum wreckage waves the flash off (see DRUM_PIECE_BLAST_GRACE); the
  // countdown itself runs once a tick, in phase A.
  const blast = exp.blast && !blastImmune(o);
  if (blast || exp.nuclearRay || exp.solidFrac >= CRUSH_SOLID_FRAC) {
    // Only the blast is a blow: a crate pinched in solid (끼임) or eaten away by
    // the beam collapses where it stands rather than bursting outward.
    destroyByproduct(o, ctx, spawn, blast ? 'impact' : 'collapse');
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
  // A smoke bomb likewise runs its own two-stage countdown (trickle → discharge →
  // spent) rather than melting or burning.
  if (o.kind === 'smokebomb') return stepSmokeBomb(o, ctx, heat);
  // A wooden box burns rather than melting: it catches, flames for a few seconds,
  // then breaks into its shards (a shard into Sawdust). See stepWoodBox.
  if (o.kind === 'woodbox') return stepWoodBox(o, ctx, heat, spawn);
  // A molotov neither melts nor burns away: it runs its wick down and waits to be
  // broken (which is the point of it). See stepMolotov.
  if (o.kind === 'molotov') return stepMolotov(o, ctx, heat);
  // Sustained heat: a drum melts in TWO stages, a ball burns away to nothing.
  // The barrel doesn't run straight to liquid — it sags open into its three shards
  // (and pours out whatever it held), and those shards, held a notch hotter for a
  // much shorter time, are what actually run to Molten Iron. Nothing hit it, so the
  // wreckage slumps in place rather than being thrown ('collapse').
  const threshold = o.kind === 'drum' ? drumMeltTemp(o.part) : BALL_BURN_TEMP;
  const ticksNeeded = o.kind === 'drum' ? drumMeltTicks(o.part) : BALL_BURN_TICKS;
  if (heat >= threshold) {
    o.heatTicks++;
    if (o.heatTicks >= ticksNeeded) {
      if (o.kind === 'drum') {
        if (o.part === 'drum') {
          spawnFillSpill(o, ctx); // contents pour out, then the shell gives way
          breakDrum(o, ctx, spawn, 'collapse'); // stage 1: barrel → three shards
        } else {
          spawnMoltenPuddle(o, ctx); // stage 2: shard → a puddle of Molten Iron
        }
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
 * — a near-miss blast (or a Woofer's shockwave — see applyWooferKnockback) shoves
 * it, a Fan's gust carries it and a live Electromagnet drags it in if it's steel
 * (see applyMagnetPull), then gravity/buoyancy/grid-collision integration, and a wooden box that met
 * the grid at smashing speed is marked doomed — skipped while the
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
  // Direct blast/Nuclear Ray hits are captured at the tick's *start* position: a body
  // engulfed by an explosion or grazed by the beam is destroyed even though the
  // same blast's knockback is about to fling it clear of the destroy check. (A
  // near-miss blast has no footprint overlap here, so it falls through to the
  // knockback shove instead; the beam has no knockback to fall through to.)
  // Each entry carries WHY it was doomed, because a wooden crate's wreckage is
  // thrown clear only when something actually hit it (see BreakCause).
  const doomed = new Map<SimBody, BreakCause>();
  // Bodies a destruction spawns this tick (only the wooden crate does: it bursts
  // into its three shards). Collected here and appended after phase C, because
  // that phase compacts `objects` in place — appending mid-pass would clobber it,
  // and a shard shouldn't be stepped in the same tick it was created anyway.
  const spawned: SimBody[] = [];
  // Phase A — each body's own physics (a held body follows the cursor instead).
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.held) continue;
    // One footprint pass captures a direct Blast/Nuclear Ray hit, consumes any
    // touching Antimatter grain and absorbs any Laser Heat Ray beam resting on the
    // body; the first three doom it this tick (see footprintHazards).
    const hz = footprintHazards(o, ctx);
    // Fresh drum wreckage waves off the flash that made it for a few ticks, and
    // this is where that clock runs (once per body per tick, before the flash is
    // judged — see DRUM_PIECE_BLAST_GRACE).
    if (o.kind === 'drum' && o.blastGraceTicks > 0) o.blastGraceTicks--;
    const blast = hz.blast && !blastImmune(o);
    if (blast || hz.nuclearRay || hz.antimatter) {
      // A blast or an annihilating grain is a shock the wreckage carries away; the
      // Nuclear Ray just eats the body where it is, so that one is a collapse.
      doomed.set(o, blast || hz.antimatter ? 'impact' : 'collapse'); // destroyed below
      continue;
    }
    // 열선 가열: the absorbed beams' heat goes straight into the body's own
    // reservoir — the only way a Heat Ray can warm an object, since the reservoir's
    // ordinary source is the footprint's *cell* temperatures (scanBodyExposure) and
    // a beam cell's `temp` is packed flight state, never a real reading. Phase C
    // then relaxes the reservoir toward the surroundings as usual, so a held beam
    // ramps the body up to a destroying temperature over a second or so while a
    // beam that moves on lets it cool back down (드럼통은 녹고, 나무 상자는 불붙고,
    // 다이너마이트는 유폭한다).
    if (hz.rayHeat > 0) o.temp += hz.rayHeat;
    applyBlastKnockback(o, ctx);
    applyWooferKnockback(o, ctx);
    applyWindPush(o, ctx);
    // The one force that gathers instead of shoving — and the only one that is
    // selective about what it acts on (see isMagneticBody).
    if (isMagneticBody(o)) applyMagnetPull(o, ctx);
    if (o.kind === 'ball') {
      stepBall(o, ctx, ax, ay, s);
      continue;
    }
    const impact = stepCapsule(o, ctx, ax, ay, s);
    if (o.kind === 'molotov') {
      // Glass, and meant to be thrown: the same closing-speed test the crate gets,
      // at a fraction of its threshold (see MOLOTOV_SMASH_SPEED). Queued as doomed
      // rather than broken here so it takes the one shared byproduct path in phase C.
      if (impact >= MOLOTOV_SMASH_SPEED) doomed.set(o, 'impact');
      continue;
    }
    // A drum — barrel or shard alike — squares up once it has stopped, for the
    // same reason the crate does below: it collides as a rounded BOX, so a body
    // that rolled to a halt part-way onto a corner would sit balanced there with
    // its own corners hanging through the floor. Easing it onto a face is also
    // what makes a dropped barrel land lid-up and ready to be stacked on. (The
    // gates mean this only ever touches a body that has genuinely stopped, so a
    // barrel knocked over still tips and still comes to rest on its side — it just
    // rests *flat* on that side rather than at whatever angle it stopped at.)
    //
    // Note what is NOT here: a drum has no smash-on-impact rule. Steel takes a
    // hurl into a wall and dents; only explosives open it (충돌 충격에는 파괴되지
    // 않고 폭발물에만 파괴), which is the one place the drum deliberately parts ways
    // with the crate it otherwise now breaks exactly like — and with the molotov
    // just above, which is glass and breaks at a third of the crate's speed.
    if (o.kind === 'drum') {
      settleBodyUpright(o);
      continue;
    }
    if (o.kind !== 'woodbox') continue;
    // Timber that meets a wall hard enough doesn't bounce, it bursts (매우 빠른
    // 속도로 벽/고체에 부딪히면 파괴). Queued as doomed rather than destroyed here so
    // it takes the one shared byproduct path in phase C — the crate into its three
    // shards, a shard into Sawdust, carrying its fire over if it was alight.
    if (impact >= WOOD_BOX_SMASH_SPEED) {
      doomed.set(o, 'impact'); // the one break that is a blow by definition
      continue;
    }
    // A settled box squares up: a crate stopped part-way onto a corner would sit
    // balanced there with its own corners hanging through the floor. Gated on the
    // body having actually stopped, so tumbling and rolling are untouched.
    settleBodyUpright(o);
  }
  // Phase B — resolve the contact graph: collisions BETWEEN bodies (the fully
  // interactive layer) and each body's collisions with the grid, alternated.
  //
  // Alternated, and not one pass of each, because a stack is a chain of contacts
  // and one pass only ever propagates one link of it. Solving the pair first and
  // the ground second, a crate resting on a crate resting on the floor hands its
  // weight to the crate below, which hands it to the floor — but the floor's
  // answer arrives after the pair is already settled, so the top crate keeps a
  // sliver of fall every tick and rides ~0.2 cells/tick into the one below it
  // forever. Each extra round passes the ground's answer one link further back up
  // the stack and quarters what is left, so a few rounds put a tower properly to
  // sleep. Cheap: object counts are small and a round is only a handful of cell
  // scans per body.
  const pairImpacts = new Map<SimBody, number>();
  const touched = new Set<SimBody>();
  for (let round = 0; round < CONTACT_ROUNDS; round++) {
    // Only the first round measures how hard bodies met — by the later rounds they
    // are looking at velocities the earlier impulses already reflected.
    touched.clear();
    resolveObjectPairs(objects, round === 0 ? pairImpacts : null, touched);
    // Nothing is touching anything: phase A already settled every body against the
    // grid, so there is no chain left to relax and the remaining rounds are work
    // for nothing. This is the common case — bodies scattered around a world.
    if (touched.size === 0) break;
    // The inter-object shove can also push a light body into terrain; this pops it
    // back out, so the crush scan below sees genuine entombment only and not a
    // transient collision overlap. Only the bodies a pair actually moved need it.
    for (const o of touched) {
      if (o.held) continue;
      if (o.kind === 'ball') resolveGridCollision(o, ctx);
      else resolveCapsuleCollision(o, ctx);
    }
  }
  // A smash threshold is about how hard the body was struck, not about what struck
  // it: hurling a crate into another crate has to burst it exactly as hurling it
  // into a wall does (오브젝트끼리 충돌해도 파괴). So the same two tests phase A ran
  // against the grid's arrival speed run again here against the pair solve's, for
  // the two bodies that break on impact — the timber crate and the glass bottle.
  // The drum is deliberately absent from both: steel only opens to explosives.
  for (const [o, hit] of pairImpacts) {
    if (o.held || doomed.has(o)) continue;
    const limit = o.kind === 'woodbox'
      ? WOOD_BOX_SMASH_SPEED
      : o.kind === 'molotov'
        ? MOLOTOV_SMASH_SPEED
        : Infinity;
    if (hit >= limit) doomed.set(o, 'impact');
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
      // A blast, a Nuclear Ray or a smashing arrival reached it this tick — spawn
      // its byproduct, UNLESS it's also being swallowed by Void, which deletes it
      // cleanly (no byproduct) and wins.
      if (!footprintTouchesVoid(o, ctx)) {
        destroyByproduct(o, ctx, spawned, doomed.get(o) as BreakCause);
      }
    } else if (evaluateTriggers(o, ctx, spawned)) {
      objects[w++] = o;
    }
  }
  objects.length = w;
  for (let i = 0; i < spawned.length; i++) objects.push(spawned[i]);
}
