import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';

// Antimatter — matter's mortal enemy. It falls like a powder until it meets any
// ordinary material, then annihilates: the matter it touched vanishes and the
// antimatter itself is consumed in a hot flash of Fire. The reaction is
// one-for-one — a grain destroys a single neighbor and dies — so a pocket of
// antimatter and a pocket of matter eat into each other at their shared edge
// rather than one instantly erasing the other, and the flashes of fire it
// leaves can set the surroundings alight. Only the indestructible Wall (and
// other antimatter) survives contact.
const FLASH_TEMP = 1200;

function updateAntimatter(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY || nid === ANTIMATTER.id) continue;
    // The indestructible Wall and explosion-proof Diamond survive annihilation.
    const nm = getMaterial(nid);
    if (nm.isWall || nm.explosionProof) continue;
    // Mutual annihilation: the matter is destroyed, this cell flashes to Fire.
    sim.set(nx, ny, EMPTY);
    sim.set(x, y, FIRE.id);
    sim.setTemp(x, y, FLASH_TEMP);
    return;
  }
  updatePowder(x, y, sim);
}

export const ANTIMATTER = register({
  id: 51,
  name: 'Antimatter',
  phase: Phase.Powder,
  color: rgb(196, 128, 236),
  density: 5,
  category: '특수',
  thermal: { conductivity: 0.2 },
  update: updateAntimatter,
});
