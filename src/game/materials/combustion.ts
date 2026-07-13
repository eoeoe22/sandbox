import { DIR8 } from '../engine/directions';
import { getMaterial } from './registry';
import { EMPTY } from '../engine/types';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { SUGAR_WATER } from './sugarwater';
import { STEAM } from './steam';
import { OXYGEN } from './oxygen';
import { AMBIENT_TEMP } from '../config';

// Shared burning behavior for the simple fuels — Crude Oil, Gasoline, Alcohol,
// Honey, Coal, Wood, Sawdust, Fuse. Unlike the explosives (Methane/Gunpowder/
// Nitro), a fuel never detonates: it catches fire and is consumed over time,
// giving off ordinary Fire that then burns out on its own.
//
// The point of this model is a *self-sustaining surface front*: a stray spark
// touching one cell must creep through the whole body and consume almost all of
// it, slowly, rather than eating only the cells it directly touched and dying
// out. The earlier model failed at that because a lit fuel cell turned straight
// into Fire — a gas that rises *away* from the fuel and burns out in a handful
// of ticks, so the flame escaped the front before the next cell's low per-tick
// catch chance could roll. With no flame anchored to the fuel, the burn
// fizzled after the first cell or two.
//
// So a lit fuel now *stays fuel while it burns* instead of flashing to gas. When
// a cell catches it doesn't vanish: it stays fuel but marked burning (its
// temperature pinned to BURN_TEMP), and each tick it (1) wreaths itself in a
// lick of Fire in the open air around it — the visible flame, and the handle
// Water uses to put it out — and (2) rolls to light each of its still-unlit fuel
// neighbors, handing the front one cell further. Only after a while (a
// memoryless per-tick chance) is the cell itself spent, collapsing into rising
// Fire. Because the burning cell persists as an ignition source for many ticks,
// even a small per-tick spread chance reliably carries the front to every
// neighbor — slow, but near-total.
//
// Crucially the burning cell keeps *moving*: after its burn step it still falls
// and flows exactly like its unlit self (the caller runs the normal
// powder/liquid movement), so a lit stream of Sawdust tumbles on down and a
// burning slick of Oil/Gasoline/Alcohol drops at the same speed as the cold
// liquid around it, instead of freezing the instant it catches. Its material id
// and pinned heat ride along on every swap, so a coherent body — a falling
// column, a settling pile, a spreading pool — carries the front with it and
// keeps lighting the neighbors it moves alongside. Only a cell already consumed
// into Fire this tick stops, because it is no longer fuel to move.
//
// `burnChance` still sets each fuel's pace, now doing double duty: the per-tick
// chance to catch from an adjacent flame *and* the per-tick chance a burning
// cell lights each fuel neighbor. Its old meaning (relative burn speed) carries
// straight over — the volatile liquids race, the loose solids creep, dense Coal
// smoulders. Each fuel also self-ignites once its own temperature passes an
// autoignition point, so radiant heat from something very hot (Lava, Blue
// Flame) can set it off with no flame cell touching it.
//
// Fuels deliberately are NOT tagged `flammable`: that tag hands ignition to
// Fire's single global-rate ignite pass (see fire.ts), which would erase the
// per-fuel speed differences. Instead each fuel drives its own rate here by
// detecting the flame itself — the same id-based, scan-order-independent
// approach the explosives use.

// Temperature a burning fuel cell holds, and the temperature the Fire it
// finally collapses into starts at. Sits above every fuel's autoignition point
// (the highest, Coal, is 580), so pinning a catching cell here always reads as
// "burning" on its next turn regardless of which fuel it is.
const BURN_TEMP = 800;

// Per-tick chance a burning cell is spent and collapses to Fire, expressed as a
// multiple of that fuel's own `burnChance`. Keeping it *below* the spread
// chance (ratio < 1) is what guarantees a cell almost always lights its
// neighbors before it burns out, so the front propagates to near-completion
// instead of stalling. Deriving it from `burnChance` also means a fuel's whole
// character falls out of that one number: a quick fuel (high burnChance) both
// spreads and is consumed fast — a brief flare — while Coal (low burnChance)
// both creeps and smoulders for a long time. Mean cell burn life is
// 1/(burnChance·CONSUME_RATIO) ticks: ~28 for Gasoline, ~95 for Coal.
const CONSUME_RATIO = 0.3;

// Per-tick chance a burning cell drops a lick of Fire into an adjacent open
// cell. Low so the body is fringed with flickering flame rather than buried in
// it (which would also choke the sim with Fire/Smoke).
const WREATH_CHANCE = 0.25;

// Oxygen forced draught. A burning fuel cell normally pins at BURN_TEMP (800°);
// Oxygen (id 36) blown against it makes the fire run hotter — each adjacent
// Oxygen cell adds OXY_BOOST to the pinned temperature up to OXY_MAX_PIN, and
// the drawn-in oxygen is consumed with probability OXY_CONSUME per tick. The
// pin steps are chosen around the world's melt points: 0 oxygen = 800°
// (unchanged bare burn — reduces iron ore but can't melt iron, and stays under
// Stone's 1100° so furnace walls are safe), 1 = 1050° (a safe low blast, still
// below stone), 2 = 1300°, 3+ = 1550° (past Iron's 1400° melt — a blast furnace
// that runs molten iron, but now hot enough to start melting stone walls, which
// is what forces water-jacket cooling). Being common to every fuel, Oxygen +
// any fuel also becomes a hotter cutting torch as a free side effect.
const OXY_BOOST = 250;
const OXY_MAX_PIN = 1550;
const OXY_CONSUME = 0.5;

export interface Combustible {
  /** Per-tick chance to catch from an adjacent flame, and — once burning — to
   *  light each adjacent fuel cell. Also sets the fuel's relative burn speed. */
  burnChance: number;
  /** Self temperature at/above which it ignites with no flame contact. */
  autoIgniteTemp: number;
}

export function isFlame(id: number): boolean {
  return id === FIRE.id || id === LAVA.id || id === BLUE_FLAME.id;
}

/** True if any 8-neighbour is an open flame (Fire/Lava/Blue Flame). Petroleum
 *  materials use this to let *direct flame contact* win over distillation — touch
 *  fire and the fuel burns; heat it through a wall and it distils. */
export function flameAdjacent(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && isFlame(sim.get(nx, ny))) return true;
  }
  return false;
}

/**
 * Run the burn step for a cell that is already burning (temperature pinned at
 * BURN_TEMP): put it out if Water reached it, otherwise re-pin its heat so it
 * stays a burning source, fringe it with flame, spread to fuel neighbors, and
 * roll to be consumed. Returns true only if the cell was consumed into Fire this
 * tick (so the caller must not then move it as fuel); false if it is still
 * unconsumed fuel — burning or freshly smothered — that the caller carries on
 * falling/flowing.
 */
function burnStep(x: number, y: number, sim: SimContext, spec: Combustible): boolean {
  // Petroleum fuels (Crude Oil, Gasoline, …) float on water and keep burning as
  // a surface fire: water below them neither douses the flame nor flashes to
  // Steam, so a lit slick on a pool reproduces an oil fire instead of snuffing
  // itself out on the water it's floating on (see Material.petroleum / water.ts).
  const isPetroleum = getMaterial(sim.get(x, y)).petroleum === true;
  let onWater = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    // Water/Saltwater/Sugar Water smothers it: the fuel survives (unlit, back to
    // ambient) and the water it touched flashes to Steam — mirroring Fire's own
    // "물 인접 시 즉시 소화, 닿은 물은 수증기로" rule. All the water-based liquids
    // douse (a burning petroleum slick still floats and keeps burning, below).
    if (nid === WATER.id || nid === SALTWATER.id || nid === SUGAR_WATER.id) {
      if (isPetroleum) {
        onWater = true; // oil fire on water: not doused, water not steamed
        continue;
      }
      // Cell stays fuel (its id is untouched); just cool it back out of the
      // burning band and flash the water it touched to Steam. Not consumed, so
      // the caller still lets the now-unlit fuel fall/flow.
      sim.setTemp(x, y, AMBIENT_TEMP);
      sim.spawn(nx, ny, STEAM.id);
      return false;
    }
  }

  // Re-pin heat so diffusion into cooler neighbors can't drop this cell below
  // its autoignition and quietly extinguish the front. Oxygen blown against the
  // fuel drives the pin higher (forced draught) — the only way to reach the
  // temperatures that melt iron with a mere coal fire. Consumed oxygen is
  // written to EMPTY, which is always a safe neighbor write (no same-tick
  // reprocessing); the self setTemp is unchanged bookkeeping.
  let pin = BURN_TEMP;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === OXYGEN.id) {
      pin = Math.min(pin + OXY_BOOST, OXY_MAX_PIN);
      if (sim.chance(OXY_CONSUME)) sim.set(nx, ny, EMPTY);
    }
  }
  sim.setTemp(x, y, pin);

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      // A lick of visible flame in the open air around the body.
      if (sim.chance(WREATH_CHANCE)) sim.spawn(nx, ny, FIRE.id);
    } else if (getMaterial(nid).combustible && sim.getTemp(nx, ny) < BURN_TEMP) {
      // Light the neighbor: pin it to BURN_TEMP so its own turn sees it as
      // burning. Gated by burnChance per neighbor, so a just-lit unscanned
      // neighbor can chain-light within the same tick — but each burning cell
      // reaches only its ~4 not-yet-scanned neighbors, so the same-tick
      // branching factor is ~4·burnChance (≈0.6 at the fastest fuel, Alcohol
      // 0.15): subcritical, a bounded flicker of well under one extra cell per
      // cell, not the deterministic one-frame runaway a raw material `set` on
      // an unscanned cell would cause. Criticality is 4·burnChance = 1 at
      // burnChance 0.25, so a fuel much above that would need rethinking this.
      if (sim.chance(spec.burnChance)) sim.setTemp(nx, ny, BURN_TEMP);
    }
  }

  // Spent: collapse into rising Fire, which flickers up and burns out on its
  // own (see fire.ts) — carrying the flame off the consumed surface. Signal the
  // caller to stop: this cell is Fire now, not fuel to fall/flow. A burning
  // petroleum cell resting *on water* is the exception: it never collapses to
  // Fire (which would then steam the water it's floating on), so the oil-water
  // interface stays oil and keeps shielding the water — a persistent oil fire.
  if (!(isPetroleum && onWater) && sim.chance(spec.burnChance * CONSUME_RATIO)) {
    sim.set(x, y, FIRE.id);
    sim.setTemp(x, y, BURN_TEMP);
    return true;
  }
  // Still burning fuel: the caller runs its normal fall/flow so it keeps moving.
  return false;
}

/**
 * Run one tick of combustion for a fuel cell. Returns true only if the cell was
 * *consumed* into Fire this tick — in which case the caller must stop, since the
 * cell is Fire now and must not be moved as a powder/liquid. In every other case
 * (still-burning fuel, freshly caught, smothered by water, or not burning at
 * all) it returns false and the caller runs its normal fall/flow: a burning fuel
 * keeps moving exactly like its unlit self.
 */
export function tryBurn(x: number, y: number, sim: SimContext, spec: Combustible): boolean {
  // Already burning (pinned hot), or hot enough to self-ignite from radiant
  // heat: run its burn step, which reports whether it was consumed.
  if (sim.getTemp(x, y) >= spec.autoIgniteTemp) {
    return burnStep(x, y, sim, spec);
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isFlame(sim.get(nx, ny))) {
      // A flame is adjacent — roll once for the whole cell this tick (catch
      // speed lives entirely in this probability, independent of how many flame
      // neighbors there are). On a catch, pin the cell hot so its next turn sees
      // it as burning; on a miss it stays cold fuel. Either way it is still fuel,
      // so it keeps falling/flowing this tick — return false and let the caller
      // move it (its pinned heat rides along on the swap).
      if (sim.chance(spec.burnChance)) {
        sim.setTemp(x, y, BURN_TEMP);
      }
      return false;
    }
  }
  return false;
}
