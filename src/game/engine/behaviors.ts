import type { SimContext } from './SimContext';
import { Phase } from './types';

// Default per-cell update rules keyed by Phase. A material without its own
// `update` inherits one of these, so most materials are pure data (one file,
// no logic). Override `update` only for special behavior.

/** Powder: fall straight down, else tumble diagonally (forms piles). */
export function updatePowder(x: number, y: number, sim: SimContext): void {
  if (sim.moveDown(x, y)) return;
  sim.moveDiagonalDown(x, y);
}

/** Liquid: fall, else flow diagonally down, else spread sideways to level out. */
export function updateLiquid(x: number, y: number, sim: SimContext): void {
  if (sim.moveDown(x, y)) return;
  if (sim.moveDiagonalDown(x, y)) return;
  sim.moveSideways(x, y);
}

/** Gas: rise, else drift diagonally up, else spread sideways. */
export function updateGas(x: number, y: number, sim: SimContext): void {
  if (sim.moveUp(x, y)) return;
  if (sim.moveDiagonalUp(x, y)) return;
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
