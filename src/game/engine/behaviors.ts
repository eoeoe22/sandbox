import type { SimContext } from './SimContext';
import { EMPTY, Phase } from './types';
import { DIR4, DIR8 } from './directions';
import { getMaterial } from '../materials/registry';

// Default per-cell update rules keyed by Phase. A material without its own
// `update` inherits one of these, so most materials are pure data (one file,
// no logic). Override `update` only for special behavior.

/**
 * With low probability, swap places with an adjacent cell of `otherId`.
 * SimContext.tryMove only ever lets same-phase fluids past each other when
 * their densities differ, so two liquids of *equal* density (e.g. Acid and
 * Water) would otherwise sit in perfectly flat, permanently unmixed layers —
 * this gives their shared boundary a slow, gradual interdiffusion instead of
 * a hard line. Returns true if a swap happened.
 */
export function diffuseWith(
  x: number,
  y: number,
  sim: SimContext,
  otherId: number,
  chance: number,
): boolean {
  // A liquid chilled below its freezing point acts solid, so it doesn't
  // interdiffuse either — otherwise a frost-rendered "frozen" cell would still
  // visibly wander into adjacent liquid (see Material.freeze / SimContext.isFrozen).
  if (sim.isFrozen(x, y)) return false;
  if (!sim.chance(chance)) return false;
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === otherId) {
      sim.swap(x, y, nx, ny);
      return true;
    }
  }
  return false;
}

/** Powder: fall straight down, else tumble diagonally (forms piles). A material's
 *  `friction` (안식각) throttles only the diagonal tumble — a high-friction grain
 *  grips the slope and stays put more often, so the pile stands steeper — while
 *  the straight-down fall is never blocked (grains still settle). */
export function updatePowder(x: number, y: number, sim: SimContext): void {
  if (sim.moveDown(x, y)) return;
  const friction = getMaterial(sim.get(x, y)).friction;
  if (friction !== undefined && friction > 0 && sim.chance(friction)) return;
  sim.moveDiagonalDown(x, y);
}

// A gas rises imperfectly (updateGas): it stalls for a beat and sways sideways
// instead of climbing a rigid column. A light, fluffy powder — Snow, Ash —
// *falls* the same imperfect way. These knobs are the falling mirror of the gas
// wobble, giving flakes a slow, scattering flutter instead of a sand-like drop.
const DRIFT_STALL_CHANCE = 0.4; // skip the tick → hangs in the air, flutters down
const DRIFT_SWAY_CHANCE = 0.5; // while airborne, drift a step sideways before dropping

/** Floaty powder (Snow, Ash): drifts down like a gas drifts up — a chance to
 *  stall mid-air (slow flutter) and, while there's still open air below, a
 *  chance to wander a step sideways before continuing to fall, so flakes
 *  scatter and wander down instead of dropping in a dead-straight column. The
 *  sideways drift is gated on "air below" so only airborne flakes wander; once
 *  one has a surface under it, it settles and piles like an ordinary powder
 *  (no endless sideways creep along the ground). */
export function updateFloatyPowder(x: number, y: number, sim: SimContext): void {
  if (sim.chance(DRIFT_STALL_CHANCE)) return;
  const airBelow = sim.inBounds(x, y + 1) && sim.isEmpty(x, y + 1);
  if (airBelow && sim.chance(DRIFT_SWAY_CHANCE) && sim.moveSideways(x, y)) return;
  if (sim.moveDown(x, y)) return;
  sim.moveDiagonalDown(x, y);
}

/** True if the cell directly against gravity ("above" x,y) holds a liquid
 *  denser than this cell's own material — i.e. this powder is pinned *under*
 *  a liquid it's too light to have sunk into on its own (water poured on top
 *  of it, or a pool closing back over it), as opposed to merely resting on a
 *  surface with open air overhead. */
function submergedUnderDenserLiquid(x: number, y: number, sim: SimContext): boolean {
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  if (!sim.inBounds(ux, uy)) return false;
  const aboveId = sim.get(ux, uy);
  if (aboveId === EMPTY) return false;
  const above = getMaterial(aboveId);
  if (above.phase !== Phase.Liquid) return false;
  return above.density > getMaterial(sim.get(x, y)).density;
}

const BUOY_STALL_CHANCE = 0.3; // rises in a bobbing flutter, not a dead-straight snap
const BUOY_SWAY_CHANCE = 0.35; // occasional sideways drift while rising, so it doesn't bore a perfectly straight shaft

/**
 * "가벼운 가루" (light powder): if this cell is submerged under a denser
 * liquid, actively try to float back up through it — rather than sitting
 * pinned in place like an inert solid the way an ordinary powder would
 * (Powder cells aren't displaceable, so a liquid can't push *into* one; see
 * SimContext.tryMove). The rise itself reuses tryMove's existing
 * density-sorted displacement (a lighter cell may swap up through a denser
 * fluid) — this just gives the powder the will to *attempt* that move each
 * tick while it's covered. Each successful rise swaps the powder up one cell
 * and the liquid down one cell in the same move, so water poured over a pile
 * doesn't pool on top of it like solid ground — the powder bubbles up through
 * the incoming water instead. Returns true if it acted (submerged, whether or
 * not the attempted move actually succeeded that tick) so the caller skips
 * its normal fall/pile behavior only while covered; false once it clears the
 * surface, letting the caller fall through to its own ordinary movement.
 */
export function tryBuoyantRise(x: number, y: number, sim: SimContext): boolean {
  if (!submergedUnderDenserLiquid(x, y, sim)) return false;
  if (sim.chance(BUOY_STALL_CHANCE)) return true;
  if (sim.chance(BUOY_SWAY_CHANCE) && sim.moveDiagonalUp(x, y)) return true;
  if (sim.moveUp(x, y)) return true;
  sim.moveDiagonalUp(x, y);
  return true;
}

/** Floaty powder (Ash) with buoyant rise: falls with the floaty-powder
 *  drift/wobble (updateFloatyPowder) when clear, and floats back up
 *  (tryBuoyantRise) when submerged under a denser liquid. See tryBuoyantRise
 *  for the rise itself; Sawdust reuses that helper directly to add the same
 *  rise to its ordinary grainy fall (updatePowder) instead of this wobble. */
export function updateBuoyantPowder(x: number, y: number, sim: SimContext): void {
  if (tryBuoyantRise(x, y, sim)) return;
  updateFloatyPowder(x, y, sim);
}

/** Fraction of the gas diffusion rate that liquids get: like a gas, a liquid
 *  spreads more as gravity weakens (see updateGas), but only creeps — a globule
 *  drifting apart in zero-g, not a billowing cloud — so it diffuses at this
 *  fraction of the gas rate. 0 at full gravity either way, so the default flow
 *  is unchanged. */
const LIQUID_DIFFUSE_SCALE = 0.35;

/** A liquid cell is "well connected" (part of a bulk pool, not an edge droplet)
 *  once it has at least this many same-material 8-neighbors. Surface tension only
 *  acts on cells below this, so it rounds up stragglers and thin films into beads
 *  without freezing the interior of a pool in place. */
const COHESION_STABLE = 4;

/**
 * Surface-tension cohesion move for a poorly-connected liquid cell: with
 * probability `st`, a straggler (fewer than COHESION_STABLE same-material
 * neighbors) hops into the adjacent empty cell where it would touch the MOST of
 * its own kind, so isolated cells ball up into rounded droplets and thin films
 * pinch off. It only ever moves to strictly *gain* contact, so the process
 * converges (no perpetual jitter) and never smears a liquid apart. Returns true
 * if it moved. A frozen liquid doesn't bead (it's solid).
 */
function surfaceTensionMove(x: number, y: number, sim: SimContext, st: number): boolean {
  if (sim.isFrozen(x, y) || !sim.chance(st)) return false;
  const id = sim.get(x, y);
  let myContact = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === id) myContact++;
  }
  if (myContact >= COHESION_STABLE) return false; // in the bulk — let it flow normally

  let bestX = -1;
  let bestY = -1;
  let bestContact = myContact; // only relocate if it strictly improves contact
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny) || !sim.isEmpty(nx, ny)) continue;
    let c = 0;
    for (const [ex, ey] of DIR8) {
      const ax = nx + ex;
      const ay = ny + ey;
      // Count same-material neighbors of the candidate cell, excluding this very
      // cell (we'd be vacating it) so the score reflects the contact it gains.
      if ((ax !== x || ay !== y) && sim.inBounds(ax, ay) && sim.get(ax, ay) === id) c++;
    }
    if (c > bestContact) {
      bestContact = c;
      bestX = nx;
      bestY = ny;
    }
  }
  if (bestX < 0) return false;
  sim.swap(x, y, bestX, bestY);
  return true;
}

/** Liquid: (surface tension pulls stragglers into beads first, then) fall, else
 *  flow diagonally down, else seep into a powder bed below as a 겹침 overlap fluid
 *  (SimContext.soakDown — chance-gated, so a pool sinks into sand gradually), else
 *  spread sideways to level out. The soak comes before the sideways step on
 *  purpose: after it, a droplet skating along a dry bed with open air on both
 *  sides would keep sliding forever and never soak in. `viscosity` (점도) gates
 *  only the lateral spread (diagonal creep + sideways leveling), so a thick liquid
 *  still falls under gravity but holds a slumping mound instead of racing flat. A
 *  liquid chilled to/below its freezing point (see Material.freeze) is frozen
 *  solid — it stays put until it warms up. */
export function updateLiquid(x: number, y: number, sim: SimContext): void {
  if (sim.isFrozen(x, y)) return;
  const m = getMaterial(sim.get(x, y));
  if (m.surfaceTension !== undefined && surfaceTensionMove(x, y, sim, m.surfaceTension)) return;
  // Slow thermal diffusion, scaled by how weak gravity is — a fraction of the
  // gas rate so liquids creep rather than billow. 0 at full gravity (default
  // flow unchanged); toward zero gravity a liquid slowly spreads in all
  // directions instead of freezing in place. A frozen liquid (above) never
  // reaches here, so chilled puddles stay put.
  const diffuse = (1 - sim.gravityStrength) * LIQUID_DIFFUSE_SCALE;
  if (diffuse > 0 && sim.chance(diffuse) && sim.moveRandom(x, y)) return;
  if (sim.moveDown(x, y)) return;
  // Viscosity resists lateral spreading (leveling), not the straight fall above:
  // a thick liquid that can't drop this tick just holds, so a poured blob mounds.
  if (m.viscosity !== undefined && m.viscosity > 0 && sim.chance(m.viscosity)) return;
  if (sim.moveDiagonalDown(x, y)) return;
  if (sim.soakDown(x, y)) return;
  sim.moveSideways(x, y);
}

// Gas rise is deliberately imperfect: a chance to stall for a tick (slows the
// overall ascent) and a chance to prefer a diagonal step over straight-up
// (sways side to side instead of climbing in a dead-straight column). Shared
// by every gas material — Fire, Smoke, Steam, Acid Vapor — and by design the
// hook a future rising/falling particle (e.g. Snow) reuses for the same wobble.
const GAS_STALL_CHANCE = 0.35; // skip movement entirely this tick → slower rise
const GAS_WOBBLE_CHANCE = 0.4; // try the diagonal step before the straight one

/** Gas: rise, else drift diagonally up, else spread sideways — with a chance
 *  to stall (slower climb) and a chance to wobble diagonally instead of
 *  going straight up (less of a rigid vertical column).
 *
 *  Thermal diffusion is layered on top and scaled by how weak gravity is:
 *  buoyancy (rising) needs gravity, but the random thermal spreading of a gas
 *  does not. At full gravity (strength 1) the diffusion chance is 0, so this is
 *  exactly the old buoyant behavior; as gravity weakens the gas increasingly
 *  spreads in every direction instead of only rising, and at zero gravity it
 *  diffuses isotropically rather than freezing in place like a solid. */
export function updateGas(x: number, y: number, sim: SimContext): void {
  const diffuse = 1 - sim.gravityStrength;
  if (diffuse > 0 && sim.chance(diffuse) && sim.moveRandom(x, y)) return;

  if (sim.chance(GAS_STALL_CHANCE)) return;
  if (sim.chance(GAS_WOBBLE_CHANCE)) {
    if (sim.moveDiagonalUp(x, y)) return;
    if (sim.moveUp(x, y)) return;
  } else {
    if (sim.moveUp(x, y)) return;
    if (sim.moveDiagonalUp(x, y)) return;
  }
  sim.moveSideways(x, y);
}

// A heavy gas (CO₂, Chlorine) is the sinking mirror of updateGas: instead of
// rising it slumps to the floor and pools, spreading sideways to fill low
// ground and settling on top of any liquid it can't sink into. Same imperfect
// wobble as the rising gas — a chance to stall for a beat and a chance to prefer
// the diagonal step — so it reads as a drifting, spreading cloud rather than a
// rigid falling column. Movement is still density-sorted by tryMove, so a heavy
// gas displaces the lighter ordinary gases (Smoke/Steam/Fire) beneath it and
// slides under them, while never sinking into a denser liquid.
const HEAVY_GAS_STALL_CHANCE = 0.35;
const HEAVY_GAS_WOBBLE_CHANCE = 0.4;

/** Heavy gas: sink, else drift diagonally down, else spread sideways — with a
 *  chance to stall (slower fall) and a chance to wobble diagonally instead of
 *  dropping straight down (a spreading cloud, not a rigid column). The downward
 *  counterpart of updateGas. */
export function updateHeavyGas(x: number, y: number, sim: SimContext): void {
  if (sim.chance(HEAVY_GAS_STALL_CHANCE)) return;
  if (sim.chance(HEAVY_GAS_WOBBLE_CHANCE)) {
    if (sim.moveDiagonalDown(x, y)) return;
    if (sim.moveDown(x, y)) return;
  } else {
    if (sim.moveDown(x, y)) return;
    if (sim.moveDiagonalDown(x, y)) return;
  }
  sim.moveSideways(x, y);
}

/** Resolve the default update for a phase (Solid/Empty are static → no update). */
export function defaultUpdate(
  phase: Phase,
): ((x: number, y: number, sim: SimContext) => void) | undefined {
  switch (phase) {
    case Phase.Powder:
      return updatePowder;
    case Phase.Liquid:
      return updateLiquid;
    case Phase.Gas:
      return updateGas;
    default:
      return undefined;
  }
}
