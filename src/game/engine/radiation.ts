import type { SimContext } from './SimContext';
import { EMPTY } from './types';
import { getMaterial } from '../materials/registry';
import { DIR8 } from './directions';

// 방사선 피폭 — the tag-driven pass that makes the 방사능 palette tab lethal to the
// 생명 tab. Every radioactive material (U235, U238, both melts, Nuke Waste)
// declares `Material.radiation`, a per-tick per-neighbour dose; every living
// material declares `Material.radiationDeath`, the remains it leaves. Neither
// side names the other, so the roster on each can grow without the other being
// edited — the same tag discipline `flammable`/`combustible` use.
//
// Simulation drives `irradiate` from its per-cell scan off a flattened per-id
// dose table (mirroring how `Material.life` decay is driven), so a radioactive
// material has nothing to call in its own `update` and cannot silently forget
// to. Range is deliberately just the 8-neighbourhood: shielding is then free and
// legible — a single cell of anything between a waste drum and a reef stops the
// dose dead, so burying waste actually works.
//
// (Chlorine kills living matter too, but off its own hardcoded id list — gassing a
// reef erases it rather than bleaching it, which is a different rule, so the two
// deliberately don't share a roster. A new living material needs a look at
// chlorine.ts as well as a `radiationDeath` here.)
//
// A living material that wants to *feel* the dose rather than simply die of it
// reads `radiationLevel` from its own update instead of declaring
// `radiationDeath` — Coral does, feeding the dose into its existing 백화 stress
// so an irradiated reef whitens over time the way a drought-struck one does.

/**
 * Deliver one tick of this source's dose to its neighbours: every adjacent cell
 * whose material declares `radiationDeath` has a `chance` of dying into those
 * remains. Aux is cleared (the corpse inherits none of the living cell's packed
 * state — a coral's heading, a seed's germination progress) and the cell is
 * marked moved so a fresh corpse doesn't also take its own turn this tick,
 * matching `spawn`. An EMPTY death is left unmarked, exactly like the engine's
 * lifetime decay: there's nothing there to guard, and marking it would block
 * something from moving into the vacated cell for the rest of the tick.
 */
export function irradiate(x: number, y: number, sim: SimContext, chance: number): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (id === EMPTY) continue;
    const death = getMaterial(id).radiationDeath;
    if (death === undefined) continue;
    if (!sim.chance(chance)) continue;
    sim.set(nx, ny, death);
    if (death !== EMPTY) {
      sim.setAux(nx, ny, 0);
      sim.markMoved(nx, ny);
    }
  }
}

/**
 * The dose falling on (x,y) — the strongest `Material.radiation` among its eight
 * neighbours, or 0 when nothing radioactive is touching it. For a living
 * material that maps exposure onto its own damage model instead of dying
 * outright (Coral's 백화 stress); anything that just dies declares
 * `radiationDeath` and lets `irradiate` do it.
 */
export function radiationLevel(x: number, y: number, sim: SimContext): number {
  let best = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const r = getMaterial(sim.get(nx, ny)).radiation;
    if (r !== undefined && r > best) best = r;
  }
  return best;
}
