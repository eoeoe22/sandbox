import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { CO2 } from './co2';

// Dry Ice — frozen CO₂ as a powder. Placed very cold (-78°), it acts as a solid
// cold sink (chilling and freezing what it rests against through conduction) and,
// once it warms past its sublimation point, turns straight into a puff of CO₂
// gas — skipping any liquid stage, the way real dry ice "smokes". Sitting in
// warm air it slowly sublimates; buried in something cold it lasts. The CO₂ it
// gives off then sinks and pools, smothering fire (see co2.ts) — so a block of
// dry ice quietly floods a pit with fire-killing fog.
const SUBLIMATE_TEMP = -55;

function updateDryIce(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= SUBLIMATE_TEMP) {
    // In-place `set` keeps the (still cold) temperature so the fresh CO₂ starts
    // out chilly.
    sim.set(x, y, CO2.id);
    return;
  }
  updatePowder(x, y, sim);
}

export const DRY_ICE = register({
  id: 34,
  name: 'Dry Ice',
  phase: Phase.Powder,
  color: rgb(236, 240, 245),
  density: 3,
  category: '냉각',
  thermal: { init: -78, conductivity: 0.4 },
  update: updateDryIce,
});
