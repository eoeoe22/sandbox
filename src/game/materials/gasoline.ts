import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Liquid fuel: flows/pools like water but lighter than it (density < 3), so a
// poured layer floats on top of water — and lighter still than Crude Oil, so
// gasoline floats on oil too. The *fastest*-burning fuel — still tuned to creep
// in from the surface rather than flash the whole pool at once, just quicker
// than the rest: the highest per-tick ignite chance of the fuels, plus a low
// autoignition point that makes it the readiest to catch from stray heat. Just
// burns — it never detonates (that's Methane/Nitro). See combustion.ts.
const SPEC: Combustible = { burnChance: 0.12, autoIgniteTemp: 400 };

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
  combustible: true,
  category: '석유',
  thermal: { conductivity: 0.2 },
  update: updateGasoline,
});
