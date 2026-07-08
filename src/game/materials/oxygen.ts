import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { BLUE_FLAME } from './blueflame';
import { LAVA } from './lava';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';

// Oxygen — a nearly-invisible light gas that turns any fire into a firestorm.
// It rises and drifts like other gases, but a cell touching a flame or anything
// molten flashes over into Fire itself, so a spark in an oxygen pocket rips
// through the whole cloud in a bright deflagration front (each cell ignites once
// and becomes flame, so the flash is self-limiting, not a runaway). Pair it with
// a fuel and you get a far fiercer, faster burn than the fuel alone; pair it
// with Hydrogen and a single spark levels the room.
const FLASH_CHANCE = 0.6;
// The flashed-over cell becomes genuinely hot Fire (spawn/set alone would leave
// it at ambient), so it radiates heat and drives the front onward.
const FLASH_TEMP = 900;

function isIgniter(id: number): boolean {
  return (
    id === FIRE.id ||
    id === BLUE_FLAME.id ||
    id === LAVA.id ||
    id === MOLTEN_METAL.id ||
    id === MOLTEN_GLASS.id
  );
}

function updateOxygen(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isIgniter(sim.get(nx, ny)) && sim.chance(FLASH_CHANCE)) {
      sim.set(x, y, FIRE.id);
      sim.setTemp(x, y, FLASH_TEMP);
      return;
    }
  }
  updateGas(x, y, sim);
}

export const OXYGEN = register({
  id: 36,
  name: 'Oxygen',
  phase: Phase.Gas,
  color: rgb(180, 205, 225),
  density: 1,
  category: '기체',
  thermal: { conductivity: 0.06 },
  update: updateOxygen,
});
