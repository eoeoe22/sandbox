import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Amber (호박) — fossilised resin: the hard, translucent gold solid that a pool
// of Resin cures into over time (see resin.ts). It's a static decorative Solid
// (build with it, seal things behind it — the "insect trapped in amber" gag), but
// it never forgot it was tree sap: it's still combustible, catching slowly and
// burning with a low, resinous flame if you hold fire to it. Just burns; like
// Wood it has no movement of its own.
const SPEC: Combustible = { burnChance: 0.03, autoIgniteTemp: 400 };

function updateAmber(x: number, y: number, sim: SimContext): void {
  // Solid: no fall/flow — combustion is the only behavior.
  tryBurn(x, y, sim, SPEC);
}

export const AMBER = register({
  id: 93,
  name: 'Amber',
  phase: Phase.Solid,
  color: rgb(210, 148, 40),
  density: 1000,
  combustible: true,
  category: '고체',
  thermal: { conductivity: 0.2 },
  update: updateAmber,
});
