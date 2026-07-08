import { DIR8 } from '../engine/directions';
import { getMaterial } from './registry';
import { EMPTY } from '../engine/types';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { AMBIENT_TEMP } from '../config';

// Shared burning behavior for the simple fuels — Crude Oil, Gasoline, Coal,
// Wood, Sawdust. Unlike the explosives (Methane/Gunpowder/Nitro), a fuel never
// detonates: it catches fire and is consumed over time, giving off ordinary
// Fire that then burns out on its own.
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
// So a lit fuel now *burns in place*. When a cell catches it doesn't vanish: it
// stays fuel but marked burning (its temperature pinned to BURN_TEMP), and each
// tick it (1) wreaths itself in a lick of Fire in the open air around it — the
// visible flame, and the handle Water uses to put it out — and (2) rolls to
// light each of its still-unlit fuel neighbors, handing the front one cell
// further. Only after a while (a memoryless per-tick chance) is the cell itself
// spent, collapsing into rising Fire. Because the burning cell sits still as a
// persistent ignition source for many ticks, even a small per-tick spread
// chance reliably carries the front to every neighbor — slow, but near-total.
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

export interface Combustible {
  /** Per-tick chance to catch from an adjacent flame, and — once burning — to
   *  light each adjacent fuel cell. Also sets the fuel's relative burn speed. */
  burnChance: number;
  /** Self temperature at/above which it ignites with no flame contact. */
  autoIgniteTemp: number;
}

function isFlame(id: number): boolean {
  return id === FIRE.id || id === LAVA.id || id === BLUE_FLAME.id;
}

/**
 * Advance one tick for a cell that is already burning (temperature pinned at
 * BURN_TEMP): put it out if Water reached it, otherwise re-pin its heat so it
 * stays a burning source, fringe it with flame, spread to fuel neighbors, and
 * roll to be consumed.
 */
function burnInPlace(x: number, y: number, sim: SimContext, spec: Combustible): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    // Water/Saltwater smothers it: the fuel survives (unlit, back to ambient)
    // and the water it touched flashes to Steam — mirroring Fire's own
    // "물 인접 시 즉시 소화, 닿은 물은 수증기로" rule.
    if (nid === WATER.id || nid === SALTWATER.id) {
      // Cell stays fuel (its id is untouched); just cool it back out of the
      // burning band and flash the water it touched to Steam.
      sim.setTemp(x, y, AMBIENT_TEMP);
      sim.spawn(nx, ny, STEAM.id);
      return;
    }
  }

  // Re-pin heat so diffusion into cooler neighbors can't drop this cell below
  // its autoignition and quietly extinguish the front.
  sim.setTemp(x, y, BURN_TEMP);

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
      // branching factor is ~4·burnChance (≈0.48 at the fastest fuel, Gasoline
      // 0.12): subcritical, a bounded flicker of well under one extra cell per
      // cell, not the deterministic one-frame runaway a raw material `set` on
      // an unscanned cell would cause. The ~2× margin to criticality is why a
      // burnChance above ~0.25 would need rethinking this.
      if (sim.chance(spec.burnChance)) sim.setTemp(nx, ny, BURN_TEMP);
    }
  }

  // Spent: collapse into rising Fire, which flickers up and burns out on its
  // own (see fire.ts) — carrying the flame off the consumed surface.
  if (sim.chance(spec.burnChance * CONSUME_RATIO)) {
    sim.set(x, y, FIRE.id);
    sim.setTemp(x, y, BURN_TEMP);
  }
}

/**
 * Run one tick of combustion for a fuel cell. Returns true if the cell is
 * burning (already alight, just caught, or self-ignited), in which case the
 * caller must stop — a burning cell stays put as a flame front instead of
 * falling/flowing for the tick.
 */
export function tryBurn(x: number, y: number, sim: SimContext, spec: Combustible): boolean {
  // Already burning (pinned hot), or hot enough to self-ignite from radiant
  // heat: burn in place.
  if (sim.getTemp(x, y) >= spec.autoIgniteTemp) {
    burnInPlace(x, y, sim, spec);
    return true;
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isFlame(sim.get(nx, ny))) {
      // A flame is adjacent — roll once for the whole cell this tick (catch
      // speed lives entirely in this probability, independent of how many flame
      // neighbors there are). On a catch, pin the cell hot so its next turn
      // burns in place; on a miss it keeps falling/flowing as usual.
      if (sim.chance(spec.burnChance)) {
        sim.setTemp(x, y, BURN_TEMP);
        return true;
      }
      return false;
    }
  }
  return false;
}
