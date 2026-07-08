import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Powder: the crumbly reddish-brown residue of Iron that has oxidized against
// water (see iron.ts). It just falls and piles (inherits updatePowder) and is
// otherwise inert — but, unlike the Iron it came from, it's soft: Acid eats
// through it readily (it's not acidResistant) and a Blast scatters it, so a
// rusted-out structure is far more fragile than a fresh iron one. Rust no longer
// conducts, so a corroded wire is also a broken circuit.
export const RUST = register({
  id: 30,
  name: 'Rust',
  phase: Phase.Powder,
  color: rgb(150, 80, 45),
  density: 4,
  category: '가루',
  thermal: { conductivity: 0.3 },
});
