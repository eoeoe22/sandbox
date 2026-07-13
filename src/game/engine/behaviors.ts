import type { SimContext } from './SimContext';
import { Phase } from './types';
import { DIR4 } from './directions';

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

/** Powder: fall straight down, else tumble diagonally (forms piles). */
export function updatePowder(x: number, y: number, sim: SimContext): void {
  if (sim.moveDown(x, y)) return;
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

/** Fraction of the gas diffusion rate that liquids get: like a gas, a liquid
 *  spreads more as gravity weakens (see updateGas), but only creeps — a globule
 *  drifting apart in zero-g, not a billowing cloud — so it diffuses at this
 *  fraction of the gas rate. 0 at full gravity either way, so the default flow
 *  is unchanged. */
const LIQUID_DIFFUSE_SCALE = 0.35;

/** Liquid: fall, else flow diagonally down, else seep into a powder bed below
 *  as a 겹침 overlap fluid (SimContext.soakDown — chance-gated, so a pool sinks
 *  into sand gradually), else spread sideways to level out. The soak comes
 *  before the sideways step on purpose: after it, a droplet skating along a dry
 *  bed with open air on both sides would keep sliding forever and never soak
 *  in. A liquid chilled to/below its freezing point (see Material.freeze) is
 *  frozen solid — it stays put until it warms up. */
export function updateLiquid(x: number, y: number, sim: SimContext): void {
  if (sim.isFrozen(x, y)) return;
  // Slow thermal diffusion, scaled by how weak gravity is — a fraction of the
  // gas rate so liquids creep rather than billow. 0 at full gravity (default
  // flow unchanged); toward zero gravity a liquid slowly spreads in all
  // directions instead of freezing in place. A frozen liquid (above) never
  // reaches here, so chilled puddles stay put.
  const diffuse = (1 - sim.gravityStrength) * LIQUID_DIFFUSE_SCALE;
  if (diffuse > 0 && sim.chance(diffuse) && sim.moveRandom(x, y)) return;
  if (sim.moveDown(x, y)) return;
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
