import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_GLASS, GLASS_MELT_TEMP } from './moltenglass';
import { tryPhaseChange } from './phasechange';

// Powder: the shattered, pourable form of Glass. It's what a solid Glass pane
// crazes into when a shockwave washes over it but can't fully break it — a
// Gunpowder concussion, a weak blast, or a Woofer's power-0 thump (see the
// `shatterId` hook in blast.ts). Otherwise it's Glass through and through:
// acid runs off it (`acidResistant`), and heated back past glass's softening
// point (GLASS_MELT_TEMP — the *fused*-glass melting point, since these are
// glass fragments, not raw silica sand) it re-melts into Molten Glass, which
// then flows and cools back into a fresh clear pane — so a heap of broken glass
// dropped in Lava pools back into liquid glass exactly as solid Glass does. It
// falls and piles like Sand (inherits updatePowder).
function updateBrokenGlass(x: number, y: number, sim: SimContext): void {
  if (tryPhaseChange(x, y, sim)) return;
  updatePowder(x, y, sim);
}

export const BROKEN_GLASS = register({
  id: 119,
  name: 'Broken Glass',
  phase: Phase.Powder,
  // A frostier, more opaque whitish-blue than a clear pane's rgb(200,225,235):
  // a loose heap of crushed shards scatters light, so it reads as frosted glass
  // dust rather than a clear window.
  color: rgb(214, 232, 238),
  // Same as solid Glass — dense shards that sink through water and lighter
  // powders alike.
  density: 1000,
  acidResistant: true,
  // Angular shards grip one another, so a poured heap stands as a steepish cone
  // (a touch more than Sand's rounded grains).
  friction: 0.4,
  category: 'powder',
  thermal: { conductivity: 0.4 },
  // 녹는점 — shards soften at the same heat a whole pane does (glass.ts).
  phaseChange: { at: () => GLASS_MELT_TEMP, when: 'atOrAbove', into: () => MOLTEN_GLASS.id },
  update: updateBrokenGlass,
});
