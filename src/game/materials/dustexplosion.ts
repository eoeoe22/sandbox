import { DIR8 } from '../engine/directions';
import { EMPTY, Phase, type MatId } from '../engine/types';
import type { SimContext } from '../engine/SimContext';
import { getMaterial } from './registry';
import { igniterAdjacent } from './deflagrate';
import { FIRE } from './fire';

// 분진 폭발 (dust explosion) — the shared rule behind every powder in this world
// whose *pile* is stubborn but whose *cloud* is a bomb.
//
// The difference is real and it is entirely about surface area meeting oxygen: a
// grain in a heap is shielded by the grains around it, a grain suspended in air
// is not. So the rule is gated strictly on suspension, and nothing else about
// the material changes. A pile behaves exactly as it always did — this is
// checked *before* the material's ordinary burn step, but only ever fires for a
// grain that is genuinely falling through open air, which no cell in a heap ever
// is. That gate is what lets a powder keep its identity (알루미늄 가루 is the
// palette's most stubborn fuel; 밀가루 heaped up will not burn at all) while
// still giving it the one scene it was missing.
//
// What makes it playable is that the game already has the disperser: the Fan
// (fan.ts) blows loose powder around, so **팬 + 가루 + 불씨** is a complete build
// out of materials that were all already here. A Spark is deliberately not a
// trigger — electricity in this game never lights an ordinary fuel directly (see
// spark.ts's arc phase), so the electric route is the honest one: heat a Nichrome
// coil or point a Heat Ray into the cloud.
//
// This lived inside aluminumdust.ts while aluminum dust was the only material
// that did it. Flour is the second, and it is not aluminum: its cloud lights
// cooler, its fireball is an organic 800°-band flame rather than a 1700° metal
// one, and a flashed grain leaves scorched residue behind. Those three numbers
// are what `DustFlash` carries; everything else — what counts as suspended, how
// far the front reaches, how the fireball is thrown — is the same rule and lives
// here once.

/** Of the 8 neighbours, how many must be open (see `isOpen`) before a grain counts as
 *  suspended rather than part of a heap. The "nothing underneath it" test below
 *  is what actually does the work — every grain in a heap is supported, so this
 *  second gate only rules out matter packed *around* a falling grain: a pour
 *  running down a one-cell shaft, or a column of dust dropping as a block. Four
 *  is deliberately loose enough to admit a dense cloud (a grain with open air N/
 *  S/E/W and other grains on the diagonals is very much airborne) while still
 *  needing half of the neighbourhood to be air. */
const SUSPENDED_MIN_EMPTY = 4;
/** Per open neighbouring cell, the chance a flashing grain throws Fire into it.
 *  Well under 1 so a cloud costs a bounded number of extra cells (a grain has at
 *  most 8 open neighbours and most of them are shared with the next grain over),
 *  but high enough that the front reliably jumps the gaps in a loose cloud. */
const FIREBALL_CHANCE = 0.4;
/** How far the flash hands itself on, in cells (a (2·R+1)² box). See the note in
 *  `tryDustExplosion` — the front travels through the burning air between grains,
 *  so it has to be able to cross the gaps in a dispersed cloud. */
const FRONT_REACH = 2;

/** One dust's own numbers for the flash. Everything else about the rule is
 *  shared — see the module note for why exactly these three differ per powder. */
export interface DustFlash {
  /** Self temperature at which a *suspended* grain flashes with no flame on it.
   *  Set it far under whatever a packed heap of the same powder needs: that
   *  higher number exists to model grains shielded inside a pile, and a grain
   *  hanging in air with oxygen on every side has no such excuse. Keep it under
   *  any melt point the powder has too, so an airborne grain always flashes
   *  rather than melting. */
  flashTemp: number;
  /** Temperature the flame left behind starts at — what this powder's whole
   *  grain burning at once actually produces (1700° for a metal dust, an
   *  ordinary 900° fire band for an organic one). */
  pinTemp: number;
  /** Scorched remains a flashed grain leaves instead of the flame, and the
   *  per-grain chance of it. Omit for a powder that leaves nothing (a metal dust
   *  burns to an oxide this world doesn't model). */
  residue?: { id: () => MatId; chance: number };
}

/** True when a cell is something a grain falls straight through: empty, or any
 *  gas. Gases have to count — the moment the first grain goes off, the cloud is
 *  full of Fire and Smoke, and a test that read those as *support* would decide
 *  the rest of the cloud had landed and stop the chain dead in the middle of its
 *  own fireball. Liquids deliberately do NOT count: dust sinking through water
 *  is wet dust, not a suspension, and it should not go off. */
function isOpen(x: number, y: number, sim: SimContext): boolean {
  if (sim.isEmpty(x, y)) return true;
  return getMaterial(sim.get(x, y)).phase === Phase.Gas;
}

/** True when the grain at (x,y) is airborne — nothing supporting it downhill of
 *  gravity, and open air all around. Both halves matter: the support test alone
 *  would count a grain sliding down the face of a heap, and the open-air count
 *  alone would count the top grain of a one-cell tower. */
export function isSuspended(x: number, y: number, sim: SimContext): boolean {
  const bx = x + sim.gravityX;
  const by = y + sim.gravityY;
  // Out of bounds counts as support: with the default `wall` border the grid
  // edge *is* the floor, so a grain resting on it is piled, not flying.
  if (!sim.inBounds(bx, by) || !isOpen(bx, by, sim)) return false;
  let open = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && isOpen(nx, ny, sim)) open++;
  }
  return open >= SUSPENDED_MIN_EMPTY;
}

/**
 * Flash a suspended dust grain, and hand the front to every suspended grain
 * touching it. Returns true if the cell went off (it is Fire or residue now, so
 * the caller must stop); false for a grain that is piled, unlit, or both.
 *
 * The chain is deliberately deterministic rather than a `burnChance` roll — a
 * dust explosion propagates through a cloud in a blink, which is the entire
 * difference between it and the slow surface front `combustion.ts` models. It
 * stays bounded because it only ever reaches *airborne* neighbours: the front
 * dies the instant it runs into a heap, so a cloud consumes itself and nothing
 * more.
 */
export function tryDustExplosion(x: number, y: number, sim: SimContext, spec: DustFlash): boolean {
  if (!isSuspended(x, y, sim)) return false;
  if (sim.getTemp(x, y) < spec.flashTemp && !igniterAdjacent(x, y, sim)) return false;

  // Pass the front on before consuming this cell, two ways.
  //
  //  • Every *airborne* grain of the same dust within FRONT_REACH is pinned hot
  //    enough that its own turn flashes it. Piled grains are skipped outright — a
  //    cloud going off over a heap must not light the heap by this path (it can
  //    still catch the ordinary way, from the flames left behind).
  //
  //    The reach is 2 rather than the usual 8-neighbourhood on purpose, and it is
  //    the difference between the rule working and not: what burns in a dust
  //    explosion is the *air between the grains*, so the front crosses gaps that
  //    a grain-to-grain rule cannot. A cloud loose enough to be interesting has a
  //    cell or two of air between grains, and with a touching-only chain the
  //    best-dispersed cloud — the one that should go off hardest — was the one
  //    that barely burned (measured: a front that stalled with ~40% of the cloud
  //    still unlit and drifting through its own fire).
  //  • The open air immediately around it takes a lick of Fire — the fireball,
  //    and the thing that lights whatever the cloud was hanging over.
  const id = sim.get(x, y);
  for (let dy = -FRONT_REACH; dy <= FRONT_REACH; dy++) {
    for (let dx = -FRONT_REACH; dx <= FRONT_REACH; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (nid === id) {
        if (!isSuspended(nx, ny, sim)) continue;
        if (sim.getTemp(nx, ny) < spec.flashTemp) sim.setTemp(nx, ny, spec.flashTemp);
      } else if (nid === EMPTY && dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1) {
        if (sim.chance(FIREBALL_CHANCE)) sim.spawn(nx, ny, FIRE.id);
      }
    }
  }

  // The grain itself is gone in one flash — not a fuel cell that smoulders, the
  // way `combustion.ts` keeps a lit heap burning. In-place `set` on the cell's
  // own turn, so nothing re-processes it this tick. A powder that leaves residue
  // drops it here instead of the flame, so a flashed cloud rains a little soot
  // rather than vanishing outright.
  if (spec.residue !== undefined && sim.chance(spec.residue.chance)) {
    sim.set(x, y, spec.residue.id());
    sim.setAux(x, y, 0);
    sim.setTemp(x, y, spec.pinTemp);
    return true;
  }
  sim.set(x, y, FIRE.id);
  sim.setTemp(x, y, spec.pinTemp);
  return true;
}
