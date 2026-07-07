import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Liquid: falls and spreads sideways to find its level (inherits updateLiquid).
// Lighter than sand, so sand displaces it.
export const WATER = register({
  id: 3,
  name: 'Water',
  phase: Phase.Liquid,
  color: rgb(60, 130, 210),
  density: 3,
});
