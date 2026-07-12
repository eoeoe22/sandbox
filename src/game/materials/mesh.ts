import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { siftVertical } from './sieve';

// Mesh (체) — a static grey screen with a woven lattice look (the renderer draws
// it as a two-tone checkerboard, see `lattice`). It's a solid, so powders pile on
// it and other solids rest against it, but liquids and gases seep straight
// *through* it (see sieve.ts): pour water onto a mesh floor and it drips through
// to the space below, and steam trapped underneath bubbles up past it. Handy as a
// filter or separator — hold back sand while letting the water drain out from
// under it, or vent gas up out of a powder bed.
function updateMesh(x: number, y: number, sim: SimContext): void {
  siftVertical(x, y, sim);
}

export const MESH = register({
  id: 83,
  name: 'Mesh',
  phase: Phase.Solid,
  color: rgb(132, 136, 142),
  // Second, darker grey woven through the base as a checkerboard so the screen
  // reads as a grid/lattice rather than a flat grey slab (see the renderer).
  lattice: rgb(92, 96, 102),
  density: 1000,
  category: '고체',
  thermal: { conductivity: 0.4 },
  update: updateMesh,
});
