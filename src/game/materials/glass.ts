import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_GLASS, GLASS_MELT_TEMP } from './moltenglass';

// Solid: a clear, rigid pane — what Molten Glass sets into once it cools (see
// moltenglass.ts). Like Stone it just sits there, but it's `acidResistant`
// (acid runs off it, so it makes acid-proof containers) and, heated back past
// its melting point (GLASS_MELT_TEMP — lower than raw sand's, since fused glass
// only has to soften), it re-melts into Molten Glass — the exact mirror of
// Stone↔Lava, so a glass wall against a hot enough source (Lava, Blue Flame,
// Molten Metal, a Thermite burn) softens and flows away. It's not
// indestructible, though: a Blast shatters it like any other non-Wall solid.
function updateGlass(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= GLASS_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten Glass
    // reads as molten instead of instantly re-setting next tick.
    sim.set(x, y, MOLTEN_GLASS.id);
  }
}

export const GLASS = register({
  id: 32,
  name: 'Glass',
  phase: Phase.Solid,
  color: rgb(200, 225, 235),
  density: 1000,
  acidResistant: true,
  category: '고체',
  thermal: { conductivity: 0.4 },
  update: updateGlass,
});
