import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Limestone — the optional flux of the smelting kit. It has no behavior of its
// own (pure powder that falls and piles); its entire role is to be *read* by an
// adjacent reducing iron-ore cell, which lifts that cell's iron yield from 0.70
// to 0.95 and consumes a grain of limestone (a hint of the real calcining that
// carries impurities off into the slag). Charge ore + coal alone and you still
// smelt iron, just a dirtier bloom shot through with slag; add a pinch of
// limestone and the bloom comes out cleaner. See ironore.ts for the flux branch.
export const LIMESTONE = register({
  id: 69,
  name: 'Limestone',
  phase: Phase.Powder,
  color: rgb(216, 210, 196),
  // Lighter than liquid Slag (6): a scatter of flux floats on a molten slag pool.
  density: 5,
  category: '제련',
  thermal: { conductivity: 0.35 },
  // No `update`: inherits the default powder fall/pile behavior.
});
