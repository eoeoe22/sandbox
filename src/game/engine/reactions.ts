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
 * The same pass across the 겹침 (overlap) seam: a cell's primary occupant and the
 * fluid soaked *into* it are a contact pair too — they share one cell, which is
 * as much contact as there is. Without this a soaked fluid is invisible to the
 * table on both sides (Activated Aluminum never fizzes on the water inside it),
 * which is why materials that need their liquid to keep reacting had to refuse
 * overlap outright (Soap's `liquidOverlap: 0`).
 *
 * Both directions are checked, host-declared first, and the writes differ from
 * the neighbor case in one way only: the participant that is the *overlay* is
 * written through the overlap slot. When its product can't stay there — a powder
 * can't hold the Hydrogen that Activated Aluminum's rule hands back — the product
 * SURFACES: into the cell itself if the reaction just emptied the host, else
 * vented to a free neighbor like any byproduct (and lost only when boxed in, the
 * same bargain `ventByproduct` already makes).
 *
 * Returns true when a rule fired; both participants are marked moved (the cell
 * and its overlap slot), so neither reacts again this tick.
 */
export function tryReactSoaked(x: number, y: number, sim: SimContext): boolean {
  const hostId = sim.get(x, y);
  const fluidId = sim.getOverlay(x, y);
  if (hostId === EMPTY || fluidId === EMPTY) return false;
  // One temperature for the pair: a soaked fluid shares its host's (see
  // SimContext.enterOverlay), so both directions gate on the same reading.
  const temp = sim.getTemp(x, y);
  const hostRules = getMaterial(hostId).reactions;
  if (hostRules !== undefined && runSoakedRules(x, y, sim, hostRules, fluidId, temp, true)) {
    return true;
  }
  const fluidRules = getMaterial(fluidId).reactions;
  return fluidRules !== undefined && runSoakedRules(x, y, sim, fluidRules, hostId, temp, false);
}

/** Find the first rule in `rules` whose partner is the co-occupant `partnerId`
 *  and whose gates pass, and apply it. `hostDeclared` says which side of the pair
 *  owns the table (and therefore which side `produce` refers to). */
function runSoakedRules(
  x: number,
  y: number,
  sim: SimContext,
  rules: readonly ReactionRule[],
  partnerId: number,
  temp: number,
  hostDeclared: boolean,
): boolean {
  for (const rule of rules) {
    if (rule.with !== partnerId) continue;
    if (rule.tempMin !== undefined && temp < rule.tempMin) continue;
    if (rule.tempMax !== undefined && temp > rule.tempMax) continue;
    let p = rule.probability ?? 1;
    // A catalyst is still looked for among the primary cells around the pair —
    // it works on the reaction, and doesn't care which of the two it can see.
    if (rule.catalyst !== undefined && neighborHas(x, y, sim, rule.catalyst)) {
      p *= rule.catalystFactor ?? DEFAULT_CATALYST_FACTOR;
    }
    if (p < 1 && !sim.chance(p)) continue;
    applySoakedReaction(x, y, sim, rule, hostDeclared);
    return true;
  }
  return false;
}

/** Apply a matched rule between a host cell and the fluid soaked into it (see
 *  tryReactSoaked). `hostDeclared` picks which side `produce`/`otherBecomes`
 *  name. */
function applySoakedReaction(
  x: number,
  y: number,
  sim: SimContext,
  rule: ReactionRule,
  hostDeclared: boolean,
): void {
  const hostId = sim.get(x, y);
  const fluidId = sim.getOverlay(x, y);
  const hostProduct = hostDeclared ? rule.produce : rule.otherBecomes;
  const soakProduct = hostDeclared ? rule.otherBecomes : rule.produce;
  const transformsSoak = soakProduct !== undefined && soakProduct !== fluidId;

  // Detach the occupant BEFORE touching the host when the rule replaces it:
  // set(x, y, EMPTY) on a soaked host releases the old fluid into the vacated
  // cell (SimContext.set), which would strand it in the very cell the product is
  // about to claim.
  if (transformsSoak) sim.clearOverlay(x, y);
  if (hostProduct !== undefined && hostProduct !== hostId) sim.set(x, y, hostProduct);
  if (transformsSoak && soakProduct !== undefined && soakProduct !== EMPTY) {
    // Back into the slot if the (possibly brand-new) host can hold it; otherwise
    // it surfaces — taking the cell the host just vacated, or venting out.
    if (!sim.setOverlay(x, y, soakProduct)) {
      if (sim.isEmpty(x, y)) sim.spawn(x, y, soakProduct);
      else ventByproduct(x, y, sim, soakProduct);
    }
  }
  // One cell, one temperature: the heat of reaction lands once, on whatever now
  // occupies it (a reaction that emptied the cell has nothing to warm).
  const heat = rule.heat ?? 0;
  if (heat !== 0 && sim.get(x, y) !== EMPTY) sim.setTemp(x, y, sim.getTemp(x, y) + heat);
  sim.markMoved(x, y);
  sim.markOverlayMoved(x, y);
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
