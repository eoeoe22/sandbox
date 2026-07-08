import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_GLASS, SAND_MELT_TEMP } from './moltenglass';

// Powder: falls and piles (inherits updatePowder). Denser than water, so it
// sinks through it. Heated past its melting point (by Lava, Blue Flame, or a
// Thermite burn) it fuses into Molten Glass, which then flows and cools back
// into a clear pane of solid Glass — a whole sand→glass pipeline that mirrors
// the Stone↔Lava and Iron↔Molten-Metal phase pairs.
function updateSand(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= SAND_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten Glass
    // reads as molten instead of instantly re-freezing to Glass next tick.
    sim.set(x, y, MOLTEN_GLASS.id);
    return;
  }
  updatePowder(x, y, sim);
}

export const SAND = register({
  id: 2,
  name: 'Sand',
  phase: Phase.Powder,
  color: rgb(232, 201, 107),
  density: 5,
  thermal: { conductivity: 0.35 },
  update: updateSand,
});
