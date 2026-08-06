import { DIR8 } from '../engine/directions';
import { SIM_HZ_AT_1X } from '../config';
import type { SimContext } from '../engine/SimContext';
import type { SpoilSpec } from '../engine/types';
import { SALT } from './salt';
import { ALCOHOL } from './alcohol';
import { HONEY } from './honey';
import { MOLD, seedMold } from './mold';

// 부패 — the one implementation every rotting thing in the palette shares, the
// way `combustion.ts` is the one implementation every fuel shares. A material
// opts in by declaring `Material.spoil` (engine/types.ts) and calling `spoilStep`
// from its own update; everything below is the same for all of them and the
// declaration carries only what genuinely differs: how fast, what it becomes, and
// where in that material's `aux` word the counter is allowed to live.
//
// ## 왜 확률 한 방이 아니라 카운터인가
//
// Dead Fish used to rot by rolling a flat chance every tick and vanishing — no
// state at all, and for a corpse that only had to disappear that was the right
// trade. It cannot carry this system, for one reason: **보존은 되돌리는 것이
// 아니라 멈추는 것이다.** Salt a cut halfway through and it has to *hold* there,
// and carry on from there when the salt is gone. A memoryless roll has no
// "there" to hold. So spoilage is a counter (SPOIL_MAX steps), preservation just
// declines to advance it, and every preservation method in the game is therefore
// a pause rather than a cure — which is also the honest model.
//
// The counter lives in the declaring material's own `aux`, at a bit offset that
// material picks, because every food here already had that word spoken for:
// 고기 keeps a dryness counter in bits 0-2, 빵 a crust bit and a lit bit,
// 반죽 a leaven level and two agent flags. The shift is the only thing the spec
// can't derive, and getting it wrong is silent, so each declaration states it
// next to a comment naming what else is in that word.
//
// ## 무엇이 멈추는가 (four preservation routes, and one that is free)
//
//   • 저온 — under SPOIL_MIN_TEMP. 냉장고를 지어라. Ice, Snow, Dry Ice and
//     Liquid N₂ all already do this; nothing was added for it.
//   • 고온 — at or over SPOIL_STOP_TEMP. Food being cooked is not also rotting,
//     which matters more than it sounds: without it a steak on a grill would be
//     racing two clocks and the fun one would lose.
//   • 건조 — 고기 사슬 only, and it is free: the dryness counter that makes
//     직화구이 work (meat.ts) already says whether a cut is bone dry, so 육포 is
//     a rule this system reads rather than a rule it adds. A material declares
//     `dryMask` to opt in.
//   • 염장 · 담금 — Salt, Alcohol or Honey touching the cell. All three are
//     ordinary palette materials doing a new job; this is the whole reason the
//     round adds three materials and not eight.
//
// Note what is deliberately *not* here: 훈연 and 밀폐. Smoke lives ~0.6s, so
// smoking would need a soak-time model of its own, and airtightness would make
// the inside of any large body preserve itself for free — "큰 덩어리는 겉만
// 썩는다" is a rule with no way to see it.
//
// ## 곰팡이가 전염 경로다
//
// The counter is invisible (it shares a word with ramps that are already spoken
// for), so the warning is 곰팡이: past MOLD_AT a cell starts throwing spores into
// the empty space around it (mold.ts), and a cell with mold against it rots
// MOLD_ACCEL times faster. That is what makes "창고에 하나 썩으면 다 썩는다"
// true without any food-to-food infection rule — the mold film creeps along the
// outside of a stack and the stack rots under it. It is also why mold spreading
// onto stone is harmless in exactly the way the design wants: the acceleration
// has nothing to act on there.

/** 부패 단계 수. Three bits, so a declaring material gives up exactly three bits
 *  of its `aux` word and the whole counter is `(aux >> shift) & SPOIL_MASK`. */
export const SPOIL_MAX = 7;
export const SPOIL_MASK = 0b111;

/** 곰팡이가 피기 시작하는 단계 — a bit past halfway, so the visible warning
 *  arrives with time left to act on it (salt it, chill it, cook it) rather than
 *  as an obituary. */
const MOLD_AT = 4;

/** 부패가 진행되는 온도 구간. Below the first, a freezer; at or above the second,
 *  cooking heat sterilises. The upper bound is the same 60° 효모 dies at
 *  (batter.ts) and 씨앗 stops germinating at (seed.ts) — the roster's existing
 *  "이 온도 위로는 생물이 못 산다" line, reused rather than re-picked. */
const SPOIL_MIN_TEMP = 0;
const SPOIL_STOP_TEMP = 60;

/**
 * 온도가 속도를 정한다 — but not monotonically, and that matters more than it
 * sounds. The declared `seconds` is the pace at room temperature
 * (RATE_ANCHOR_TEMP); warmth speeds it up to a peak and then it *falls off again*
 * as the sterilising bound approaches, reaching zero exactly there.
 *
 * The first version was a plain ratio that climbed all the way to the 60° cutoff,
 * and it was wrong twice over. It made the cutoff a cliff — a cell at 59° rotting
 * at full tilt and a cell at 60° frozen in place — where what the player is
 * actually doing is applying heat, gradually. And it made *gently warm* the worst
 * possible storage by a wide margin: `test/cooking.ts` caught it, with a 50° scene
 * that exists to prove a warm plate leaves a raw cut alone finding 82 of 96 cells
 * rotted instead. Falling off toward the bound is also the honest curve — spoilage
 * organisms peak around body heat and are dying well before water boils.
 */
const RATE_ANCHOR_TEMP = 20;
/** 가장 빨리 썩는 온도, and how much faster than room temperature it is. */
const RATE_PEAK_TEMP = 35;
const RATE_PEAK = 2;
/** The floor for the cold side, so a cell just over freezing still creeps rather
 *  than stopping outright — freezing is what stops it, and that has its own
 *  threshold. */
const RATE_MIN = 0.2;

/** The curve described above, as a factor on the declared pace. */
function tempScale(t: number): number {
  if (t <= RATE_ANCHOR_TEMP) return Math.max(RATE_MIN, t / RATE_ANCHOR_TEMP);
  if (t <= RATE_PEAK_TEMP) {
    const f = (t - RATE_ANCHOR_TEMP) / (RATE_PEAK_TEMP - RATE_ANCHOR_TEMP);
    return 1 + (RATE_PEAK - 1) * f;
  }
  const f = (SPOIL_STOP_TEMP - t) / (SPOIL_STOP_TEMP - RATE_PEAK_TEMP);
  return RATE_PEAK * Math.max(0, f);
}

/** 곰팡이가 붙은 칸은 훨씬 빨리 썩는다 — the transmission path, see the note. */
const MOLD_ACCEL = 3;

/** 포자 — per-tick chance a sufficiently rotten cell tries to start a colony in
 *  one of its empty neighbours. Low, because a *cell* rolls it and a body of food
 *  has many: a loaf furs over in a few seconds of game time while a single
 *  dropped crumb takes a while to grow anything at all. */
const SPORE_CHANCE = 0.02;

/** 소금·알콜·꿀 — 염장과 담금. Contact only (`DIR8`), never consumed: a salt
 *  crust or a honey jar is a condition the food is being kept in, not a reagent
 *  being spent, and food that un-preserved itself by sitting in its own brine
 *  would be a strictly worse version of the same idea. */
function isPreservative(id: number): boolean {
  return id === SALT.id || id === ALCOHOL.id || id === HONEY.id;
}

/** Read the spoilage counter out of a cell's `aux` word. */
export function spoilOf(aux: number, spec: SpoilSpec): number {
  return (aux >> spec.auxShift) & SPOIL_MASK;
}

/** Write a spoilage counter into an `aux` word, leaving every other bit alone. */
export function withSpoil(aux: number, spec: SpoilSpec, value: number): number {
  return (aux & ~(SPOIL_MASK << spec.auxShift)) | (value << spec.auxShift);
}

/**
 * Run one tick of spoilage on a cell. Returns `true` if the cell turned this
 * tick (it is now `spec.into` and the caller must not touch it again), `false`
 * otherwise.
 *
 * Callers put this at the TOP of their update for the same reason `dryStep`
 * sits there: a cell that has just gone over should not also run the turn of the
 * material it no longer is.
 */
export function spoilStep(x: number, y: number, sim: SimContext, spec: SpoilSpec): boolean {
  const t = sim.getTemp(x, y);
  if (t < SPOIL_MIN_TEMP || t >= SPOIL_STOP_TEMP) return false;

  const aux = sim.getAux(x, y);

  // 건조 — 육포. Free for the meat chain, which already tracks this (meat.ts);
  // everything else omits `dryMask` and skips the test.
  if (spec.dryMask !== undefined && (aux & spec.dryMask) === spec.dryMask) return false;

  // 염장·담금, and the mold that speeds things up — one neighbour walk for both,
  // since a cell that is preserved doesn't care what else is touching it.
  let accel = 1;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (isPreservative(nid)) return false;
    if (nid === MOLD.id) accel = MOLD_ACCEL;
  }

  const stage = spoilOf(aux, spec);

  // 포자 — past the halfway mark the cell starts trying to grow a colony on
  // itself. Before the counter advances, so the last stage before turning still
  // gets its turn to seed.
  if (stage >= MOLD_AT && sim.chance(SPORE_CHANCE)) seedMold(x, y, sim);

  // `SPOIL_MAX + 1`, not `SPOIL_MAX`: a cell needs seven successful rolls to climb
  // 0 → SPOIL_MAX and an eighth to actually turn, so dividing the declared time by
  // seven makes every material take an eighth longer than it says (measured: a
  // 60s cut converting at 68.4s). The declared number is quoted in the codex and
  // in the docs, so it has to be the number that comes out.
  const rate = ((SPOIL_MAX + 1) / (spec.seconds * SIM_HZ_AT_1X)) * tempScale(t) * accel;
  if (!sim.chance(rate)) return false;

  if (stage < SPOIL_MAX) {
    sim.setAux(x, y, withSpoil(aux, spec, stage + 1));
    return false;
  }

  // Gone over. `set` keeps aux (that is its contract), and what is in there is
  // this material's private bookkeeping — a dryness counter, a crust bit, a
  // leaven level — none of which means anything to what comes next. Clearing it
  // is the same discipline every in-place transform in the roster keeps.
  sim.set(x, y, spec.into());
  sim.setAux(x, y, 0);
  return true;
}
