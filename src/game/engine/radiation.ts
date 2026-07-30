import type { SimContext } from './SimContext';
import { EMPTY, Phase, type Material } from './types';
import { getMaterial } from '../materials/registry';
import { DIR8 } from './directions';

// 방사선 피폭 — the tag-driven pass that makes the 방사능 palette tab lethal to the
// 생명 tab. Every radioactive material (U235, U238, both melts, Nuke Waste)
// declares `Material.radiation`, its dose at one step; every living material
// declares `Material.radiationDeath` (the remains it leaves) or
// `Material.radiationHit` (its own damage model). Neither side names the other,
// so the roster on each can grow without the other being edited — the same tag
// discipline `flammable`/`combustible` use.
//
// Simulation drives `irradiate` from its per-cell scan off a flattened per-id
// dose table (mirroring how `Material.life` decay is driven), so a radioactive
// material has nothing to call in its own `update` and cannot silently forget to.
//
// (Chlorine kills living matter too, but off its own hardcoded id list — gassing a
// reef erases it rather than bleaching it, which is a different rule, so the two
// deliberately don't share a roster. A new living material needs a look at
// chlorine.ts as well as a tag here.)
//
// ── 무엇이 막고 무엇이 통과하는가 ──────────────────────────────────────────────
//
// The emission is a breadth-first flood out of the source cell, and what it can
// flow through is the whole model:
//
//   • **고체만 막는다.** Stone, iron, concrete, Wall — and, since most living
//     things here are `Phase.Solid` too, a stand of plants shields what's behind
//     it. Everything else is transparent: air, gas, **powder and liquid alike**.
//     Sand shovelled over a waste drum is not shielding; a pool carries the dose
//     right across itself. Burying waste means casing it in something solid.
//   • **방사성 물질은 스스로를 막는다** (자기차폐). A material that declares
//     `radiation` is opaque to the flood, so a pile's interior grains are blocked
//     on every side and only its *surface* emits. That is real self-absorption in
//     a thick source, and it's also what bounds the cost: the work a body of fuel
//     does per tick scales with its surface area, not its volume, so a lake of
//     corium costs about what its shoreline costs.
//
// Distance is geodesic (steps through open matter, not line-of-sight), so a dose
// leaks around a corner along a water channel the way the Electromagnet's field
// and the Woofer's shockwave bend around theirs. Attenuation is `dose / d` rather
// than a true inverse square: 1순위 재미 — at the edge of RADIATION_RANGE an
// inverse square would be a rounding error, and a hot zone whose rim does nothing
// is a hot zone the player can't read.

/** How far an emission reaches, in steps of open matter. */
export const RADIATION_RANGE = 6;

// Flood scratch, reused across every call. The flood never leaves a
// (2R+1)×(2R+1) box around its source, so "visited" is a small local grid indexed
// relative to that source rather than anything grid-sized — clearing it is a
// 169-byte memset, and nothing here has to know how big the world is.
//
// The queue is sized to that same box and cannot overrun it: a cell is enqueued
// only on the transition that sets its `seen` byte, and the source's own byte is
// set before the loop starts, so across a whole flood there is at most one
// enqueue per box cell.
//
// Being module-level scratch, this is NOT re-entrant. Nothing re-enters it today
// — `irradiate` is called only from Simulation's per-cell scan, and the
// `radiationHit` hooks it dispatches to only write aux — but a hook that somehow
// caused another irradiation would corrupt the flood in progress. A hook is for
// recording damage on the cell it was handed; it must not set the world off.
const SPAN = RADIATION_RANGE * 2 + 1;
const CELLS = SPAN * SPAN;
const seen = new Uint8Array(CELLS);
const queueX = new Int32Array(CELLS);
const queueY = new Int32Array(CELLS);
const queueD = new Int32Array(CELLS);

/** Hand one arriving dose to a living cell: its own `radiationHit` model if it
 *  has one, else the `radiationDeath` kill roll.
 *
 *  The kill goes through `spawn`, which is the documented discipline for writing
 *  non-Empty material into a *neighbour* cell (see SimContext.spawn): it marks
 *  the cell moved so a fresh corpse doesn't also take its own turn this tick,
 *  clears the aux (the corpse inherits none of the living cell's packed state — a
 *  seed's germination progress, a plant's structure), and resets the temperature
 *  to the corpse material's own. That last one matters for consistency rather
 *  than for looks: `blastDeathId`, the sibling "kill a neighbour and leave
 *  remains" tag, spawns its remains too, so a plant cooked to 150° beside a waste
 *  cask leaves the same ambient Ash whether radiation or a blast finished it.
 *
 *  An EMPTY death takes plain `set` instead, which is stricter, not laxer:
 *  `set(EMPTY)` releases any 겹침 fluid the dead cell was hosting back into the
 *  world rather than destroying it with its host, and it deliberately leaves the
 *  cell unmarked — there's nothing there to guard, and marking it would block
 *  something from moving into the vacated cell for the rest of the tick (the same
 *  choice the engine's lifetime decay makes). */
function deliver(sim: SimContext, x: number, y: number, m: Material, dose: number): void {
  if (m.radiationHit !== undefined) {
    m.radiationHit(sim, x, y, dose);
    return;
  }
  const death = m.radiationDeath;
  if (death === undefined) return;
  if (!sim.chance(dose)) return;
  if (death === EMPTY) sim.set(x, y, EMPTY);
  else sim.spawn(x, y, death);
}

/**
 * Deliver one tick of this source's emission: flood out to RADIATION_RANGE
 * through everything that isn't a Solid or another radiation source, handing
 * `dose / d` to every living cell reached at distance `d`.
 *
 * Note the flood *delivers into* a blocker before refusing to continue through
 * it — a living cell is usually a Solid itself, so the near face of a hedge dies
 * while the rank behind it is shielded. Whether a cell blocks is read off the
 * material found there, before the delivery can transform it, so a plant turning
 * to Ash mid-flood doesn't retroactively open a hole this same tick.
 */
export function irradiate(x: number, y: number, sim: SimContext, dose: number): void {
  seen.fill(0);
  seen[RADIATION_RANGE * SPAN + RADIATION_RANGE] = 1;
  let head = 0;
  let tail = 0;
  queueX[tail] = x;
  queueY[tail] = y;
  queueD[tail] = 0;
  tail++;

  while (head < tail) {
    const cx = queueX[head];
    const cy = queueY[head];
    const cd = queueD[head];
    head++;
    if (cd === RADIATION_RANGE) continue;
    const d = cd + 1;
    for (const [dx, dy] of DIR8) {
      const nx = cx + dx;
      const ny = cy + dy;
      // Local (source-relative) index; out of the box ⇒ past the range.
      const lx = nx - x + RADIATION_RANGE;
      const ly = ny - y + RADIATION_RANGE;
      if (lx < 0 || ly < 0 || lx >= SPAN || ly >= SPAN) continue;
      const li = ly * SPAN + lx;
      if (seen[li] !== 0) continue;
      seen[li] = 1;
      if (!sim.inBounds(nx, ny)) continue;
      const m = getMaterial(sim.get(nx, ny));
      const blocks = m.phase === Phase.Solid || m.radiation !== undefined;
      deliver(sim, nx, ny, m, dose / d);
      if (blocks) continue;
      queueX[tail] = nx;
      queueY[tail] = ny;
      queueD[tail] = d;
      tail++;
    }
  }
}
