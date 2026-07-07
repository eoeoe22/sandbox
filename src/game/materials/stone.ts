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
const STONE_MELT_TEMP = 1100;

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
  density: 1000,
  thermal: { conductivity: 0.5 },
  update: updateStone,
});
