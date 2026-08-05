import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn } from './combustion';

// Burnt Meat (탄 고기) — the end of the grilling line (see rawmeat.ts), and the
// only state of it that will actually catch fire. Everything wet has boiled out
// of it by the time it gets here, so what is left is char, and char burns: a
// slow, stubborn front like Coal's, and a very high ash yield, because a burnt
// steak is already most of the way to being ash.
//
// That completes the chain — 생고기 → 익은 고기 → 탄 고기 → 재 — and it means
// the *consequence* of overcooking is not merely a colour: leave a black steak
// on a fire and it eventually lights, feeds the fire, and is gone.

function updateBurntMeat(x: number, y: number, sim: SimContext): void {
  // Solid: no fall/flow, so combustion is the only behaviour.
  tryBurn(x, y, sim);
}

export const BURNT_MEAT = register({
  id: 156,
  name: 'Burnt Meat',
  phase: Phase.Solid,
  color: rgb(56, 44, 38),
  // Narrower than the states before it: char is a much flatter surface than
  // marbled meat, but not so flat that a block of it reads as painted.
  colorVary: 12,
  density: 1000,
  category: 'food',
  // Char is a poor conductor, and that is a real (if small) mercy: a blackened
  // crust slows what reaches whatever is left behind it.
  thermal: { conductivity: 0.2 },
  // Reluctant, like Coal, and mostly ash when it is done.
  combustion: { burnChance: 0.04, autoIgniteTemp: 350, ashChance: 0.6 },
  update: updateBurntMeat,
});
