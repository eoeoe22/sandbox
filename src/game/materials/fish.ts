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
// then, and move aside when another fish gets too close. What it does borrow from
// the bugs is the *other* half — `touchingBlast` for the detonation test, and the
// declarative death tags (`radiationDeath`, `blastDeathId`, `shockDeathChance`)
// that already say "fragile organic body" for the Termite.
//
// 사회성은 밀고 당기는 두 항뿐이고, 그 조합이 요점이다: a hard push out of arm's
// reach (`crowdedHeading`, every tick) against a weak pull toward company
// (`freeHeading`, only when re-heading). Neither alone is right, and both failures
// were seen rather than guessed:
//   • Cohesion + ALIGNMENT — a proper boids school. Measurably worked (twelve fish
//     clumped and agreed on a heading) and looked scripted: the shoal swung about
//     as one body. The alignment term is what did that, so it's gone.
//   • Separation ALONE — the most natural-looking rule, and at any real fish count
//     genuinely unpleasant: evenly-spaced dots on a grid. 환공포증.
// A weak pull against a hard push never settles at an equilibrium spacing, so the
// tank stays lumpy and irregular, which is what actually reads as alive.
//
// The other half of that fix isn't in this file: fish are **sown, not poured**
// (`placementDensity`), because the lattice needed a crowd to be visible at all.
//
// 물 안 / 물 밖 — the two states it lives in:
//   • Touching liquid → it swims. It can only step INTO liquid, so it never
//     climbs out of its own tank; the waterline is a ceiling it can't cross.
//   • Out of liquid → 펄떡임. It hops off the ground in a random direction and
//     falls back, and a counter in `aux` runs up: AIR_DEATH_TICKS of that and it
//     suffocates. Landing back in water resets the counter to zero, so a fish
//     that flops its way to the edge of a puddle really is saved.
//
// It dies five ways, all of them leaving a Dead Fish (deadfish.ts) that floats
// belly-up to the surface: 고온, 폭발 충격파(인접 Blast 섬광은 즉사), 방사능 피폭,
// 감전, 물 밖 질식. A weaker shockwave — a Woofer's thump — kills it half the time
// and merely throws it the rest (`shockLoose` + `shockDeathChance`, the Termite's
// exact pattern; see blast.ts). Electricity is the same 50%, and reaches much
// further than you'd expect: water is a conductor, so a live wire dipped in a tank
// electrifies the whole pool at once (`sparkDeathChance`, driven from spark.ts).
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
/** 개인 공간 — how close another fish has to get before this one moves off. Small
 *  on purpose: at 3 the objection is to genuinely being bumped, not to company.
 *
 *  Scanned EVERY tick, unlike the loose cohesion below which only fires on a
 *  re-heading roll. That asymmetry is the point — being crowded is urgent and
 *  wanting company is not — and it costs (2R+1)² = 49 grid reads per fish per
 *  tick. Fish are placed by hand, never breed, and are now sown sparsely
 *  (`placementDensity`), so the population can't run away with that. */
const PERSONAL_SPACE = 3;
/** 느슨한 모임 — how far a fish looks for company when it picks a fresh heading.
 *  Has to be several times the ~3.7 cells it covers between two re-headings
 *  (SWIM_CHANCE / TURN_CHANCE) or there is no restoring force at all: at radius 4
 *  a group crossed its own perception range in one heading and was strangers
 *  inside ten seconds. Measured, twice — this number is not a guess. */
const SCHOOL_RADIUS = 8;
/** Having found company beyond arm's length, the chance it heads that way rather
 *  than drawing a free heading. This is cohesion WITHOUT alignment, deliberately:
 *  cohesion alone gathers them loosely, while adding alignment made the group
 *  swing about as one body and read as scripted rather than alive.
 *
 *  Paired with PERSONAL_SPACE it is also what keeps the spacing *irregular*.
 *  Separation on its own settles into an evenly-spaced lattice — technically the
 *  most natural-looking rule and, at any real fish count, genuinely unpleasant to
 *  look at. A weak pull inward against a hard push outward never reaches an
 *  equilibrium spacing, so the tank stays lumpy. */
const COHERE_CHANCE = 0.45;
/** 전기 감전 — chance a fish adjacent to a live Spark dies (see Material.
 *  sparkDeathChance). Water and Saltwater are both conductors, so dropping a live
 *  wire into a tank electrifies the water itself and the current fans out through
 *  it: half of everything it reaches floats up dead. */
const SPARK_DEATH_CHANCE = 0.5;
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

/** 개인 공간 — the heading that takes this fish away from whoever is crowding it,
 *  or -1 if nobody is. Only the nearest ring of company counts: this is the whole
 *  of the social behaviour, and it is deliberately a *push*, never a pull.
 *
 *  There used to be cohesion and alignment here — a proper boids school, tuned
 *  until twelve fish demonstrably clumped and agreed on a heading. It worked and
 *  it looked wrong: a shoal moving as one blob reads as scripted, not alive. Real
 *  tank fish mostly mind their own business and object to being sat on. So the
 *  pull is gone and only the objection remains, which is both the nicer picture
 *  and much the cheaper one — the perception box went from 17×17 to 7×7. */
function crowdedHeading(x: number, y: number, sim: SimContext): number {
  let cx = 0; // summed offsets to everyone too close — the direction to flee is -this
  let cy = 0;
  for (let dy = -PERSONAL_SPACE; dy <= PERSONAL_SPACE; dy++) {
    for (let dx = -PERSONAL_SPACE; dx <= PERSONAL_SPACE; dx++) {
      if (dx === 0 && dy === 0) continue; // itself — no information
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== FISH.id) continue;
      cx += dx;
      cy += dy;
    }
  }
  // Dead centre of a symmetric squeeze the offsets cancel and there is no way out
  // to pick; -1 lets the caller carry on as it was rather than invent a direction.
  return cx === 0 && cy === 0 ? -1 : headingToward(-cx, -cy);
}

/** A heading for a fish that needs one and isn't being crowded: 느슨하게 모인다.
 *  It looks for company out to SCHOOL_RADIUS and heads roughly that way, or draws
 *  a free heading if there's nobody about (or if the roll says to go its own way,
 *  which is what keeps a group from locking rigidly together).
 *
 *  Only the pull is here. There is no alignment term — see COHERE_CHANCE. */
function freeHeading(x: number, y: number, sim: SimContext): number {
  if (sim.chance(COHERE_CHANCE)) {
    let cx = 0;
    let cy = 0;
    for (let dy = -SCHOOL_RADIUS; dy <= SCHOOL_RADIUS; dy++) {
      for (let dx = -SCHOOL_RADIUS; dx <= SCHOOL_RADIUS; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== FISH.id) continue;
        cx += dx;
        cy += dy;
      }
    }
    // Nobody about, or a symmetric ring that cancels — either way there is no
    // direction to head, so fall through to a free draw rather than invent one.
    const toward = headingToward(cx, cy);
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
  // Being crowded is checked EVERY tick, not just on the re-heading roll like a
  // free turn is. A fish that only noticed company once every ~7 ticks would take
  // most of a second to object to being sat on, by which point the two have
  // already swum through each other — the whole behaviour reads as lag.
  const away = crowdedHeading(x, y, sim);
  if (away >= 0) h = away;
  else if (h < 0 || sim.chance(TURN_CHANCE)) h = freeHeading(x, y, sim);
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
 *  world's gravity is rotated.
 *
 *  Whether the jump *happens* is muscle, not weight, so it is deliberately NOT
 *  gravity-gated — the rule `SimContext.gravityPass` documents is to gate what
 *  gravity *causes*, and a fish thrashes whether or not it weighs anything.
 *  Whether the jump is **aimed against gravity** is a different question, and that
 *  one does roll the gate, because it has to stay in proportion to the fall that
 *  balances it. The fall goes through `moveDown`, which is gated, so its rate
 *  scales with strength; an ungated upward bias does not, and below the crossover
 *  (FLOP_CHANCE/(1-FLOP_CHANCE) ≈ 0.25 — well inside the 0.1 steps the UI slider
 *  offers) the fish out-jumps its own falling and rows itself to the ceiling. That
 *  is not a zero-gravity special case: measured drift was WORSE at 0.05 (+57칸)
 *  and 0.1 (+42칸) than at 0 (+28칸), because at 0 it at least never fell back to
 *  jump again. Gating the aim instead of the jump makes the balance hold at every
 *  strength continuously, and reduces to exactly the old behaviour at both ends —
 *  always aimed at 1, never aimed at 0.
 *
 *  Unaimed, it thrashes in a random direction. It still 펄떡거린다 at zero gravity —
 *  freezing it would be both duller and less honest — it just has no preferred way
 *  to go, which is what weightlessness means. */
function flop(x: number, y: number, sim: SimContext, a: number, air: number): void {
  const faces = (a & FACING_RIGHT) !== 0;
  if (sim.chance(FLOP_CHANCE)) {
    const aimed = sim.gravityPass();
    const [rx, ry] = RING[sim.randInt(RING.length)];
    const lean = sim.randInt(3) - 1; // -1, 0, +1 across the gravity axis
    const jx = aimed ? x - sim.gravityX - sim.gravityY * lean : x + rx;
    const jy = aimed ? y - sim.gravityY + sim.gravityX * lean : y + ry;
    if (sim.inBounds(jx, jy) && sim.isEmpty(jx, jy)) {
      // Read the facing off the step it is actually about to take, never off
      // `lean`: the perpendicular is (-gravityY, gravityX), so under the ordinary
      // downward gravity a positive lean moves the fish LEFT. Deriving it from
      // `lean` had the tail on the wrong side of every sideways flop, and would
      // have been wrong again in a different way under rotated gravity.
      sim.setAux(x, y, pack(facingAfter(jx - x, a), -1, air));
      sim.tryMove(x, y, jx, jy);
      return;
    }
  }
  // The plain fall follows gravity exactly (SimContext.moveDown), so under
  // *sideways* gravity the fall itself IS a horizontal step and has to set the
  // facing like any other. The correction goes on the destination rather than
  // up front, because a fall that doesn't happen must not flip the tail.
  //
  // `moveDown` returning true is NOT proof the fish is now one gravity step
  // away, so the destination has to be confirmed to actually hold this fish
  // before writing to it — the same guard moveDown uses on its own fall-boost
  // hop (SimContext.moveDown), and for the same reasons. tryMove reports a move
  // it did not make in two ways that are both reachable here: a displacement
  // drag-gate stall consumes the move without swapping (a stranded fish falls
  // *into* a gas cell — touchingLiquid only counts liquids, so a fish beside
  // CO2 is out of water and flopping), and a void border deletes the cell at
  // the edge and reports success with nothing left to correct. Trusting the
  // return value wrote packed fish bits over the gas's own aux — which for
  // Ethylene is a live polymerization counter — or, at a void edge, over an
  // unrelated cell of the row above, since Grid.setAux does no bounds check.
  sim.setAux(x, y, pack(faces, -1, air));
  if (!sim.moveDown(x, y) || sim.gravityX === 0) return;
  const nx = x + sim.gravityX;
  const ny = y + sim.gravityY;
  if (sim.inBounds(nx, ny) && sim.get(nx, ny) === FISH.id) {
    sim.setAux(nx, ny, pack(sim.gravityX > 0, -1, air));
  }
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
  // 흩뿌리기 — a fish is a creature, not a fill: the brush sows a few rather than
  // stamping a wall of them (Seed's tag, at a third of Seed's rate — a fistful of
  // seeds is a bed, a fistful of fish is an aquarium). A single click still lands
  // one, since PointerPainter guarantees a press places at least one grain. This
  // is also half the answer to the even-spacing problem: a lattice needs a crowd
  // to be visible, and now you have to work to make a crowd.
  placementDensity: 0.015,
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
  // 감전 — it isn't conductive (the current doesn't pass through it), it just has
  // to be standing in water the current reaches. Water conducts, so a live wire in
  // a tank kills half of everything in the pool.
  sparkDeathChance: SPARK_DEATH_CHANCE,
  // Organic and poorly conductive, so it takes a moment to cook rather than dying
  // the instant a warm cell touches the tank.
  thermal: { conductivity: 0.2 },
  update: updateFish,
});
