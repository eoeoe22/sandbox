import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateBuoyantPowder } from '../engine/behaviors';

// Ash — fine, light powder, the spent remains of a fire. It's unusually light
// (density 1.5): lighter than water, so a sprinkle of ash floats on the surface
// of a pool rather than sinking through it. Being so light it doesn't just drop
// — it drifts down with the floaty-powder wander, stalling and swaying sideways
// so it scatters as it settles. "가벼운 가루": if it ends up submerged (water
// poured over a pile, a pool closing back over it), it doesn't just sit pinned
// under the water like solid ground — it actively bubbles back up through the
// liquid to the surface (updateBuoyantPowder), so mixing ash into water never
// obstructs the water's own flow. Otherwise inert — it's here as a soft,
// settling residue to build and bury with, the cold end-state of the burn cycle.
export const ASH = register({
  id: 55,
  name: 'Ash',
  phase: Phase.Powder,
  color: rgb(92, 92, 98),
  density: 1.5,
  category: '가루',
  thermal: { conductivity: 0.2 },
  update: updateBuoyantPowder,
});
