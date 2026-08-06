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

/** 분해 — how long a heap takes to become 퇴비 at room temperature. Longer than
 *  anything that rots *into* it, so a store room that has gone over stays gone
 *  over for a while: the mess is a state you have to live with (or burn), not a
 *  loading screen in front of free fertiliser. */
const BREAKDOWN_SECONDS = 150;

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
  spoil: { seconds: BREAKDOWN_SECONDS, auxShift: 0, into: () => COMPOST.id },
  // Wet organic matter — poor conductor, like the meat and the fish it came from.
  thermal: { conductivity: 0.2 },
  update: updateSpoiledFood,
});
