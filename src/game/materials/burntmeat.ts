import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryFlameOnlyBurn } from './combustion';

// Burnt Meat (탄 고기) — the end of the grilling line (see rawmeat.ts), and the
// only state of it that will actually catch fire. Everything wet has boiled out
// of it by the time it gets here, so what is left is char, and char burns: a
// slow, stubborn front like Coal's, and a very high ash yield, because a burnt
// steak is already most of the way to being ash.
//
// That completes the chain — 생고기 → 익은 고기 → 탄 고기 → 재 — and it means
// the *consequence* of leaving a steak on the fire is not merely a colour: a
// black cut in the flames eventually lights, feeds the fire, and is gone.
//
// **In the flames**, and only there. Like Bread and Popcorn it is 직화 전용
// (`combustion.flameOnly`, see combustion.ts `tryFlameOnlyBurn`): radiant heat
// never lights it, however fierce. Ruining a steak in an oven leaves you a
// blackened, inedible steak — which is what ruining a steak in an oven does —
// rather than deleting it, and it is the same reason a loaf can be baked in a
// sealed iron firebox at ~880° without going up. The number below is the floor a
// cell that is already alight must stay above to still count as alight, not an
// ignition point; see `tryFlameOnlyBurn`.

/**
 * This material's `aux` bit for "alight". Bit 3, because the bits around it
 * arrive already occupied: `sim.set` preserves aux, so a cut that charred out of
 * 익은 고기 brings that material's whole word along with it — the dryness counter
 * in bits 0-2 and, since the 부패 계통 landed, a spoilage counter in bits 4-6.
 * Nothing here reads either of them (char has no moisture left to model and does
 * not rot), but writing over them would be writing over state this material does
 * not own.
 *
 * **This bit is load-bearing from the other side of the chain**, which is not
 * obvious from here: a lit cell skips `tryFlameOnlyBurn`'s adjacent-flame gate
 * entirely, so anything upstream that leaves this bit set hands over char that
 * ignites on radiant heat alone. The full three-material layout, and the bug that
 * came of getting it wrong, are documented in meat.ts (`SPOIL_SHIFT`).
 * Exported so `test/spoil.ts` can hold the two apart.
 */
export const BURNT_LIT_BIT = 0b1000;
const LIT_BIT = BURNT_LIT_BIT;

function updateBurntMeat(x: number, y: number, sim: SimContext): void {
  // Solid: no fall/flow, so combustion is the only behaviour and there is
  // nothing to do with the "was it consumed" answer.
  tryFlameOnlyBurn(x, y, sim, LIT_BIT);
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
  // Reluctant, like Coal, and mostly ash when it is done — but only ever lit by
  // a flame actually touching it (see the note above).
  combustion: { burnChance: 0.04, autoIgniteTemp: 350, ashChance: 0.6, flameOnly: true },
  update: updateBurntMeat,
});
