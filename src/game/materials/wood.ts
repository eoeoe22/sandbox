import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Solid fuel: a static, rigid timber (like Wall/Stone it just sits — Solid has
// no phase-default movement) that you build structures from and watch burn
// down. Its burn speed sits in the middle of the pack — slower than the loose
// Sawdust it's milled into, faster than a dense Coal lump or Crude Oil pool —
// so a lit beam is eaten along by a visible, creeping flame front. A consumed
// cell has a chance to leave a fleck of Ash behind (see combustion.ts) instead
// of just puffing into Fire, so a burnt-down beam leaves real ash residue. Just
// burns; never detonates. See combustion.ts for the shared model.
const SPEC: Combustible = { burnChance: 0.06, autoIgniteTemp: 500, ashChance: 0.15 };

function updateWood(x: number, y: number, sim: SimContext): void {
  // Solid: no fall/flow, so combustion is the only behavior — if it doesn't
  // ignite this tick the cell simply stays put.
  tryBurn(x, y, sim, SPEC);
}

export const WOOD = register({
  id: 26,
  name: 'Wood',
  phase: Phase.Solid,
  color: rgb(140, 96, 56),
  // Timber is never one flat brown — sapwood, heartwood and the grain between
  // them all catch light differently, so a plank wall of a single colour reads as
  // painted board rather than as wood. 16 matches Plant, the nearest sibling (the
  // other organic solid); it is wide enough to see on a mid-brown without turning
  // a big block into static, which is what a powder-width 18 does on this base.
  // One number feeds both the canvas and the palette chip (`varyAmplitude`), so
  // the swatch grains exactly as much as the material does — which is why Wood
  // no longer needs a drawing to have a surface.
  colorVary: 16,
  density: 1000,
  combustible: true,
  category: 'fire',
  thermal: { conductivity: 0.2 },
  update: updateWood,
});
