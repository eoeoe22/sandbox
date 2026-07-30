import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { BLAST } from './blast';
import { MOLTEN_IRON } from './molteniron';
import { MOLTEN_GLASS } from './moltenglass';

// Shared ignition trigger for the *deflagrating* fuel gases — the ones that
// simply catch fire and burn cell-to-cell through the cloud rather than
// detonating a crater (LPG, Ethylene). Unlike Methane/Hydrogen, which call
// `detonate`, these just convert themselves to Fire in place and let the flame
// front rip through the gas.
//
// Detection is by id, exactly as Methane/Gunpowder do it, not via the generic
// `flammable` tag: that tag hands ignition to Fire's own global-rate pass
// (0.04/tick — a visible crawl), whereas a fuel gas meeting an igniter should
// flash over at once. Being id-based it's also scan-order independent.
//
// Extracted from lpg.ts when Ethylene arrived so the roster of things that
// count as an igniter lives in one place — adding a new flame/melt material to
// this list lights every deflagrating gas at once, rather than drifting between
// per-material copies.

/** True if `id` is hot enough, as matter, to set a fuel gas alight on contact. */
export function isIgniter(id: number): boolean {
  return (
    id === FIRE.id ||
    id === LAVA.id ||
    id === BLUE_FLAME.id ||
    id === BLAST.id ||
    id === MOLTEN_IRON.id ||
    id === MOLTEN_GLASS.id
  );
}

/** True if any of the 8 neighbours of (x,y) is an igniter. */
export function igniterAdjacent(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isIgniter(sim.get(nx, ny))) return true;
  }
  return false;
}
