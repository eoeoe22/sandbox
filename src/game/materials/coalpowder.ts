import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Powdered coal — the pourable form of Coal. Solid Coal (id 25) is a rigid lump
// that holds its shape (Solid has no default movement), so a heap of it can't be
// interleaved with ore; Coal Powder falls and piles like Sand, so it can be
// poured in alternating layers with Iron Ore to charge a bloomery or blast
// furnace (see ironore.ts). It burns with the *exact same* spec as solid Coal —
// the slowest, longest-smouldering fuel — so the smelting carbon economy is
// unchanged: this is just Coal you can pour. Iron-ore reduction reads it as a
// carbon source alongside solid Coal. Just burns; never detonates. See
// combustion.ts for the shared surface-front model.
const SPEC: Combustible = { burnChance: 0.035, autoIgniteTemp: 580 };

function updateCoalPowder(x: number, y: number, sim: SimContext): void {
  // Burn first; if not consumed into Fire this tick, fall/pile like a powder
  // (mirrors Sawdust, the game's other burning powder).
  if (tryBurn(x, y, sim, SPEC)) return;
  updatePowder(x, y, sim);
}

export const COAL_POWDER = register({
  id: 70,
  name: 'Coal Powder',
  phase: Phase.Powder,
  // A touch lighter than solid Coal's near-black so a loose pile reads as grainy
  // dust rather than a solid block.
  color: rgb(40, 36, 46),
  density: 5,
  combustible: true,
  category: '제련',
  thermal: { conductivity: 0.2 },
  update: updateCoalPowder,
});
