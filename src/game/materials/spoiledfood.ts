import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { spoilStep } from './spoil';
import { COMPOST } from './compost';
import { ASH } from './ash';

// Spoiled Food (부패물) — 부패 사슬의 가운데. Everything that rots arrives here
// (spoil.ts) and everything here carries on to 퇴비 (compost.ts), so the line is:
//
//   식품 / 사체 ──부패──▶ 부패물 ──분해──▶ 퇴비 ──▶ 밭이 걸어진다
//
// It is one material rather than one per source on purpose. A rotten steak and a
// rotten loaf are the same brown sludge in every way that matters here, and
// keeping the middle of the chain narrow is what lets the chain exist at all —
// five inputs and one output instead of five parallel lines.
//
// **It rots on the same mechanism it was made by.** The step to 퇴비 is another
// `Material.spoil` declaration, not a private timer, and that is load-bearing in
// two directions. Preservation keeps working: freeze a bin of it, or salt it, and
// it holds as sludge instead of quietly becoming soil, so a player who wants to
// *keep* the mess can. And 곰팡이 reads `Material.spoil` to decide what it grows
// quickly on (mold.ts), so a heap of this furs over at food pace without needing
// to be named anywhere in that file.
//
// 물에 뜬다 — density 2.9 against Water's 3. A corpse that rotted in a tank
// surfaces as scum rather than settling out of sight, which is the state of a
// neglected aquarium made visible. It sinks in Saltwater (4) the way it should.
//
// 불에 넣으면 재. Wet rot is not a fuel — it will not catch, spread a front, or
// pay back any of the heat put into it — so instead of a `combustion` spec it
// just chars away past CHAR_TEMP. Burning out a spoiled store room costs you the
// fuel to do it, which is the honest trade.

/** 태워 없애는 온도 — well over anything the rot itself does and clear of the
 *  60° its spoilage stops at, so "썩은 걸 불로 지운다" needs a real fire and not
 *  a warm afternoon. */
const CHAR_TEMP = 250;

/**
 * 분해 — how long a heap takes to become 퇴비 at room temperature (×1 speed).
 *
 * The target is stated as a **median, not a mean**: 부패물 더미를 쏟아 놓으면 약
 * 10초 뒤에 절반쯤이 퇴비다. That is a number a player can see happening — you
 * tip out the bin, look away, look back, and the heap has visibly turned — which
 * is what the 부패 사슬 was missing at the old 300초. The mess is still a mess
 * (you cannot un-rot it, and freezing or salting still pins it as sludge), it
 * just stops being a five-minute wait in front of the only thing the chain is
 * *for*.
 *
 * ## 그 10초가 어디서 나온 숫자인가
 *
 * ×1 은 초당 `SIM_HZ_AT_1X` = TICK_HZ/2 = **30틱**이므로 10초 = **N = 300틱**.
 *
 * 흔한 반사식인 `p = 1 − 0.5^(1/N)` (= 0.002308) 은 **여기 맞지 않는다.** 그 공식은
 * 매 틱 한 번 굴려 바로 넘어가는 무기억 모델의 것인데, 부패는 그렇지 않다:
 * `spoilStep` 은 카운터를 0 → SPOIL_MAX 로 일곱 번 올리고 **여덟 번째 성공에 실제로
 * 넘어간다**. 즉 전환 시각은 기하분포가 아니라 **성공 8회짜리 음이항분포**이고,
 * 중앙값은 평균보다 짧다(감마 근사로 (8 − 1/3)/8 ≈ 0.958배).
 *
 * 그래서 선언값(= 평균 수명)은 10 / 0.958 ≈ **10.4초**로 잡는다. 그때 틱당 확률은
 * `spoilStep` 의 식 그대로
 *
 *     r = (SPOIL_MAX + 1) / (seconds × SIM_HZ_AT_1X)
 *       = 8 / (10.4 × 30) = 8 / 312 = **0.025641**
 *
 * 이고, 300틱 안에 성공 8회 이상 나올 확률은
 *
 *     P(Binom(300, 0.025641) ≥ 8) = **0.505**
 *
 * — 목표한 0.5 다. (참고로 선언값 10.0초면 0.549, 10.5초면 0.494로 넘어간다. 이
 * 숫자는 도감이 "시간이 지나면"이라고만 적으므로 인용값은 아니지만, 실제로 나오는
 * 값이어야 한다는 규율은 나머지 부패 시간과 같다.) `test/spoil.ts` 가 같은 장면을
 * 실측해 이 0.5를 붙잡는다.
 */
const BREAKDOWN_SECONDS = 10.4;

/** 어둡고 눅눅한 갈녹색 — mould-and-mush, kept far from both Dirt's warm brown
 *  and Compost's near-black so all three read apart in a heap. */
const SPOILED_COLOR = rgb(94, 88, 56);

function updateSpoiledFood(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= CHAR_TEMP) {
    sim.set(x, y, ASH.id);
    return;
  }
  // 분해 — the same counter-and-preservation machinery every rotting thing uses.
  // Returns true when the cell has already become 퇴비; nothing else may run.
  if (spoilStep(x, y, sim, SPOILED_FOOD.spoil!)) return;
  updatePowder(x, y, sim);
}

export const SPOILED_FOOD = register({
  id: 160,
  name: 'Spoiled Food',
  phase: Phase.Powder,
  color: SPOILED_COLOR,
  // Mush is uneven — near Dead Fish's 20, well under Mold's blotchy 24.
  colorVary: 20,
  // Just under Water (3): rot floats. See the note.
  density: 2.9,
  category: 'food',
  // Also on the 생명 shelf — it is the middle of a decomposition chain that ends
  // in the soil the plants grow out of, and someone following that loop looks
  // there. And on 가루, which is what it physically is.
  alsoIn: ['life', 'powder'],
  // 분해 — 퇴비로. `auxShift: 0` because nothing else lives in this material's
  // aux word; it is the one link in the chain that gets the low bits.
  //
  // `spontaneous: true` — 부패물은 아무것도 안 닿아도 분해된다. Every other food
  // needs 물·수증기·곰팡이 to start its clock (spoil.ts `isRotting`), but this step
  // is 분해 rather than 부패 and the chain has to be able to *finish*: a heap that
  // sat forever unless you watered it would leave the loop open at its last link,
  // and 퇴비 — the reason the whole 부패 계통 exists — would be something you could
  // only make by accident.
  //
  // **`spores` is deliberately absent, and that is the point of the pair.** 부패물이
  // 곰팡이를 피우면 더미가 스스로 곰팡이밭이 되고, 그 곰팡이는 옆에 있는 멀쩡한 식품의
  // 시계까지 돌린다 — 창고 한구석의 찌꺼기 한 무더기가 창고 전체를 상하게 하는, 정확히
  // 이 라운드가 없앤 실패 모드다. 부패물 더미는 퇴비가 되지 곰팡이 농장이 되지 않는다.
  // (곰팡이가 밖에서 기어 들어와 표면에 앉는 것은 그대로 둔다 — 그건 자연발생이 아니고,
  // `tryErode` 는 애초에 부패물을 먹지 않는다.)
  spoil: {
    seconds: BREAKDOWN_SECONDS,
    auxShift: 0,
    spontaneous: true,
    into: () => COMPOST.id,
  },
  // Wet organic matter — poor conductor, like the meat and the fish it came from.
  thermal: { conductivity: 0.2 },
  update: updateSpoiledFood,
});
