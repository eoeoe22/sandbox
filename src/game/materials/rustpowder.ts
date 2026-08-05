import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { updatePowder } from '../engine/behaviors';
import { IRON_MELT_TEMP } from './molteniron';
import { SLAG } from './slag';
import { MOLTEN_IRON_ORE } from './moltenironore';

// Rust Powder (녹가루) — fine grainy rust formed when iron powder oxidizes in salt water
// or when iron crumbles into rust powder upon corrosion.
// When heated past iron's melting point (IRON_MELT_TEMP), it melts into either
// Slag (50% chance) or Molten Iron Ore (50% chance).
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
  color: rgb(190, 85, 50),
  density: 5.5,
  friction: 0.35,
  category: 'powder',
  alsoIn: ['metal'],
  // Iron oxide dust still answers a magnet (weakly in reality, fully here — 재미
  // 우선), so scale swept off a rusted build can be gathered up with the filings
  // it came from (see materials/electromagnet.ts).
  magnetic: true,
  thermal: { conductivity: 0.25 },
  update: updateRustPowder,
});
