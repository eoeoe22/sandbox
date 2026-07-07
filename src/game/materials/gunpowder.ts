import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { FIRE } from './fire';
import { LAVA } from './lava';

// Powder: falls/piles like sand. Each tick scans its own 8 neighbors for
// Fire/Lava by id (NOT via the generic `flammable` tag — see the plan doc:
// tagging Gunpowder flammable would let Fire's own ignite pass silently
// swallow it into plain Fire before its turn runs, skipping the explosion
// depending on scan-order timing. Self-triggered id detection is
// deterministic regardless of scan order). A Water/Saltwater neighbor makes
// it "wet" and blocks detonation this tick (misfire) even if Fire/Lava is
// also adjacent.
const BLAST_RADIUS = 4;

function updateGunpowder(x: number, y: number, sim: SimContext): void {
  let wet = false;
  let trigger = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id) wet = true;
    else if (nid === FIRE.id || nid === LAVA.id) trigger = true;
  }

  if (!wet && trigger) {
    sim.explode(x, y, BLAST_RADIUS, FIRE.id);
    return;
  }
  updatePowder(x, y, sim);
}

export const GUNPOWDER = register({
  id: 12,
  name: 'Gunpowder',
  phase: Phase.Powder,
  color: rgb(60, 60, 65),
  density: 5,
  thermal: { conductivity: 0.3 },
  update: updateGunpowder,
});
