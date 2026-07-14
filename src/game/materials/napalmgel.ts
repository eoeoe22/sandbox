import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { AMBIENT_TEMP } from '../config';
import type { SimContext } from '../engine/SimContext';
import {
  GRAVITY_Q,
  clampTo,
  LEGACY_V_MAX_Q,
  cellsThisTick,
  decodeFlight,
  encodeFlight,
  launchBallistic,
  walkFlight,
  advanceFlight,
  type LaunchSpec,
} from './ballistic';
import { FIRE } from './fire';
import { SMOKE } from './smoke';
import { WATER } from './water';
import { SALTWATER } from './saltwater';

// Napalm gel — the sticky, clinging fire a Napalm shell sprays from its rim. It
// has two lives in one material, told apart by `aux`:
//
//   • Flying (aux 0): a ballistic blob lobbed from the crater rim, arcing out
//     like a bomblet (the shared flight core, velocity+life packed in `temp`).
//   • Burning (aux > 0): where it lands it *sticks and burns* for a good while
//     (aux counts the remaining ticks down from GEL_BURN_TICKS), wreathing itself
//     in flame and lighting nearby fuel. Crucially it is NOT put out by water —
//     it burns on the surface of a pool and clings to wet ground, so water stops
//     being the universal extinguisher. It's dense-but-floaty, so it rides on
//     water and only drips down through open air.
//
// Never painted from the palette (like Ember it only exists as thrown ejecta).

const GEL_LAUNCH: LaunchSpec = {
  speedMinQ: 6,
  speedVarQ: 5,
  jitterQ: 3,
  upBiasQ: 3,
  lifeMin: 8,
  lifeVar: 8,
};

/** How long a landed blob burns (ticks). Stored in aux, so it must fit a byte. */
const GEL_BURN_TICKS = 90;
/** On hitting water, the blob sticks and burns on the surface this often;
 *  otherwise it's washed out. Water is a *poor* extinguisher, not a perfect one. */
const GEL_WATER_PERSIST = 0.6;
/** Per open-neighbor per-tick chance a burning blob wreaths a lick of Fire. */
const GEL_WREATH_CHANCE = 0.3;
/** Per fuel-neighbor per-tick chance it pins that fuel hot enough to catch, so
 *  it lights what it's stuck directly against even with no air gap for flame. */
const GEL_IGNITE_CHANCE = 0.25;
/** Temperature it pins an adjacent fuel to — above every fuel's autoignition
 *  point (Coal, 580, is the highest) so the neighbor's own turn sees it burning. */
const GEL_IGNITE_TEMP = 850;
/** Chance a spent blob leaves a wisp of Smoke rather than clearing to air. */
const GEL_SMOKE_CHANCE = 0.3;

function isWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

/** Fling a flying gel blob from a napalm rim cell along its outward normal. */
export function launchGel(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  launchBallistic(sim, x, y, dirX, dirY, NAPALM_GEL.id, GEL_LAUNCH);
}

/** Convert (tx,ty) into a freshly landed, burning gel blob. */
function ignite(sim: SimContext, tx: number, ty: number): void {
  sim.spawn(tx, ty, NAPALM_GEL.id);
  sim.setAux(tx, ty, GEL_BURN_TICKS); // aux > 0 ⇒ the burning state
  sim.setTemp(tx, ty, AMBIENT_TEMP); // clear the packed flight state; aux runs the burn
}

/** Land at the last open cell (cx,cy) on the flight path, clearing the blob's
 *  own cell first if it travelled this tick. */
function land(sim: SimContext, x: number, y: number, cx: number, cy: number): void {
  if (cx !== x || cy !== y) sim.set(x, y, EMPTY);
  ignite(sim, cx, cy);
}

/** One tick of a flying (aux 0) gel blob. */
function updateFlying(x: number, y: number, sim: SimContext): void {
  const st = decodeFlight(sim.getTemp(x, y));
  if (st.life < 1) {
    // Flight spent midair → it congeals and starts burning right here.
    ignite(sim, x, y);
    return;
  }
  const vxQ = st.vxQ;
  // Heavy, gravity every tick; terminal fall pinned at the legacy ceiling this
  // particle was tuned for (the wider shared clamp is Debris-only).
  const vyQ = clampTo(st.vyQ + GRAVITY_Q, LEGACY_V_MAX_Q);

  // The shared straight-line walk handles the flight; the blob sticks where it
  // lands — and, unusually, mostly *sticks and burns on water's surface* rather
  // than being washed out (water is a poor extinguisher for napalm).
  walkFlight(sim, x, y, cellsThisTick(sim, vxQ), cellsThisTick(sim, vyQ), {
    siblingId: NAPALM_GEL.id,
    onImpact(sim, x, y, cx, cy, nx, _ny, nid) {
      // nx >= 0 is a real cell hit; nx < 0 is the wall edge (just stick there).
      if (nx >= 0 && isWater(nid)) {
        if (sim.chance(GEL_WATER_PERSIST)) land(sim, x, y, cx, cy);
        else sim.set(x, y, EMPTY);
        return;
      }
      land(sim, x, y, cx, cy);
    },
    onArrive(sim, x, y, cx, cy) {
      // aux stays 0 (still flying) — advanceFlight's spawn already zeroed it.
      advanceFlight(sim, x, y, cx, cy, NAPALM_GEL.id, encodeFlight(st.life - 1, vxQ, vyQ));
    },
  });
}

/** One tick of a landed, burning (aux > 0) gel blob. */
function updateBurning(x: number, y: number, sim: SimContext, timer: number): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      if (sim.chance(GEL_WREATH_CHANCE)) sim.spawn(nx, ny, FIRE.id);
    } else {
      const m = getMaterial(nid);
      if ((m.combustible || m.flammable) && sim.chance(GEL_IGNITE_CHANCE)) {
        // Pin the fuel hot so its own turn catches — lights what it clings to
        // even with no air gap between them.
        sim.setTemp(nx, ny, GEL_IGNITE_TEMP);
      }
    }
  }

  if (timer <= 1) {
    // Burned out → a wisp of Smoke or clean air.
    if (sim.chance(GEL_SMOKE_CHANCE)) sim.spawn(x, y, SMOKE.id);
    else sim.set(x, y, EMPTY);
    return;
  }
  sim.setAux(x, y, timer - 1);
  // Sticky and floaty: it drips straight down through open air but rides on
  // water (density below water's), so a blob on a pool keeps burning there.
  sim.moveDown(x, y);
}

function updateNapalmGel(x: number, y: number, sim: SimContext): void {
  const timer = sim.getAux(x, y);
  if (timer === 0) updateFlying(x, y, sim);
  else updateBurning(x, y, sim, timer);
}

export const NAPALM_GEL = register({
  id: 78,
  name: 'Napalm Gel',
  phase: Phase.Solid, // sticky: it isn't shoved around by fluids, and floats via density
  color: rgb(226, 118, 40), // clinging orange fire-gel
  density: 2, // lighter than water (3) → rides on the surface instead of sinking
  category: '폭발',
  colorVary: 24,
  // conductivity 0: the heat pass must leave `temp` alone while it holds the
  // packed flight state; init 0 → a stray blob (aux 0, life 0) congeals and
  // burns where it sits rather than flying off with garbage velocity.
  thermal: { init: 0, conductivity: 0 },
  packedTemp: true,
  update: updateNapalmGel,
});
