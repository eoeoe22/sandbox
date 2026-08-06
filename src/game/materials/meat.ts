import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';

// 고기의 수분 — the one mechanic shared by 생고기 and 익은 고기, and the reason
// 직화구이 works at all.
//
// The grill started life as two bare temperature thresholds: 70° made a steak
// cooked, 200° made it char. That reads fine on a hot plate and is completely
// wrong on a fire. Fire runs at 1000° and a burning fuel pins at 800°, meat
// conducts at 0.3, so a cut laid in the flames crossed *both* thresholds inside
// about ten ticks — measured: a 48 cell cut was half char after 0.3 seconds and
// entirely char after one second, having never once looked cooked. Direct-flame
// grilling is the most familiar thing anyone does with meat and fire, and the
// material made it impossible.
//
// The fix is the same thing that makes it possible in a real fire pit: **the
// water in the meat has to boil off before the meat itself can get hot.** A cut
// that still holds moisture pins its own temperature at a boiling plateau
// (BOIL_PLATEAU) no matter how fierce the fire around it is, and vents what it is
// being given as Steam. 110° is inside the 70-200° cooked band and nowhere
// near the char point, so a steak thrown straight into a bonfire sears, goes
// brown, and then *sits there steaming* — cooked and holding — until it has
// actually dried out.
//
// Drying is an `aux` counter, 0 (완전히 촉촉) to DRY_MAX. It is the zero value
// that is fresh for the same reason Bread's crust is zero: `spawn` and the brush
// both leave aux at 0, so meat placed by hand out of the palette is juicy meat.
// The counter survives the raw→cooked transition for free, because
// `tryPhaseChange` transforms with `sim.set` and `set` keeps aux — a steak does
// not get its moisture back by being cooked.
//
// The rate is read off the temperature the cell is *being pushed to*, before the
// plateau claws it back, so the fire's ferocity still matters even though the
// meat's own temperature does not move: a cut in open flame reads several
// hundred degrees each tick and its face is char in about five seconds, while a
// gentler source takes far longer to run the counter out.
//
// The honest unit for that is **one cell**, because the counter is rolled per
// cell: DRY_MAX / rate ticks on average, which at 30Hz is 4.7s at 400°, 7.4s at
// 250°, 11.9s at 150°, 18.8s at 90°, and about a minute and a half under the cook
// point. A whole *cut* always takes longer than any of those and there is no
// single number for it — "the cut is dry" means the slowest of N independent
// counters finished, so it grows with how big the cut is. (Two measurements of
// the same thing at different sizes is exactly how the figures here first came
// out wrong: 48 cells and 96 cells do not agree, and neither is the constant.)
//
// Drying out is *not* the same as charring, and a slow grill is safe for the
// other reason: charring needs the counter empty **and** 200°, so a cut on a 150°
// plate goes bone dry after half a minute and then simply sits there cooked,
// forever. (It has spent its buffer, though — move that same dried cut into a
// fire and it chars at once, with no plateau left to hold it.)
//
// That gradient is also what keeps a thick cut cooking in *layers* — the face
// against the fire reads hot and dries first, while the cells behind it read
// only their plateaued neighbours and stay wet — so a badly-grilled steak is
// still black outside and red in the middle. The layering just belongs to
// dryness now instead of to temperature.
//
// 익은 고기 spends the rest of the counter visibly (see its `auxPalette`): it
// darkens step by step from fresh brown toward char, so "이거 곧 탄다" is
// something you can see coming rather than something that happens.
//
// The steam rides on the same counter and that is the point, not a shortcut: a
// puff is *one unit of moisture leaving*, so what a cut can give off is bounded
// by what it started with. Playtest caught this the hard way — see PUFF_CHANCE.

/** 익는 온도. The real "cooked through" mark rather than boiling, so an ordinary
 *  hot plate — anything you can hold in the 70-200° band — is a working grill. */
export const COOK_TEMP = 70;

/** 타는 온도. Comfortably above the cook point, so the "cooked, not burnt" band
 *  is a wide, aimable target. Reaching it is necessary but no longer sufficient:
 *  a cut also has to be bone dry (DRY_MAX) before it can char. */
export const CHAR_TEMP = 200;

/** The temperature a still-moist cut pins itself to, however hot its
 *  surroundings. Chosen just over water's boiling point and deliberately inside
 *  the cooked band: a steak in a bonfire is *cooking*, not charring, for as long
 *  as it has water left to give. */
export const BOIL_PLATEAU = 110;

/** 수분이 다 날아간 상태. Three bits, so the whole counter is `aux & DRY_MASK`
 *  and anything above it (Burnt Meat's lit flag) rides along untouched — and so
 *  the 8-entry ramp 익은 고기 draws itself with, indexed `aux % 8`, is exactly
 *  the counter. */
export const DRY_MAX = 7;
export const DRY_MASK = 0b111;

/** Per-tick drying chance at the cook point, plus what each 100° above it adds.
 *  Tuned off the pre-plateau temperature (see the module note). The first number
 *  sets the floor — how long a barely-warm cut lingers — and the second how much
 *  a fiercer heat source is worth: at the cook point a single cell's counter takes
 *  700 ticks on average to run out, and every 100° above it buys a bit more than
 *  another 1% per tick. Per *cell* — a whole cut finishes when its slowest cell
 *  does, which is longer and depends on how many cells it has. */
const DRY_BASE = 0.01;
const DRY_PER_100 = 0.012;

/** 김이 오르기 시작하는 온도 — well under the cook point, so the steam starts
 *  before the colour turns and reads as a warning rather than an afterthought.
 *  Below the cook point the counter still creeps, at DRY_BASE × WARM_DRY_SCALE —
 *  meat left somewhere merely warm does dry out, it just takes a minute and a
 *  half rather than a few seconds. That is what keeps the pre-cook wisp on the
 *  same bounded budget as everything else (see `vent`). */
const STEAM_TEMP = 45;
const WARM_DRY_SCALE = 0.25;

/** Chance that a unit of moisture leaving actually shows up as a visible puff.
 *
 *  The important word is *a unit*: steam is emitted only when the dryness counter
 *  advances, never per tick. That is the whole shape of this — a steak contains a
 *  fixed amount of water, so the steam it can give off is `DRY_MAX` puffs per
 *  cell and not one more, however long it sits there.
 *
 *  It did not start that way, and the bug is worth keeping written down because
 *  it looked like a tuning number. Venting per tick while boiling made the total
 *  proportional to **time** instead of to moisture, so a cut on a grill just kept
 *  producing: a 48-cell steak reached **194 cells of water — four times its own
 *  volume** — and was still climbing when the measurement stopped. No value of a
 *  per-tick chance fixes that, because the quantity being unbounded is the
 *  problem, not the rate. Tying the puff to the counter caps it by construction,
 *  and it also makes the *rate* come out right for free: a fierce fire advances
 *  the counter fast and hisses hard, a warm plate ticks it over now and then and
 *  wisps. Same rule, both readings. */
const PUFF_CHANCE = 0.15;

/** Throw off a puff of Steam into any open neighbour. */
function vent(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
      sim.spawn(nx, ny, STEAM.id);
      return;
    }
  }
}

/**
 * Run one tick of the moisture model on a meat cell: steam it, dry it, and hold
 * it at the boiling plateau while there is anything left to boil. Returns the
 * cell's dryness *after* the step, which is what 익은 고기 gates its char on.
 *
 * Called before the cell's own transition check, so a cut that dried out this
 * tick can char on the same turn rather than waiting for the next.
 */
export function dryStep(x: number, y: number, sim: SimContext): number {
  const aux = sim.getAux(x, y);
  let dry = aux & DRY_MASK;
  const t = sim.getTemp(x, y);
  if (t < STEAM_TEMP || dry >= DRY_MAX) return dry;

  // Read off the *pre-plateau* temperature — the one the fire is pushing this
  // cell to, which the clamp below is about to take back. This is the only place
  // the strength of the heat source still shows through, and it is what makes a
  // bonfire faster than a warm plate and an outer cell faster than an inner one.
  // Under the cook point it only creeps: warm meat dries, slowly.
  const rate =
    t >= COOK_TEMP
      ? DRY_BASE + (DRY_PER_100 * (t - COOK_TEMP)) / 100
      : DRY_BASE * WARM_DRY_SCALE;
  if (sim.chance(rate)) {
    dry += 1;
    sim.setAux(x, y, (aux & ~DRY_MASK) | dry);
    // The one place steam comes from: a puff *is* a unit of moisture leaving, so
    // the total a cut can give off is bounded by what it started with. See
    // PUFF_CHANCE for what this replaced.
    if (sim.chance(PUFF_CHANCE)) vent(x, y, sim);
    // Bone dry as of this tick: the plateau is over, and the cell keeps the heat
    // it was already given so the char it is about to become arrives hot. Note
    // this is the ONLY path that skips the clamp below — a cell that merely
    // advanced its counter is still wet and must still be held down. Returning
    // early on every advance instead was a real regression while this was being
    // written: the cell kept its full pre-clamp temperature for that tick, so a
    // cut in a fire spiked to several hundred degrees on each drying tick and
    // radiated that into its neighbours.
    if (dry >= DRY_MAX) return dry;
  }

  // Latent heat: everything the fire put into this cell above the plateau went
  // into boiling water, not into the meat. Physically a heat sink, and bounded —
  // it only runs while the counter has room, so it can never hold a cut cold
  // forever.
  if (t >= BOIL_PLATEAU) sim.setTemp(x, y, BOIL_PLATEAU);
  return dry;
}
