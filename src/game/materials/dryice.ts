import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { CO2 } from './co2';

// Dry Ice — frozen CO₂ as a rigid, static solid block. Placed very cold (-78°)
// it acts as a solid cold sink, frosting and freezing whatever it rests against
// through conduction. It doesn't last, though: it slowly sublimates into a cloud
// of cold CO₂ gas (see co2.ts) — the heavy fog that pools along the floor and
// smothers fire — and any warmth speeds that up, so once it heats past its
// sublimation point it fumes away quickly. Left cold and alone it still gives off
// gas over time; sat against anything warm it boils off fast. The CO₂ it releases
// keeps the block's temperature, so the fresh fog starts bitterly cold and sinks.
const SUBLIMATE_TEMP = -40; // warmed past this → sublimates away promptly
const SLOW_SUBLIMATE_CHANCE = 0.0025; // …and even kept cold it slowly evaporates

function updateDryIce(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= SUBLIMATE_TEMP) {
    sim.set(x, y, CO2.id);
    return;
  }
  if (sim.chance(SLOW_SUBLIMATE_CHANCE)) {
    sim.set(x, y, CO2.id);
    return;
  }
  // Solid: no movement — it just sits and evaporates while chilling its neighbors.
}

export const DRY_ICE = register({
  id: 34,
  name: 'Dry Ice',
  phase: Phase.Solid,
  color: rgb(236, 240, 245),
  density: 1000,
  category: '냉각',
  thermal: { init: -78, conductivity: 0.4 },
  update: updateDryIce,
});
