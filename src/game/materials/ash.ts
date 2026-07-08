import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Ash — fine, light powder, the spent remains of a fire. It falls and piles like
// any powder but is unusually light (density 1.5): lighter than water, so a
// sprinkle of ash floats on the surface of a pool rather than sinking through
// it. Otherwise inert — it's here as a soft, settling residue to build and bury
// with, the cold end-state of the burn cycle.
export const ASH = register({
  id: 55,
  name: 'Ash',
  phase: Phase.Powder,
  color: rgb(92, 92, 98),
  density: 1.5,
  category: '가루',
  thermal: { conductivity: 0.2 },
});
