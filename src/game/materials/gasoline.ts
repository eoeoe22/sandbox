import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Liquid fuel: flows/pools like water but lighter than it (density < 3), so a
// poured layer floats on top of water — and lighter still than Crude Oil, so
// gasoline floats on oil too. The *fastest*-burning fuel: a high per-tick
// ignite chance makes a pool flash over almost at once, and a low autoignition
// point makes it the readiest to catch from stray heat. Just burns — it never
// detonates (that's Methane/Nitro). See combustion.ts for the shared model.
const SPEC: Combustible = { burnChance: 0.55, autoIgniteTemp: 280 };

function updateGasoline(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  updateLiquid(x, y, sim);
}

export const GASOLINE = register({
  id: 24,
  name: 'Gasoline',
  phase: Phase.Liquid,
  color: rgb(214, 190, 96),
  density: 2.2,
  thermal: { conductivity: 0.2 },
  update: updateGasoline,
});
