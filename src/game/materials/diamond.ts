import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Diamond — effectively indestructible. It conducts heat superbly (the best
// thermal conductor in the game), yet almost nothing destroys it: it's
// `explosionProof` (it stops a Blast front and shadows what's behind it, and
// shatters flying Embers on contact — like the Wall does), it's
// `acidResistant`, and it declares no temperature
// reaction, so no amount of heat or cold melts, freezes, or sublimates it. (We
// deliberately drop the real-world detail that diamond burns/sublimates at
// extreme temperatures.) The one thing that does take it out is Antimatter,
// which annihilates every material but the Wall and the Void (antimatter.ts).
// Handy for heat-conducting yet blast-proof structures: a diamond
// wall shrugs off a detonation while still shuttling a torch's heat through.
export const DIAMOND = register({
  id: 57,
  name: 'Diamond',
  phase: Phase.Solid,
  color: rgb(150, 226, 236),
  lattice: rgb(135, 145, 158),
  checker2x2: true,
  colorVary: 10,
  density: 1000,
  acidResistant: true,
  explosionProof: true,
  category: 'solid',
  thermal: { conductivity: 0.95 },
});
