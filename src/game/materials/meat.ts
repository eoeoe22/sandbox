import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';

// 고기의 수분 — the one mechanic shared by 생고기 and 익은 고기, and the reason
// 직화구이 works at all.
//
// The grill started life as two bare temperature thresholds: 70° made a steak
// cooked, 200° made it char. That reads fine on a hot plate and is completely
// wrong on a fire. Flame runs at 800°, meat conducts at 0.3, so a cut laid in
// the flames crossed *both* thresholds inside about ten ticks — measured: a 48
// cell cut was half char after 0.3 seconds and entirely char after one second,
// having never once looked cooked. Direct-flame grilling is the most familiar
// thing anyone does with meat and fire, and the material made it impossible.
//
// The fix is the same thing that makes it possible in a real fire pit: **the
// water in the meat has to boil off before the meat itself can get hot.** A cut
// that still holds moisture pins its own temperature at a boiling plateau
// (BOIL_PLATEAU) no matter how fierce the fire around it is, and vents the heat
// it is being given as Steam. 110° is inside the 70-200° cooked band and nowhere
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
// gentler source takes tens of seconds to run the counter out (measured on a
// burner pinned straight onto the meat: 12s at 250°, 27s at 150°, 39s at 90°).
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
 *  a fiercer heat source is worth: at the cook point the counter needs ~800 ticks
 *  to run out, and every 100° above it buys a bit more than another 1% per tick. */
const DRY_BASE = 0.01;
const DRY_PER_100 = 0.012;

/** 김이 오르기 시작하는 온도 — well under the cook point, so the steam starts
 *  before the colour turns and reads as a warning rather than an afterthought. */
const STEAM_TEMP = 45;
/** Per-tick puff chance when merely warm. Low: a steak should wisp, not fog the
 *  room. */
const WARM_STEAM_CHANCE = 0.04;
/** …and when the moisture is actually boiling off at the plateau. Much higher,
 *  because this is the visible tell that the cut is spending the thing keeping
 *  it from burning — the hiss is the clock. */
const BOIL_STEAM_CHANCE = 0.14;

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
  const dry = aux & DRY_MASK;
  const t = sim.getTemp(x, y);
  if (t < STEAM_TEMP) return dry;

  // Is the cell actually boiling off water this tick? Both halves matter: below
  // the plateau there is not enough heat to drive it, and at DRY_MAX there is
  // nothing left to drive.
  const boiling = t >= BOIL_PLATEAU && dry < DRY_MAX;
  if (sim.chance(boiling ? BOIL_STEAM_CHANCE : WARM_STEAM_CHANCE)) vent(x, y, sim);

  if (dry < DRY_MAX && t >= COOK_TEMP) {
    // Read off the *pre-plateau* temperature — the one the fire is pushing this
    // cell to, which the clamp below is about to take back. This is the only
    // place the strength of the heat source still shows through, and it is what
    // makes a bonfire faster than a warm plate and an outer cell faster than an
    // inner one.
    if (sim.chance(DRY_BASE + (DRY_PER_100 * (t - COOK_TEMP)) / 100)) {
      const next = dry + 1;
      sim.setAux(x, y, (aux & ~DRY_MASK) | next);
      // Bone dry as of this tick: the plateau is over, and the cell keeps the
      // heat it was already given so the char it is about to become arrives hot.
      return next;
    }
  }

  // Latent heat: everything the fire put into this cell above the plateau went
  // into boiling water, not into the meat. Physically a heat sink, and bounded —
  // it only runs while the counter has room, so it can never hold a cut cold
  // forever.
  if (boiling) sim.setTemp(x, y, BOIL_PLATEAU);
  return dry;
}
