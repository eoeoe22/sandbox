import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { CHAR_TEMP, DRY_MAX, SPOIL_SHIFT, dryStep } from './meat';
import { BURNT_MEAT } from './burntmeat';
import { spoilStep } from './spoil';
import { SPOILED_FOOD } from './spoiledfood';

// Cooked Meat (익은 고기) — the middle of the grilling line (see rawmeat.ts for
// the whole chain), and the state you are actually trying to stop in. Raw Meat
// arrives here at 70°; cooking is one-way, so a steak that cools down does not
// go back to red.
//
// This is where the grill's whole margin for error lives, and it is a *timer*
// rather than a thermometer. Charring needs two things at once: past 200°, and
// bone dry (`DRY_MAX`, meat.ts). The second one is the real gate — a cut still
// holding water pins itself at 110° no matter what is around it, so it cannot be
// over 200° until it has finished boiling off, and that takes about five seconds
// in open flame and nearer nine on a 250° plate. A steak thrown into a fire has
// that long to be *taken back out*, which is the point: the material used to run
// raw → cooked → char in under a second and 직화구이 simply did not exist.
//
// Under 200° it never chars at all, however long you leave it. A hot plate held
// anywhere in the band still holds a steak there forever — the moisture drains
// away and nothing happens, because the other condition is never met.
//
// Because the char is no longer a plain temperature threshold, this material
// does **not** declare `phaseChange`: a two-condition transition is not a phase
// change and pretending it is would make the declaration lie to the palette, to
// the codex and to test/phasechange.ts (which heats every declaration and
// demands it fire). The threshold it *does* still respect is exported from
// meat.ts and stated in the codex entry instead.
//
// It carries no `combustion` spec either: it is still moist enough not to burn as
// a fuel, so the only route onward is the char. It is drier than raw meat though,
// so it conducts a little less and a cooked outer layer slightly insulates the
// red middle behind it.

/** 익은 고기 spends its moisture visibly. `Material.auxPalette` is indexed
 *  `aux % 8` and the dryness counter *is* the low three bits (meat.ts), so these
 *  eight entries are a direct readout of how much water the cut has left: fresh
 *  brown at 0, most of the way to char at DRY_MAX. The steps are small on
 *  purpose — this is a countdown you should notice out of the corner of your eye
 *  and be able to act on, not a second material. A hand-placed steak out of the
 *  palette is aux 0 and so draws the fresh end, which is what it should be. */
const DRY_RAMP = [
  rgb(150, 94, 58),
  rgb(146, 90, 55),
  rgb(140, 85, 52),
  rgb(130, 78, 48),
  rgb(118, 70, 44),
  rgb(104, 62, 40),
  rgb(90, 55, 38),
  rgb(74, 48, 36),
] as const;

function updateCookedMeat(x: number, y: number, sim: SimContext): void {
  // 부패 — first, and only under 60°: a steak resting on the counter goes over,
  // a steak on the grill does not (spoil.ts). Cooking bought it time, not
  // immunity.
  if (spoilStep(x, y, sim, COOKED_MEAT.spoil!)) return;
  // Steam, dry, and hold at the plateau — and hand back the dryness *after* this
  // tick, so a cut that finished drying just now can char on the same turn
  // rather than waiting for the next.
  const dry = dryStep(x, y, sim);
  // 바싹 마른 뒤 200° → 탄 고기. In-place `set` rather than `spawn`, so the char
  // keeps the heat that made it (and the dryness bits with it — `set` preserves
  // aux, which is what lets Burnt Meat park its lit flag in the bit above them).
  if (dry >= DRY_MAX && sim.getTemp(x, y) >= CHAR_TEMP) {
    sim.set(x, y, BURNT_MEAT.id);
    return;
  }
  // Solid: nothing else to do.
}

export const COOKED_MEAT = register({
  id: 155,
  name: 'Cooked Meat',
  phase: Phase.Solid,
  color: rgb(148, 90, 54),
  colorVary: 16,
  // 수분이 빠지는 정도 — see DRY_RAMP.
  auxPalette: DRY_RAMP,
  density: 1000,
  category: 'food',
  // 부패 — slower than raw, which is the point of cooking something you mean to
  // keep. Same shift as 생고기 on purpose: the cook transition preserves aux, so
  // the counter carries over rather than resetting.
  //
  // The shift is shared from meat.ts rather than written here because this
  // material is the one that hands the word on to 탄 고기, and that material's
  // "alight" bit has to stay clear of it — see the layout note there for what
  // happened when it did not.
  //
  // **No `dryMask` here, unlike 생고기, and that asymmetry is the whole point.**
  // Declaring it made 웰던 고기 immortal: this material dries at the *cooking*
  // rate (DRY_BASE + DRY_PER_100, meat.ts — 4.7s at 400°), and 탄 고기 gates its
  // char on the counter being full, so **anything grilled past medium reaches
  // DRY_MAX by construction**. Every cut that came off a fire was then permanently
  // preserved and the 260s declared above never once fired. 육포 has to be
  // something you *choose*, and on the raw side it is: 생고기 turns at 70° the
  // instant it is hot enough to cook, so the only window in which it can dry is
  // STEAM_TEMP(45°)~70° — a dehydrator, not a grill. Cooking dries meat too; it
  // just is not what drying meat to keep it means.
  spoil: {
    seconds: 260,
    auxShift: SPOIL_SHIFT,
    into: () => SPOILED_FOOD.id,
  },
  // Drier than raw, so it conducts a touch less — a cooked shell genuinely does
  // slow the heat reaching the middle.
  thermal: { conductivity: 0.25 },
  update: updateCookedMeat,
});
