import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateFloatyPowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryFlameOnlyBurn } from './combustion';
import { spoilStep } from './spoil';
import { SPOILED_FOOD } from './spoiledfood';

// Popcorn (팝콘) — what a Corn Kernel becomes when it goes off (cornkernel.ts).
//
// It is the lightest food in the palette by a wide margin (density 1.8, between
// Ash's 1.5 and Sawdust's 2), and it behaves accordingly: it drifts down with
// the floaty-powder wander rather than dropping straight, stalling and swaying
// sideways so a burst scatters instead of stacking, and it *floats* on water —
// tip a bowl of it into a pool and it rafts on the surface. Both of those are
// what "puffed" should feel like, and both come free from the same movement rule
// Ash uses.
//
// Dry starch full of air burns readily — quicker than Bread and much quicker
// than the char it leaves — so a bowl of popcorn in a fire is genuinely a
// hazard, and a popped-and-lit pile is the fastest way to turn a corn harvest
// into ash.
//
// *In* a fire. Popcorn is 직화 전용 (`combustion.flameOnly`, see
// `tryFlameOnlyBurn` in combustion.ts), and here that is not a nicety, it is the
// difference between the material working and not. Popping needs 180°, and the
// realistic way to get there is a pan over a fire — but a metal pan over coal
// sits at several hundred degrees, and Iron conducts so well that a closed one
// measures ~880°. With an ordinary autoignition point the puffs would light in
// the pan that just made them, every time, and there is no threshold that fixes
// it (see combustion.ts). So heat alone only ever pops and toasts; a flame cell
// touching the popcorn is the one thing that lights it.

/** This material's `aux` bit for "alight" (`tryFlameOnlyBurn`). Bit 0, and the
 *  부패 counter sits at bits 1-3 deliberately clear of it — the meat chain shipped
 *  a spoilage counter overlapping exactly this flag once, and the result was
 *  탄 고기 self-igniting with no flame anywhere on the grid (see meat.ts). No
 *  `auxPalette` here, so neither field touches the colour. */
const LIT_BIT = 0b1;
const SPOIL_SHIFT = 1;

function updatePopcorn(x: number, y: number, sim: SimContext): void {
  // 부패 — first, so a puff that has gone over does not also take a turn as
  // popcorn. Stops well below any temperature that could light it, so 눅눅해지는
  // 것 and 타는 것 never contend for the same cell.
  if (spoilStep(x, y, sim, POPCORN.spoil!)) return;
  // Consumed into flame this tick → stop; it is Fire now, not a powder to move.
  if (tryFlameOnlyBurn(x, y, sim, LIT_BIT)) return;
  updateFloatyPowder(x, y, sim);
}

export const POPCORN = register({
  id: 158,
  name: 'Popcorn',
  phase: Phase.Powder,
  color: rgb(248, 242, 222),
  // Puffed corn is all shadowed pockets and bright ridges — the widest variation
  // of any food here, and the thing that stops a heap reading as spilled sugar.
  colorVary: 22,
  // Lighter than water (3) and than everything else edible, so it rafts on a
  // pool and drifts as it falls. Only Ash (1.5) is lighter.
  density: 1.8,
  category: 'food',
  alsoIn: ['powder'],
  // Air-filled starch: it catches fast and leaves a fair amount of ash. The
  // temperature is the "still alight" floor rather than a 발화점 — see
  // `flameOnly` and the note above. Raised from the original 250° along with it:
  // a pan hot enough to pop corn routinely runs past that, so the floor now sits
  // clear of any plausible cooking temperature and only a burning cell is ever
  // above it.
  combustion: { burnChance: 0.1, autoIgniteTemp: 400, ashChance: 0.3, flameOnly: true },
  // 부패 — 눅눅해지는 것. Slow, because puffed starch is dry and keeps for a long
  // while, but faster than the kernel it came from (1200s): popping is what takes
  // a grain built to survive a winter and turns it into something with a shelf
  // life. Bits 1-3, clear of LIT_BIT.
  spoil: { seconds: 900, auxShift: SPOIL_SHIFT, into: () => SPOILED_FOOD.id },
  thermal: { conductivity: 0.15 },
  update: updatePopcorn,
});
