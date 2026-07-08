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
import { BLAST, seedBlast } from './blast';

// Powder: falls/piles like sand. Each tick scans its own 8 neighbors for
// Fire/Lava/Blast by id (NOT via the generic `flammable` tag — see the plan doc:
// tagging Gunpowder flammable would let Fire's own ignite pass silently
// swallow it into plain Fire before its turn runs, skipping the explosion
// depending on scan-order timing. Self-triggered id detection is
// deterministic regardless of scan order). A Water/Saltwater neighbor makes
// it "wet" and blocks detonation this tick (misfire) even if a trigger is
// also adjacent. Detonation seeds a Blast core (see blast.ts) whose life = the
// blast radius: a shockwave that spreads outward destroying particles, rather
// than the old "fill a disc with Fire" that behaved like plain fuel.
const BLAST_RADIUS = 5;

function updateGunpowder(x: number, y: number, sim: SimContext): void {
  let wet = false;
  let trigger = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id) wet = true;
    else if (nid === FIRE.id || nid === LAVA.id || nid === BLAST.id) trigger = true;
  }

  if (!wet && trigger) {
    sim.spawn(x, y, BLAST.id);
    sim.setTemp(x, y, seedBlast(BLAST_RADIUS));
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
  explosive: true,
  category: '폭발',
  thermal: { conductivity: 0.3 },
  update: updateGunpowder,
});
