import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Solid: static barrier like Wall (no update). A visually distinct variant
// that reads as natural rock rather than a built wall; water/sand pile on top
// of it exactly as they do on Wall, since Solid blocks displacement.
export const STONE = register({
  id: 4,
  name: 'Stone',
  phase: Phase.Solid,
  color: rgb(150, 140, 128),
  density: 1000,
  // Conducts heat well enough that the crust which forms between water and lava
  // keeps passing heat through instead of insulating the molten lava beneath.
  thermal: { conductivity: 0.5 },
});
