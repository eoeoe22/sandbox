import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Id 0 is reserved for Empty. Selecting it in the palette acts as the eraser,
// and its color is the canvas background.
export const EMPTY_MAT = register({
  id: 0,
  name: 'Eraser',
  phase: Phase.Empty,
  color: rgb(16, 16, 22),
  density: 0,
});
