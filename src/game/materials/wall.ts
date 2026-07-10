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
  density: 1000,
  acidResistant: true,
  isWall: true,
  // Perfect insulator, no self-temperature: Wall is excluded from heat entirely.
  thermal: { conductivity: 0 },
});
