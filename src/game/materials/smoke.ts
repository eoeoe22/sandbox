import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';

// Gas: rises/diffuses like the default gas behavior, then probabilistically
// dissipates to nothing so it doesn't accumulate forever. This is now expressed
// through the generalized `life` tag (~37-tick mean life ≈ 0.6 s at 60 Hz, the
// same ~2.7%/tick decay Smoke always used) — the engine expires the cell before
// its update runs, so the update is just the plain rising/diffusing gas.
const LIFE_TICKS = 37;

export const SMOKE = register({
  id: 6,
  name: 'Smoke',
  phase: Phase.Gas,
  color: rgb(180, 180, 188),
  density: 1,
  thermal: { conductivity: 0.05 },
  // Dissipates to Empty on a memoryless timer (see Material.life).
  life: { ticks: LIFE_TICKS },
  update: updateGas,
});
