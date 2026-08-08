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
// The field is a **checkerboard lattice of small square pores, each nudged by at
// most one cell**: a pore sits in every other period (PORE_P), is 2 cells square —
// 3 one time in eight — and starts either on its period's corner or one cell in from
// it. That is the whole rule. About a quarter of the surface ends up void, a little
// more open than the chip's 22% grey, which is what the finer pitch buys.
//
// It is a hash and not `Math.random()` for two reasons: the field has to be the
// same on every frame (a re-rolled field would boil), and it has to be the same
// for the icon generator, which is forbidden randomness outright.
//
// ── Why so little randomness — the version that had more ────────────────────
// The first field went the other way. Its pores were anchored anywhere in their
// period, at 2-4 cells, with one period in four left empty, and they were allowed
// to spill across period boundaries so that no phase of the period was favoured
// (measured: every column of a period within 1.07× of every other, where confining
// the pores made a period's middle column 2.05× as likely to be void as its edge —
// a rhythm in density that no single pore shows but a whole wall does).
//
// **That field read as styrofoam** (스티로폼 같은데), and the spill is exactly why.
// Pores from neighbouring periods overlapped and merged into large irregular voids,
// which is the structure of expanded polystyrene: big lumpy cells with thin walls
// between them. Aerogel is the opposite — a fine, even, glassy foam. So the trade
// got made the other way round:
//
//   • pores **may not merge**. A pore is confined to its own period: its nudge is
//     whatever room its own size leaves it (`PORE_P − s`), so the fit is structural
//     rather than a bound someone has to remember. Measured over 300 × 300 cells, the
//     longest run of void in either axis is 3 — the widest a single pore can be, i.e.
//     no two pores ever touch.
//   • the lattice **is** visible as a lattice, and that is now intended rather than
//     tolerated: the arrangement is regular, and the jitter is there to keep it from
//     being *rigid*, not to hide it. Density therefore varies by phase within a
//     period (a period's last row is void about a quarter as often as its second),
//     which the old field's checks would have failed. Those checks are gone; what
//     replaced them is in test/materialicons.ts.
//
// The checkerboard, rather than a pore in every period, is what buys the wall between
// pores at this pitch: a pore every 3 cells in both axes would leave no wall at all in
// places, and even at the previous 4-cell pitch it left a single cell, which reads as
// a crack rather than as a strut. Every other period keeps a whole period of solid
// between pores on the axes, and lets them meet only corner to corner on the diagonal.
//
// **The pitch has come down twice on the same instruction** (더 작게·촘촘하게, then
// 간격 좀더 촘촘하게): 6 → 4 → 3, with the pore following it down 2-4 → 2-3 cells. At 3
// the two rolls stop being independent — a 3-cell pore fills its period exactly and has
// nowhere to be nudged to — so the nudge is read out of the room the size leaves rather
// than rolled separately. That is why one pore in eight is both the biggest and the only
// perfectly lattice-aligned one.
//
// ── What it costs ──────────────────────────────────────────────────────────
// One hash per drawn cell, and nothing else — no state, no neighbour scan. That
// falls out of "a pore never leaves its period": the period a cell sits in is the
// only thing that can put a pore on it. (The spill version had to check the three
// periods a pore could reach in from, at 2.25 hashes a cell.) A Node microbenchmark
// of `poreAt` ALONE — a 400 × 300 board, every cell aerogel, 60 passes — runs about
// 0.7 ms per pass here, against 2.4 ms for the spill version. Treat the ratio, not the
// figure: an independent run of the same comparison on other hardware read 1.1 vs 2.4,
// so what is stable across harnesses is "the checkerboard is the cheaper one by a
// factor of two or more". And it is not a render-loop profile either way — it excludes
// the branch dispatch around it, every other per-cell cost, and the canvas paint. It
// bounds this function's share, nothing more, and the browser measurement is still
// unmade (docs/MATERIAL-ICONS.md §5, item 3 — the render loop's cost, which is a
// different subsystem from the palette gallery's unmeasured DOM cost in item 2).

/** Cells per period. One period in two carries a pore (see `poreAt`), so there is a
 *  pore every PORE_P cells along each diagonal and every 2·PORE_P along each axis. */
export const PORE_P = 3;

/** The two pore sizes, in cells square — the whole of the size roll (크기를 1픽셀만),
 *  with the larger drawn one time in eight.
 *
 *  `PORE_MAX ≤ PORE_P` is a correctness precondition, not taste: a pore has to fit in
 *  the period it is anchored in, because that is what lets `poreAt` read one period
 *  instead of scanning neighbours. Break it and the widest pores are silently
 *  **clipped** at the period edge — drawn as rectangles with a slice missing.
 *
 *  `PORE_P − s` is used as a bit mask for the nudge, so every size must leave a room
 *  that is one less than a power of two. Both are pinned in `test/materialicons.ts`.
 *
 *  PORE_MIN is 2 and not 1 because a 1-cell void is indistinguishable from the
 *  per-grain speckle every powder carries — a pore has to read as a hole. */
export const PORE_MIN = 2;
export const PORE_MAX = 3;

/** Patch edge for a `poresPattern` icon.
 *
 *  18 rather than a multiple of PORE_P, because the constraint that actually binds
 *  is the device-pixel grid: 9 and 18 are the only edges whose cells land on whole
 *  device pixels in the 18 px swatch (see materialSvg's `N`), and 12 — three
 *  periods — would not. The tile is a crop of the field rather than a repeating
 *  tile, so it does not need to close on a period boundary; it needs to be a big
 *  enough *sample*, and six periods each way is about eighteen pores. */
export const PORE_N = 18;

/** Salt mixed into the field's hash.
 *
 *  Any value gives the same statistics; this one is chosen so that the corner of
 *  the field the icon samples — cells (0,0)…(17,17), since a palette chip has no
 *  world position to sample at — comes out at 25.3% void against the field's 25.9%
 *  average, with both pore sizes and all four jitter positions in it. Salts that miss
 *  the 3-cell pore entirely in that window are common (it is one pore in eight and the
 *  window holds about twenty), and a chip drawn from one of those says the pores are
 *  all one size, which is not what the wall does.
 *  Nothing about the wall the player paints changes with this number — only which
 *  patch of foam the chip generator is looking at. */
const PORE_SALT = 13;

/**
 * Pure 32-bit mix of a period's lattice coordinates.
 *
 * This is `tintNoise.hash8`'s mixer with one extra fold on the end. `hash8` hands
 * back its *top* byte and says so — that is the part a multiply mixes best, since
 * bit 0 of a product depends only on bit 0 of its inputs. This field slices the low
 * bits instead (the size roll is bit 0), so it folds the high half down over them
 * first and gets the same guarantee for one xor.
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
 * Two rolls, both sliced out of the one hash, and each moves the pore by exactly one
 * cell:
 *
 *   • **size** — 2 cells square, or 3 one time in eight.
 *   • **jitter** — the pore's top-left corner is its period's own corner, or one cell
 *     right, or one cell down, or both. A 3-cell pore fills its period and so has no
 *     room to be nudged: it always sits on the corner.
 *
 * Pores are square because the chip's are, and because at world scale a pore is 2-3
 * cells across: a rasterised circle of that radius IS a square with at most its
 * corners nipped, and nipping them costs a compare per cell to draw the same
 * picture.
 *
 * The jitter runs forward only, never backward, for the same reason the pore is capped
 * at PORE_MAX: a pore that could start one cell *before* its period would reach into
 * the previous one, and then a cell would have to ask its neighbours too. Nudging the
 * whole lattice one way is the same picture anyway — it is the spacing between pores
 * that the eye reads, not their offset from an origin it cannot see.
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
  const s = (h & 7) === 0 ? PORE_MAX : PORE_MIN;
  // Whatever room this size leaves inside the period — 1 cell for the small pore, none
  // for the large one. Used as a mask, which is why the room has to be 0 or 1 (or any
  // 2ⁿ − 1); the alternative, a modulo, would cost a divide per drawn cell.
  const room = PORE_P - s;
  const ox = cx * PORE_P + ((h >>> 5) & room);
  const oy = cy * PORE_P + ((h >>> 6) & room);
  return x >= ox && x < ox + s && y >= oy && y < oy + s;
}
