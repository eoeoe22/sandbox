import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { clampV, cellsThisTick, decodeFlight, encodeFlight } from './ballistic';

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
const LIFE_MIN = 7;
const LIFE_VAR = 8; // 7..14 ticks — a quick, snappy arc, not a floaty hang
const BASE_SPEED_Q = 5; // baseline outward speed (quarter-cells/tick)
const GAIN_Q = 2; // + this per unit of remaining outward budget
const JITTER_Q = 3; // per-axis scatter so a flung pile fans out
const UP_BIAS_Q = 5; // upward loft added to every fragment, so the spray fountains up
// Debris falls harder than a light Ember (which drifts on alternate ticks): a
// brisk parabola that peaks fast and comes back down quickly, so a burst resolves
// in well under a second instead of hanging in the air.
const GRAVITY_Q = 2;
// A fragment whose speed has dropped to essentially zero on BOTH axes (apex of a
// slow lob, or spent after a few bounces) settles now rather than hovering out
// the rest of its life — keeps the burst snappy. Testing both axes (not their
// sum) matters: a fresh side-launched fragment has |vx|≈2 with vy≈0, and must NOT
// be caught here on its first tick, or it would deposit without ever flying.
const STILL_Q = 1;
// A shoved *liquid* transmits the impulse up its column instantly (liquids are
// incompressible): a freshly launched submerged fragment swaps straight up
// through the liquid above it within the launch tick, surfacing at once — so an
// underwater concussion erupts a water column on the very next frame, instead of
// each fragment crawling upward at flight speed (invisible inside like-colored
// water, and usually expiring before it ever reached air). The climb is capped
// in cells per unit of remaining shove budget, so only the blast's core punches
// to the surface and a charge set too deep merely churns the depths. Swapping
// conserves mass: the column above slides down one cell into the fragment's wake.
const JET_CELLS_PER_OUT = 4;

/**
 * Fling the cell at (x,y) — currently holding material `origId` — as a Debris
 * fragment. The horizontal launch follows the shock's outward normal (entryDx),
 * so a pile fans out left/right; the *vertical* launch is always UP, because the
 * solid ground reflects a downward push — so instead of driving half the ejecta
 * into the floor (a symmetric X-spray), the burst fountains up and out, like a
 * real splash. `outB` (remaining outward budget) sets the speed, fiercest at the
 * epicenter. Called from `detonate`'s default cell handler (blast.ts) for each
 * loose powder/liquid/gas cell a blast is too weak to destroy.
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
  const dirX = entryDx; // horizontal spreads along the shock's outward normal
  let speedQ = BASE_SPEED_Q + Math.round(outB) * GAIN_Q;
  // Diagonal launches cover √2 more ground; scale down so the spray reads round.
  if (dirX !== 0 && entryDy !== 0) speedQ = (speedQ * 3) >> 2;
  const jitterSpan = JITTER_Q * 2 + 1;
  const vxQ = clampV(dirX * speedQ + sim.randInt(jitterSpan) - JITTER_Q);
  // Always upward: the vertical push magnitude, reflected up, plus a loft bias —
  // a fragment shoved straight down (below the charge) erupts up too. The jitter
  // keeps a straight-up column from stacking in one line.
  const upSpeedQ = Math.abs(entryDy) * speedQ + UP_BIAS_Q;
  const vyQ = clampV(-upSpeedQ + sim.randInt(jitterSpan) - JITTER_Q);
  sim.spawn(x, y, DEBRIS.id);
  sim.setTemp(x, y, encodeFlight(LIFE_MIN + sim.randInt(LIFE_VAR), vxQ, vyQ));
  sim.setAux(x, y, origId); // the material to rain back down (material ids fit a byte)

  // Incompressible jet: surface a submerged liquid fragment now (see
  // JET_CELLS_PER_OUT). Swaps carry the packed flight state and aux along, and
  // stop at anything non-liquid — air (surfaced), a stacked sibling fragment
  // (the forming column), a solid lid, or a frozen (hardened) liquid.
  if (getMaterial(origId).phase === Phase.Liquid) {
    let climb = Math.round(outB) * JET_CELLS_PER_OUT;
    let jy = y;
    while (climb-- > 0 && jy > 0) {
      const aid = sim.get(x, jy - 1);
      if (aid === EMPTY || getMaterial(aid).phase !== Phase.Liquid) break;
      if (sim.isFrozen(x, jy - 1)) break;
      sim.swap(x, jy, x, jy - 1);
      jy--;
    }
  }
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
  let vyQ = clampV(st.vyQ + GRAVITY_Q); // brisk gravity every tick → a quick arc
  if (Math.abs(vxQ) <= STILL_Q && Math.abs(vyQ) <= STILL_Q) {
    // Momentum spent on both axes → settle now instead of hovering, so the burst
    // doesn't linger. (A freshly launched fragment always has speed on at least
    // one axis, so it never lands here before flying — see STILL_Q.)
    sim.spawn(x, y, origId);
    return;
  }

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
  color: rgb(150, 130, 110), // fallback tone (drawn only if aux carries no material)
  density: 1,
  category: '폭발',
  // A fragment draws as the material it's carrying (its origin id, in aux) —
  // shoved water flies blue, sand flies tan — not as a uniform grey grain.
  renderAsAux: true,
  // conductivity 0 keeps the heat pass off `temp`, which holds the packed
  // life+velocity; init 0 → life 0 so a hand-placed fragment dies immediately.
  thermal: { init: 0, conductivity: 0 },
  update: updateDebris,
});
