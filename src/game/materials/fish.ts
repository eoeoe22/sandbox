import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { DIR4 } from '../engine/directions';
import { SIM_HZ_AT_1X } from '../config';
import { touchingBlast } from './crawler';
import { DEAD_FISH } from './deadfish';

// Fish (물고기) — the first *swimming* life in the sandbox. One cell is one fish
// (엔진 판정은 1픽셀); the grey tail that trails it is drawn by the renderer and
// occupies nothing (see `tailPixel` below).
//
// It does NOT reuse crawler.ts's `crawl`. That is a right-hand wall-follower —
// its whole point is to keep a surface on one side and wrap around corners, which
// is what a termite wants and the exact opposite of what open water asks for. A
// fish's locomotion is its own (see `swim`): hold a heading, drift off it now and
// then, and lean toward whichever of its own kind it can see nearby. What it does
// borrow from the bugs is the *other* half — `touchingBlast` for the detonation
// test, and the declarative death tags (`radiationDeath`, `blastDeathId`,
// `shockDeathChance`) that already say "fragile organic body" for the Termite.
//
// 물 안 / 물 밖 — the two states it lives in:
//   • Touching liquid → it swims. It can only step INTO liquid, so it never
//     climbs out of its own tank; the waterline is a ceiling it can't cross.
//   • Out of liquid → 펄떡임. It hops off the ground in a random direction and
//     falls back, and a counter in `aux` runs up: AIR_DEATH_TICKS of that and it
//     suffocates. Landing back in water resets the counter to zero, so a fish
//     that flops its way to the edge of a puddle really is saved.
//
// It dies four ways, all of them leaving a Dead Fish (deadfish.ts) that floats
// belly-up to the surface: 고온, 폭발 충격파(인접 Blast 섬광은 즉사), 방사능 피폭,
// 물 밖 질식. A weaker shockwave — a Woofer's thump — kills it half the time and
// merely throws it the rest (`shockLoose` + `shockDeathChance`, the Termite's
// exact pattern; see blast.ts).
//
// 잡아먹거나 번식하지 않는다. 개체 수는 유저가 찍은 만큼이 전부다 — a tank doesn't
// silently fill up with fish while you look away.

/** 사망 온도 — a fish is far more fragile than a termite (70°): water this warm is
 *  already lethal long before it would boil. */
const DEATH_TEMP = 45;
/** 물 밖에서 버티는 시간(틱) — ~12초 at ×1 speed. Long enough that a fish flung onto
 *  the bank by a blast has a real chance to flop back in. Bounded by the 10 bits
 *  the aux layout gives the counter (max 1023). */
const AIR_DEATH_TICKS = Math.round(12 * SIM_HZ_AT_1X);
/** 충격파 노출 시 사망 확률 — half of a school caught in a (non-destructive) wave is
 *  crushed; the rest is only flung. */
const SHOCK_DEATH_CHANCE = 0.5;

/** Chance a swimming fish actually advances this tick. Below 1 it *cruises* —
 *  gliding and coasting rather than teleporting a cell every single tick, which
 *  at 30 ticks/s would read as a jitter rather than as swimming. */
const SWIM_CHANCE = 0.55;
/** Chance per swimming tick that it picks a fresh heading (see `pickHeading`).
 *  Low, because the heading is what makes a fish look like it's *going somewhere*;
 *  re-rolling often would turn the tank into brownian noise. */
const TURN_CHANCE = 0.15;
/** 느슨한 무리 짓기 — how far a fish looks for company when it re-heads. It has to
 *  be several times the distance a fish covers between two re-headings (SWIM_CHANCE
 *  / TURN_CHANCE ≈ 3.7 cells), or the school has no restoring force at all: cross
 *  the radius in one heading and your neighbours are simply gone, `pickHeading`
 *  falls back to a random draw, and the group is scattered for good. At 4 that is
 *  exactly what happened — a clump of 12 was strangers inside ten seconds.
 *
 *  Two attempts before this one, kept here because both look reasonable and
 *  neither works: sampling eight random cells in the box instead of scanning it
 *  (with one neighbour in 81 cells, eight probes find it 9% of the time — a cue
 *  once every three seconds, far too rare to pull against a random walk), and
 *  aligning headings without any pull toward the group (see COHERE_CHANCE).
 *
 *  The scan is the whole (2R+1)² box, but only on a re-heading roll, so it
 *  amortizes to TURN_CHANCE × 288 ≈ 43 grid reads per fish per tick. Fish are
 *  placed by hand and never breed (there is no population to run away with), so
 *  that is a bounded cost in a way a self-replicating bug's would not be. */
const SCHOOL_RADIUS = 8;
/** Having found company, the chance it swims *toward* the group's centre rather
 *  than falling in on the group's heading. Alignment alone is not a school:
 *  twelve fish all heading east drift apart at slightly different rates and are
 *  strangers within a minute. The pull is what keeps them together; the alignment
 *  is what makes the group read as going somewhere rather than milling. */
const COHERE_CHANCE = 0.6;
/** Chance per stranded tick that it throws itself into the air (see `flop`). */
const FLOP_CHANCE = 0.2;

// ── 방향 ──────────────────────────────────────────────────────────────────────
// A clockwise ring of the 8 neighbours, so (h+1)&7 is "turn 45° one way" and
// (h+4)&7 is "turn around". DIR8 in engine/directions.ts is grouped by axis, not
// ordered around the circle, so it can't be turned through — hence the local table.
const RING: ReadonlyArray<readonly [number, number]> = [
  [0, -1], //  0 N
  [1, -1], //  1 NE
  [1, 0], //   2 E
  [1, 1], //   3 SE
  [0, 1], //   4 S
  [-1, 1], //  5 SW
  [-1, 0], //  6 W
  [-1, -1], // 7 NW
];

/** The bag a fresh heading is drawn from — RING indices, repeated to weight them.
 *  Weighted heavily toward due east/west because that is what a fish looks like:
 *  it cruises the tank lengthwise and only occasionally rises or dives. An even
 *  draw over all 8 makes them mill about vertically and read as bubbles. */
const HEADING_PICK = [2, 2, 2, 2, 6, 6, 6, 6, 1, 3, 5, 7, 0, 4] as const;

/** RING index for a step of (sign(dx), sign(dy)) — the inverse of RING, indexed as
 *  (dy+1)*3 + (dx+1). The centre (no offset at all) is -1: there is no heading
 *  that means "stay". */
const RING_OF: readonly number[] = [
  7, 0, 1, // dy -1: NW  N  NE
  6, -1, 2, //dy  0: W   ·  E
  5, 4, 3, // dy +1: SW  S  SE
];
const headingToward = (dx: number, dy: number): number =>
  RING_OF[(Math.sign(dy) + 1) * 3 + (Math.sign(dx) + 1)];

// ── aux 레이아웃 ─────────────────────────────────────────────────────────────
//   bit 0      facing — 1이면 오른쪽. **렌더러와의 계약**: any material declaring
//              `tailPixel` puts its facing in this bit and nothing else (see the
//              field's doc in engine/types.ts). It's a separate bit from the
//              heading because a fish swimming straight up or down still faces
//              the way it last went sideways — the tail must not flip.
//   bits 1-4   heading + 1 (0 = 아직 못 정함, 1..8 = RING 0..7), the engine's usual
//              "a freshly placed cell reads 0" convention.
//   bits 5-14  물 밖 경과 틱 (0..1023), reset to 0 the moment it touches liquid.
const FACING_RIGHT = 1;
const HEADING_SHIFT = 1;
const AIR_SHIFT = 5;
const AIR_MAX = 0x3ff;

const headingOf = (a: number): number => ((a >>> HEADING_SHIFT) & 0xf) - 1;
const airOf = (a: number): number => (a >>> AIR_SHIFT) & AIR_MAX;

/** Build the whole word. `heading` may be -1 for "unchosen" (a flopping fish has
 *  no heading — it picks a fresh one when it lands back in water). */
const pack = (facesRight: boolean, heading: number, air: number): number =>
  (facesRight ? FACING_RIGHT : 0) |
  (((heading + 1) & 0xf) << HEADING_SHIFT) |
  ((Math.min(air, AIR_MAX) & AIR_MAX) << AIR_SHIFT);

/** Which way the body faces after a step of `dx`. A purely vertical step keeps
 *  the old facing — see the aux note above. */
const facingAfter = (dx: number, a: number): boolean =>
  dx === 0 ? (a & FACING_RIGHT) !== 0 : dx > 0;

// ── 물 ────────────────────────────────────────────────────────────────────────

/** True if (x,y) is water a fish can be *in*: any non-frozen liquid. Deliberately
 *  not water-specific — a fish swimming through oil or acid (briefly, in the
 *  acid's case) is more fun than a fish that phases through everything but H₂O,
 *  and every liquid is already a thing you can pour a tank of. A liquid chilled
 *  to its freezing point acts solid everywhere else in the engine (see
 *  SimContext.isFrozen), so it walls a fish in rather than letting it swim. */
function swimmable(x: number, y: number, sim: SimContext): boolean {
  if (!sim.inBounds(x, y)) return false;
  const id = sim.get(x, y);
  if (id === EMPTY) return false; // 수면 위 공기로는 스스로 나가지 않는다
  return getMaterial(id).phase === Phase.Liquid && !sim.isFrozen(x, y);
}

/** True if any cardinal neighbour is liquid — "아직 물에 닿아 있다". Note this is
 *  NOT crawler.ts's `isSubmerged`, which the bugs use to drown: that one demands
 *  *no* air neighbour, so a fish cruising just under the waterline would read as
 *  out of water and slowly suffocate at the top of its own tank. A fish only needs
 *  to be touching water, not buried in it. */
function touchingLiquid(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (id === EMPTY) continue;
    if (getMaterial(id).phase === Phase.Liquid && !sim.isFrozen(nx, ny)) return true;
  }
  return false;
}

// ── 이동 ──────────────────────────────────────────────────────────────────────

/** A heading for a fish that needs a new one: 느슨한 무리 짓기. It samples a few
 *  random cells in a box around itself and, on the first of its own kind it finds,
 *  either turns toward it (cohesion) or falls in behind it on its heading
 *  (alignment) — see COHERE_CHANCE for why it takes both. There is no leader, no
 *  list and no per-tick neighbourhood scan; a school is just this, repeated.
 *
 *  Finding nobody — a lone fish, or an unlucky set of probes — it draws from
 *  HEADING_PICK, which is also what keeps a school from locking rigidly onto one
 *  heading forever: every fish that misses its probes stirs the group a little. */
function pickHeading(x: number, y: number, sim: SimContext): number {
  let cx = 0; // offset to the neighbours' centre of mass — the cohesion pull
  let cy = 0;
  let hx = 0; // their headings summed as vectors — the alignment cue
  let hy = 0;
  let n = 0;
  for (let dy = -SCHOOL_RADIUS; dy <= SCHOOL_RADIUS; dy++) {
    for (let dx = -SCHOOL_RADIUS; dx <= SCHOOL_RADIUS; dx++) {
      if (dx === 0 && dy === 0) continue; // itself — no information
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== FISH.id) continue;
      n++;
      cx += dx;
      cy += dy;
      const h = headingOf(sim.getAux(nx, ny));
      if (h >= 0) {
        hx += RING[h][0];
        hy += RING[h][1];
      }
    }
  }
  if (n > 0) {
    // Either cue can come out empty — a fish sitting dead centre of a symmetric
    // group has nowhere to close toward, and a group facing every which way sums
    // to nothing. Fall through rather than inventing a direction for it.
    const toward = sim.chance(COHERE_CHANCE) ? headingToward(cx, cy) : headingToward(hx, hy);
    if (toward >= 0) return toward;
  }
  return HEADING_PICK[sim.randInt(HEADING_PICK.length)];
}

/** One swimming step. Holds its heading, and when the way ahead is closed tries
 *  progressively wider turns before giving up and reversing — which is what makes
 *  a fish follow the contour of a tank instead of pressing its nose into the glass.
 *  `aux` is stamped on the source cell *before* the swap so it travels with the
 *  fish (SimContext.swap carries aux), exactly as crawler.ts does for its heading. */
function swim(x: number, y: number, sim: SimContext, a: number): void {
  let h = headingOf(a);
  if (h < 0 || sim.chance(TURN_CHANCE)) h = pickHeading(x, y, sim);
  if (!sim.chance(SWIM_CHANCE)) {
    sim.setAux(x, y, pack((a & FACING_RIGHT) !== 0, h, 0));
    return; // coasting this tick
  }
  // Straight on, then ±45°, then ±90°. Beyond that it's cornered.
  for (const d of [h, (h + 1) & 7, (h + 7) & 7, (h + 2) & 7, (h + 6) & 7]) {
    const [dx, dy] = RING[d];
    if (!swimmable(x + dx, y + dy, sim)) continue;
    sim.setAux(x, y, pack(facingAfter(dx, a), d, 0));
    sim.swap(x, y, x + dx, y + dy);
    return;
  }
  // Boxed in — turn around in place and try again next tick.
  sim.setAux(x, y, pack((a & FACING_RIGHT) !== 0, (h + 4) & 7, 0));
}

/** 펄떡임 — one tick of a fish out of water. It throws itself against gravity with
 *  a random sideways lean and otherwise falls, so a stranded fish visibly thrashes
 *  its way downhill and back toward whatever water is below. Written against
 *  `sim.gravityX/Y` rather than "up is -y" so it still flops the right way when the
 *  world's gravity is rotated. */
function flop(x: number, y: number, sim: SimContext, a: number, air: number): void {
  const faces = (a & FACING_RIGHT) !== 0;
  if (sim.chance(FLOP_CHANCE)) {
    const lean = sim.randInt(3) - 1; // -1, 0, +1 across the gravity axis
    const jx = x - sim.gravityX - sim.gravityY * lean;
    const jy = y - sim.gravityY + sim.gravityX * lean;
    if (sim.inBounds(jx, jy) && sim.isEmpty(jx, jy)) {
      sim.setAux(x, y, pack(lean === 0 ? faces : lean > 0, -1, air));
      sim.tryMove(x, y, jx, jy);
      return;
    }
  }
  sim.setAux(x, y, pack(faces, -1, air));
  sim.moveDown(x, y);
}

function die(x: number, y: number, sim: SimContext): void {
  sim.set(x, y, DEAD_FISH.id);
  sim.setAux(x, y, 0); // the corpse keeps no state of its own (see deadfish.ts)
}

function updateFish(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= DEATH_TEMP || touchingBlast(x, y, sim)) {
    die(x, y, sim);
    return;
  }
  const a = sim.getAux(x, y);
  if (touchingLiquid(x, y, sim)) {
    swim(x, y, sim, a); // swim() re-packs with the air counter cleared
    return;
  }
  const air = airOf(a) + 1;
  if (air >= AIR_DEATH_TICKS) {
    die(x, y, sim);
    return;
  }
  flop(x, y, sim, a, air);
}

export const FISH = register({
  id: 146,
  name: 'Fish',
  phase: Phase.Solid,
  // 짙은 네이비 몸통 — dark enough to read as a silhouette against every liquid
  // it can swim in (Water, Oil, Acid), which a mid-tone body would not.
  color: rgb(0x1e, 0x30, 0x5e),
  colorVary: 18,
  density: 3,
  category: 'life',
  // 꼬리 — the grey pixel the renderer trails behind it. Display only: it is not a
  // cell, occupies nothing, and no rule in the simulation can see it.
  tailPixel: rgb(0x8c, 0x95, 0xa2),
  // Every death leaves the same floating corpse — at a blast's epicentre, at its
  // rim (updateFish's touchingBlast), from a dose of radiation, or from air.
  blastDeathId: DEAD_FISH.id,
  radiationDeath: DEAD_FISH.id,
  // A body this small and unanchored rides a pressure wave rather than standing in
  // it, and is crushed half the time when it does — the Termite's exact trade.
  shockLoose: true,
  shockDeathChance: SHOCK_DEATH_CHANCE,
  // Organic and poorly conductive, so it takes a moment to cook rather than dying
  // the instant a warm cell touches the tank.
  thermal: { conductivity: 0.2 },
  update: updateFish,
});
