import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryPhaseChange } from './phasechange';
import { BURNT_MEAT } from './burntmeat';

// Cooked Meat (익은 고기) — the middle of the grilling line (see rawmeat.ts for
// the whole chain), and the state you are actually trying to stop in. Raw Meat
// arrives here at 70°; hold it anywhere under 200° and it stays, indefinitely,
// even as it cools. Cooking is one-way: a steak that cools down does not go back
// to red.
//
// Push it past 200° and it chars to Burnt Meat, which is the point of the
// material — the band between the two thresholds is wide enough to hit
// deliberately and narrow enough to overshoot if you just throw the thing on a
// bonfire.
//
// Like raw meat it carries no `combustion` spec: it is still moist enough not to
// burn as a fuel, so the only route onward is the char threshold below. It is
// drier than raw meat though, so it conducts a little less and a cooked outer
// layer slightly insulates the red middle behind it.

/** 타는 온도. Comfortably above the 70° cook point, so the "cooked, not burnt"
 *  band is a wide, aimable target — an oven or hot plate anywhere in between
 *  holds a steak there forever. */
export const CHAR_TEMP = 200;

function updateCookedMeat(x: number, y: number, sim: SimContext): void {
  // 200° → 탄 고기. Solid otherwise: nothing else to do.
  tryPhaseChange(x, y, sim);
}

export const COOKED_MEAT = register({
  id: 155,
  name: 'Cooked Meat',
  phase: Phase.Solid,
  color: rgb(148, 90, 54),
  colorVary: 16,
  density: 1000,
  category: 'food',
  // Drier than raw, so it conducts a touch less — a cooked shell genuinely does
  // slow the heat reaching the middle.
  thermal: { conductivity: 0.25 },
  phaseChange: { at: () => CHAR_TEMP, when: 'atOrAbove', into: () => BURNT_MEAT.id },
  update: updateCookedMeat,
});
