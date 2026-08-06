import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryPhaseChange } from './phasechange';
import { COOK_TEMP, DRY_MASK, SPOIL_SHIFT, dryStep } from './meat';
import { COOKED_MEAT } from './cookedmeat';
import { spoilStep } from './spoil';
import { SPOILED_FOOD } from './spoiledfood';

// Raw Meat (생고기) — the first of the three grilling states, and the material
// that turns "how hot is this fire, actually" into something you can read off a
// steak. A rigid Solid like Wood: lay it on a hot plate, over coals, on a
// Heatpipe, into the flames themselves, and watch it change.
//
// The line is one axis with two ends:
//
//   생고기 ──70°──▶ 익은 고기 ──(수분이 다 마른 뒤) 200°──▶ 탄 고기 ──(불)──▶ 재
//
// The first step is deliberately instant — meat laid on anything properly hot
// sears and goes brown at once, which is what searing *is*. The interesting part
// is the second one, and it is not a temperature at all: a cut has to boil off
// all its water before it can char (meat.ts), so 익은 고기 is somewhere a steak
// genuinely *rests* even in an open fire, steaming, for several seconds. That is
// what makes 직화구이 possible, and it is the whole reason the moisture model
// exists — see meat.ts for what this material did before it.
//
// Because the drying rate is read off how hard the heat source is pushing rather
// than off the meat's own (plateaued) temperature, a thick cut still cooks in
// layers: the face against the flame dries and chars while the middle, shielded
// behind cells that are all pinned at the plateau, stays wet and red. The
// cross-section of a badly-grilled steak is legible without any special
// rendering.
//
// It is wet, so it steams as it heats, and the steam is not decoration — it is
// the clock. A cut only hisses while it still has water to lose, so the moment
// it stops steaming is the moment it can start to burn.
//
// Raw meat deliberately has no `combustion` spec of its own. Wet meat does not
// catch fire — it cooks first, chars second, and only the char burns
// (burntmeat.ts). Putting a fuel spec here would let a torch light a raw steak
// directly and skip the entire chain.

function updateRawMeat(x: number, y: number, sim: SimContext): void {
  // 부패 — before anything else, since a cut that has gone over is no longer a
  // cut. Only runs under 60°, so meat anywhere near a grill is cooking rather
  // than rotting and the two clocks never compete (spoil.ts).
  if (spoilStep(x, y, sim, RAW_MEAT.spoil!)) return;
  // Steam, dry, and hold at the boiling plateau. First, so a cell that cooks
  // this tick has still wisped on its way there rather than turning silently —
  // and so the plateau is in place before the threshold below is consulted.
  dryStep(x, y, sim);
  // 70° → 익은 고기. The plateau (110°) sits above this on purpose: a cut held
  // down by its own moisture is held *inside* the cooked band, not short of it.
  // Solid otherwise: no fall, no flow, nothing else to do.
  tryPhaseChange(x, y, sim);
}

export const RAW_MEAT = register({
  id: 154,
  name: 'Raw Meat',
  phase: Phase.Solid,
  color: rgb(198, 84, 84),
  // Meat is marbled — fat, grain and muscle all catch light differently. Wider
  // than Wood's 16 because the contrast in a raw cut genuinely is higher.
  colorVary: 18,
  density: 1000,
  category: 'food',
  // Wet, so it takes heat readily — which is what makes a thick cut cook in
  // visible layers instead of all at once.
  thermal: { conductivity: 0.3 },
  phaseChange: { at: () => COOK_TEMP, when: 'atOrAbove', into: () => COOKED_MEAT.id },
  // 부패 — the fastest-spoiling thing in the palette, which is what raw meat
  // should be. The shift is the meat chain's shared one (meat.ts `SPOIL_SHIFT`,
  // which documents the whole three-material word and why bit 3 is not ours to
  // take), and `dryMask` points at the dryness counter so a cut that has been
  // dried out stops rotting: 육포. Cooking is the other way out — 익은 고기 rots
  // slower, and carries this counter across with it.
  spoil: {
    seconds: 60,
    auxShift: SPOIL_SHIFT,
    dryMask: DRY_MASK,
    into: () => SPOILED_FOOD.id,
  },
  update: updateRawMeat,
});
