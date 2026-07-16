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
const MAX_CELLS = 200; // per-source flood budget (own R6 disc; see soloSource below)
// A fused pile of napalm should go up as ONE simultaneous cluster burst, not
// dribble outward over many ticks — but every member still needs its own full,
// uniform R6 flourish (see CLUSTER_CAP's caller, igniteCluster). Fixed cap on
// how many connected napalm cells join one simultaneous burst, trimmed a bit
// below the old de-facto ~200 so a big pile's instant gel/flame volley stays
// readable instead of flooding the screen at once (기획: 클러스터 규모 소폭 축소).
const CLUSTER_CAP = 120;
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
  // A fused blob of napalm is `explosive`, so without this a single detonate()
  // call would sweep the whole connected pile into one shared mass survey —
  // and with maxCells this tight, that mass alone eats the budget near
  // whichever cell it started from, starving every other member's R6
  // flourish (see DetonateOptions.soloSource). igniteCluster below instead
  // calls detonate() once per member with soloSource, so every cell in the
  // simultaneous burst gets its own complete, uniform fireball.
  soloSource: true,
};

/** Collect up to CLUSTER_CAP connected (8-way) Napalm cells starting at
 *  (x0,y0) — the pile that should go off together as one instantaneous
 *  cluster burst. Capped so a screen-filling pile doesn't light wall-to-wall
 *  in a single tick; a pile larger than the cap still burns in full, just
 *  over a couple of ticks as the unclaimed remainder re-triggers off the
 *  fire this burst leaves behind. */
function collectCluster(sim: SimContext, x0: number, y0: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [[x0, y0]];
  const seen = new Set<number>([y0 * sim.width + x0]);
  let head = 0;
  while (head < cells.length && cells.length < CLUSTER_CAP) {
    const [x, y] = cells[head++];
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const key = ny * sim.width + nx;
      if (seen.has(key)) continue;
      seen.add(key);
      if (sim.get(nx, ny) === NAPALM.id) cells.push([nx, ny]);
    }
  }
  return cells;
}

/** Detonate a whole connected napalm pile at once: every member (up to
 *  CLUSTER_CAP) gets its own soloSource blast in the SAME tick, so the
 *  cluster reads as one simultaneous burst rather than a fire creeping across
 *  it tick by tick. Neighboring members' discs overlap heavily, so most cells
 *  are already Fire by the time their own turn comes — skip those rather than
 *  re-flooding ground this same burst already claimed. */
function igniteCluster(sim: SimContext, x0: number, y0: number): void {
  for (const [cx, cy] of collectCluster(sim, x0, y0)) {
    if (sim.get(cx, cy) === NAPALM.id) detonate(sim, cx, cy, 0, NAPALM_OPTS);
  }
}

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

  if (trigger) igniteCluster(sim, x, y);
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
