import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Heatpipe (히트파이프) — a copper heat-conducting rod. It has the highest thermal
// conductivity in the game (1.0, edging out even Diamond's 0.95), so it shuttles
// heat end-to-end almost instantly — the ideal way to pipe a torch's warmth or a
// coolant's chill clear across a build. It never melts, freezes, or burns no
// matter how hot or cold it gets: like Diamond it simply declares no temperature
// reaction. It is tough but *not* indestructible — an ordinary (non-Wall,
// non-explosionProof) solid, so a strong blast still craters it and only a weak
// concussion like a Gunpowder charge is shrugged off (see blast.ts durability).
// Copper-colored.
export const HEATPIPE = register({
  id: 85,
  name: 'Heatpipe',
  phase: Phase.Solid,
  color: rgb(184, 115, 51),
  density: 1000,
  category: '고체',
  // The best heat conductor in the game — a Heatpipe bar carries heat across a
  // whole build faster than Iron (0.85) or even Diamond (0.95).
  thermal: { conductivity: 1.0 },
});
