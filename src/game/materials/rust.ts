import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_METAL, IRON_MELT_TEMP } from './moltenmetal';
import { SLAG } from './slag';
import { MOLTEN_IRON_ORE } from './moltenironore';

// Rust (녹) — corroded iron formed when iron or nanobots are exposed to saltwater.
// Unlike iron, it is non-conductive and crumbles into slag or molten iron ore when heated past
// iron's melting point (50% Slag, 50% Molten Iron Ore).
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
  color: rgb(175, 68, 37),
  density: 950,
  category: '고체',
  thermal: { conductivity: 0.3 },
  update: updateRust,
});
