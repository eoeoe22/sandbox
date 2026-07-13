import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Helium (헬륨) — the lightest gas there is, and completely inert. It has no
// update of its own: it just inherits the default gas behavior and rises, but its
// density is below every other gas (Hydrogen and the rest sit at ~1, Helium at
// 0.5), so it bubbles up *through* all of them and collects in a layer right
// against the ceiling — the balloon gas. It reacts with nothing: no burning, no
// combining, no condensing. Purely a light, drifting filler for buoyancy gags
// (fill a sealed dome, float a pocket of it under a lid, watch it escape through
// an opening). In an open (void-border) sandbox it simply rises out of the world.
export const HELIUM = register({
  id: 97,
  name: 'Helium',
  phase: Phase.Gas,
  color: rgb(236, 232, 210),
  // Lighter than every other gas so it rises above all of them (see the density
  // sort in SimContext.tryMove); inert, so no custom update — pure data.
  density: 0.5,
  category: '기체',
  thermal: { conductivity: 0.04 },
});
