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
import { BLAST, detonate } from './blast';

// Powder: falls/piles like sand. Each tick scans its own 8 neighbors for
// Fire/Lava/Blast by id (NOT via the generic `flammable` tag — see the plan doc:
// tagging Gunpowder flammable would let Fire's own ignite pass silently
// swallow it into plain Fire before its turn runs, skipping the explosion
// depending on scan-order timing. Self-triggered id detection is
// deterministic regardless of scan order). A Water/Saltwater neighbor makes
// it "wet" and blocks detonation this tick (misfire) even if a trigger is
// also adjacent. Detonation is an instant filled-disc shockwave (see blast.ts).
//
// Gunpowder is the game's *weak* explosive: a low `destructivePower` (파괴력)
// means its shock can't break tough matter (stone/metal/glass survive and shadow
// it), so instead of cratering it *shoves loose powder/liquid/gas aside* as Debris
// that arcs out and rains back — a mass-conserving "concussion" heave rather than
// a hole. Black powder is low-brisance, so this doubles as a bit of a nod to
// physics. Every other explosive omits the field and levels everything as before.
const BLAST_RADIUS = 8;
// Below every phase's default durability (see blast.ts): a gunpowder blast breaks
// nothing solid and shoves all loose matter within reach.
const DESTRUCTIVE_POWER = 6;

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
    detonate(sim, x, y);
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
  blastRadius: BLAST_RADIUS,
  destructivePower: DESTRUCTIVE_POWER, // weak: shoves loose matter, can't crater solids
  category: '폭발',
  thermal: { conductivity: 0.3 },
  update: updateGunpowder,
});
