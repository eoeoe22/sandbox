import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import {
  GRAVITY_Q,
  clampV,
  cellsThisTick,
  decodeFlight,
  encodeFlight,
  walkFlight,
  advanceFlight,
} from './ballistic';

// Debris — the grain a weak blast flings instead of erasing. Ballistic
// like an Ember, but where an ember *smashes* on impact, a debris fragment
// *restores* the material it carries: the original powder/liquid id rides in the
// cell's `aux`, and when the fragment lands (or its flight expires) it deposits
// that material again. So a concussion tosses sand and water up and out on a
// parabolic arc and they rain back down and re-settle — the world is rearranged,
// not emptied, and total mass is conserved (each fragment becomes exactly one
// grain again). Heavier than an ember: gravity bites every tick, so it flies a
// real arc that falls back to the ground rather than a mostly-flat beam.
//
// It is never painted from the palette (like Ember/Spark it only exists mid-
// flight); a fragment placed by hand has aux 0 / life 0 and vanishes at once.
// The flight bookkeeping is the shared ballistic core (velocity+life packed in
// `temp`, conductivity 0); only the launch and the deposit-on-land are its own.

// Launch tuning. Speed rises with the blast's remaining budget, so the push is
// fiercest right at the epicenter and gentle at the rim (a real pressure
// gradient); the per-axis clamp in ballistic.ts caps it at 4 cells/tick anyway.
const LIFE_MIN = 14;
const LIFE_VAR = 12; // 14..25 ticks of flight — long enough to arc and fall back
const BASE_SPEED_Q = 5; // baseline outward speed (quarter-cells/tick)
const GAIN_Q = 2; // + this per unit of remaining outward budget
const JITTER_Q = 3; // per-axis scatter so a flung pile fans out
const UP_BIAS_Q = 2; // slight loft, so grains rise before they fall

/**
 * Fling the cell at (x,y) — currently holding material `origId` — outward as a
 * Debris fragment along the shock's outward normal (entryDx,entryDy). At the
 * very epicenter (0,0) there's no outward direction, so it lofts up-and-out in a
 * random horizontal. Called from `detonate`'s default cell handler (blast.ts) for
 * each loose powder/liquid/gas cell a blast is too weak to destroy.
 */
export function launchDebris(
  sim: SimContext,
  x: number,
  y: number,
  origId: number,
  entryDx: number,
  entryDy: number,
  outB: number,
): void {
  let dirX = entryDx;
  let dirY = entryDy;
  if (dirX === 0 && dirY === 0) {
    dirX = sim.chance(0.5) ? 1 : -1;
    dirY = -1;
  }
  let speedQ = BASE_SPEED_Q + Math.round(outB) * GAIN_Q;
  // Diagonal launches cover √2 more ground; scale down so the spray reads round.
  if (dirX !== 0 && dirY !== 0) speedQ = (speedQ * 3) >> 2;
  const jitterSpan = JITTER_Q * 2 + 1;
  const vxQ = clampV(dirX * speedQ + sim.randInt(jitterSpan) - JITTER_Q);
  const vyQ = clampV(dirY * speedQ + sim.randInt(jitterSpan) - JITTER_Q - UP_BIAS_Q);
  sim.spawn(x, y, DEBRIS.id);
  sim.setTemp(x, y, encodeFlight(LIFE_MIN + sim.randInt(LIFE_VAR), vxQ, vyQ));
  sim.setAux(x, y, origId); // the material to rain back down (material ids fit a byte)
}

/** Put the carried material back: at the last open cell (cx,cy) on the flight
 *  path when it hit something, clearing the fragment's own cell first if it
 *  moved. spawn() gives the restored grain a fresh init temp / tint. */
function settle(sim: SimContext, x: number, y: number, cx: number, cy: number, origId: number): void {
  if (cx !== x || cy !== y) {
    sim.set(x, y, EMPTY);
    sim.spawn(cx, cy, origId);
  } else {
    sim.spawn(x, y, origId);
  }
}

function updateDebris(x: number, y: number, sim: SimContext): void {
  const origId = sim.getAux(x, y);
  if (origId === EMPTY) {
    // Malformed (hand-placed, or a corrupt reload with no carried id): nothing
    // to deposit, so it simply vanishes.
    sim.set(x, y, EMPTY);
    return;
  }
  const st = decodeFlight(sim.getTemp(x, y));
  if (st.life < 1) {
    // Flight spent midair → the grain rains out right here.
    sim.spawn(x, y, origId);
    return;
  }
  const vxQ = st.vxQ;
  const vyQ = clampV(st.vyQ + GRAVITY_Q); // full gravity every tick → a falling arc

  // The shared straight-line walk handles the flight; the fragment re-deposits
  // its carried grain wherever it lands (void edge just drops it out of world).
  walkFlight(sim, x, y, cellsThisTick(sim, vxQ), cellsThisTick(sim, vyQ), {
    siblingId: DEBRIS.id,
    onImpact(sim, x, y, cx, cy) {
      settle(sim, x, y, cx, cy, origId);
    },
    onArrive(sim, x, y, cx, cy) {
      advanceFlight(sim, x, y, cx, cy, DEBRIS.id, encodeFlight(st.life - 1, vxQ, vyQ));
      sim.setAux(cx, cy, origId); // carry the material id along on the move
    },
  });
}

export const DEBRIS = register({
  id: 73,
  name: 'Debris',
  phase: Phase.Gas,
  color: rgb(150, 130, 110), // dull thrown-earth tone
  density: 1,
  category: '폭발',
  // conductivity 0 keeps the heat pass off `temp`, which holds the packed
  // life+velocity; init 0 → life 0 so a hand-placed fragment dies immediately.
  thermal: { init: 0, conductivity: 0 },
  update: updateDebris,
});
