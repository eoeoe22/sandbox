import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Static barrier. No `update` (Solid) → never moves; nothing sinks through it.
// Acid-resistant, unlike Stone — the one deliberately corrosion-proof solid.
//
// Wall sits entirely outside the temperature system: with conductivity 0 it's a
// perfect thermal insulator, so the diffusion pass never exchanges heat across
// it (a neighbour sees min(cond, 0) = 0 — see Simulation.diffuseHeat) and its
// own cells never heat or cool. A walled container is therefore a perfect heat
// boundary, and the heat/cool brush skips Wall entirely (see brushTools.ts).
export const WALL = register({
  id: 1,
  name: 'Wall',
  phase: Phase.Solid,
  color: rgb(120, 124, 130),
  // Running-bond masonry, the pattern the hand-drawn Wall chip already shows,
  // brought to the canvas: `lattice` is the mortar and the renderer lights the top
  // row of each brick a step above `color` (see Material.brickPattern). Both tones
  // are the icon's own — #484c52 mortar under a #787c82 brick — so a wall on the
  // board and the wall on its palette chip are lit the same way. `lattice` here is
  // only the mortar colour: Wall is not `latticeFilter`, so nothing seeps through it.
  lattice: rgb(72, 76, 82),
  brickPattern: true,
  density: 1000,
  acidResistant: true,
  isWall: true,
  // Perfect insulator, no self-temperature: Wall is excluded from heat entirely.
  thermal: { conductivity: 0 },
});
