import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { MOLTEN_IRON } from './molteniron';
import { MOLTEN_GLASS } from './moltenglass';
import { BLAST, detonate } from './blast';

// TNT — a packed charge: a static solid block (it holds its shape until it goes
// off, unlike loose Gunpowder that piles) that detonates into a *large* Blast.
// It's the demolition tool — stack blocks to blow craters, or wire one to a
// Battery through a fuse or metal for a remote detonator. It goes off from an
// adjacent flame or blast, from an electric arc (a Spark drops Fire beside it),
// or from enough radiant heat, and — being `explosive` — the shockwave front
// sweeps *through* neighboring charges and sets them off within the same tick,
// so a stack of blocks detonates as one big crater rather than erasing itself.
const BLAST_RADIUS = 16;
const AUTOIGNITE_TEMP = 240;

function updateTNT(x: number, y: number, sim: SimContext): void {
  let trigger = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  if (!trigger) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (
        nid === FIRE.id ||
        nid === LAVA.id ||
        nid === BLUE_FLAME.id ||
        nid === BLAST.id ||
        nid === MOLTEN_IRON.id ||
        nid === MOLTEN_GLASS.id
      ) {
        trigger = true;
        break;
      }
    }
  }

  if (trigger) {
    detonate(sim, x, y);
  }
  // Otherwise it just sits there — a Solid has no phase-default movement.
}

export const TNT = register({
  id: 52,
  name: 'TNT',
  phase: Phase.Solid,
  // The reference art's red (#db2a2a) rather than the older, duller #c43a30. The
  // canvas tile hoists this exact colour as its background (a stick's body is the
  // largest share of the tile), so the material's registered colour and the field it
  // paints are one value — which is also what `test/materialicons.ts` asserts of a
  // golden tile.
  color: rgb(0xdb, 0x2a, 0x2a),
  // A bundle of dynamite behind a printed label rather than a red slab: four sticks
  // per tile, lit on one side and shaded on the other in this tone, with a paper band
  // reading TNT wrapped across the middle (see Material.tntPattern and
  // render/tntTile.ts). `lattice` is the shaded side of each stick — the dark half of
  // the light/dark pair that makes a flat column read as a round.
  lattice: rgb(0x8d, 0x0f, 0x0f),
  tntPattern: true,
  density: 1000,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  category: 'explosive',
  thermal: { conductivity: 0.3 },
  update: updateTNT,
});
