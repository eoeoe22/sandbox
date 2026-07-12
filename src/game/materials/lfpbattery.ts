import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { PULSE_PERIOD, injectPulses } from './battery';
import { MOLTEN_METAL } from './moltenmetal';

// LFP Battery — the safe chemistry. Pulses exactly like the Lithium Battery
// (same cadence, same full-strength injection — see battery.ts), but with no
// thermal runaway at all: no overheat threshold, no burning, no detonation.
// The trade-off for that safety is that it's an ordinary solid in every other
// way — a blast that reaches it destroys it like any solid (it is NOT
// explosion-proof), and only truly extreme heat undoes it: well past an
// ordinary flame's ~1000° ceiling it finally melts down into Molten Metal
// (Blue Flame / Lava / Thermite grade — Iron's own 1400°, which also keeps it
// safely above Molten Metal's 1350° freeze point so the melt actually stays
// molten instead of instantly setting back to Iron). In between, it just
// keeps ticking — the right power source to bury next to a Nichrome heater or
// run through a burning building.
const MELT_TEMP = 1400;

function updateLfpBattery(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten
    // Metal reads as molten instead of instantly re-freezing next tick.
    sim.set(x, y, MOLTEN_METAL.id);
    return;
  }

  const aux = sim.getAux(x, y);
  if (aux < PULSE_PERIOD - 1) {
    sim.setAux(x, y, aux + 1);
    return;
  }
  sim.setAux(x, y, 0);
  injectPulses(x, y, sim);
}

export const LFP_BATTERY = register({
  id: 82,
  name: 'LFP Battery',
  phase: Phase.Solid,
  color: rgb(95, 160, 120),
  density: 1000,
  category: '전기',
  thermal: { conductivity: 0.3 },
  update: updateLfpBattery,
});
