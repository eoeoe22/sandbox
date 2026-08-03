import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_GLASS, SAND_MELT_TEMP } from './moltenglass';
import { tryPhaseChange } from './phasechange';

// Powder: falls and piles (inherits updatePowder). Denser than water, so it
// sinks through it. Heated past its melting point (by Lava, Blue Flame, or a
// Thermite burn) it fuses into Molten Glass, which then flows and cools back
// into a clear pane of solid Glass — a whole sand→glass pipeline that mirrors
// the Stone↔Lava and Iron↔Molten-Iron phase pairs.
function updateSand(x: number, y: number, sim: SimContext): void {
  if (tryPhaseChange(x, y, sim)) return;
  updatePowder(x, y, sim);
}

export const SAND = register({
  id: 2,
  name: 'Sand',
  phase: Phase.Powder,
  color: rgb(232, 201, 107),
  density: 5,
  // A modest angle of repose (마찰): grains grip a little, so a poured heap stands
  // as a rounded cone instead of instantly flattening.
  friction: 0.3,
  thermal: { conductivity: 0.35 },
  // 녹는점 — loose grains have to fuse, so this sits above solid Glass's.
  phaseChange: { at: () => SAND_MELT_TEMP, when: 'atOrAbove', into: () => MOLTEN_GLASS.id },
  update: updateSand,
});
