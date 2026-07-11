import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';
import { BLAST } from './blast';
import { OXYGEN } from './oxygen';
import { STEAM } from './steam';

// Hydrogen — the lightest gas, now a *flammable gas* rather than a detonating
// explosive. It fills a volume and pools against the ceiling like any gas, and
// it catches very easily (a low autoignition point), but igniting a cloud makes
// it burn — a flame that creeps cell to cell — instead of blowing a crater.
//
// Its signature reaction is with Oxygen: an ignited hydrogen cell touching an
// Oxygen cell burns the two together into *water* (2H₂+O₂→2H₂O). Both cells
// become hot Steam, which rises and condenses into Water (see steam.ts) — so
// lighting an H₂/O₂ mix leaves a steam cloud that rains down as water instead of
// a blast. With no Oxygen adjacent it just burns off to ordinary Fire, the way a
// flammable gas whooshes.
//
// Ignition is self-detected by id (Fire/Lava/Blue Flame/Blast/molten metal or
// glass), not the generic `flammable` tag: handling it here lets the O₂→water
// reaction take priority over Fire's plain ignite pass (which would otherwise
// convert it straight to Fire). It also self-ignites once heated past its low
// autoignition point.
const AUTOIGNITE_TEMP = 200;
// Combustion product temperature: the Fire/Steam a burning cell leaves is hot,
// so it radiates and the Steam rises before condensing to Water.
const BURN_TEMP = 700;

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

function updateHydrogen(x: number, y: number, sim: SimContext): void {
  let ignite = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  let oxyX = -1;
  let oxyY = -1;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === OXYGEN.id) {
      oxyX = nx;
      oxyY = ny;
    } else if (isIgniter(nid)) {
      ignite = true;
    }
  }

  if (ignite) {
    if (oxyX >= 0) {
      // Burns with the oxygen into water vapour (2H₂+O₂→2H₂O): both cells become
      // hot Steam, which rises and condenses back into Water. spawn() marks the
      // oxygen cell moved so it isn't reprocessed this same tick.
      sim.spawn(oxyX, oxyY, STEAM.id);
      sim.setTemp(oxyX, oxyY, BURN_TEMP);
      sim.set(x, y, STEAM.id);
      sim.setTemp(x, y, BURN_TEMP);
    } else {
      // Plain flammable-gas combustion: whooshes to Fire, which then creeps to
      // the next hydrogen cell (self-detected), so a cloud burns rather than blasts.
      sim.set(x, y, FIRE.id);
      sim.setTemp(x, y, BURN_TEMP);
    }
    return;
  }
  updateGas(x, y, sim);
}

export const HYDROGEN = register({
  id: 37,
  name: 'Hydrogen',
  phase: Phase.Gas,
  color: rgb(214, 228, 238),
  density: 1,
  category: '기체',
  // Very low conductivity, but a low autoignition point, so even a little
  // sustained heat lights it.
  thermal: { conductivity: 0.05 },
  update: updateHydrogen,
});
