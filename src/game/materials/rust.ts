import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { IRON_MELT_TEMP } from './moltenmetal';
import { SLAG } from './slag';
import { MOLTEN_IRON_ORE } from './moltenironore';

// Rust (녹) — solid iron oxide formed when iron is exposed to salt water.
// Non-conductive solid (iron oxide is an electrical insulator unlike clean iron).
// When heated past iron's melting point (IRON_MELT_TEMP), it melts into either
// Slag (50% chance) or Molten Iron Ore (50% chance).
function updateRust(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= IRON_MELT_TEMP) {
    if (sim.chance(0.5)) {
      sim.set(x, y, SLAG.id);
    } else {
      sim.set(x, y, MOLTEN_IRON_ORE.id);
    }
  }
}

export const RUST = register({
  id: 113,
  name: 'Rust',
  phase: Phase.Solid,
  color: rgb(175, 75, 45),
  density: 900,
  category: '고체',
  thermal: { conductivity: 0.3 },
  update: updateRust,
});
