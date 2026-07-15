import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';
import { BLAST, detonate, type DetonateOptions } from './blast';
import { launchGel } from './napalmgel';

// Napalm incendiary (네이팜 소이탄) — the charge that trades destruction for
// *fire*. It carves no crater: a small self-contained flood sets fuel alight,
// dusts open air with flame, and merely scorches anything that won't burn, then
// its rim flings sticky Napalm Gel that clings and burns for seconds (see
// napalmgel.ts). The result is a slow wildfire rather than a bang — and, because
// the gel shrugs off water, the first charge where a bucket of water isn't the
// whole answer. Built on the `detonate` seam (blast.ts): a fixed small reach, a
// low cell cap so it can't run the whole screen, an igniting `onCell`, and a gel
// rimHandler.
const REACH = 6;
const MAX_CELLS = 200;
const AUTOIGNITE_TEMP = 240;
const HEAT_BUMP = 250; // non-flammable cells are only scorched, never cratered
const EMPTY_FIRE_CHANCE = 0.3; // open air catches a lick of flame this often
const GEL_RIM_CHANCE = 1.0; // rim cells that fling a sticky gel blob

/** Per-cell rule for a napalm flood — see DetonateOptions.onCell. Always claims
 *  the cell (no default crater flash is ever dropped). */
function napalmCell(sim: SimContext, x: number, y: number, prevId: number): boolean {
  if (prevId === EMPTY) {
    if (sim.chance(EMPTY_FIRE_CHANCE)) sim.spawn(x, y, FIRE.id);
    return true;
  }
  const m = getMaterial(prevId);
  // Fuel — and the napalm charge itself — is set alight. Consuming the charge
  // into Fire also stops the source cell from re-triggering next tick.
  if (prevId === NAPALM.id || m.combustible || m.flammable) {
    sim.spawn(x, y, FIRE.id);
    return true;
  }
  // Everything else (stone, metal, water, …) isn't cratered — just scorched, so
  // napalm is about the fire it starts, not the hole it digs (크레이터 0).
  sim.setTemp(x, y, sim.getTemp(x, y) + HEAT_BUMP);
  return true;
}

function napalmRim(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  if (sim.chance(GEL_RIM_CHANCE)) launchGel(sim, x, y, dirX, dirY);
}

const NAPALM_OPTS: DetonateOptions = {
  reach: REACH,
  maxCells: MAX_CELLS,
  onCell: napalmCell,
  rimHandler: napalmRim,
};

function updateNapalm(x: number, y: number, sim: SimContext): void {
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
        nid === MOLTEN_METAL.id ||
        nid === MOLTEN_GLASS.id
      ) {
        trigger = true;
        break;
      }
    }
  }

  if (trigger) detonate(sim, x, y, 0, NAPALM_OPTS);
  // Otherwise it just sits there — a Solid has no phase-default movement.
}

export const NAPALM = register({
  id: 77,
  name: 'Napalm',
  phase: Phase.Solid,
  color: rgb(204, 112, 40), // incendiary orange
  density: 1000,
  explosive: true,
  blastRadius: REACH,
  category: '폭발',
  thermal: { conductivity: 0.3 },
  update: updateNapalm,
});
