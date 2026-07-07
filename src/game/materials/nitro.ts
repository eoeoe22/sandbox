import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLAST, seedBlast } from './blast';

// Liquid: flows/pools like water, but denser than every other liquid (even
// Lava) so it sinks straight through Water/Acid/Saltwater puddles and settles
// on the bottom — still lighter than the powders, so it doesn't block Sand/
// Salt/Gunpowder from sinking through it in turn. Same self-triggered
// detonation pattern as Gunpowder (see gunpowder.ts for why it's id-based,
// not `flammable`-tagged) but a larger blast radius and no wet/misfire
// exception — nitroglycerin isn't deactivated by water. Detonation seeds a
// Blast core (see blast.ts): a destructive shockwave, not a fireball.
const BLAST_RADIUS = 8;

function updateNitro(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === FIRE.id || nid === LAVA.id || nid === BLAST.id) {
      sim.spawn(x, y, BLAST.id);
      sim.setTemp(x, y, seedBlast(BLAST_RADIUS));
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
  density: 4.8,
  explosive: true,
  thermal: { conductivity: 0.4 },
  update: updateNitro,
});
