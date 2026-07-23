import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { updatePowder } from '../engine/behaviors';
import { IRON_MELT_TEMP } from './moltenmetal';
import { SLAG } from './slag';
import { MOLTEN_IRON_ORE } from './moltenironore';

// Rust Powder (녹 가루) — pulverized, corroded iron particles formed when metal powder
// or iron comes into contact with saltwater. Like solid rust, when heated past
// iron's melting point it converts into 50% Slag and 50% Molten Iron Ore.
function updateRustPowder(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= IRON_MELT_TEMP) {
    if (sim.chance(0.5)) {
      sim.set(x, y, SLAG.id);
    } else {
      sim.set(x, y, MOLTEN_IRON_ORE.id);
    }
    return;
  }
  updatePowder(x, y, sim);
}

export const RUST_POWDER = register({
  id: 114,
  name: 'Rust Powder',
  phase: Phase.Powder,
  color: rgb(195, 88, 52),
  density: 6.5,
  category: '가루',
  friction: 0.35,
  thermal: { conductivity: 0.25 },
  update: updateRustPowder,
});
