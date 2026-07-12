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

/** Liquid: fall, else flow diagonally down, else seep into a powder bed below
 *  as a 겹침 overlap fluid (SimContext.soakDown — chance-gated, so a pool sinks
 *  into sand gradually), else spread sideways to level out. The soak comes
 *  before the sideways step on purpose: after it, a droplet skating along a dry
 *  bed with open air on both sides would keep sliding forever and never soak
 *  in. A liquid chilled to/below its freezing point (see Material.freeze) is
 *  frozen solid — it stays put until it warms up. */
export function updateLiquid(x: number, y: number, sim: SimContext): void {
  if (sim.isFrozen(x, y)) return;
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
 *  going straight up (less of a rigid vertical column). */
export function updateGas(x: number, y: number, sim: SimContext): void {
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
