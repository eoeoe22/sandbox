import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { SALT } from './salt';
import { tryPhaseChange } from './phasechange';

// Molten Salt (용융염) — what Salt becomes when heated past its melting point
// (see salt.ts). A hot, glowing liquid that flows and, once conduction cools it
// back below the freeze point, crystallizes into solid Salt again — the same
// melt→flow→set cycle as Lava↔Stone, Sand→Glass and Iron→Molten Iron. Placed
// molten-hot; like isolated Lava it stays molten with nothing cold touching it.
export const SALT_MELT_TEMP = 800;
const MOLTEN_SALT_TEMP = 900;
const MOLTEN_SALT_FREEZE_TEMP = 700;
const FLOW_CHANCE = 0.25;

function updateMoltenSalt(x: number, y: number, sim: SimContext): void {
  if (tryPhaseChange(x, y, sim)) return;
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const MOLTEN_SALT = register({
  id: 56,
  name: 'Molten Salt',
  phase: Phase.Liquid,
  color: rgb(245, 205, 150),
  density: 4,
  category: 'fire',
  thermal: { init: MOLTEN_SALT_TEMP, conductivity: 0.5 },
  glow: { min: MOLTEN_SALT_FREEZE_TEMP, max: MOLTEN_SALT_TEMP, cool: rgb(150, 110, 80) },
  // 어는점
  phaseChange: { at: () => MOLTEN_SALT_FREEZE_TEMP, when: 'atOrBelow', into: () => SALT.id },
  update: updateMoltenSalt,
});
