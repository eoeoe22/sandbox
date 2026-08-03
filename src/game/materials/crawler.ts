import { EMPTY, Phase } from '../engine/types';
import { getMaterial } from './registry';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { BLAST } from './blast';

// ── Shared "기어다니는" (crawling) behavior — Termite & Nanobot ────────────────
//
// Both bugs share one locomotion model: they don't fall and pile like a powder,
// they *cling to surfaces and walk along them* — floors, walls, ceilings, and
// the world border alike. The model is a classic right-hand wall-follower over
// the CA grid, which is exactly what produces the surface-hugging march the spec
// asks for ("벽과 바닥 천장 표면을 따라 이동"): it keeps a surface on one side and
// wraps around every inner and outer corner, so a bug set on top of a block
// walks the top, turns down the far face, and continues along the underside.
//
// The heading (which of the 4 cardinal directions it's currently walking) is
// stored in the cell's `aux` word as `heading + 1` (so 0 = "not yet chosen",
// matching the engine's convention that a freshly placed/spawned cell reads 0).
// Storing it makes the walk *persistent* — "이동 방향을 어느정도 유지" — instead of
// re-randomizing every tick, and `aux` travels with the cell on every swap (see
// SimContext.swap) so the heading follows the bug as it moves.
//
// The heading only needs 3 bits, so it lives in the LOW 3 bits of `aux` and the
// rest of the 16-bit word is left free for the individual bug's own per-cell
// state — read and written with `crawlerState`/`setCrawlerState` below. The
// Nanobot parks its 금속 기억 (which metal that cell's body is built from) there,
// and because the two fields share one word the memory rides along on every swap
// exactly as the heading does. Old saves stored the bare `heading + 1` in the
// whole word, which is this same layout with an empty state field, so they load
// unchanged.
//
// The two bugs differ only in how they treat liquid, passed as `liquidPolicy`:
//   • 'avoid'  (Termite): liquid is an obstacle it *walks along the edge of* — it
//     counts as a surface to cling to but can't be entered, so a termite skirts a
//     puddle's shoreline instead of marching in ("액체를 만나면 방향을 바꿔 기피").
//   • 'ignore' (Nanobot): liquid is transparent — neither surface nor obstacle, so
//     a nanobot swims straight through it and crawls on whatever solid it finds
//     under the water ("액체를 무시하고 돌아다님").

export type LiquidPolicy = 'avoid' | 'ignore';

// Cardinal directions in clockwise order (N, E, S, W) — the wall-follower rotates
// through this ring, so index+1 mod 4 is "turn right" and index+3 is "turn left".
const CARD: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 0 N
  [1, 0], //  1 E
  [0, 1], //  2 S
  [-1, 0], // 3 W
];

// Small chance per step to pick a fresh random heading, so a swarm doesn't settle
// into perfectly deterministic loops around a block — it keeps a lively wander on
// top of the otherwise consistent march.
const TURN_RANDOM_CHANCE = 0.08;

// ── aux layout: [ per-bug state | heading+1 ] ────────────────────────────────
const HEADING_BITS = 3;
const HEADING_MASK = (1 << HEADING_BITS) - 1;

/** The bug's current heading (0..3), or -1 when it hasn't picked one yet. */
function readHeading(sim: SimContext, x: number, y: number): number {
  return (sim.getAux(x, y) & HEADING_MASK) - 1;
}

/** Write the heading back *without disturbing the bug's own state field* — the
 *  locomotion layer owns the low 3 bits of `aux` and nothing else. */
function stampHeading(sim: SimContext, x: number, y: number, heading: number): void {
  sim.setAux(x, y, (sim.getAux(x, y) & ~HEADING_MASK) | ((heading + 1) & HEADING_MASK));
}

/** The bug's private per-cell state (see the aux layout note at the top of this
 *  file). 0 for a freshly placed/spawned cell, which every crawler treats as its
 *  default. */
export function crawlerState(sim: SimContext, x: number, y: number): number {
  return sim.getAux(x, y) >>> HEADING_BITS;
}

/** Write that state, leaving the heading the locomotion layer owns alone. */
export function setCrawlerState(sim: SimContext, x: number, y: number, state: number): void {
  sim.setAux(x, y, (state << HEADING_BITS) | (sim.getAux(x, y) & HEADING_MASK));
}

/** True if (x,y) is something a bug can cling to. Solids and powders always are;
 *  liquid is a surface only for the liquid-avoiding Termite (it walks the
 *  shoreline). The world border counts as a surface in `wall` mode (so bugs crawl
 *  the container's floor/ceiling/walls), never in `void` mode (open edges). A
 *  bug never clings to its own kind, which keeps a colony spread over a surface
 *  rather than piling into a clump. */
function isSurface(sim: SimContext, x: number, y: number, selfId: number, liquidIsSurface: boolean): boolean {
  if (!sim.inBounds(x, y)) return sim.borderMode === 'wall';
  const id = sim.get(x, y);
  if (id === EMPTY || id === selfId) return false;
  const p = getMaterial(id).phase;
  if (p === Phase.Solid || p === Phase.Powder) return true;
  // A liquid chilled to/below its freezing point acts solid (see Material.freeze),
  // so it's a surface to cling to for *both* bugs; a flowing liquid is a surface
  // only for the liquid-avoiding Termite (walks its shoreline).
  if (p === Phase.Liquid) return liquidIsSurface || sim.isFrozen(x, y);
  return false; // gas
}

/** True if the bug can step into (x,y). Empty air always; liquid only when the
 *  bug ignores liquid (Nanobot). Solids, powders, gases, and its own kind block —
 *  a blocked cardinal is what the wall-follower turns away from. */
function canStepInto(sim: SimContext, x: number, y: number, selfId: number, enterLiquid: boolean): boolean {
  if (!sim.inBounds(x, y)) return sim.borderMode === 'void';
  const id = sim.get(x, y);
  if (id === EMPTY) return true;
  if (id === selfId) return false;
  const p = getMaterial(id).phase;
  // A frozen liquid acts solid — every other density-mover in the engine gates on
  // !isFrozen (SimContext.tryMove/swapOntoLiquid), so a Nanobot can't swim through
  // a chilled puddle either; it crawls on it like ground.
  if (p === Phase.Liquid) return enterLiquid && !sim.isFrozen(x, y);
  return false;
}

/** Relocate the bug one cell, carrying `heading` with it. `heading` is stamped on
 *  the source first so SimContext.swap moves it along to the destination. An empty
 *  target is a plain move; a liquid target (Nanobot only, already vetted by
 *  canStepInto) is an unconditional swap so the bug roams through liquid freely
 *  regardless of density/direction — it truly "ignores" the water. */
function moveTo(sim: SimContext, x: number, y: number, tx: number, ty: number, heading: number): void {
  stampHeading(sim, x, y, heading);
  if (!sim.inBounds(tx, ty) || sim.get(tx, ty) === EMPTY) sim.tryMove(x, y, tx, ty);
  else sim.swap(x, y, tx, ty);
}

/** True if any 8-neighbor (or the world border) is a surface the bug clings to. */
function isAttached(sim: SimContext, x: number, y: number, selfId: number, liquidIsSurface: boolean): boolean {
  for (const [dx, dy] of DIR8) {
    if (isSurface(sim, x + dx, y + dy, selfId, liquidIsSurface)) return true;
  }
  return false;
}

// Same-kind 8-neighbor count at which a bug actively squeezes out of the clump
// rather than wall-following. A single-file trail leaves ~2 same-kind neighbors,
// a 2-wide band ~5, so this thins bands to a line but never disturbs a lone trail.
const CROWD_THRESHOLD = 4;

/** Count this bug's own kind in the 8-neighborhood, optionally skipping one cell
 *  (the bug's current cell, when scoring a candidate it would vacate). */
function countSelf(sim: SimContext, x: number, y: number, selfId: number, skipX: number, skipY: number): number {
  let c = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx === skipX && ny === skipY) continue;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === selfId) c++;
  }
  return c;
}

/** Anti-clumping ("층을 이루지 않게"): a bug packed among its own kind squeezes
 *  toward open space — it moves to the adjacent passable cell with the FEWEST
 *  same-kind neighbors, and only when that's *strictly* fewer than where it
 *  stands. Because every move lowers the total same-kind adjacency in the world,
 *  a heap boils apart into a thin trail and the process converges (no endless
 *  jitter). Without this, a bug walled in on all sides by its own kind — which
 *  blocks movement and offers no surface to cling to — just sits: the "쌓인 더미가
 *  반쯤 멈춰있음" (a piled heap half-frozen) case. Returns true if it dispersed. */
function disperseCrowded(
  x: number,
  y: number,
  sim: SimContext,
  selfId: number,
  enterLiquid: boolean,
  heading: number,
): boolean {
  const mine = countSelf(sim, x, y, selfId, -1, -1);
  if (mine < CROWD_THRESHOLD) return false;
  let bestX = -1;
  let bestY = -1;
  let best = mine; // must strictly improve to move
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!canStepInto(sim, nx, ny, selfId, enterLiquid)) continue;
    const c = countSelf(sim, nx, ny, selfId, x, y);
    if (c < best) {
      best = c;
      bestX = nx;
      bestY = ny;
    }
  }
  if (bestX < 0) return false; // boxed in with no better spot — a neighbor frees it next tick
  moveTo(sim, x, y, bestX, bestY, heading);
  return true;
}

/** One locomotion step. Attached to a surface → a right-hand wall-follow (hug the
 *  surface, turning through corners while keeping the current heading when it can).
 *  Not attached (adrift in open air / water) → drift along gravity to find a
 *  surface. Nothing here ever falls-and-piles: bugs walk, they don't stack. */
export function crawl(x: number, y: number, sim: SimContext, selfId: number, policy: LiquidPolicy): void {
  const enterLiquid = policy === 'ignore';
  const liquidIsSurface = policy === 'avoid';

  let h = readHeading(sim, x, y);
  if (h < 0 || h > 3) h = sim.randInt(4);

  // Relieve crowding first: a bug buried in a heap of its own kind squeezes out
  // toward open space before it tries any surface-following (see disperseCrowded).
  if (disperseCrowded(x, y, sim, selfId, enterLiquid, h)) return;

  if (!isAttached(sim, x, y, selfId, liquidIsSurface)) {
    // Adrift: sink toward gravity until a surface is found (straight, then the two
    // diagonals). Heading is preserved so it resumes its march on landing.
    const gx = sim.gravityX;
    const gy = sim.gravityY;
    const s = sim.chance(0.5) ? 1 : -1;
    const px = -gy;
    const py = gx;
    const drifts: ReadonlyArray<readonly [number, number]> = [
      [gx, gy],
      [gx + px * s, gy + py * s],
      [gx - px * s, gy - py * s],
    ];
    for (const [dx, dy] of drifts) {
      if (canStepInto(sim, x + dx, y + dy, selfId, enterLiquid)) {
        moveTo(sim, x, y, x + dx, y + dy, h);
        return;
      }
    }
    stampHeading(sim, x, y, h);
    return;
  }

  // Occasional random reheading keeps a colony from locking into rigid loops.
  if (sim.chance(TURN_RANDOM_CHANCE)) h = sim.randInt(4);

  // Right-hand rule: prefer an opening on the right (wrap an outer corner), then
  // straight ahead (keep the heading), then left (turn away from a wall ahead),
  // then reverse. The first steppable option wins.
  const order = [(h + 1) & 3, h, (h + 3) & 3, (h + 2) & 3];
  for (const d of order) {
    const [dx, dy] = CARD[d];
    if (canStepInto(sim, x + dx, y + dy, selfId, enterLiquid)) {
      moveTo(sim, x, y, x + dx, y + dy, d);
      return;
    }
  }
  // Boxed in on all four sides — turn around in place and try again next tick.
  stampHeading(sim, x, y, (h + 2) & 3);
}

/** How a bug's feeding differs from the plain "eat one cell, become two" default.
 *  Declare one of these once at module scope (never build it per call — this runs
 *  for every bug every tick). */
export interface FeedOptions {
  /** 0..1 chance that the gnawed cell is simply *eaten away* — it goes back to
   *  empty air instead of turning into another bug. The Termite's 50%: half of
   *  what a colony chews through is digested, half becomes more colony, so a
   *  swarm still spreads but no longer converts a timber wall into its own mass
   *  cell for cell. Omitted ⇒ every meal reproduces (the Nanobot). */
  vanishChance?: number;
  /** Called on the newborn bug's cell the instant it spawns, told what it was
   *  made from, so a bug can carry state over from its food (the Nanobot stamps
   *  its 금속 기억 — see nanobot.ts). Not called when the meal vanished. */
  onBorn?: (sim: SimContext, x: number, y: number, eatenId: number) => void;
}

/** Per-tick feeding: with `chance`, gnaw one random adjacent `foods` cell — which
 *  either vanishes or becomes another bug of the same kind (`selfId`), per
 *  `opts.vanishChance` — "갉아먹고 동일한 파티클로 변환". `spawn` marks the new bug
 *  moved, so a colony can't fill a whole food block in a single tick; it spreads
 *  one cell per fed tick.
 *
 *  Returns the id of what it gnawed this tick, or EMPTY if it didn't feed — the
 *  eater's own hook into its meal (the Nanobot rebuilds its body out of the metal
 *  it just ate). */
export function eatAndReproduce(
  x: number,
  y: number,
  sim: SimContext,
  selfId: number,
  foods: readonly number[],
  chance: number,
  opts?: FeedOptions,
): number {
  if (!sim.chance(chance)) return EMPTY;
  const fx: number[] = [];
  const fy: number[] = [];
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (foods.includes(sim.get(nx, ny))) {
      fx.push(nx);
      fy.push(ny);
    }
  }
  if (fx.length === 0) return EMPTY;
  const k = sim.randInt(fx.length);
  const ex = fx[k];
  const ey = fy[k];
  const eaten = sim.get(ex, ey);
  if (opts?.vanishChance !== undefined && sim.chance(opts.vanishChance)) {
    sim.set(ex, ey, EMPTY); // eaten clean away — no new bug from this one
    return eaten;
  }
  sim.spawn(ex, ey, selfId);
  opts?.onBorn?.(sim, ex, ey, eaten);
  return eaten;
}

/** True if the cell is fully immersed with no air to reach ("액체에 완전히 잠김"):
 *  no cardinal neighbor is open air (Empty or gas) and at least one is liquid. A
 *  bug on a submerged floor (liquid above/beside, solid below) still counts —
 *  it's underwater — while one walking a water's surface (open air above) or
 *  merely buried in solid with no liquid touching it does not. The world border
 *  is a wall side, neither air nor liquid, so it doesn't by itself save or drown. */
export function isSubmerged(x: number, y: number, sim: SimContext): boolean {
  let touchesLiquid = false;
  for (const [dx, dy] of CARD) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue; // wall side: not air, not liquid
    const id = sim.get(nx, ny);
    if (id === EMPTY) return false; // an air pocket to breathe → not submerged
    const p = getMaterial(id).phase;
    if (p === Phase.Gas) return false; // gas pocket counts as air too
    // A frozen liquid acts solid (encased in ice, not drowning in water), so it
    // counts as neither air nor liquid here — consistent with canStepInto/isSurface.
    if (p === Phase.Liquid && !sim.isFrozen(nx, ny)) touchesLiquid = true;
  }
  return touchesLiquid;
}

/** True if any 8-neighbor is a Blast shockwave flash cell — the "폭발 충격파 노출"
 *  test for a *real detonation*: it paints Blast flash cells across and around its
 *  crater, so a bug that survived the crater flood but stands at its rim still
 *  dies to the explosion it was next to.
 *
 *  A Woofer's shockwave deliberately paints no flash (see woofer.ts), so it never
 *  trips this — it reaches the bugs through the other channel instead: both are
 *  `shockLoose`, so a shockwave too weak to break them sweeps them up as Debris
 *  (and rolls the Termite's `shockDeathChance`) right inside blast.ts. Two
 *  channels, two intensities: a detonation's flash is certain death, a passing
 *  pressure wave merely throws you (and may crush a termite). */
export function touchingBlast(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === BLAST.id) return true;
  }
  return false;
}

/** Shared per-tick feed rate for both bugs (틱당 5% 확률로 먹이 갉아먹기). */
export const EAT_CHANCE = 0.05;
