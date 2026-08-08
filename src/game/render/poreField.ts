// The porous field of an aerogel block (Material.poresPattern) — shared between
// the render loop and the palette icon generator, the same way the TNT bundle and
// the rotor wheels are.
//
// It is shared for the ordinary reason (docs/MATERIAL-ICONS.md §2.2): a mismatch
// here would be invisible. Every other rule-shaped pattern is a period and a
// compare or two, so restating it on both sides is reviewable — a wrong BRICK_W
// shows up as a wrong brick. This one is a *hash*, and a hash mirrored with one
// shifted bit-slice does not draw a wrong picture, it draws an equally plausible
// different one that nobody can tell is wrong by looking at it.
//
// ── What it draws ───────────────────────────────────────────────────────────
// Aerogel's palette chip (svg-assets/material-icons/aerogel.svg) is a pale block
// pitted with grey holes: "frozen smoke" is mostly air, and the holes are what
// says so. The canvas drew none of that — an aerogel wall was a flat pale slab,
// so the one material whose whole identity is "it is full of nothing" was the one
// that looked solid.
//
// The field is a **checkerboard lattice of one small square pore per period, each
// nudged by at most one cell**. Every pore is the same size (PORE_SIZE); the only
// thing that varies is where in its period it sits. That is the whole rule, and it
// leaves the surface 22.2% void — the same fraction of grey as the chip.
//
// It is a hash and not `Math.random()` for two reasons: the field has to be the
// same on every frame (a re-rolled field would boil), and it has to be the same
// for the icon generator, which is forbidden randomness outright.
//
// ── How little randomness, and why ──────────────────────────────────────────
// This pattern has been tuned down four times, each time toward *less* variation,
// and the record is worth keeping because every step removed something that had a
// real argument behind it:
//
//   1. **Free placement, pores spilling across period edges** (2-4 cells, one
//      period in four empty, anchored anywhere). The spill was deliberate: confining
//      a pore makes its offset range shrink as its size grows, which made a period's
//      middle 2.05× as likely to be void as its edge — a rhythm a whole wall shows
//      even though no single pore does. Spilling flattened that to 1.07×.
//   2. **That field read as styrofoam** (스티로폼 같은데). The spill is exactly why:
//      pores from neighbouring periods overlapped and merged into large irregular
//      voids, which is the structure of expanded polystyrene — big lumpy cells with
//      thin walls. Aerogel is the opposite, a fine even glassy foam. So the trade
//      reversed: pores confined, never merging, on a deliberately visible lattice.
//   3. **Pitch 6 → 4 → 3**, on two rounds of "smaller and closer together".
//   4. **Size fixed at the smaller of the two** (점 크기는 항상 똑같게 작은쪽으로).
//      The size roll was the last of the original three rolls to go.
//
// What is left is one roll: **a pore is nudged 0 or 1 cell in each axis**. The
// lattice is meant to read as a lattice; the nudge only keeps it from reading as a
// stamp. Density therefore varies by phase within a period — the middle of a period
// is void more often than its edges, which is what happens whenever a pore smaller
// than its period has to fit inside it, at any pitch. The first field's checks would
// have failed that. They are gone; what replaced them is in test/materialicons.ts.
//
// The checkerboard, rather than a pore in every period, is what buys the wall
// between pores at this pitch: a pore every 3 cells in both axes would leave no wall
// at all in places, and even at the previous 4-cell pitch it left a single cell,
// which reads as a crack rather than as a strut. Every other period keeps a whole
// period of solid between pores on the axes, and lets them meet only corner to
// corner on the diagonal.
//
// ── What it costs ──────────────────────────────────────────────────────────
// One hash per drawn cell, and nothing else — no state, no neighbour scan. That
// falls out of "a pore never leaves its period": the period a cell sits in is the
// only thing that can put a pore on it. (The spill version had to check the three
// periods a pore could reach in from, at 2.25 hashes a cell.) A Node microbenchmark
// of `poreAt` ALONE — a 400 × 300 board, every cell aerogel, 60 passes — runs about
// 0.7 ms per pass here, against 2.4 ms for the spill version. Treat the ratio, not
// the figure: an independent run of the same comparison on other hardware read 1.1
// vs 2.4, so what is stable across harnesses is "the confined field is the cheaper
// one by a factor of two or more". And it is not a render-loop profile either way —
// it excludes the branch dispatch around it, every other per-cell cost, and the
// canvas paint. It bounds this function's share, nothing more, and the browser
// measurement is still unmade (docs/MATERIAL-ICONS.md §5, item 3 — the render loop's
// cost, which is a different subsystem from the palette gallery's unmeasured DOM
// cost in item 2).

/** Cells per period. One period in two carries a pore (see `poreAt`). */
export const PORE_P = 3;

/** Every pore, in cells square — one size, always, and the smaller of the two this
 *  pattern used to roll between.
 *
 *  Two bounds, both pinned in `test/materialicons.ts` because nothing here enforces
 *  them:
 *
 *   • `PORE_SIZE < PORE_P`, so a pore fits its period *with room to be nudged*. It is
 *     what lets `poreAt` read one period instead of scanning neighbours; break it and
 *     pores are silently **clipped** at the period edge — still drawn, still the right
 *     colour, just missing a slice on the side they spilled toward. `PORE_P − PORE_SIZE`
 *     is also used as a bit mask, so it has to come out one less than a power of two.
 *   • `PORE_SIZE ≥ 2`, because a 1-cell void is indistinguishable from the per-grain
 *     speckle every powder carries. A pore has to read as a hole. */
export const PORE_SIZE = 2;

/** Patch edge for a `poresPattern` icon.
 *
 *  The binding constraint is the device-pixel grid, not the period: 9 and 18 are the
 *  only edges whose cells land on whole device pixels in the 18 px swatch (see
 *  materialSvg's `N`), so the choice is between those two and nothing else. 9 holds
 *  too few pores at any pitch this pattern would plausibly take — too small a sample
 *  to show either the arrangement or how open the surface is — so 18 it is.
 *
 *  Deliberately says nothing about how many periods that is. The tile is a crop of the
 *  field rather than a repeating tile, so it never had to close on a period boundary,
 *  and every version of this comment that counted periods went stale the next time the
 *  pitch moved (it has moved twice). If the pitch moves again, this stays 18. */
export const PORE_N = 18;

/** Salt mixed into the field's hash.
 *
 *  With one pore size left, every salt gives the same void fraction — the chip's
 *  window is 22.2% whichever one is picked, because the arrangement, not the sampling,
 *  decides it. What the salt still moves is which nudges land in the corner the icon
 *  samples (cells (0,0)…(17,17), since a palette chip has no world position), and this
 *  value shows every one of them. Nothing about the wall the player paints changes
 *  with this number. */
const PORE_SALT = 13;

/**
 * Pure 32-bit mix of a period's lattice coordinates.
 *
 * This is `tintNoise.hash8`'s mixer with one extra fold on the end. `hash8` hands
 * back its *top* byte and says so — that is the part a multiply mixes best, since
 * bit 0 of a product depends only on bit 0 of its inputs. This field slices further
 * down (the nudge reads bits 5 and 6), so it folds the high half down over the low
 * one first and gets the same guarantee for one xor.
 *
 * Measured, this particular mixer's low bits come out even without the fold — the
 * `h ^= h >>> 13` before the last multiply has already carried the high bits down.
 * The fold stays anyway: it costs one instruction per period, and it makes the
 * field's evenness a property of the code rather than of a measurement someone took
 * once and wrote in a comment.
 */
function poreHash(cx: number, cy: number): number {
  let h = (PORE_SALT + Math.imul(cx | 0, 0x27d4eb2d)) ^ Math.imul(cy | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16; // fold the well-mixed high bits down over the low ones
  return h >>> 0;
}

/**
 * Is this cell inside a pore?
 *
 * Positional (keyed to x/y, not to the particle) like the Mesh weave and the Wall's
 * courses, so a block dragged out with the brush is one continuous piece of foam
 * rather than a fresh pattern per stroke — and so a pore stays where it was while
 * the player builds around it.
 *
 * One roll, out of one hash: the pore's top-left corner is its period's own corner,
 * or one cell right, or one cell down, or both.
 *
 * Pores are square because the chip's are, and because at world scale a pore is two
 * cells across: a rasterised circle of that radius IS a square, and there is nothing
 * left to round off.
 *
 * The nudge runs forward only, never backward, for the same reason the pore is capped
 * below the period: a pore that could start one cell *before* its period would reach
 * into the previous one, and then a cell would have to ask its neighbours too.
 * Nudging the whole lattice one way is the same picture anyway — it is the spacing
 * between pores that the eye reads, not their offset from an origin it cannot see.
 *
 * Callers pass non-negative grid coordinates; the truncating divide below is a floor
 * only for those (the render loop's x/y and the icon patch's both are).
 */
export function poreAt(x: number, y: number): boolean {
  const cx = (x / PORE_P) | 0;
  const cy = (y / PORE_P) | 0;
  // The checkerboard: every other period, so each pore keeps a whole period of solid
  // around it on the axes and meets its diagonal neighbours corner to corner.
  if (((cx + cy) & 1) !== 0) return false;
  const h = poreHash(cx, cy);
  // The room the pore leaves inside its period, used as a mask — which is why it has
  // to be 0 or 1 (or any 2ⁿ − 1). The alternative, a modulo, would cost a divide per
  // drawn cell.
  const room = PORE_P - PORE_SIZE;
  const ox = cx * PORE_P + ((h >>> 5) & room);
  const oy = cy * PORE_P + ((h >>> 6) & room);
  return x >= ox && x < ox + PORE_SIZE && y >= oy && y < oy + PORE_SIZE;
}
