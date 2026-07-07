import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Powder: falls and piles (inherits updatePowder). Denser than water, so it
// sinks through it.
export const SAND = register({
  id: 2,
  name: 'Sand',
  phase: Phase.Powder,
  color: rgb(232, 201, 107),
  density: 5,
  thermal: { conductivity: 0.35 },
});
