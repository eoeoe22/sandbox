import { DIR4, DIR8 } from '../engine/directions';
import { SIM_HZ_AT_1X } from '../config';
import type { SimContext } from '../engine/SimContext';
import type { SpoilSpec } from '../engine/types';
import { Phase } from '../engine/types';
import { getMaterial } from './registry';
import { SALT } from './salt';
import { SUGAR } from './sugar';
import { SALTWATER } from './saltwater';
import { SUGAR_WATER } from './sugarwater';
import { ALCOHOL } from './alcohol';
import { HONEY } from './honey';
import { WATER } from './water';
import { STEAM } from './steam';
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
// ## 무엇이 멈추는가 (five preservation routes, and one that is free)
//
//   • 저온 — under SPOIL_MIN_TEMP. 냉장고를 지어라. Ice, Snow, Dry Ice and
//     Liquid N₂ all already do this; nothing was added for it.
//   • 고온 — at or over SPOIL_STOP_TEMP. Food being cooked is not also rotting,
//     which matters more than it sounds: without it a steak on a grill would be
//     racing two clocks and the fun one would lose.
//   • 건조 — 생고기 only, and it is free: the dryness counter that makes 직화구이
//     work (meat.ts) already says whether a cut is bone dry, so 육포 is a rule
//     this system reads rather than a rule it adds. A material declares `dryMask`
//     to opt in. 익은 고기 pointedly does not: grilling drives that same counter
//     to full on its own, so declaring it there made every cooked cut immortal
//     (cookedmeat.ts).
//   • 염장 · 당장 · 담금 — one of the six 절임 물질 (`isPreservative`) against the
//     cell: 소금·설탕 두 가루, 소금물·설탕물 두 절임액, 그리고 꿀·알콜. All six are
//     ordinary palette materials doing a new job; this is the whole reason the
//     round adds no materials at all.
//   • 잠김 — 절임 물질에 파묻힌 덩어리의 **속살** (`isSubmerged`): 사방으로 덩어리를
//     뚫고 나가 「가장 가까운 소금」이 「가장 가까운 트인 곳」보다 가까우면 절여진 것
//     이다. 접촉만 보면 소금 더미에 묻은 고기 블록은 닿은 겉껍질 한 겹만 지켜지고
//     안쪽은 그대로 썩는데, 그건 「절였다」가 아니라 「겉에 소금을 뿌렸다」다.
//     밀폐는 여전히 보존이 아니다(절임 물질이 없으면 통과할 수 없다). See its note.
//   • 물질만 아는 조건 (`keptWhile`) — an escape hatch for a pause only the
//     declaring material can evaluate. One user: 반죽 is kept while it is actively
//     fermenting (batter.ts), because 발효 and 부패 are the same kind of process
//     and running both at once means the rise always loses.
//
// Note what is deliberately *not* here: 훈연 and 밀폐. Smoke lives ~0.6s, so
// smoking would need a soak-time model of its own, and airtightness would make
// the inside of any large body preserve itself for free — "큰 덩어리는 겉만
// 썩는다" is a rule with no way to see it.
//
// ## 무엇이 시계를 돌리는가 (`isRotting`) — 방치는 그 자체로 아무것도 아니다
//
// 보존 above is the list of things that *stop* the clock. This is the other half,
// added later and the more important one: **what has to be true for it to run at
// all.** By default a food cell rots only while
//
//   • **젖어 있다** — 물 또는 수증기가 닿아 있거나 그 칸에 스며 있다, or
//   • **곰팡이가 닿아 있다.**
//
// A dry loaf on a dry shelf keeps forever, and that is the point. The first
// version had every food rot unattended, which made the palette's whole food half
// an egg timer: anything you built with it dissolved while you were looking at
// something else, and a store room — the obvious thing to build with food — was
// a structure that deleted itself. 「썩는다」 has to be something the world does to
// your food, not something food does.
//
// **생고기 is the single exception** (`SpoilSpec.spontaneous`), and 부패물 is the
// second declaration of it — not an exception to the rule but a terminus: its
// `spoil` step is 분해 into 퇴비 rather than rot, and a heap has to be able to
// finish on its own or the chain never terminates.
//
// ## 곰팡이 자연발생도 같은 조건을 쓴다 (`SpoilSpec.spores`)
//
// 「시계가 도는 조건」 above and 「곰팡이가 피는 조건」 are deliberately the *same*
// condition seen twice, because the player only has to learn one thing: **젖으면
// 상하고, 젖으면 곰팡이가 핀다.** Past MOLD_AT a cell puffs spores into a
// neighbouring cell, and whether it may do that at all is a three-way declaration
// (engine/types.ts `SporeMode`):
//
//   • **젖었을 때만 (`'damp'`, the default)** — 대부분의 일반 식품. 빵·익은 고기·
//     죽은 물고기·팝콘·옥수수알·반죽. Nothing declares it; it is what you get by
//     saying nothing, which is right because a wet cell is already the only kind
//     whose clock runs.
//   • **마른 자리에서도 (`'always'`)** — 생고기뿐. That is the only thing left that
//     makes a raw cut special: everything else needs the world to wet it first.
//   • **절대 (`'never'`)** — 부패물뿐, and stated out loud rather than derived from
//     `spontaneous`. A heap that puffed spores would send them creeping onto the
//     next shelf, and mold contact starts *those* clocks — the exact failure this
//     system removed, returning through the chain's own output. 부패물은 10.4초 뒤
//     퇴비가 되는 종착점이지 곰팡이 농장이 아니다.
//
// An earlier round had `spores` as a boolean that only 생고기 set, so the world had
// exactly one origin for mold — and the trouble with that, which a play test found
// immediately, is that **젖은 빵에 곰팡이가 안 폈다.** Soaking a loaf ran its clock
// and turned it into 부패물 with nothing to see on the way, which is the wrong
// reading of what water does to bread. Wet food growing its own mold restores the
// picture without giving up the property the gate bought: 마른 선반은 여전히 안전하다.
//
// ## 곰팡이가 전염 경로다
//
// The counter is invisible (it shares a word with ramps that are already spoken
// for), so the warning is 곰팡이: past MOLD_AT a cell allowed to seed starts
// puffing spores into the space around it (mold.ts), and mold **eats food
// outright** — an adjacent food cell is converted to more mold. That is what makes
// "창고에 하나 썩으면 다 썩는다" true without any food-to-food infection rule, and it
// is also why mold drifting onto stone stays harmless: there is nothing there to
// eat.
//
// Mold contact being a *clock* trigger and an *erosion* trigger is one mechanism
// seen twice, and the order matters: a colony touching a fresh loaf starts that
// loaf's counter, and only once the counter has climbed past MOLD_AT may the
// colony eat it (`moldCanEat`). So mold never outruns the clock it is the visible
// end of — it starts it.
//
// Erosion consults `isPreserved` below rather than doing its own test, so a
// salted ham or a frozen loaf is not eaten either. 보존 has to mean 보존 against
// every route or it means nothing.

/** 부패 단계 수. Three bits, so a declaring material gives up exactly three bits
 *  of its `aux` word and the whole counter is `(aux >> shift) & SPOIL_MASK`. */
export const SPOIL_MAX = 7;
export const SPOIL_MASK = 0b111;

/** 곰팡이가 피기 시작하는 단계 — a bit past halfway, so the visible warning
 *  arrives with time left to act on it (salt it, chill it, cook it) rather than
 *  as an obituary.
 *
 *  It is also the stage at which a cell can be *eaten* (see `moldCanEat`), and
 *  those being the same number is the whole reason the two halves stay in
 *  proportion: mold appears exactly where food has gone far enough to be taken. */
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

/** 포자 — per-tick chance a sufficiently rotten cell that is allowed to seed
 *  (`SpoilSpec.spores`) puffs one into a neighbouring cell. Low, because a *cell*
 *  rolls it and a body of food has many: a cut furs over in a few seconds of game
 *  time while a single dropped scrap takes a while to grow anything at all. */
const SPORE_CHANCE = 0.02;

/** `rotSources` bits — 젖었다 / 곰팡이가 닿았다. Returned together because both
 *  answers come out of one pass over `DIR8` and both are wanted: the first decides
 *  whether the clock runs *and* whether an ordinary food may seed its own mold,
 *  the second only ever decides the clock. */
const ROT_WET = 0b01;
const ROT_MOLD = 0b10;

/**
 * 썩을 조건이 갖춰졌는가 — the gate described in the module note, for every
 * material that does not declare `spontaneous`.
 *
 * Two ways in, both contact rules like 염장·담금 above, so the player learns one
 * geometry for the whole system:
 *
 *   • **물·수증기** (`ROT_WET`) — touching the cell, or soaked into it. The 겹침
 *     slot is checked because a powder buried in wet ground genuinely is wet (an
 *     ear of corn in damp sand holds the water *in* its own cell, with no water
 *     cell anywhere in `DIR8`), and "젖었나" must not depend on which of the two
 *     places the engine happened to park the liquid.
 *   • **곰팡이** (`ROT_MOLD`) — a colony against the cell. This is the transmission
 *     path: mold starts somewhere, creeps, and wakes up whatever it reaches.
 *
 * The two are returned apart rather than as one boolean because 「젖었나」 is asked a
 * second time, by the spore gate below: an ordinary food seeds mold **only while
 * wet**, and a cell that is merely being touched by someone else's colony must not
 * count as an origin of its own — it already has all the mold it needs next to it.
 *
 * `MOLD.id` is read at call time, never at module load, so the `mold ↔ spoil`
 * import cycle stays safe for the same reason `seedMold` does — the binding is
 * only dereferenced once both modules have finished evaluating.
 */
function rotSources(x: number, y: number, sim: SimContext): number {
  let flags = 0;
  const soaked = sim.getOverlay(x, y);
  if (soaked === WATER.id || soaked === STEAM.id) flags |= ROT_WET;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (id === WATER.id || id === STEAM.id) flags |= ROT_WET;
    else if (id === MOLD.id) flags |= ROT_MOLD;
    if (flags === (ROT_WET | ROT_MOLD)) break;
  }
  return flags;
}

/**
 * 절임 물질 여섯 — 염장·당장·담금. Never consumed: a salt crust or a honey jar is
 * a condition the food is being kept in, not a reagent being spent, and food that
 * un-preserved itself by sitting in its own brine would be a strictly worse
 * version of the same idea.
 *
 * The list is 「높은 삼투압 또는 알콜」 read off the palette, and it is closed under
 * the reactions the roster already has, which is the point of it being six rather
 * than three. 소금 가루에 묻어 둔 고기 위에 물을 부으면 소금이 녹아 소금물이 되는데
 * (salt.ts), 소금물이 명단에 없으면 그 순간 저장고가 통째로 상하기 시작한다 — 현실의
 * 절임은 정확히 그 반대 방향이다. 같은 이유로 설탕/설탕물이 짝으로 들어오고, 꿀은
 * 이미 그 자체가 당장액이다.
 *
 * 물·수증기는 당연히 여기 없다 — 그쪽은 시계를 *돌리는* 쪽이다(`rotSources`).
 */
function isPreservative(id: number): boolean {
  return (
    id === SALT.id ||
    id === SUGAR.id ||
    id === SALTWATER.id ||
    id === SUGAR_WATER.id ||
    id === ALCOHOL.id ||
    id === HONEY.id
  );
}

/** 같은 덩어리인가 — any material that declares `spoil`. 잠김 판정의 광선은 이걸
 *  뚫고 지나간다: 소금에 파묻힌 것이 빵 한 종류일 이유가 없고, 고기 위에 빵을 쌓아
 *  같이 절이는 것이 안 되면 「덩어리」라는 말이 무의미해진다. 부패물도 여기 들어오므로
 *  절임 통 안에서 하나가 넘어가도 나머지의 잠김이 깨지지 않는다. */
function isSpoilable(id: number): boolean {
  const m = getMaterial(id);
  return m !== undefined && m.spoil !== undefined;
}

/** 광선을 막는 것 — 절임 물질이 아니면서 「뚫려 있지 않다」고 볼 수 있는 것, 즉
 *  유체가 못 지나는 고체. 유리병 바닥, 돌 선반, 무쇠솥. 가루(모래·흙)와 유체는
 *  막지 못한다: 그쪽으로는 공기도 물도 드나들므로 「잠겼다」고 할 수 없다. */
function sealsSubmersion(id: number): boolean {
  const m = getMaterial(id);
  return m !== undefined && m.phase === Phase.Solid && m.porous !== true;
}

/** 한 방향으로 덩어리를 뚫고 나갈 수 있는 최대 거리. 이보다 두꺼운 덩어리의 정중앙은
 *  절임 물질을 못 찾아 「안 잠긴」 것이 된다 — 무한 광선은 판 전체가 식품인 장면에서
 *  매 틱 O(판)이 되고, 그 장면은 실수로 만들기 쉽다. 판(360×203)의 짧은 변 절반보다
 *  넉넉해서, 실제로 지어 볼 만한 절임통은 전부 안쪽까지 닿는다. */
const SUBMERGE_MAX_DEPTH = 64;

/**
 * 잠겨 있는가 — 접촉이 못 보는 절반, 즉 **절임 물질에 파묻힌 덩어리의 속살**.
 *
 * 접촉 규칙(`DIR8`)만으로는 3층짜리 빵 덩어리에 소금을 얹으면 닿은 한 줄만 지켜졌다.
 * 그건 규칙이 아니라 장면의 기하를 재는 것이고, 플레이어가 「절인다」로 이해하는 동작
 * — 통에 붓고 파묻기 — 이 정확히 안 먹히는 유일한 동작이 된다.
 *
 * ## 규칙: **소금이 바깥보다 가까우면 절여진다**
 *
 * 칸에서 상하좌우 네 방향으로 나가면서 **같은 덩어리(식품)는 뚫고 지나가고**, 처음
 * 만난 남인 칸까지의 거리를 잰다. 그 남인 칸은 셋 중 하나다:
 *
 *   • **절임 물질** → 그 거리를 `cure` 후보로 담는다.
 *   • **막는 고체 또는 판 경계** → 아무것도 아니다. 유리병 바닥·돌 선반이 여기다.
 *     벽은 뚫린 곳이 아니라는 유저 결정이고, 안 그러면 「바닥에 놓인 절임통」이라는
 *     가장 자연스러운 장면이 통째로 실패한다.
 *   • **그 밖의 무엇이든**(빈칸·물·모래·곰팡이) → 트인 곳. `open` 후보로 담는다.
 *
 * 그리고 **가장 가까운 절임 물질이 가장 가까운 트인 곳보다 멀지 않을 때만** 잠긴
 * 것이다. 두 거리의 비교라는 게 요점이고, 이유는 두 가지다.
 *
 *   • **반쯤 잠긴 덩어리가 잠긴 만큼만 지켜진다.** 「네 면이 다 막혔는가」로 물으면
 *     소금 위로 한 칸이라도 튀어나온 기둥이 위로 뚫린 통로가 되어 **잠겨 있는 아래쪽
 *     까지 통째로** 보존이 풀린다. 거리로 물으면 소금에 가까운 아래쪽은 절여지고 공기
 *     쪽에 가까운 윗동만 상한다 — 눈에 보이는 그대로다.
 *   • **밀폐는 여전히 보존이 아니다.** 절임 물질이 하나도 없으면 `cure` 가 무한이라
 *     아무리 돌상자로 밀봉해도 통과하지 못한다. 큰 덩어리 속이 공짜로 안 썩는 것은 이
 *     계통이 처음부터 거절한 규칙이고(모듈 주석), 보존은 **플레이어가 가져다 놓은
 *     물질**이 하는 일로 남아야 한다.
 *
 * **같은 거리는 절여진 쪽으로 끊는다**(`<=`), 그리고 그건 튜닝이 아니라 위 두 번째
 * 항목을 실제로 성립시키는 조건이다. 반쯤 잠긴 기둥에서 공기 쪽 윗동이 썩어 나가면
 * 트인 곳이 **아래로 내려온다**. 엄격한 `<` 로 끊으면 그렇게 내려온 개구부가 잠긴
 * 칸의 소금 거리와 같아지는 순간 그 칸이 풀리고, 풀린 칸이 또 썩어서 개구부를 한 칸
 * 더 내리는 — 침식 전선이 소금 수면 아래로 기어 들어간다(실측: 잠긴 30칸 중 9칸이
 * 이렇게 사라졌다). 같은 거리에서 멈춰 세우면 전선이 수면에서 선다.
 *
 * 무한대끼리는 같아도 잠긴 것이 아니다 — `cure` 가 유한해야 한다는 조건이 위의
 * 「밀폐는 보존이 아니다」를 지키는 자리이고, `<=` 로 바꾸면서 명시적으로 적어야 하는
 * 유일한 곳이다.
 *
 * 광선이지 플러드 필이 아니라, 대각선으로만 트인 오목한 덩어리는 잠긴 것으로 본다.
 * 근사인 걸 알고 쓴다: 정확한 판정은 덩어리마다 플러드 필이고 그건 이 자리에서 낼 수
 * 있는 비용이 아니다. 틀리는 방향도 관대한 쪽이라 「절였는데 썩었다」는 나오지 않는다.
 *
 * 비싸다 — 그래서 `spoilStep` 은 이걸 **굴림이 성공한 뒤에만** 부른다(그 주석 참고).
 */
function isSubmerged(x: number, y: number, sim: SimContext): boolean {
  let open = Infinity;
  let cure = Infinity;
  for (const [dx, dy] of DIR4) {
    // 이미 찾은 가장 가까운 트인 곳보다 멀리 볼 이유가 없다: 그보다 먼 소금은 어차피
    // 판정을 못 뒤집는다. 공중에 놓인 덩어리에서 이 한 줄이 나머지 세 방향을 몇 칸
    // 짜리로 줄인다.
    const reach = Math.min(SUBMERGE_MAX_DEPTH, open);
    let nx = x + dx;
    let ny = y + dy;
    for (let step = 1; step <= reach; step++, nx += dx, ny += dy) {
      if (!sim.inBounds(nx, ny)) break; // 판 경계 = 벽
      const id = sim.get(nx, ny);
      if (isPreservative(id)) {
        if (step < cure) cure = step;
        break;
      }
      // 같은 덩어리 — 계속 뚫는다. 식품을 고체보다 **먼저** 물어야 한다: 빵도 고기도
      // Solid 라 순서가 뒤집히면 덩어리 자신이 자기를 막는 벽이 된다.
      if (isSpoilable(id)) continue;
      if (sealsSubmersion(id)) break; // 벽 — 트인 것도 절인 것도 아니다
      if (step < open) open = step;
      break;
    }
  }
  return cure !== Infinity && cure <= open;
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
 * 보존되고 있는가 — whether anything is currently holding this food cell's clock,
 * by any of the routes in the module note (온도 · 건조 · 염장·당장·담금 · 잠김).
 *
 * Exported because **곰팡이 asks the same question** (mold.ts): a spore that lands
 * on a salted ham or a frozen loaf must not eat it, or 보존 would mean "keeps
 * until something eats it", which is not keeping. Sharing the predicate is what
 * makes 보존 one rule rather than two that drift apart — there is exactly one
 * definition of what a preserved cell is and both readers consult it.
 */
export function isPreserved(x: number, y: number, sim: SimContext, spec: SpoilSpec): boolean {
  return keptCheaply(x, y, sim, spec) || isSubmerged(x, y, sim);
}

/**
 * 보존 판정의 싼 절반 — 온도·건조·`keptWhile`·접촉. Every one of these is a handful
 * of array reads on the cell itself or its eight neighbours.
 *
 * Split out from `isPreserved` purely so `spoilStep` can put the *expensive* half
 * (잠김, which walks rays through the body) behind a die roll — see the note
 * there. Nothing about the meaning is split: 보존은 여전히 한 술어고, 바깥에서
 * 물어보는 쪽(mold.ts)은 `isPreserved` 하나만 본다.
 */
function keptCheaply(x: number, y: number, sim: SimContext, spec: SpoilSpec): boolean {
  const t = sim.getTemp(x, y);
  if (t < SPOIL_MIN_TEMP || t >= SPOIL_STOP_TEMP) return true;

  // 건조 — 육포. Free for 생고기, which already tracks this (meat.ts); everything
  // else omits `dryMask` and skips the test.
  const aux = sim.getAux(x, y);
  if (spec.dryMask !== undefined && (aux & spec.dryMask) === spec.dryMask) return true;

  // 물질만 아는 조건 — 반죽's "발효 중" (batter.ts). Declared rather than special-
  // cased here so this file stays the shared routes and nothing else.
  if (spec.keptWhile !== undefined && spec.keptWhile(x, y, sim)) return true;

  // 염장·당장·담금 — 절임 물질이 칸에 닿아 있다.
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isPreservative(sim.get(nx, ny))) return true;
  }
  return false;
}

/**
 * 곰팡이가 먹을 수 있는 칸인가 — far enough gone to have lost to it, and not being
 * kept.
 *
 * The stage gate is what keeps 침식 from outrunning the clock it is supposed to
 * be the visible end of. Without it mold ate *fresh* food the moment a colony
 * touched it, and since every eaten cell becomes another eater the front ran away
 * exponentially — which quietly destroyed the things you are supposed to be able
 * to do with food. `test/cooking.ts` caught both: a 200-cell dough could no longer
 * be proofed (it was eaten during the rise, so the "효모 반죽은 정확히 두 배"
 * measurement came back 0 → 2 → 29 of 200), and a raw cut on a 50° plate — a scene
 * that exists to prove a warm plate leaves meat alone — came back 0 of 96.
 *
 * With the gate, mold can only take cells the timer had already brought most of
 * the way, so it makes the tail of spoilage fast and *visible* without ever
 * getting ahead of it. 곰팡이는 상하기 시작한 것을 먹지, 멀쩡한 것을 먹지 않는다.
 */
export function moldCanEat(x: number, y: number, sim: SimContext, spec: SpoilSpec): boolean {
  if (spoilOf(sim.getAux(x, y), spec) < MOLD_AT) return false;
  return !isPreserved(x, y, sim, spec);
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
  if (keptCheaply(x, y, sim, spec)) return false;
  const sources = rotSources(x, y, sim);
  // 방치는 그 자체로 아무것도 아니다 — 생고기와 부패물만 이 문을 그냥 지난다.
  if (spec.spontaneous !== true && sources === 0) return false;

  const t = sim.getTemp(x, y);
  const aux = sim.getAux(x, y);
  const stage = spoilOf(aux, spec);

  // 포자 — past the halfway mark a cell starts trying to grow a colony on itself,
  // if its `SporeMode` lets it (engine/types.ts): 'always' for 생고기, 'damp' (the
  // default, so most foods) only while the cell is actually wet, 'never' for 부패물.
  // Before the counter advances, so the last stage before turning still gets its
  // turn to seed.
  const mode = spec.spores ?? 'damp';
  const maySeed = mode === 'always' || (mode === 'damp' && (sources & ROT_WET) !== 0);
  if (maySeed && stage >= MOLD_AT && sim.chance(SPORE_CHANCE) && !isSubmerged(x, y, sim)) {
    seedMold(x, y, sim);
  }

  // `SPOIL_MAX + 1`, not `SPOIL_MAX`: a cell needs seven successful rolls to climb
  // 0 → SPOIL_MAX and an eighth to actually turn, so dividing the declared time by
  // seven makes every material take an eighth longer than it says (measured: a
  // 60s cut converting at 68.4s). The declared number is quoted in the codex and
  // in the docs, so it has to be the number that comes out.
  const rate = ((SPOIL_MAX + 1) / (spec.seconds * SIM_HZ_AT_1X)) * tempScale(t);
  if (!sim.chance(rate)) return false;

  // 잠김은 **굴림이 성공한 뒤에** 묻는다 — 판정 자체는 순서와 무관하게 같은 답을 주고
  // (틱 안에서 결정적이다), 비용만 1/1000 로 떨어진다. 광선 판정은 칸당 최대 4×64 회
  // 읽기라, 매 틱 모든 식품 칸에 돌리면 「판 전체가 생고기」 같은 장면에서 프레임을
  // 통째로 먹는다. 굴림 성공률은 생고기 기준 틱당 0.09% 다.
  //
  // 접촉·온도·건조는 반대로 **앞**에 있어야 한다: 싸고, 무엇보다 굴림을 소비하지 않아야
  // 절인 칸이 난수 흐름에 손을 안 댄다.
  if (isSubmerged(x, y, sim)) return false;

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
