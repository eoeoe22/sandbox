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
import { BLAST } from './blast';
import { HYDROGEN } from './hydrogen';
import { STEAM } from './steam';

// Oxygen — a nearly-invisible light gas that turns any fire into a firestorm.
// It rises and drifts like other gases, but a cell touching a flame, anything
// molten, or a blast wave flashes over: it becomes Blue Flame rather than
// ordinary Fire (a self-oxygenated burn runs at torch heat, same as the forced
// draught in combustion.ts), so a spark in an oxygen pocket rips through the
// whole cloud in a bright, hot deflagration front (each cell ignites once, so
// the flash is self-limiting).
//
// But if Hydrogen is mixed in, the two burn together into *water* instead: the
// flashing oxygen cell becomes Steam (hot water vapor, 2H₂+O₂→2H₂O), which then
// condenses into Water (see steam.ts). Hydrogen is now a flammable gas rather
// than an explosive (see hydrogen.ts), so igniting an H₂/O₂ mix doesn't blast —
// it burns and leaves a steam cloud that rains back down as water.
const FLASH_CHANCE = 0.6;
// The flashed-over cell becomes genuinely hot Blue Flame (spawn/set alone
// would leave it at ambient) — matching Blue Flame's own init temp, so it
// radiates heat and drives the front onward at full torch heat.
const FLASH_TEMP = 1800;

function isIgniter(id: number): boolean {
  return (
    id === FIRE.id ||
    id === BLUE_FLAME.id ||
    id === LAVA.id ||
    id === MOLTEN_METAL.id ||
    id === MOLTEN_GLASS.id ||
    id === BLAST.id
  );
}

function hasHydrogenNeighbor(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === HYDROGEN.id) return true;
  }
  return false;
}

function updateOxygen(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isIgniter(sim.get(nx, ny)) && sim.chance(FLASH_CHANCE)) {
      if (hasHydrogenNeighbor(x, y, sim)) {
        sim.set(x, y, STEAM.id); // burns with the hydrogen into water vapor
      } else {
        sim.set(x, y, BLUE_FLAME.id);
        sim.setTemp(x, y, FLASH_TEMP);
      }
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
