import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';

// The explosion *shockwave* — what makes a detonation different from just
// lighting fuel on fire. Unlike Fire (a gas that only drifts upward and ignites
// flammables), a Blast:
//   1. spreads in ALL four directions (상하좌우) as an expanding front, and
//   2. DESTROYS the particles it passes through (sand, water, plants, …), not
//      just igniting them — carving a crater.
//
// Lifetime without a dedicated `life` field: each cell stores its remaining
// spread distance in its *temperature* (conductivity 0, so the heat-diffusion
// pass leaves that value untouched and the blast never bleeds "heat" into its
// neighbors). A cell with life L seeds its orthogonal neighbours as life L-1 and
// then spends itself, so the maximum life strictly decreases by one every tick —
// the whole wave is guaranteed to die out within L+1 ticks, no matter how it
// bounces around a cleared crater. A cell seeded at life L reaches L cells out
// (the life-1 ring still destroys its neighbours; only life-0 cells stop), so
// the seeded life *is* the blast radius. Gunpowder/Nitro seed the core (see
// those files); painting Blast directly drops a `thermal.init`-sized charge.
const BLAST_FIRE_CHANCE = 0.35; // a spent blast cell leaves scattered flames…
// …otherwise it clears to Empty, so the net result is a crater dusted with fire.

function updateBlast(x: number, y: number, sim: SimContext): void {
  const life = sim.getTemp(x, y);
  if (life >= 1) {
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue; // edge (or void border): nothing to hit
      const nid = sim.get(nx, ny);
      if (nid === BLAST.id) continue; // don't re-energize a cell already blasting
      if (nid !== EMPTY) {
        const m = getMaterial(nid);
        // Only the indestructible boundary Wall blocks the wave outright.
        // Every other solid — Stone included — gets destroyed like anything else.
        if (m.isWall) continue;
        // Explosives are passed over so they can chain-detonate on their own turn.
        if (m.explosive) continue;
      }
      // Destroy whatever was there and carry the wave one cell further out.
      sim.spawn(nx, ny, BLAST.id);
      sim.setTemp(nx, ny, life - 1);
    }
  }
  // Spent: collapse into a flame or clear out.
  if (sim.chance(BLAST_FIRE_CHANCE)) sim.spawn(x, y, FIRE.id);
  else sim.set(x, y, EMPTY);
}

export const BLAST = register({
  id: 17,
  name: 'Blast',
  phase: Phase.Gas,
  color: rgb(255, 245, 210),
  density: 1,
  // `init` doubles as the spread radius when a Blast is placed by the brush.
  // conductivity 0 is load-bearing: it makes the heat pass treat `temp` as an
  // inert per-cell counter (the blast's remaining life) instead of real heat.
  thermal: { init: 5, conductivity: 0 },
  update: updateBlast,
});
