import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Compost (퇴비) — 부패 사슬의 끝이자, 그 사슬이 존재하는 이유.
//
// Rot on its own is a punishment: food you left out is gone and you have less
// than you started with. That is a fine mechanic for about a minute. What makes
// it worth building is where it *lands* — 부패물이 분해되면 흙이 되고, 그 흙은
// 보통 흙보다 좋다. So the loop closes:
//
//   씨앗 → 식물 → 씨앗 → (요리) → 식품 → 부패 → 부패물 → 퇴비 → 더 잘 자라는 밭
//
// and the answer to "고기를 썩혀서 뭐하나" is "밭에 준다".
//
// ## 비옥함이란 무엇인가 (soil.ts / plant.ts)
//
// It is one number, in the place the plant system already had a number. A plant's
// roots reach down for the water table (soil.ts `findMoisture`); ground that has
// merely *soaked* water into its pores is a trickle rather than a puddle, so it
// tops a root up only to `SOIL_MOISTURE` — enough for a modest plant and no more.
// Compost lifts that ceiling (`FERTILE_MOISTURE`, plant.ts). Nothing else changes:
// same roots, same drinking, same growth rules. A damp compost bed simply sustains
// a plant that a damp dirt bed could only keep alive, so the same watering grows
// a visibly lusher plant — more branches, more leaves, and enough spare vigour to
// actually set seed.
//
// It is `isSoil` (soil.ts), so a Seed planted on it germinates and roots work
// through it exactly as they do through Dirt, Mud, Sand or Ash. Nothing needed a
// new code path; the material was added to a list.
//
// ## 젖어도 퇴비다
//
// Dirt soaks up an adjacent Water cell and becomes Mud (dirt.ts). Compost
// deliberately does not: a bed that turned into ordinary mud the first time it
// was watered would erase the thing you spent five minutes rotting, at the exact
// moment you used it correctly. So it has no update of its own beyond the powder
// default — water drains through it into the pores like it does through sand, and
// what the roots find down there is still fertile ground.
//
// ## 여기서 끝난다
//
// No further decay. Compost is what decomposition *produces*; a compost heap that
// itself rotted away would mean the loop leaks and a long game ends with nothing.
// It is the one link in the chain with no `Material.spoil` — which is also what
// tells 곰팡이 to treat it as ordinary surface rather than food (mold.ts).

/** 거의 검은 부엽토색 — darker and far greyer than Dirt's warm brown (112,82,52),
 *  so a compost bed laid into a dirt field reads as a different, richer patch at
 *  a glance rather than as a shadow on the same soil. */
const COMPOST_COLOR = rgb(58, 48, 38);

export const COMPOST = register({
  id: 161,
  name: 'Compost',
  phase: Phase.Powder,
  color: COMPOST_COLOR,
  // Crumbly leaf mould, but a *ground* material: kept at Stone/Concrete's narrow
  // 7 rather than the powder default of 18, for the reason Stone's note gives —
  // speckle that is pleasant in one cell is noise across a whole field, and this
  // is a material laid down by the bedful.
  colorVary: 7,
  // Same as Dirt, so a mixed bed of the two neither floats nor sinks through
  // itself and a heap tipped onto a field just sits there.
  density: 5,
  // 정본은 가루다 — 퇴비는 흙이지 생물이 아니다. It reads as a 생명 material
  // because of where it comes from, but `category` is what the rules consult, not
  // where a player looks it up: 방사선 doses everything in the 생명 tab and
  // demands each member declare how it dies (engine/radiation.ts), and irradiating
  // a bed of soil should do nothing at all. Filed with Dirt, which it is a richer
  // version of, and shelved in 생명 as well because that is the loop it closes.
  category: 'powder',
  alsoIn: ['life'],
  // Clumpy earth, like Dirt: a compost heap stands at the same steep angle.
  friction: 0.42,
  // Damp humus conducts about as poorly as the dirt it sits with.
  thermal: { conductivity: 0.3 },
});
