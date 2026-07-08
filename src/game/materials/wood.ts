import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Solid fuel: a static, rigid timber (like Wall/Stone it just sits — Solid has
// no phase-default movement) that you build structures from and watch burn
// down. Its burn speed sits in the middle of the pack — slower than the loose
// Sawdust it's milled into, faster than a dense Coal heap or Crude Oil pool —
// so a lit beam is eaten along by a visible, creeping flame front. Just burns;
// never detonates. See combustion.ts for the shared model.
const SPEC: Combustible = { burnChance: 0.13, autoIgniteTemp: 500 };

function updateWood(x: number, y: number, sim: SimContext): void {
  // Solid: no fall/flow, so combustion is the only behavior — if it doesn't
  // ignite this tick the cell simply stays put.
  tryBurn(x, y, sim, SPEC);
}

export const WOOD = register({
  id: 26,
  name: 'Wood',
  phase: Phase.Solid,
  color: rgb(140, 96, 56),
  density: 1000,
  thermal: { conductivity: 0.2 },
  update: updateWood,
});
