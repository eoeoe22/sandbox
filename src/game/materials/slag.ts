import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';

// Slag — the glassy waste of smelting: what iron ore turns into when it's melted
// without enough carbon to reduce it (t ≥ IRON_MELT_TEMP, see ironore.ts) and
// the fraction of a finished reduction that didn't make iron. It mirrors the
// Asphalt "hot ⇒ flows, cold ⇒ solid crust" template but keyed off a freeze
// point instead of an own gate: while hot (≥ SOFTEN_TEMP) it oozes as a thick,
// glowing liquid, slower than Lava; once it cools below SOFTEN_TEMP the shared
// `freeze` mechanism stops it flowing and it sets into a dull grey-blue crust.
// There's no separate cold material — it stays id 68 and just darkens via its
// glow ramp, so reheating a cold crust past SOFTEN_TEMP makes it flow again
// (build a furnace out of slag and it slumps when the furnace gets hot). It's the
// densest of the three molten smelting phases (Slag 8 > Molten Iron Ore 7 >
// Molten Metal 6), so the waste slag sinks to the bottom of the hearth and the
// reduced iron floats up above it — a readable dark band settling under the
// bright pooled metal.
const SLAG_SOFTEN_TEMP = 600;
const SLAG_FLOW_CHANCE = 0.1;

function updateSlag(x: number, y: number, sim: SimContext): void {
  // Only hot slag flows, and thickly (below Lava's 0.15). Cold slag is held
  // still by the shared `freeze` spec (SimContext.isFrozen), which also blocks
  // denser material from sinking through the set crust.
  if (sim.getTemp(x, y) >= SLAG_SOFTEN_TEMP && sim.chance(SLAG_FLOW_CHANCE)) {
    updateLiquid(x, y, sim);
  }
}

export const SLAG = register({
  id: 68,
  name: 'Slag',
  phase: Phase.Liquid,
  // Base colour is the fully-molten shade — a glow material darkens from `color`
  // (at `max`) down to `cool` (at `min`), so this is the hot end of the ramp.
  color: rgb(225, 95, 45),
  density: 8,
  category: '제련',
  // Cold crust below the softening point: stops flowing and acts solid.
  freeze: { temp: SLAG_SOFTEN_TEMP },
  // Placed hot (fresh from a melt); conducts a little worse than stone.
  thermal: { init: 1450, conductivity: 0.3 },
  // Glows when molten, cooling to a dark crust as it sets.
  glow: { min: 600, max: 1450, cool: rgb(70, 34, 28) },
  update: updateSlag,
});
