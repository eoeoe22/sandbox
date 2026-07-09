import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { GASOLINE } from './gasoline';
import { KEROSENE } from './kerosene';
import { DIESEL } from './diesel';

// The transient fume that boiling crude oil gives off (see oil.ts). One shared
// vapor stands in for all three condensable cuts: which liquid it condenses back
// into is carried in the cell's own `aux` byte (1 = Gasoline, 2 = Kerosene, 3 =
// Diesel), stamped by oil.ts right after it spawns the vapor. Aux rides along on
// every swap (see SimContext.swap), so the fume keeps its identity as it drifts
// up. Like Steam it rises and then condenses on a fixed per-tick chance — higher
// when the cell above is blocked, so vapor pooling under a lid rains out faster
// than vapor still rising freely. The lasting, legible result is the coloured,
// density-stratified liquid layers it leaves behind, so one neutral grey fume
// serves for all three cuts.
const CONDENSE_CHANCE = 0.004;
const CONDENSE_CHANCE_BLOCKED = 0.02;

function condenseTarget(code: number): number {
  if (code === 2) return KEROSENE.id;
  if (code === 3) return DIESEL.id;
  return GASOLINE.id;
}

function updatePetroleumVapor(x: number, y: number, sim: SimContext): void {
  const blocked = !sim.inBounds(x, y - 1) || !sim.isEmpty(x, y - 1);
  if (sim.chance(blocked ? CONDENSE_CHANCE_BLOCKED : CONDENSE_CHANCE)) {
    // Condensing means it has shed its heat — drop back to ambient so the fresh
    // liquid doesn't sit hot and immediately re-distil into vapor. In-place set
    // to a non-empty material keeps the temperature we just wrote; the leftover
    // aux code is harmless on a liquid that never reads it.
    const target = condenseTarget(sim.getAux(x, y));
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, target);
    return;
  }
  updateGas(x, y, sim);
}

export const PETROLEUM_VAPOR = register({
  id: 59,
  name: 'Petroleum Vapor',
  phase: Phase.Gas,
  color: rgb(190, 180, 165),
  density: 1.2,
  category: '석유',
  thermal: { init: 110, conductivity: 0.08 },
  update: updatePetroleumVapor,
});
