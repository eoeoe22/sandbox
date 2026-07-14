import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { RESIN } from './resin';

// Amber (호박) — fossilised resin: the hard, translucent gold solid that a pool
// of Resin cures into over time (see resin.ts). It's a static decorative Solid
// (build with it, seal things behind it — the "insect trapped in amber" gag), but
// it never forgot it was tree sap: it's still combustible, catching slowly and
// burning with a low, resinous flame if you hold fire to it. Like Wood it has no
// movement of its own — until it gets hot.
//
// Heat it up and it *un-cures*: fossilised resin remembers it was sap, so once a
// cell reaches MELT_TEMP the hard solid liquefies straight back into sticky Resin
// (see resin.ts), completing the reversible cycle — cold Resin slowly cures to
// Amber, hot Amber melts back to Resin. The set is in place and keeps the cell's
// heat, so the fresh Resin is already glowing and immediately burns/oozes: hold a
// flame to a block of amber and it doesn't just char, it softens and drips as
// burning, tarry sap.
const SPEC: Combustible = { burnChance: 0.03, autoIgniteTemp: 400 };

// Melt point. Pinned to Resin's autoignition / cure threshold (400°, see
// resin.ts): Resin only *cures* to Amber while cooler than 400°, so making Amber
// melt at that same 400° leaves no temperature where both conversions fire —
// below 400° a cell settles as Amber, at/above it settles as (burning) Resin,
// with no flip-flop band between. A cell caught by an adjacent flame is pinned to
// the 800° burn temperature, well past this, so a lit amber block melts within a
// tick or two of catching.
const MELT_TEMP = 400;

function updateAmber(x: number, y: number, sim: SimContext): void {
  // Hot enough to un-cure: liquefy back into Resin. In-place `set` keeps the
  // cell's temperature, so the new Resin stays at its current heat — if that was
  // burning heat it carries the fire on as oozing, dripping sap.
  if (sim.getTemp(x, y) >= MELT_TEMP) {
    sim.set(x, y, RESIN.id);
    return;
  }
  // Solid and still cool: no fall/flow — catching fire is the only behavior. A
  // catch pins the cell hot, so its next turn melts it above.
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
