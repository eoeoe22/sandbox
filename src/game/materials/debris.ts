import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { GRAVITY_Q, clampV, cellsThisTick, decodeFlight, encodeFlight } from './ballistic';

// Debris — the grain a weak blast flings instead of erasing. It carries the
// original powder/liquid/gas id in `aux` and, when its flight expires, deposits
// that material again, so a concussion *rearranges* the world instead of emptying
// it and total mass is conserved (each fragment becomes exactly one grain again).
//
// Unlike Ember (which smashes the first thing it touches), a fragment has to fly
// out of a *dense burst*: a buried charge turns a whole solid disc of sand into
// fragments at once, and if each stopped at the first neighbor they'd all jam and
// just settle back in place — no scatter. So a fragment moves by SWAPPING: it
// passes *through* sibling fragments and any loose matter (powder/liquid/gas),
// trading places with them, so the packed cloud can expand and erupt (a buried
// blast fountains its ejecta up through the overburden). Only true solids
// (stone/metal/walls/packed charges) stop it, and those it *bounces* off — grains
// ricochet around for their whole flight and rain back down, rather than sticking
// on first contact. Swapping preserves each cell's temp/aux/tint, so it neither
// loses mass nor corrupts the packed flight state.
//
// Never painted from the palette (like Ember/Spark it only exists mid-flight); a
// fragment placed by hand has aux 0 / life 0 and vanishes at once. Velocity+life
// are packed in `temp` (conductivity 0) via the shared ballistic core.

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

/** A cell the flying fragment moves *through*, trading places with it: open air,
 *  a sibling fragment, or any loose matter (powder/liquid/gas). Only a true solid
 *  (stone/metal/wall/packed charge) stops it. This is what lets a dense burst
 *  expand — fragments swap past each other and the surrounding loose matter
 *  instead of jamming. */
function passableForDebris(sim: SimContext, nx: number, ny: number): boolean {
  const id = sim.get(nx, ny);
  return id === EMPTY || getMaterial(id).phase !== Phase.Solid;
}

/** Reflect a velocity component off a solid, shedding ~1/4 of its speed so the
 *  ricochet settles over a few bounces instead of ringing forever (small speeds
 *  decay to a stop). */
function bounceV(vQ: number): number {
  return clampV(-(((vQ * 3) / 4) | 0));
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
    // Flight spent → the grain lands right where it is (its own cell becomes the
    // carried material again). No move, so nothing to conserve against.
    sim.spawn(x, y, origId);
    return;
  }
  let vxQ = st.vxQ;
  let vyQ = clampV(st.vyQ + GRAVITY_Q); // full gravity every tick → a falling arc

  // Walk the straight-line path one cell at a time, swapping through everything
  // passable (air, siblings, loose matter) so a packed cloud can expand; bounce
  // off the first solid (or a wall edge) and stop advancing for this tick.
  const dxCells = cellsThisTick(sim, vxQ);
  const dyCells = cellsThisTick(sim, vyQ);
  const steps = Math.max(Math.abs(dxCells), Math.abs(dyCells));
  let cx = x;
  let cy = y;
  for (let s = 1; s <= steps; s++) {
    const nx = x + Math.round((dxCells * s) / steps);
    const ny = y + Math.round((dyCells * s) / steps);
    if (nx === cx && ny === cy) continue;
    if (!sim.inBounds(nx, ny)) {
      if (sim.borderMode === 'void') {
        sim.set(cx, cy, EMPTY); // flew out of an open border — the grain leaves the world
        return;
      }
      if (nx !== cx) vxQ = bounceV(vxQ); // solid container edge: ricochet back in
      if (ny !== cy) vyQ = bounceV(vyQ);
      break;
    }
    if (passableForDebris(sim, nx, ny)) {
      sim.swap(cx, cy, nx, ny); // fragment advances; whatever was there slides to its trail
      cx = nx;
      cy = ny;
      continue;
    }
    // A solid it can't pass: ricochet off the blocked axes and stop this tick.
    if (nx !== cx) vxQ = bounceV(vxQ);
    if (ny !== cy) vyQ = bounceV(vyQ);
    break;
  }
  sim.setTemp(cx, cy, encodeFlight(st.life - 1, clampV(vxQ), clampV(vyQ)));
  sim.setAux(cx, cy, origId); // origId rides along on the swap; re-stamp defensively
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
