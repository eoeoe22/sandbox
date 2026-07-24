import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Diamond — effectively indestructible. It conducts heat superbly (the best
// thermal conductor in the game), yet nothing destroys it: it's
// `explosionProof` (it stops a Blast front and shadows what's behind it, shatters
// flying Embers on contact, and shrugs off Antimatter — like the Wall does), it's
// `acidResistant`, and it declares no temperature
// reaction, so no amount of heat or cold melts, freezes, or sublimates it. (We
// deliberately drop the real-world detail that diamond burns/sublimates at
// extreme temperatures — here it's simply the one placeable solid immune to
// everything.) Handy for heat-conducting yet blast-proof structures: a diamond
// wall shrugs off a detonation while still shuttling a torch's heat through.
export const DIAMOND = register({
  id: 57,
  name: 'Diamond',
  phase: Phase.Solid,
  color: rgb(150, 226, 236),
  lattice: rgb(95, 185, 200),
  checker2x2: true,
  density: 1000,
  acidResistant: true,
  explosionProof: true,
  category: '고체',
  thermal: { conductivity: 0.95 },
});
