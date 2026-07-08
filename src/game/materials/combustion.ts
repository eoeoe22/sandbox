import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';

// Shared burning behavior for the simple fuels — Crude Oil, Gasoline, Coal,
// Wood, Sawdust. Unlike the explosives (Methane/Gunpowder/Nitro), a fuel never
// detonates: it just catches fire and is consumed, turning into ordinary Fire
// that then burns out on its own. The one thing that differs between fuels is
// *how fast* they burn, captured by `burnChance` — the per-tick probability
// that a fuel cell touching a flame turns to Fire. Every fuel is tuned to burn
// *slowly*, eating in from the surface a cell at a time rather than flashing the
// whole body over at once; `burnChance` only sets the relative pace — a bit
// quicker for the loose/volatile fuels (gasoline, sawdust), a long slow smoulder
// for the dense ones (coal, crude oil). Because only cells actually touching a
// flame roll to catch, the burn stays a creeping surface front: the interior
// stays cool (insulated by its own still-unlit neighbors) until the front
// reaches it. Each fuel also self-ignites once its own temperature passes an
// autoignition point, so the heat brush or radiant heat from something very hot
// (Lava, Blue Flame) can set it off with no flame cell touching it.
//
// Fuels deliberately are NOT tagged `flammable`: that tag hands ignition to
// Fire's single global-rate ignite pass (see fire.ts), which would erase the
// per-fuel speed differences and let a fire quietly swallow the fuel before its
// own turn runs. Instead each fuel drives its own rate here by detecting the
// flame itself — the same id-based, scan-order-independent approach the
// explosives use.

// Temperature the Fire a lit fuel becomes starts at. Hot enough to boil water,
// melt ice, and warm the next fuel cell along — but the autoignition points
// below sit far enough above what a single such neighbor reaches by conduction
// (Fire conducts poorly, 0.1) that `burnChance`, not heat spread, stays the
// thing that sets the visible burn speed.
const BURN_TEMP = 800;

export interface Combustible {
  /** Per-tick chance to catch fire when a flame source is adjacent. */
  burnChance: number;
  /** Self temperature at/above which it ignites with no flame contact. */
  autoIgniteTemp: number;
}

function ignite(x: number, y: number, sim: SimContext): void {
  // In-place transform of the fuel's own cell — safe without a moved mark since
  // the scan visits each cell once; the fresh Fire starts next tick.
  sim.set(x, y, FIRE.id);
  sim.setTemp(x, y, BURN_TEMP);
}

/**
 * Run one tick of combustion for a fuel cell. Returns true if it ignited
 * (turned to Fire), in which case the caller must stop — skipping its normal
 * fall/flow for the tick.
 */
export function tryBurn(x: number, y: number, sim: SimContext, spec: Combustible): boolean {
  if (sim.getTemp(x, y) >= spec.autoIgniteTemp) {
    ignite(x, y, sim);
    return true;
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === FIRE.id || nid === LAVA.id || nid === BLUE_FLAME.id) {
      // A flame is adjacent — roll once for the whole cell this tick (the burn
      // speed lives entirely in this probability, independent of how many
      // flame neighbors there are).
      if (sim.chance(spec.burnChance)) {
        ignite(x, y, sim);
        return true;
      }
      return false;
    }
  }
  return false;
}
