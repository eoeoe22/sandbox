import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Static barrier. No `update` (Solid) → never moves; nothing sinks through it.
// Acid-resistant, unlike Stone — the one deliberately corrosion-proof solid.
export const WALL = register({
  id: 1,
  name: 'Wall',
  phase: Phase.Solid,
  color: rgb(120, 124, 130),
  density: 1000,
  acidResistant: true,
  isWall: true,
});
