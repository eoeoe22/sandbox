import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { WATER, FROST_MELT_TEMP } from './water';
import { tryPhaseChange } from './phasechange';

// Solid: a static, rigid block of frozen water (like Stone, it just sits — no
// phase-default update for Solids). It's the deep-frozen end of the water phase
// diagram: Water chills to Ice below Water's deep-freeze point (see water.ts),
// and Ice thaws back to Water once conduction warms it past the melt point.
//
// Ice conducts heat reasonably well and is placed well below freezing, so it
// acts as a genuine cold sink: a block of Ice sitting in warmer Water slowly
// draws the heat out of the surrounding cells — chilling them toward Snow/Ice —
// while itself warming toward the melt point, so the interface advances and the
// Ice eventually melts rather than freezing the whole pool forever (the exact
// mirror of how Lava heats water while itself cooling to Stone). Air conducts
// nothing, so Ice left in open space never warms and persists indefinitely.
const ICE_INIT_TEMP = -20;

function updateIce(x: number, y: number, sim: SimContext): void {
  if (tryPhaseChange(x, y, sim)) return;
}

export const ICE = register({
  id: 21,
  name: 'Ice',
  phase: Phase.Solid,
  color: rgb(165, 215, 240),
  density: 1000,
  category: 'cooling',
  // 소화제: like Snow, a spent cell melts to Water rather than flashing off, so a
  // block thrown on a fire leaves meltwater behind that keeps working (suppress.ts).
  douses: 'melt',
  thermal: { init: ICE_INIT_TEMP, conductivity: 0.45 },
  // 녹는점
  phaseChange: { at: () => FROST_MELT_TEMP, when: 'atOrAbove', into: () => WATER.id },
  update: updateIce,
});
