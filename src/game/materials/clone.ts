import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8, DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { BLAST } from './blast';
import { EMBER } from './ember';
import { SPARK } from './spark';
import { VOID } from './void';

// Clone — an infinite source. It's a static block that, on first contact with
// any real material, *latches onto* it (remembering that material's id in its
// `aux` byte) and from then on continuously emits copies of it into the empty
// cells around it. Drop a Clone in water and it becomes an endless spring;
// latch it onto Sand and it's an hourglass that never empties; latch it onto
// Fire and it's an eternal flame. It's the classic sandbox toy, and the flip
// side of Void.
//
// Clone is `indestructible`: blasts are blocked by it, embers shatter on it,
// Void skips it, and even a critical uranium's Nuclear Ray bounces off it. So a
// Clone source keeps running no matter what you throw at it — with one
// exception: Antimatter annihilates it like anything else, since only the Wall
// and the Void survive that (antimatter.ts). Short of antimatter, only the
// eraser brush (or a full clear) takes it out.
//
// The adopted id lives in `aux` (0 = "hasn't latched yet"). It won't latch onto
// things that aren't meaningful to duplicate: Empty, the Wall, another Clone, a
// Void, or the transient effect particles (Blast/Ember/Spark).
/** Exported so the UI's 더블클릭 Clone shortcut (MaterialPalette.svelte) can
 *  check up front whether a material is a valid latch target, instead of
 *  pre-seeding `aux` with an id Clone itself would never adopt. */
export function canAdopt(id: number): boolean {
  if (id === EMPTY || id === CLONE.id || id === VOID.id) return false;
  if (id === BLAST.id || id === EMBER.id || id === SPARK.id) return false;
  return !getMaterial(id).isWall;
}

/**
 * 방출 밀도 — chance that one open orthogonal neighbor receives a copy on any
 * given tick. Clone used to fill *every* open neighbor every tick, which made a
 * single block a firehose: a Clone latched onto water flooded a room faster than
 * the liquid could spread out of the way, so the emitter was always buried in
 * its own output and there was nothing to watch. Metering it turns the same
 * block into a spring — the output has room to flow, fall and react before the
 * next copy lands on top of it.
 *
 * It only changes the *rate*, never the reach: the source is still infinite and
 * still fills the same space given time, and a Clone walled in by its own
 * material still tops it up as fast as it drains. Per-neighbor rather than
 * per-cell so a Clone with one open side isn't throttled the same as one
 * standing in open air.
 */
const EMIT_CHANCE = 0.25;

function updateClone(x: number, y: number, sim: SimContext): void {
  let adopted = sim.getAux(x, y);

  if (adopted === EMPTY) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (canAdopt(nid)) {
        adopted = nid;
        sim.setAux(x, y, nid);
        break;
      }
    }
    if (adopted === EMPTY) return; // nothing to copy yet
  }

  // Emit a copy of the adopted material into each open orthogonal neighbor —
  // metered, so a source pours at a watchable rate instead of instantly (see
  // EMIT_CHANCE).
  for (const [dx, dy] of DIR4) {
    if (Math.random() >= EMIT_CHANCE) continue;
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
      sim.spawn(nx, ny, adopted);
    }
  }
}

export const CLONE = register({
  id: 49,
  name: 'Clone',
  phase: Phase.Solid,
  color: rgb(228, 110, 200),
  density: 1000,
  acidResistant: true,
  indestructible: true,
  category: 'exotic',
  thermal: { conductivity: 0.2 },
  update: updateClone,
});
