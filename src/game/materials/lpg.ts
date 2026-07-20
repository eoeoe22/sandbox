import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { BLAST } from './blast';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';

// LPG — the lightest cut of crude, the petroleum gas that boils off first when
// oil is gently heated (see oil.ts's distillation). It's a *product*, not a
// process fume: unlike Petroleum Vapor it never condenses back to a liquid, it
// just rises and disperses. Lighter than every other gas so it races to the
// top and pools under a lid.
//
// It *deflagrates* rather than detonates. Unlike Methane or Hydrogen (fuel-air
// explosives that call `detonate` and level a filled disc instantly), LPG
// simply catches fire: a cell touched by a flame, molten material, or blast
// wave — or heated past its autoignition point — converts itself to Fire in
// place. The fire then spreads cell-to-cell through the cloud as each ignited
// neighbor becomes fire, producing a visible flame front that rips through
// the gas without carving a crater.
//
// Trigger detection is by id (like Methane/Gunpowder), not the generic
// `flammable` tag. A `flammable` tag would let Fire's own slow ignite pass
// (0.04/tick) handle it — a visible crawl that reads as sluggish. Instead LPG
// flashes over itself the instant it meets an igniter, matching Methane's
// responsiveness but without the shockwave.
const AUTOIGNITE_TEMP = 400;

function isIgniter(id: number): boolean {
  return (
    id === FIRE.id ||
    id === LAVA.id ||
    id === BLUE_FLAME.id ||
    id === BLAST.id ||
    id === MOLTEN_METAL.id ||
    id === MOLTEN_GLASS.id
  );
}

function updateLPG(x: number, y: number, sim: SimContext): void {
  let trigger = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  if (!trigger) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      if (isIgniter(sim.get(nx, ny))) {
        trigger = true;
        break;
      }
    }
  }

  if (trigger) {
    // Become Fire in place — a deflagration front, not a detonation. spawn
    // seeds the cell at Fire's own init temperature (1000°) and marks it moved
    // so it isn't reprocessed this tick.
    sim.spawn(x, y, FIRE.id);
    return;
  }
  updateGas(x, y, sim);
}

export const LPG = register({
  id: 58,
  name: 'LPG',
  phase: Phase.Gas,
  color: rgb(210, 215, 170),
  density: 0.8,
  category: '석유',
  thermal: { init: 60, conductivity: 0.08 },
  update: updateLPG,
});
