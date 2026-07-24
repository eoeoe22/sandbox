import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { LIQUID_GALLIUM, GALLIUM_MELT_TEMP } from './liquidgallium';

// Gallium — a solid silvery-blue metal with one famous quirk: it melts with the
// faintest warmth. Its melt point sits barely above room temperature
// (GALLIUM_MELT_TEMP = 30°, ambient is 20°), so a coal ember, a warm neighbour,
// even a passing flame's radiant heat is enough to slump a Gallium bar into a
// shiny puddle of Liquid Gallium — the classic "metal that melts in your hand".
// It's `conductive` like Iron and Mercury, so a Spark runs along a Gallium
// wire; its only per-tick job as a static solid is to tick down the post-spark
// refractory stamped in its `aux` (mirrors Iron) and to check whether it's warm
// enough to melt.
function updateGallium(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again.
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (sim.getTemp(x, y) >= GALLIUM_MELT_TEMP) {
    // In-place `set` keeps the (now warm) temperature so the fresh Liquid
    // Gallium reads as molten instead of instantly re-freezing next tick.
    sim.set(x, y, LIQUID_GALLIUM.id);
  }
}

export const GALLIUM = register({
  id: 116,
  name: 'Gallium',
  phase: Phase.Solid,
  color: rgb(178, 188, 202),
  density: 1000,
  conductive: true,
  category: '고체',
  // A bright silvery metal surface: a Heat Ray beam reflects cleanly off it
  // (정반사) — see heatray.ts.
  laserReflective: true,
  // A metal, so it carries heat readily — which, with its very low melt point,
  // is exactly why the smallest warm touch spreads through a bar and melts it.
  thermal: { conductivity: 0.7 },
  update: updateGallium,
});
