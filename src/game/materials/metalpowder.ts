import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { updatePowder } from '../engine/behaviors';
import { MOLTEN_METAL, IRON_MELT_TEMP } from './moltenmetal';

// Metal Powder — the pourable, shattered form of metal. It's what a blue drum
// bursts into when an explosion tears it apart (see objects.ts): the shell is
// blown to bits rather than cleanly melting, so it rains down as a heap of heavy
// steel grains instead of a molten puddle. It falls and piles like Sand, and —
// being metal — it still melts: heated past Iron's melting point it turns to
// Molten Metal exactly as solid Iron does, so a pile of drum shrapnel dropped in
// Lava pools back into liquid metal. Denser than the lighter mineral powders
// (sand/coal ~5) so a metal-dust heap settles beneath them and sinks through
// water — though lighter than liquid Slag (8), which it floats on — and nowhere
// near solid Iron's block density.
function updateMetalPowder(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= IRON_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten Metal
    // reads as molten instead of instantly re-freezing next tick (mirrors Iron).
    sim.set(x, y, MOLTEN_METAL.id);
    return;
  }
  updatePowder(x, y, sim);
}

export const METAL_POWDER = register({
  id: 105,
  name: 'Metal Powder',
  phase: Phase.Powder,
  // A grainier, slightly lighter steel-grey than solid Iron's rgb(135,140,150),
  // so a loose pile reads as dusty metal shavings rather than a solid bar.
  color: rgb(158, 162, 172),
  density: 7,
  category: '가루',
  // Rounded, tumbling grains slide more freely than angular coal dust, so a metal
  // heap spreads to a shallower angle of repose (마찰 lower than Coal Powder).
  friction: 0.32,
  // Loose grains bridge heat far worse than a solid Iron bar (0.85), but metal
  // still carries warmth better than mineral dust.
  thermal: { conductivity: 0.35 },
  update: updateMetalPowder,
});
