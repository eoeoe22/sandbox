import type { SimContext } from './SimContext';
import { EMPTY, type ReactionRule } from './types';
import { getMaterial } from '../materials/registry';
import { DIR8 } from './directions';

// Declarative contact-reaction pass — the data-driven counterpart to the
// hardcoded 2-body reactions scattered across material `update`s (acid corroding,
// cement setting, sodium fizzling). A material declares `reactions: [...]` and the
// engine runs this one pass per cell each tick, so a new simple interaction is
// "one table row" instead of a new custom update (the plan's 2순위 편의성 payoff).
//
// The whole correctness discipline is the same the tag-based reactions already
// rely on (see the plan's "반응 테이블의 함정"): a reaction fires from the cell that
// *declares* the rule, and BOTH participating cells are marked moved the instant
// it fires, so the partner can't run its own reverse reaction later in the same
// scan (no double reaction) and neither cell is reprocessed (no scan-order
// runaway). Chains happen across ticks, never as a same-tick cascade.

/** Default multiplier applied to a reaction's probability while its `catalyst`
 *  is present in the neighborhood (a catalyst speeds the reaction up several-fold
 *  without being consumed). Overridable per-rule via `catalystFactor`. */
const DEFAULT_CATALYST_FACTOR = 4;

/** True if any 8-neighbor of (x,y) holds material `id`. Used both to find a
 *  reaction partner and to spot a catalyst. */
function neighborHas(x: number, y: number, sim: SimContext, id: number): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === id) return true;
  }
  return false;
}

/** Emit a reaction's gas/particle byproduct into an adjacent empty cell, preferring
 *  straight "up" (opposite gravity) so a released bubble rises off the reaction.
 *  Silently does nothing when the cell is boxed in. spawn() marks it moved. */
function ventByproduct(x: number, y: number, sim: SimContext, id: number): void {
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  if (sim.inBounds(ux, uy) && sim.isEmpty(ux, uy)) {
    sim.spawn(ux, uy, id);
    return;
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
      sim.spawn(nx, ny, id);
      return;
    }
  }
}

/** Apply a matched reaction between the declaring cell (x,y) and its partner
 *  (nx,ny): transform each per the rule, deposit heat into both, vent any
 *  byproduct, and mark both moved so neither reacts again this tick. */
function applyReaction(
  x: number,
  y: number,
  nx: number,
  ny: number,
  rule: ReactionRule,
  sim: SimContext,
): void {
  const selfId = sim.get(x, y);
  const otherId = sim.get(nx, ny);
  const heat = rule.heat ?? 0;

  // Transform the declaring cell. An in-place set() keeps the cell's temperature
  // (so the heat delta below lands on the reacted state), then we mark it moved —
  // set() on one's own cell doesn't, and without it a later neighbor could pick
  // this fresh product up as a partner in the same tick.
  if (rule.produce !== undefined && rule.produce !== selfId) {
    sim.set(x, y, rule.produce);
  }
  if (heat !== 0 && sim.get(x, y) !== EMPTY) sim.setTemp(x, y, sim.getTemp(x, y) + heat);
  sim.markMoved(x, y);

  // Transform the partner cell (a non-self write, so it must be marked moved —
  // that's exactly what spawn() is for, but we want to keep the cell's own temp
  // for the heat delta, so use set()+markMoved like the self cell).
  const partnerTransformed = rule.otherBecomes !== undefined && rule.otherBecomes !== otherId;
  if (partnerTransformed) {
    sim.set(nx, ny, rule.otherBecomes!);
  }
  if (heat !== 0 && sim.get(nx, ny) !== EMPTY) sim.setTemp(nx, ny, sim.getTemp(nx, ny) + heat);
  // Guard the partner against same-tick re-processing only when the reaction
  // actually changed it — or when it declares reactions of its own and could
  // otherwise run the reverse reaction later in this same scan. An *untouched*
  // catalyst/surface partner (H2O2's Iron/Yeast) stays unmarked so its own
  // update still runs this tick: Iron keeps ticking its spark-refractory
  // countdown and checking its melt point (which the heat just deposited above
  // feeds into), Yeast keeps growing/falling.
  if (partnerTransformed || getMaterial(otherId).reactions !== undefined) {
    sim.markMoved(nx, ny);
  }

  if (rule.byproduct !== undefined) ventByproduct(x, y, sim, rule.byproduct);
}

/**
 * Run the declarative contact-reaction pass for the cell at (x,y). Scans its 8
 * neighbors for a partner matching one of its `reactions` rules whose gates
 * (temperature window, probability, catalyst boost) all pass, applies the first
 * such match, and returns true. Returns false when the material declares no
 * reactions or none fired — the caller then runs the material's own `update`.
 */
export function tryReact(x: number, y: number, sim: SimContext): boolean {
  const rules = getMaterial(sim.get(x, y)).reactions;
  if (rules === undefined) return false;
  const selfTemp = sim.getTemp(x, y);

  for (const rule of rules) {
    // Temperature window is a property of the reaction site, checked once per
    // rule before the (more expensive) neighbor scan.
    if (rule.tempMin !== undefined && selfTemp < rule.tempMin) continue;
    if (rule.tempMax !== undefined && selfTemp > rule.tempMax) continue;

    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      if (sim.get(nx, ny) !== rule.with) continue;
      // A partner already written/moved this tick is ineligible until the next
      // one. Without this, a rule whose `produce` equals its own `with` (AN
      // dissolving to Water beside more AN) would cascade down the scan
      // direction within a single tick — exactly the scan-order-dependent
      // multi-cell chain the moved discipline exists to prevent. A just-settled
      // droplet likewise waits a tick; chains happen across ticks, never as a
      // same-tick cascade.
      if (sim.hasMoved(nx, ny)) continue;

      let p = rule.probability ?? 1;
      if (rule.catalyst !== undefined && neighborHas(x, y, sim, rule.catalyst)) {
        p *= rule.catalystFactor ?? DEFAULT_CATALYST_FACTOR;
      }
      if (p < 1 && !sim.chance(p)) continue;

      applyReaction(x, y, nx, ny, rule, sim);
      return true;
    }
  }
  return false;
}
