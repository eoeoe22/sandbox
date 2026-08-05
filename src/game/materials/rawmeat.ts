import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { tryPhaseChange } from './phasechange';
import { STEAM } from './steam';
import { COOKED_MEAT } from './cookedmeat';

// Raw Meat (생고기) — the first of the three grilling states, and the material
// that turns "how hot is this fire, actually" into something you can read off a
// steak. A rigid Solid like Wood: lay it on a hot plate, over coals, on a
// Heatpipe, beside lava, and watch it change.
//
// The whole line is one temperature axis with two thresholds:
//
//   생고기 ──70°──▶ 익은 고기 ──200°──▶ 탄 고기 ──(불)──▶ 재
//
// which means the *interesting* place to be is between them. A grill held in the
// 70-200° band cooks a steak through and stops; a bonfire runs it straight past
// both and leaves char. Because heat conducts cell by cell, a thick cut sitting
// on something very hot goes through the states in layers — a black underside, a
// brown band above it, and a red middle — so the cross-section of a badly-grilled
// steak is legible without any special rendering.
//
// It is wet, so it steams as it heats: a warm cell throws off the occasional
// puff of Steam, which is the only warning you get that the fire is doing
// something before the colour actually turns.
//
// Raw meat deliberately has no `combustion` spec of its own. Wet meat does not
// catch fire — it cooks first, chars second, and only the char burns
// (burntmeat.ts). Putting a fuel spec here would let a torch light a raw steak
// directly and skip the entire chain.

/** 가열 시 김이 오르는 온도 — well under the 70° cook point, so the steam starts
 *  before the colour turns and reads as a warning rather than an afterthought. */
const STEAM_TEMP = 45;
/** Per-tick chance a warm cell throws off a puff. Low: a steak should wisp, not
 *  fog the room. */
const STEAM_CHANCE = 0.04;

/** 익는 온도. Chosen as the real "cooked through" mark rather than boiling, so an
 *  ordinary hot plate — anything you can hold in the 70-200° band — is a working
 *  grill. */
export const COOK_TEMP = 70;

/** Throw off a puff of Steam if the cell is warm and there is open air to take
 *  it. Shared by the raw state only: once it is cooked, the water is out of it. */
function trySteam(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) < STEAM_TEMP || !sim.chance(STEAM_CHANCE)) return;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
      sim.spawn(nx, ny, STEAM.id);
      return;
    }
  }
}

function updateRawMeat(x: number, y: number, sim: SimContext): void {
  // Steam first: a cell that cooks this tick should still have wisped on its way
  // there, rather than turning silently.
  trySteam(x, y, sim);
  // 70° → 익은 고기. Solid otherwise: no fall, no flow, nothing else to do.
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
  update: updateRawMeat,
});
