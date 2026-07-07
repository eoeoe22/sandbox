import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';

// Liquid: flows/pools like water (heavier). Same self-triggered detonation
// pattern as Gunpowder (see gunpowder.ts for why it's id-based, not
// `flammable`-tagged) but a larger blast radius and no wet/misfire exception
// — nitroglycerin isn't deactivated by water.
const BLAST_RADIUS = 7;

function updateNitro(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === FIRE.id || nid === LAVA.id) {
      sim.explode(x, y, BLAST_RADIUS, FIRE.id);
      return;
    }
  }
  updateLiquid(x, y, sim);
}

export const NITRO = register({
  id: 13,
  name: 'Nitro',
  phase: Phase.Liquid,
  color: rgb(225, 225, 140),
  density: 4,
  update: updateNitro,
});
