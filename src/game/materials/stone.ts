import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { LAVA } from './lava';

// Solid: static barrier like Wall, but destructible (see blast.ts — only Wall
// is exempt from the blast wave) and re-meltable. Conducts heat well enough
// that the crust which forms between water and lava keeps passing heat through
// instead of insulating the molten lava beneath — which also means Stone
// sitting against Lava (or otherwise heated past STONE_MELT_TEMP) eventually
// melts back into Lava itself, mirroring Lava's own freeze-to-Stone reaction.
// Exported because Obsidian (obsidian.ts) deliberately melts at *exactly* the
// same point — sharing the constant instead of copying the number keeps the two
// rocks from silently drifting apart if this is ever retuned.
export const STONE_MELT_TEMP = 1100;

function updateStone(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= STONE_MELT_TEMP) {
    // In-place `set` keeps the cell's (now high) temperature, so the fresh
    // Lava reads as molten instead of instantly re-freezing next tick.
    sim.set(x, y, LAVA.id);
  }
}

export const STONE = register({
  id: 4,
  name: 'Stone',
  phase: Phase.Solid,
  color: rgb(150, 140, 128),
  // A granular rock, so it carries a per-particle brightness grain rather than being
  // one painted rectangle — a slab of stone is mineral grains catching the light at
  // slightly different angles, and a wall of it was reading as flat plaster.
  //
  // Deliberately *low dynamic range*: 7 is the same amplitude Concrete carries (the
  // other mineral solid) and well under the powders' default 18. Stone is placed by
  // the screenful, so what looks like pleasant texture on one cell becomes visual
  // noise across a cavern wall — the point is to break the flatness, not to make the
  // rock sparkle. One number feeds both the canvas and the palette chip
  // (`varyAmplitude`).
  //
  // Per cell rather than blocked (contrast Obsidian's `tintBlock: 2`): obsidian
  // fractures into broad curved faces many cells wide, and stone does not — its
  // features really are grain-sized, so sampling at the cell is the honest reading
  // here even though it was the wrong one there.
  colorVary: 7,
  density: 1000,
  thermal: { conductivity: 0.5 },
  update: updateStone,
});
