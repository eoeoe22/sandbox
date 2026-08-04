import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { DIR4 } from '../engine/directions';
import { SIM_HZ_AT_1X } from '../config';
import { touchingBlast } from './crawler';
import { DEAD_FISH } from './deadfish';
import { WATER } from './water';
import { SALTWATER } from './saltwater';

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
//   • Touching water → it swims. It can only step INTO water, so it never
//     climbs out of its own tank; the waterline is a ceiling it can't cross.
//   • Out of water → 펄떡임. It hops off the ground in a random direction and
//     falls back, and a counter in `aux` runs up. It doesn't suffocate ON that
//     counter — the counter feeds a per-tick risk that climbs the longer it's
//     been out (AIR_HAZARD), so a brief slip out of the water is near-harmless
//     and a long one is near-certain death. Landing back in water resets the
//     counter to zero, so a fish that flops its way to the edge of a puddle
//     really is saved.
//
// 물과 소금물뿐 — "water" above means exactly Water and Saltwater (`BREATHABLE`).
// Every other liquid is 오염수: it can't be swum in and it kills (POISON_HAZARD,
// 대략 1.5초). This used to be the opposite — a fish would happily swim through
// oil or acid — and it read as a bug rather than as a feature: 기름을 부어도
// 물고기가 태연히 헤엄치면 수조에 무슨 짓을 해도 상관없다는 뜻이라, 어항을 관리할
// 이유가 사라진다. 이제 기름 유출은 떼죽음이고, 그 편이 훨씬 재미있다. A liquid
// chilled to its freezing point acts solid everywhere else in the engine (see
// SimContext.isFrozen), so it walls a fish in rather than drowning or poisoning
// it.
//
// 수위 — 물고기는 물을 밀어내지 않는다. A fish swimming into a cell takes that
// cell's water into its own 겹침 (overlap) slot instead of shoving it aside
// (`porous` + `overlapFluids`, drawIntoOverlay in `swim`), so a tank's surface
// sits exactly where it would with no fish in it: 열 마리를 풀어도 물이 넘치지
// 않는다. The engine already had the whole mechanism for it — wet sand carries
// its water the same way — and it comes with the bookkeeping for free: `swap`
// carries the overlay, `set` hands it to the corpse (a Powder hosts a liquid),
// and a corpse rotting away releases it back into the cell. The water is parked,
// never destroyed. Out of water the fish sheds it again (`shedWater`), so a
// stranded one is an ordinary opaque body dripping a puddle at its feet.
//
// It dies six ways, all of them leaving a Dead Fish (deadfish.ts) that floats
// belly-up to the surface: 고온, 폭발 충격파(인접 Blast 섬광은 즉사), 방사능 피폭,
// 감전, 물 밖 질식, 오염수 접촉. A weaker shockwave — a Woofer's thump — kills it
// half the time and merely throws it the rest (`shockLoose` + `shockDeathChance`,
// the Termite's exact pattern; see blast.ts). Electricity is the same 50%, and
// reaches much further than you'd expect: water is a conductor, so a live wire
// dipped in a tank electrifies the whole pool at once (`sparkDeathChance`, driven
// from spark.ts).
//
// 잡아먹거나 번식하지 않는다. 개체 수는 유저가 찍은 만큼이 전부다 — a tank doesn't
// silently fill up with fish while you look away.

/** 사망 온도 — a fish is far more fragile than a termite (70°): water this warm is
 *  already lethal long before it would boil. */
const DEATH_TEMP = 45;
/** 물 밖에서 버티는 시간(틱) — the MEDIAN, ~12초 at ×1 speed, not a deadline. Long
 *  enough that a fish flung onto the bank by a blast has a real chance to flop
 *  back in. */
const AIR_DEATH_MEDIAN = Math.round(12 * SIM_HZ_AT_1X);
/** 질식은 타이머가 아니라 매 틱 굴리는 확률이고, 그 확률은 물 밖에 있던 시간에
 *  비례해 오른다 — p(t) = t × AIR_HAZARD. 두 가지를 동시에 만족해야 해서 이 모양이다.
 *
 *  **고정 타이머가 아닐 것.** 정확히 360틱에 죽으면 같이 던져진 무리가 한 프레임에
 *  일제히 죽어 기계처럼 보인다. 사체 부패가 카운터 대신 확률을 쓰는 것과 같은 이유다
 *  (deadfish.ts).
 *
 *  **그런데 매 틱 *같은* 확률이어도 안 된다.** 그러면 물 밖에 나온 첫 틱에 죽는
 *  개체가 나온다. 수조에서 물이 출렁이거나 물고기끼리 서로를 한두 틱 가두는 일은
 *  실제로 일어나므로(1번 검사가 그 blip을 재고 있다), 균일 확률은 멀쩡히 헤엄치던
 *  물고기를 이유 없이 죽이는 것으로 보인다. 위험률이 시간에 비례해 오르면 스친
 *  경우는 사실상 안전하고(2틱이면 1e-5), 오래 나와 있을수록 진짜로 위험해진다 —
 *  "빨리 물로 돌아가야 한다"가 규칙이 아니라 압력으로 읽힌다.
 *
 *  선형 위험률의 생존곡선은 S(t) = exp(-t²·AIR_HAZARD/2)이므로, 중앙값을
 *  AIR_DEATH_MEDIAN에 맞추려면 AIR_HAZARD = 2·ln2 / median². 분포는 레일리 분포라
 *  표준편차가 중앙값의 약 0.5배 — 12초쯤에 몰리되 6~20초로 흩어진다.
 *
 *  꼬리는 유한하지 않고 그냥 아주 얇다. 카운터가 10비트라 1023틱(34초)에서 멈추므로
 *  위험률도 거기서 오르기를 그치고 1.1%/틱로 굳는다 — 상한이 아니라 지수 꼬리다.
 *  34초를 넘기는 개체가 0.4%쯤 있고, 그중 대부분이 몇 초 안에 죽어 60초까지 가는
 *  것은 100만 마리에 하나꼴이다(3번 검사의 60초 창이 잘라내는 양). */
const AIR_HAZARD = (2 * Math.LN2) / (AIR_DEATH_MEDIAN * AIR_DEATH_MEDIAN);
/** 충격파 노출 시 사망 확률 — half of a school caught in a (non-destructive) wave is
 *  crushed; the rest is only flung. */
const SHOCK_DEATH_CHANCE = 0.5;

/** 오염수 사망 — 물·소금물이 아닌 액체에 닿아 있는 동안 매 틱 굴리는 확률. 평균
 *  수명 POISON_MEAN_SECONDS이라 기름이 덮친 수조는 몇 초 만에 조용해진다.
 *
 *  질식(AIR_HAZARD)과 달리 **시간에 비례해 오르지 않고 매 틱 같은 확률**이다. 오르는
 *  위험률을 쓰려면 노출 시간을 또 하나 세야 하는데 `aux`가 이미 꽉 차 있고(아래 레이아웃
 *  — 남은 건 비트 하나뿐), 무엇보다 질식이 그 모양이어야 했던 이유가 여기엔 없다:
 *  물고기가 제 수조에서 한두 틱 물이 안 닿는 일은 늘 있지만, 기름에 스치는 것은 사고가
 *  아니라 유저가 기름을 부은 결과다. 그래도 지수분포라 사망 시점은 흩어지고(무리가 한
 *  프레임에 몰살하지 않는다) 한 틱 스친 개체는 2.2%만 죽으므로, 파도가 기름을 잠깐
 *  끼얹은 정도로는 대개 살아남는다. */
const POISON_MEAN_SECONDS = 1.5;
const POISON_HAZARD = 1 / (POISON_MEAN_SECONDS * SIM_HZ_AT_1X);

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
/** 느슨한 모임 — how far a fish looks for company when it picks a fresh heading. */
const SCHOOL_RADIUS = 8;
/** Having found company beyond arm's length, the chance it aligns with the group's heading
 *  or heads toward the group's centre.
 *  
 *  개인 공간(PERSONAL_SPACE=3)으로 밀착을 방지하면서, 정렬(ALIGN_CHANCE=0.3)과 응집(COHERE_CHANCE=0.45)을
 *  조합하여 완전히 붙어 뭉치지 않되 좀 더 명확하게 떼를 지어 수평 유영하는 절충안입니다. */
const ALIGN_CHANCE = 0.3;
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
//   bits 5-14  물 밖 경과 틱 (0..1023), reset to 0 the moment it touches water.
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

/** 물고기가 살 수 있는 액체 — 물과 소금물뿐. Also the exact list the fish may take
 *  into its 겹침 slot (`overlapFluids` below), which is what keeps the two halves
 *  of the design honest: it can only carry what it can breathe, so a fish is never
 *  found holding a pocket of oil. */
const BREATHABLE: readonly number[] = [WATER.id, SALTWATER.id];

const isBreathable = (id: number): boolean => id === WATER.id || id === SALTWATER.id;

/** True if (x,y) is water a fish can be *in*: unfrozen Water or Saltwater. Frozen
 *  water acts solid everywhere else in the engine (see SimContext.isFrozen), so it
 *  walls a fish in rather than letting it swim; every other liquid is 오염수 and is
 *  refused here so the fish never *chooses* to swim into what kills it (it can
 *  still be dropped in one, which is what `touchingPoison` is for). */
function swimmable(x: number, y: number, sim: SimContext): boolean {
  if (!sim.inBounds(x, y)) return false;
  const id = sim.get(x, y);
  if (id === EMPTY) return false; // 수면 위 공기로는 스스로 나가지 않는다
  return isBreathable(id) && !sim.isFrozen(x, y);
}

/** True if any cardinal neighbour is breathable water — "아직 물에 닿아 있다". Note
 *  this is NOT crawler.ts's `isSubmerged`, which the bugs use to drown: that one
 *  demands *no* air neighbour, so a fish cruising just under the waterline would
 *  read as out of water and slowly suffocate at the top of its own tank. A fish
 *  only needs to be touching water, not buried in it.
 *
 *  Deliberately blind to the water the fish is *carrying* in its own 겹침 slot
 *  (see the header note on 수위). Counting that would mean a fish flung onto dry
 *  land breathes out of the pocket it swallowed on the way — for as long as the
 *  pocket lasts, which under zero gravity is forever, since nothing drains. The
 *  fish sheds that water the same tick it finds itself out of water (`shedWater`),
 *  so the two rules agree: 이웃에 물이 없으면 물 밖이다. */
function touchingWater(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isBreathable(sim.get(nx, ny)) && !sim.isFrozen(nx, ny)) return true;
  }
  return false;
}

/** True if any cardinal neighbour is a liquid that ISN'T water — 오염수 접촉.
 *  Frozen liquids are excluded for the same reason `swimmable` excludes them:
 *  a block of frozen oil is a wall the fish is pressed against, not a bath it is
 *  dying in. Checked even while it is happily swimming, so a slick of oil floating
 *  on a tank kills the fish that come up to meet it. */
function touchingPoison(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (id === EMPTY || isBreathable(id)) continue;
    if (getMaterial(id).phase === Phase.Liquid && !sim.isFrozen(nx, ny)) return true;
  }
  return false;
}

/** 물 밖으로 나온 물고기가 품고 있던 물을 흘려보낸다 — the counterpart to the
 *  `drawIntoOverlay` in `swim`, and what keeps "물고기 한 마리 = 물 한 칸을 밀어냄"
 *  from surviving out of the tank. Gravity's way first, then the two sides, then
 *  up: a fish stranded on a bank leaves its water on the ground rather than
 *  hovering with it. Written against the gravity vector, like `flop`, so it still
 *  drips downhill when the world's gravity is rotated — and NOT gated on gravity
 *  *strength*, because a weightless fish still has to let go (`SimContext.
 *  updateOverlay`, which is gated, would otherwise never drain the slot and the
 *  fish would breathe out of it forever).
 *
 *  Boxed in on all four sides by solids it keeps carrying — there is nowhere to
 *  put a cell of water — and suffocates holding it, which is the corpse's problem
 *  then (a Dead Fish is a Powder and hosts the liquid quite happily). */
function shedWater(x: number, y: number, sim: SimContext): void {
  if (sim.getOverlay(x, y) === EMPTY) return;
  const gx = sim.gravityX;
  const gy = sim.gravityY;
  if (sim.pushOverlay(x, y, x + gx, y + gy)) return;
  if (sim.pushOverlay(x, y, x - gy, y + gx)) return;
  if (sim.pushOverlay(x, y, x + gy, y - gx)) return;
  sim.pushOverlay(x, y, x - gx, y - gy);
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

/** A heading for a fish that needs one and isn't being crowded: 느슨하게 무리 짓는다.
 *  개인 공간(PERSONAL_SPACE)으로 근접 밀착을 방지하며, 정렬(ALIGN_CHANCE)과 응집(COHERE_CHANCE)을
 *  조합하여 완전히 붙어 뭉치지 않되 적당히 떼를 지어 유영합니다. */
function freeHeading(x: number, y: number, sim: SimContext): number {
  let cx = 0;
  let cy = 0;
  let hx = 0;
  let hy = 0;
  let n = 0;
  for (let dy = -SCHOOL_RADIUS; dy <= SCHOOL_RADIUS; dy++) {
    for (let dx = -SCHOOL_RADIUS; dx <= SCHOOL_RADIUS; dx++) {
      if (dx === 0 && dy === 0) continue;
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
    if (sim.chance(ALIGN_CHANCE)) {
      const toward = headingToward(hx, hy);
      if (toward >= 0) return toward;
    } else if (sim.chance(COHERE_CHANCE)) {
      const toward = headingToward(cx, cy);
      if (toward >= 0) return toward;
    }
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
    // 수위 — 밀어내지 않고 **품고** 간다. Drawing the target's water into this
    // fish's own 겹침 slot empties that cell, so the swap below walks the fish
    // into a vacated cell instead of shoving a cell of water out to where the
    // fish just was — which is exactly the displacement that used to make a
    // tank's level climb by one cell for every fish poured into it. Two cells
    // become one, the way a sinking grain of sand swallows the drop it
    // displaces (SimContext.tryMove's 겹침 absorb).
    //
    // It returns false when the slot is already full, and that case is just as
    // correct: the fish carries its own water and `swap` trades it with the
    // target's, so the water stays put and only the fish moves.
    sim.drawIntoOverlay(x, y, x + dx, y + dy);
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
  // *into* a gas cell — touchingWater only counts water, so a fish beside
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

/** 사망 — the corpse takes over the cell, keeping nothing of the fish's state but
 *  the one bit the renderer needs: which way it was facing, so the Dead Fish's own
 *  꼬리 (deadfish.ts's `tailPixel`) trails on the same side the living fish's did
 *  instead of flipping the instant it dies. `set`, not `spawn`, hands the corpse
 *  whatever was in the 겹침 slot as well (a Powder hosts a liquid), so a fish that
 *  dies mid-tank doesn't spit its cell of water back out and bump the level. */
function die(x: number, y: number, sim: SimContext): void {
  const faces = sim.getAux(x, y) & FACING_RIGHT;
  sim.set(x, y, DEAD_FISH.id);
  sim.setAux(x, y, faces);
}

function updateFish(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= DEATH_TEMP || touchingBlast(x, y, sim)) {
    die(x, y, sim);
    return;
  }
  // 오염수 — 물·소금물이 아닌 액체에 닿아 있으면 매 틱 굴린다(POISON_HAZARD).
  // Rolled before the swim so it applies at the waterline too: a slick of oil on
  // top of a tank kills the fish that surface into it, which is the whole point.
  if (touchingPoison(x, y, sim) && sim.chance(POISON_HAZARD)) {
    die(x, y, sim);
    return;
  }
  const a = sim.getAux(x, y);
  if (touchingWater(x, y, sim)) {
    swim(x, y, sim, a); // swim() re-packs with the air counter cleared
    return;
  }
  // 물 밖 — 품고 있던 물부터 내려놓는다(see shedWater). Before the suffocation
  // roll, so a fish that dies out of water has already left its water behind
  // rather than handing a puddle to the corpse.
  shedWater(x, y, sim);
  // 질식 — 시간에 비례해 오르는 위험률을 매 틱 굴린다(AIR_HAZARD). 카운터는 여전히
  // 세지만 그건 이제 '기한'이 아니라 위험률의 입력이고, 물에 닿는 순간 0으로 돌아가는
  // 것은 그대로다 — 웅덩이 가장자리까지 튀어 가면 사는 것도 그대로.
  const air = airOf(a) + 1;
  if (sim.chance(air * AIR_HAZARD)) {
    die(x, y, sim);
    return;
  }
  flop(x, y, sim, a, air);
}

export const FISH = register({
  id: 146,
  name: 'Fish',
  phase: Phase.Powder,
  // 짙은 네이비 몸통 — dark enough to read as a silhouette against the water it
  // swims in (and against the oil slick that kills it), which a mid-tone body
  // would not.
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
  // 수위 — a fish takes up no room in the water it swims in: its cell holds the
  // water too, in the 겹침 (overlap) slot every porous host has (see the header
  // note). `porous` is what makes a *Solid* eligible to host at all
  // (SimContext.canHostOverlap), and it comes with the rest of the porous rule
  // for free, all of which reads right for a fish: water flows through its cell
  // rather than piling up on it, and smoke drifts past it instead of being
  // walled out. The allowlist is the same two liquids it can breathe, so nothing
  // else ever ends up inside a fish — a fish full of oil would be a fish that
  // deleted the oil.
  porous: true,
  overlapFluids: BREATHABLE,
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
