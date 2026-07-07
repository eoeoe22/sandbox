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
  // Air conducts no heat here (direct conduction only, no convection): this is
  // what keeps an isolated hot blob from bleeding heat into empty space, so
  // lava with nothing cold touching it never spontaneously solidifies.
  thermal: { conductivity: 0 },
});
