import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';

// Dry Ice — frozen CO₂ as a rigid, static solid block. Placed very cold (-78°)
// it acts as a solid cold sink, frosting and freezing whatever it rests against
// through conduction. It doesn't last, though: it slowly sublimates away into
// thin air — vanishing outright, leaving no gas behind — and any warmth speeds
// that up, so once it heats past its sublimation point it's gone quickly. Left
// cold and alone it still thins out over time; sat against anything warm it
// melts away fast.
const SUBLIMATE_TEMP = -40; // warmed past this → sublimates away promptly
const SLOW_SUBLIMATE_CHANCE = 0.0025; // …and even kept cold it slowly evaporates

function updateDryIce(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= SUBLIMATE_TEMP) {
    sim.set(x, y, EMPTY);
    return;
  }
  if (sim.chance(SLOW_SUBLIMATE_CHANCE)) {
    sim.set(x, y, EMPTY);
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
