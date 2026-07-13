import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { clampTo, clampV, cellsThisTick, decodeFlight, encodeFlight } from './ballistic';

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
// gradient); the per-axis clamp in ballistic.ts caps it at 6 cells/tick anyway.
const LIFE_MIN = 9;
const LIFE_VAR = 8; // 9..16 ticks — long enough to ride the boosted vertical to
// its apex (~12 ticks at the clamp) while still a snappy arc, not a floaty hang
const BASE_SPEED_Q = 5; // baseline outward speed (quarter-cells/tick)
const GAIN_Q = 2; // + this per unit of remaining outward budget
const JITTER_Q = 3; // per-axis scatter so a flung pile fans out
const UP_BIAS_Q = 5; // upward loft added to every fragment, so the spray fountains up
// Spray composition: most fragments erupt STRAIGHT UP (the tall central column),
// the rest fly out on ~45° diagonals to the sides (the skirt of the splash).
// Rolled per fragment at launch, so a burst reads as one dominant vertical
// plume flanked by a thinner fan instead of a uniform half-dome.
const VERTICAL_CHANCE = 0.7; // 70% up, 30% side diagonals
// The vertical column gets an extra kick (×1.5 of the shock speed) so it towers
// well above the diagonal skirt; the skirt's final per-axis LAUNCH velocity
// saturates at the pre-boost ceiling (the old shared clamp), so raising V_MAX_Q
// only made the column launch taller — the sides launch exactly as before.
// In-flight gravity is a different story, deliberately: every fragment's FALL
// may now build to the full V_MAX_Q (6 cells/tick, was 4), because a column
// hurled up at 6 cells/tick that drifted back down at 4 would look floaty —
// the descent mirrors the ascent.
const VERTICAL_BOOST_NUM = 3; // ×3/2
const DIAG_MAX_AXIS_Q = 16; // the skirt's per-axis launch ceiling (the old clamp)
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
 * fragment. Every launch is UPWARD (the solid ground reflects a downward push,
 * so nothing is driven into the floor): VERTICAL_CHANCE of fragments take the
 * full speed straight up (the central column) and the rest fly a ~45° diagonal,
 * siding with the shock's outward normal (entryDx) so the left flank of a blast
 * sprays left — together a tall plume with a thinner skirt, like a real splash.
 * `outB` (remaining outward budget) sets the speed, fiercest at the epicenter.
 * Called from `detonate`'s default cell handler (blast.ts) for each loose
 * powder/liquid/gas cell a blast is too weak to destroy.
 */
export function launchDebris(
  sim: SimContext,
  x: number,
  y: number,
  origId: number,
  entryDx: number,
  _entryDy: number, // kept for call-site symmetry; every launch is upward now
  outB: number,
): void {
  const speedQ = BASE_SPEED_Q + Math.round(outB) * GAIN_Q;
  const jitterSpan = JITTER_Q * 2 + 1;
  let vxQ: number;
  let vyQ: number;
  if (sim.chance(VERTICAL_CHANCE)) {
    // Straight up, boosted ×1.5: the column is the show, so it rides the full
    // velocity clamp near the epicenter. Jitter only sideways (it keeps a
    // column from stacking into a single line of cells).
    vxQ = clampV(sim.randInt(jitterSpan) - JITTER_Q);
    const upSpeedQ = ((speedQ * VERTICAL_BOOST_NUM) >> 1) + UP_BIAS_Q;
    vyQ = clampV(-upSpeedQ + sim.randInt(jitterSpan) - JITTER_Q);
  } else {
    // ~45° diagonal: the speed split across both axes (×3/4 ≈ 1/√2 per axis so
    // the diagonal covers the same ground). Side follows the shock's outward
    // normal when it has one; a fragment shoved purely vertically picks a side
    // at random so a centered burst still fans both ways. Both FINAL components
    // (bias and jitter included) saturate at the pre-boost ceiling — exactly
    // where the old shared clamp flattened them — so the skirt stays the modest
    // 45° fan it always was and only the column got taller.
    const side = entryDx !== 0 ? entryDx : sim.chance(0.5) ? 1 : -1;
    const axisQ = (speedQ * 3) >> 2;
    vxQ = clampTo(side * axisQ + sim.randInt(jitterSpan) - JITTER_Q, DIAG_MAX_AXIS_Q);
    vyQ = clampTo(
      -(axisQ + UP_BIAS_Q) + sim.randInt(jitterSpan) - JITTER_Q,
      DIAG_MAX_AXIS_Q,
    );
  }
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

/** Default coefficient of restitution for a fragment whose carried material sets
 *  no `elasticity` — sheds ~1/4 of its speed on a bounce, the ricochet feel every
 *  pre-existing blast was tuned against. */
const DEBRIS_RESTITUTION = 0.75;

/** Reflect a velocity component off a solid, keeping the fraction `restitution`
 *  of its speed (the carried material's 탄성): a springy grain (near 1) ping-pongs
 *  for its whole flight, a dead one settles after a bounce or two as small speeds
 *  decay to a stop. */
function bounceV(vQ: number, restitution: number): number {
  return clampV(-((vQ * restitution) | 0));
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
  // The carried material's 탄성 (elasticity) sets how bouncy this fragment is when
  // it ricochets off a solid — a springy material keeps most of its speed, a dull
  // one thuds and settles. Read from the origin id it's carrying in aux.
  const restitution = getMaterial(origId).elasticity ?? DEBRIS_RESTITUTION;
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
      if (nx !== cx) vxQ = bounceV(vxQ, restitution); // solid container edge: ricochet back in
      if (ny !== cy) vyQ = bounceV(vyQ, restitution);
      break;
    }
    if (passableForDebris(sim, nx, ny)) {
      sim.swap(cx, cy, nx, ny); // fragment advances; whatever was there slides to its trail
      cx = nx;
      cy = ny;
      continue;
    }
    // A solid it can't pass: ricochet off the blocked axes and stop this tick.
    if (nx !== cx) vxQ = bounceV(vxQ, restitution);
    if (ny !== cy) vyQ = bounceV(vyQ, restitution);
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
