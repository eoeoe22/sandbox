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

// A submerged grain's moveUp target is exactly the cell submergedUnderDenserLiquid
// just confirmed is a denser liquid, so tryMove's density-sort passes almost every
// tick by construction — left unchecked, a whole stack of submerged grains (liquid
// backfilling below each one the instant it rises, see tryBuoyantRise's comment)
// would ride straight up in lockstep, staying a rigid vertical column the entire way
// instead of spreading out. Mirrors updateGas's wobble: a chance to prefer the
// diagonal step over going straight up, so a rising cluster drifts apart instead of
// preserving whatever column shape it started in.
const RISE_WOBBLE_CHANCE = 0.4;

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
 * the incoming water instead.
 *
 * No fixed per-tick stall chance — a powder blocked from going straight up
 * is a Powder-phase obstacle the liquid can never displace on its own (see
 * SimContext.isDisplaceable), so sitting idle while covered would plug the
 * liquid's own flow around it every tick it stalled. `moveUp`/`moveDiagonalUp`
 * still commonly report no real movement two ways though — tryMove's own
 * density-gap drag gate can consume the tick without swapping (same
 * resistance every displacement gets, see tryMove), and each move rolls
 * gravityStrength independently, so a reduced strength can skip either or
 * both on a given tick. Whichever of the two (straight/diagonal, order set by
 * RISE_WOBBLE_CHANCE) is tried first, the other is tried as a fallback if it
 * fails — no `friction` gate on the diagonal, since that field's per-tick
 * "grip" chance is tuned for a grain resting on a slope under gravity, a
 * scenario with no equivalent here, and gating on it would just reintroduce a
 * stall by another name — several materials' resting friction (e.g. Cement's
 * 0.52) is higher than any fixed stall chance this file has ever used.
 *
 * Returns true if it acted (submerged, whether or not the attempted move
 * actually succeeded that tick) so the caller skips its normal fall/pile
 * behavior only while covered; false once it clears the surface, letting the
 * caller fall through to its own ordinary movement (see flattenIfFloating,
 * which handles a surfaced grain capping others still queued below it).
 *
 * Every powder is density-rated (see Material.density), so this is purely a
 * density comparison — no per-material float list. A powder floats clear of
 * whichever liquids it's lighter than and stays sunk in whichever it's
 * heavier than, the same rule in both directions.
 */
export function tryBuoyantRise(x: number, y: number, sim: SimContext): boolean {
  if (!submergedUnderDenserLiquid(x, y, sim)) return false;
  if (sim.chance(RISE_WOBBLE_CHANCE)) {
    if (sim.moveDiagonalUp(x, y)) return true;
    sim.moveUp(x, y);
  } else {
    if (sim.moveUp(x, y)) return true;
    sim.moveDiagonalUp(x, y);
  }
  return true;
}

/** Fall straight down, else tumble diagonally (forms piles); returns whether
 *  either actually moved the cell. A material's `friction` (안식각) throttles
 *  only the diagonal tumble — a high-friction grain grips the slope and stays
 *  put more often, so the pile stands steeper — while the straight-down fall
 *  is never blocked (grains still settle). tryBuoyantRise above has the same
 *  straight-move/diagonal-fallback shape for the submerged/rising case, but
 *  *without* this friction gate — see its own comment for why gating the rise
 *  the same way doesn't work. */
function fallAndPile(x: number, y: number, sim: SimContext): boolean {
  if (sim.moveDown(x, y)) return true;
  const friction = getMaterial(sim.get(x, y)).friction;
  if (friction !== undefined && friction > 0 && sim.chance(friction)) return false;
  return sim.moveDiagonalDown(x, y);
}

// How far denserLiquidBelow looks down through a run of Powder cells before
// giving up. A grain that just surfaced from a rise often still has more of the
// same queued directly beneath it — moveUp swaps the liquid that used to separate
// them away as each follower arrives (see tryBuoyantRise), so by the time a grain
// is capped there's no liquid left between it and its queue, only more Powder;
// checking just the immediate neighbor would never catch that. Bounded so the
// look-down can't walk the full height of an ordinary grounded pile.
const FLOAT_STACK_SCAN = 16;
// Looking that far down is comparatively expensive, so restingOnStackedFloat
// (below) only rolls it this often per idle tick rather than every tick — a
// capped column still clears in a handful of ticks on average (imperceptible at
// sim speed), while an ordinary grounded pile — whose interior cells all fail
// this same look-down every idle tick — pays the cost far less often.
const FLOAT_STACK_SCAN_CHANCE = 0.2;

/** True if the cell `maxDepth` steps down from (x,y) — through any run of
 *  intervening Powder cells — holds a liquid denser than this cell's own
 *  material and not frozen solid (a frozen liquid acts as solid ground, see
 *  SimContext.isFrozen, so it's not something to float/flatten onto). Backs
 *  both floatingOnLiquid (maxDepth 1, checked every tick — the grain is
 *  resting directly on the liquid) and restingOnStackedFloat (maxDepth
 *  FLOAT_STACK_SCAN, gated — the liquid is somewhere further down a stack of
 *  the grain's own kind). Not shared with submergedUnderDenserLiquid above:
 *  that one checks the opposite (against-gravity) side, where the frozen
 *  liquid being checked *is* the move's own target (tryMove's isFrozen check
 *  already covers it there) — here the move is sideways, past the liquid
 *  being checked, so nothing else catches a frozen "floor". */
function denserLiquidBelow(x: number, y: number, sim: SimContext, maxDepth: number): boolean {
  const myDensity = getMaterial(sim.get(x, y)).density;
  let cx = x;
  let cy = y;
  for (let i = 0; i < maxDepth; i++) {
    cx += sim.gravityX;
    cy += sim.gravityY;
    if (!sim.inBounds(cx, cy)) return false;
    const belowId = sim.get(cx, cy);
    if (belowId === EMPTY) return false;
    const below = getMaterial(belowId);
    if (below.phase === Phase.Powder) continue; // keep looking down through the stack
    return below.phase === Phase.Liquid && below.density > myDensity && !sim.isFrozen(cx, cy);
  }
  return false;
}

/** True if this cell is floating directly on a liquid it's too light to sink
 *  into, as opposed to resting on solid ground or another powder. */
function floatingOnLiquid(x: number, y: number, sim: SimContext): boolean {
  return denserLiquidBelow(x, y, sim, 1);
}

/** True if this cell is stacked on other Powder cells that themselves bottom
 *  out on a denser liquid within FLOAT_STACK_SCAN levels — the deep-buried
 *  version of floatingOnLiquid, for a grain that's floating but has more of
 *  its own kind between it and the liquid. */
function restingOnStackedFloat(x: number, y: number, sim: SimContext): boolean {
  return denserLiquidBelow(x, y, sim, FLOAT_STACK_SCAN);
}

/** True if this grain should try a sideways step: floating directly on a
 *  liquid it's too light to sink into (floatingOnLiquid), or buried in a
 *  stack of its own kind that bottoms out on one within FLOAT_STACK_SCAN
 *  levels (the FLOAT_STACK_SCAN_CHANCE-gated restingOnStackedFloat). Shared by
 *  flattenIfFloating (ordinary powder, spreads via moveSidewaysBuoyant) and
 *  updatePowderSink (melt-pinned powder, spreads via moveSidewaysContained) —
 *  both only want the sideways step under the same "actually floating"
 *  condition, they just differ in which primitive is safe to spread with. */
function shouldFlatten(x: number, y: number, sim: SimContext): boolean {
  if (floatingOnLiquid(x, y, sim)) return true;
  return sim.chance(FLOAT_STACK_SCAN_CHANCE) && restingOnStackedFloat(x, y, sim);
}

/** A sideways step if this grain is floating (see shouldFlatten) — called
 *  once a caller's own fall/pile or fall/drift attempt already found nothing
 *  to do. This settles an unevenly-stacked raft of floating powder flat along
 *  the surface instead of letting it stand in a sand-pile-style heap, and lets
 *  a surfaced grain capping the column rising beneath it (see tryBuoyantRise)
 *  clear out of the way instead of forcing the whole queue into a straight
 *  line. A grain resting on solid ground, or buried deeper than a
 *  stacked-float check can see, gets no such step and keeps its ordinary
 *  angle-of-repose pile shape.
 *
 *  Uses moveSidewaysBuoyant, not the plain moveSideways: a raft floating in
 *  the middle of a pool has more of the same liquid it's floating on at both
 *  flanks, not open air — ordinary moveSideways's density-sort would demand
 *  this (lighter) grain outweigh that liquid to take its spot, which is
 *  exactly backwards for a floater, so it would only ever resolve at a pool's
 *  edge where air happens to be exposed. Every interior cell of the raft
 *  would stay stuck, which is exactly the "doesn't flatten in the middle of
 *  the pool, only piles into narrow columns" failure this exists to fix. */
function flattenIfFloating(x: number, y: number, sim: SimContext): void {
  if (shouldFlatten(x, y, sim)) sim.moveSidewaysBuoyant(x, y);
}

/** Sink-only powder: falls and piles (fallAndPile), but never attempts the
 *  generic density-based rise. For the rare powder (Coal Powder, Limestone)
 *  that has its own material-specific rule for *which* liquid it's allowed to
 *  float clear of (see moltenironore.ts's `tryHoldInActiveMelt`) — while
 *  pinned against Molten Iron Ore/Slag it must still be free to settle
 *  *downward* if there's room (an ordinary powder never stops falling just
 *  because something denser is above it), it just must not try to rise.
 *
 *  Once fallAndPile finds nothing to do, this still spreads sideways under the
 *  same shouldFlatten condition flattenIfFloating uses — via
 *  SimContext.moveSidewaysContained (not moveSidewaysBuoyant, which isn't safe
 *  for a pinned grain — see SimContext.ts's swapOntoLiquid doc comment for
 *  why `containerIds` matters here), so a raft of flux pinned inside an
 *  ore/slag charge (e.g. trapped under cells that just melted in place above
 *  it) settles flat instead of freezing into the same jagged comb of straight
 *  columns moveSidewaysBuoyant fixes for ordinary floating powder (see
 *  docs/MATERIAL-SYSTEMS.md). Gating on shouldFlatten, rather than trying the
 *  swap unconditionally whenever fallAndPile fails, also matters for Coal
 *  Powder: it's denser than Molten Iron Ore/Slag, so shouldFlatten stays
 *  false for it while pinned above those two — but *not* once it has sunk
 *  through them to rest directly on Molten Metal (8), still denser than Coal
 *  Powder (7.5), so this step does fire there (see moltenironore.ts's
 *  tryHoldInActiveMelt doc comment for the full density ordering).
 *
 *  `mixIds` is forwarded to moveSidewaysContained's swapOntoPinnedPowder
 *  fallback (see SimContext.ts) — the same two-melt-pinned-powders-side-by-side
 *  comb that updatePowderMix's mixIds fixes for the free-floating case can
 *  recur one step earlier, while both grains are still pinned against Molten
 *  Iron Ore/Slag rather than having cleared onto Molten Metal (reported
 *  after the free-floating fix: the frozen columns still contained Molten
 *  Iron Ore). */
export function updatePowderSink(
  x: number,
  y: number,
  sim: SimContext,
  containerIds: readonly number[],
  mixIds: readonly number[],
): void {
  if (fallAndPile(x, y, sim)) return;
  if (shouldFlatten(x, y, sim)) sim.moveSidewaysContained(x, y, containerIds, mixIds);
}

/** Empty `mixIds` — updatePowder's "no other floating powder to swap with"
 *  case, reused so it doesn't allocate a fresh array every call (mirrors
 *  SimContext.ts's own NO_MIX_IDS, kept as a separate constant here rather
 *  than exported/shared since it's a trivial, module-local value). */
const NO_MIX_IDS: readonly number[] = [];

// How far tryFloatLightPowderStack looks past its own column's top for
// unrelated Powder resting on it (a heavier grain, or pile of them, placed on
// a raft) when tallying `loadWeight` below — bounded for the same reason
// FLOAT_STACK_SCAN is (so a tall stockpile dropped on a raft doesn't pay for
// scanning its full height every tick), just aimed the opposite direction
// (past the top instead of past the bottom). Set independently of, not tied
// to, FLOAT_STACK_SCAN's value: this only runs on a column's single
// top-of-stack cell (not every cell in a deep stack, gated by
// FLOAT_STACK_SCAN_CHANCE, the way restingOnStackedFloat is), so it can afford
// a taller look without the same per-tick cost multiplying across a whole
// pile. A load stacked past this limit simply undercounts — `loadWeight` stops
// growing — rather than erroring; unlikely to matter at ordinary pile heights.
const LOAD_SCAN_LIMIT = 64;

/**
 * Checks if a light powder is in a contiguous column and if so, evaluates its
 * submerged depth vs its ideal buoyant depth based on density ratios, and
 * shifts the column up or down if it's out of equilibrium.
 *
 * Also carries the powder-on-powder weight interaction: `loadWeight` tallies
 * whatever *other* (denser) Powder is resting on top of the column, and folds
 * it into the same equilibrium as extra cargo the column has to support — a
 * raft sits lower the more weight is piled on it, on top of (not instead of)
 * its own unloaded density-ratio depth. When even fully submerging the whole
 * column still isn't enough buoyancy to carry that cargo, the excess doesn't
 * just vanish: the load cell touching the column's top swaps into it instead
 * (see the `idealRaw > h` branch below), sinking one cell into the raft each
 * tick it's re-evaluated. Every load-bearing cell handles this identically —
 * there's no separate "digging" step — so a tall pile that outruns what the
 * column beneath it can support keeps sinking, one cell and one tick at a
 * time, into whatever fresh top-of-stack cell it now rests on, while the
 * lighter grains it displaces surface and (once shouldFlatten notices them
 * floating — see flattenIfFloating) spread out of the way instead of piling
 * back on top of the very load pressing them down. A column loaded exactly at
 * (not beyond) its full-submersion capacity just sits fully submerged, no
 * digging — only genuine excess weight breaches through, and a taller, denser
 * pile reaches that excess sooner than a lighter one, which is what makes
 * digging start earliest whichever spot is loaded the most.
 *
 * `loadWeight` zero (nothing resting on top) is the overwhelmingly common
 * case, and takes the exact original code path — computed to bit-identical
 * `idealSubmerged` — so an unloaded raft's behavior is untouched.
 */
function tryFloatLightPowderStack(x: number, y: number, sim: SimContext): boolean {
  const gx = sim.gravityX;
  const gy = sim.gravityY;

  const id = sim.get(x, y);
  const myDensity = getMaterial(id).density;

  // Only process if we are the top of the stack (no same-material powder above us, against gravity)
  const ux = x - gx;
  const uy = y - gy;
  if (sim.inBounds(ux, uy) && sim.get(ux, uy) === id) return false;

  // Scan down to find the height of the column and its submerged depth
  let h = 1;
  let submergedCount = 0;
  let liquidDensity = 0;

  if (sim.getOverlay(x, y) !== EMPTY) {
    submergedCount++;
    const oId = sim.getOverlay(x, y);
    if (oId !== EMPTY && getMaterial(oId).phase === Phase.Liquid) {
      liquidDensity = Math.max(liquidDensity, getMaterial(oId).density);
    }
  }

  for (let i = 1; i < 256; i++) { // arbitrary limit to prevent infinite loops, though grid is capped
    const cx = x + gx * i;
    const cy = y + gy * i;
    if (!sim.inBounds(cx, cy)) break;

    if (sim.get(cx, cy) === id) {
      h++;
      const oId = sim.getOverlay(cx, cy);
      if (oId !== EMPTY) {
        submergedCount++;
        if (getMaterial(oId).phase === Phase.Liquid) {
          liquidDensity = Math.max(liquidDensity, getMaterial(oId).density);
        }
      }
    } else {
      break;
    }
  }

  // Weight of any *other* Powder stacked on the column's own top (ux,uy) and
  // beyond — a different material, since a same-id run above would have made
  // (x,y) fail the "top of the stack" check above instead of reaching here.
  // Each cell contributes its own density, matching how the column's own
  // weight is expressed as h * myDensity below (one unit of density per
  // cell). Stops at the first non-Powder cell (open air, solid ground, a
  // liquid) — only Powder-on-Powder weight counts here.
  let loadWeight = 0;
  for (let i = 0; i < LOAD_SCAN_LIMIT; i++) {
    const lx = ux - gx * i;
    const ly = uy - gy * i;
    if (!sim.inBounds(lx, ly)) break;
    const lid = sim.get(lx, ly);
    if (lid === EMPTY) break;
    const lm = getMaterial(lid);
    if (lm.phase !== Phase.Powder) break;
    loadWeight += lm.density;
  }

  // A raft carrying no load only ever equilibrates using liquid it has
  // already actually absorbed (submergedCount above) — an entirely dry column
  // merely *resting* on a liquid surface it hasn't yet started to sink into
  // never bootstraps a nonzero liquidDensity here, so it correctly does
  // nothing (liquidDensity stays 0 below). A *loaded* column can't wait for
  // that: the whole point is to press a dry raft down under fresh weight, so
  // it also checks the liquid immediately past the column's own bottom —
  // what it's actually resting on — to learn that liquid's density even
  // before any of it has been absorbed.
  if (loadWeight > 0) {
    const belowBottomX = x + gx * h;
    const belowBottomY = y + gy * h;
    if (sim.inBounds(belowBottomX, belowBottomY)) {
      const belowId = sim.get(belowBottomX, belowBottomY);
      if (belowId !== EMPTY) {
        const belowMat = getMaterial(belowId);
        if (belowMat.phase === Phase.Liquid) {
          liquidDensity = Math.max(liquidDensity, belowMat.density);
        }
      }
    }
  }

  if (liquidDensity === 0 || myDensity >= liquidDensity) return false;

  // Written as h*(myDensity/liquidDensity) + loadWeight/liquidDensity, not the
  // single division (h*myDensity+loadWeight)/liquidDensity, so the unloaded
  // case (loadWeight 0) computes bit-identically to the original
  // h*(myDensity/liquidDensity) — no floating-point drift changes behavior
  // when there's nothing riding on top.
  const idealRaw = h * (myDensity / liquidDensity) + loadWeight / liquidDensity;

  // idealRaw exceeding h means even fully submerging this column can't carry
  // everything resting on it — excess weight the shift below can't absorb.
  // Once the column has actually reached full submersion (nothing left for a
  // shift to do), that excess instead sinks the load cell straight into the
  // raft: swap (x,y) — the column's current top, already wet since submersion
  // fills a column from the bottom up (see shiftPowderColumnUp/Down) — with
  // (ux,uy), the load cell touching it. SimContext.swap moves each side's
  // whole (material, overlay, …) tuple to the other position, so overlay
  // travels with whichever cell already had it, not with the destination
  // coordinate: the lighter grain rises into (ux,uy) *carrying its wet
  // overlay with it*, while the heavier grain that sinks into (x,y) arrives
  // dry (matching (ux,uy)'s prior state) — the same rule "wet sand carries
  // its water as it falls" describes for every other swap, just easy to
  // misread here since the wet/dry cells also swap which position looks
  // submerged. The sunk grain only actually gets wet once it either digs
  // through to real liquid or picks up an overlay via the ordinary soak path.
  // Either way (x,y) becomes the new top of a one-shorter column that's
  // re-evaluated on its own next tick — against whatever is now stacked above
  // it, which is how a tall load keeps sinking cell by cell instead of
  // stopping after one swap.
  if (idealRaw > h && submergedCount >= h) {
    sim.swap(x, y, ux, uy);
    return true;
  }

  const idealSubmerged = Math.min(h, Math.round(idealRaw));

  if (submergedCount > idealSubmerged) {
    if (sim.shiftPowderColumnUp(x, y, h)) return true;
  } else if (submergedCount < idealSubmerged) {
    if (sim.shiftPowderColumnDown(x, y, h)) return true;
  }

  return false;
}

/** Like updatePowder, but the flatten step also lets the sideways move swap
 *  places with a specific *other* floating powder listed in `mixIds` (see
 *  SimContext.moveSidewaysMix), instead of only an adjacent Liquid. For a
 *  powder that can end up floating side by side with one particular other
 *  kind of powder on the same liquid — Coal Powder and Limestone on a
 *  smelting furnace's Molten Metal, once tryHoldInActiveMelt no longer holds
 *  them — where the two together can fully tile the surface with no exposed
 *  liquid gap left for the ordinary moveSidewaysBuoyant fallback to use,
 *  freezing into the same comb shape flattenIfFloating exists to prevent,
 *  just triggered by a powder neighbor instead of a liquid one. `updatePowder`
 *  below is just this with `mixIds` empty, so there's one flatten path to
 *  maintain instead of two near-identical copies. */
export function updatePowderMix(
  x: number,
  y: number,
  sim: SimContext,
  mixIds: readonly number[],
): void {
  if (tryFloatLightPowderStack(x, y, sim)) return;
  if (tryBuoyantRise(x, y, sim)) return;
  if (fallAndPile(x, y, sim)) return;
  if (shouldFlatten(x, y, sim)) sim.moveSidewaysMix(x, y, mixIds);
}

/** Powder: falls and piles (fallAndPile), then flattens/unclogs if that had
 *  nothing to do, but first tries to float clear if it's submerged under a
 *  denser liquid (tryBuoyantRise) — every powder sinks or floats by its own
 *  density against whatever liquid it ends up under, not just the handful
 *  that used to have this wired in specially. The shared default for
 *  Phase.Powder (see registry.ts's defaultUpdate) and the fallback nearly
 *  every material-specific powder update calls once its own reactions don't
 *  fire, so this one change gives buoyancy to the whole roster for free. A
 *  powder with its own material-specific float rule instead of the bare
 *  density comparison (Coal Powder, Limestone — see moltenironore.ts's
 *  tryHoldInActiveMelt) intercepts before this ever runs. Just
 *  updatePowderMix with no other floating powder to swap with — see its own
 *  comment. */
export function updatePowder(x: number, y: number, sim: SimContext): void {
  updatePowderMix(x, y, sim, NO_MIX_IDS);
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
 *  (no endless sideways creep along the ground). Also floats clear
 *  (tryBuoyantRise) if submerged under a denser liquid, same as updatePowder,
 *  and flattens/unclogs the same way once it can't fall or drift any further
 *  (flattenIfFloating). Also carries the powder-on-powder weight interaction
 *  the same way updatePowder does (tryFloatLightPowderStack's `loadWeight`) —
 *  Snow and Ash float raft-style too. */
export function updateFloatyPowder(x: number, y: number, sim: SimContext): void {
  if (tryFloatLightPowderStack(x, y, sim)) return;
  if (tryBuoyantRise(x, y, sim)) return;
  if (sim.chance(DRIFT_STALL_CHANCE)) return;
  const bx = x + sim.gravityX;
  const by = y + sim.gravityY;
  const airBelow = sim.inBounds(bx, by) && sim.isEmpty(bx, by);
  if (airBelow && sim.chance(DRIFT_SWAY_CHANCE) && sim.moveSideways(x, y)) return;
  if (sim.moveDown(x, y)) return;
  if (sim.moveDiagonalDown(x, y)) return;
  flattenIfFloating(x, y, sim);
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
// Known, deliberately-unfixed sibling of the Powder comb bug moveSidewaysBuoyant
// fixes (see docs/MATERIAL-SYSTEMS.md's "뜨는 가루 평탄화 후속 수정"): the plain
// moveSideways below has the identical density-sort problem for a liquid
// lighter than its neighbors (e.g. Gasoline/Kerosene/Diesel under Water), so it
// can form the same permanent jagged layering mid-pool. Left as-is because a
// liquid-vs-liquid fix needs an actual density comparison between the two
// liquids (unlike swapOntoLiquid's blanket "any Liquid" allowance, which relies
// on Powder floaters always being lighter), and no player-visible case has
// surfaced yet to justify the broader change.
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
