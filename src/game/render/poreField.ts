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
// most one cell**: a pore sits in every other period (PORE_P), is 2 or 3 cells
// square, and starts either on its period's corner or one cell in from it. That is
// the whole rule. About a fifth of the surface ends up void, against 22% grey in
// the chip.
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
//   • pores **may not merge**. A pore is confined to its own period, and its size
//     and jitter are bounded so it cannot reach the next one (PORE_MAX + PORE_JITTER
//     ≤ PORE_P). Measured over 300 × 300 cells, the longest run of void in either
//     axis is 3 — the widest a single pore can be, i.e. no two pores ever touch.
//   • the lattice **is** visible as a lattice, and that is now intended rather than
//     tolerated: the arrangement is regular, and the jitter is there to keep it from
//     being *rigid*, not to hide it. Density therefore varies by phase within a
//     period (a period's last row is void about a quarter as often as its second),
//     which the old field's checks would have failed. Those checks are gone; what
//     replaced them is in test/materialicons.ts.
//
// The checkerboard, rather than a pore in every period, is what buys the wall
// between pores at this pitch: a pore every 4 cells in both axes would leave a
// 1-cell wall, and a 1-cell wall reads as a crack rather than as a strut.
//
// ── What it costs ──────────────────────────────────────────────────────────
// One hash per drawn cell, and nothing else — no state, no neighbour scan. That
// falls out of "a pore never leaves its period": the period a cell sits in is the
// only thing that can put a pore on it. (The spill version had to check the three
// periods a pore could reach in from, at 2.25 hashes a cell.) A Node microbenchmark
// of `poreAt` ALONE — a 400 × 300 board, every cell aerogel, 60 passes — runs about
// 0.6 ms per pass here, against 2.4 ms for the spill version. Treat the ratio, not the
// figure: an independent run of the same comparison on other hardware read 1.1 vs 2.4,
// so what is stable across harnesses is "the checkerboard is the cheaper one by a
// factor of two or more". And it is not a render-loop profile either way — it excludes
// the branch dispatch around it, every other per-cell cost, and the canvas paint. It
// bounds this function's share, nothing more, and the browser measurement is still
// unmade (docs/MATERIAL-ICONS.md §5, item 3 — the render loop's cost, which is a
// different subsystem from the palette gallery's unmeasured DOM cost in item 2).

/** Cells per period. One period in two carries a pore (see `poreAt`), so there is a
 *  pore every PORE_P cells along each diagonal and every 2·PORE_P along each axis. */
export const PORE_P = 4;

/** Widest a pore can be. */
export const PORE_MAX = 3;

/** How far a pore may be nudged off its period's corner, in cells — that and the one
 *  cell of size are the whole of the pattern's randomness (위치 및 크기를 각각
 *  1픽셀씩만).
 *
 *  `PORE_MAX + PORE_JITTER ≤ PORE_P` is a correctness precondition, not taste: it is
 *  what keeps a pore inside its own period, and therefore what lets `poreAt` read one
 *  period instead of scanning neighbours. Break it and the widest, most jittered
 *  pores are silently **clipped** at the period edge — drawn as rectangles with a
 *  slice missing, on the side they spilled toward. `test/materialicons.ts` pins it.
 *
 *  It is also a mask, so it has to stay one less than a power of two. */
export const PORE_JITTER = 1;

/** Patch edge for a `poresPattern` icon.
 *
 *  18 rather than a multiple of PORE_P, because the constraint that actually binds
 *  is the device-pixel grid: 9 and 18 are the only edges whose cells land on whole
 *  device pixels in the 18 px swatch (see materialSvg's `N`), and 12 — three
 *  periods — would not. The tile is a crop of the field rather than a repeating
 *  tile, so it does not need to close on a period boundary; it needs to be a big
 *  enough *sample*, and 4½ periods each way is about ten pores. */
export const PORE_N = 18;

/** Salt mixed into the field's hash.
 *
 *  Any value gives the same statistics; this one is chosen so that the corner of
 *  the field the icon samples — cells (0,0)…(17,17), since a palette chip has no
 *  world position to sample at — comes out at 20.7% void against the field's 20.2%
 *  average, with both pore sizes and all four jitter positions in it. At salt 0 that
 *  same window reads 17.9%, a thinner-looking block than the material actually is.
 *  Nothing about the wall the player paints changes with this number — only which
 *  patch of foam the chip generator is looking at. */
const PORE_SALT = 11;

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
 *   • **size** — 2 or 3 cells square, evenly.
 *   • **jitter** — the pore's top-left corner is its period's own corner, or one
 *     cell right, or one cell down, or both.
 *
 * Pores are square because the chip's are, and because at world scale a pore is 2-3
 * cells across: a rasterised circle of that radius IS a square with at most its
 * corners nipped, and nipping them costs a compare per cell to draw the same
 * picture.
 *
 * The jitter runs 0…+PORE_JITTER rather than ±PORE_JITTER for the same reason the
 * pore is capped at PORE_MAX: a pore that could start one cell *before* its period
 * would reach into the previous one, and then a cell would have to ask its
 * neighbours too. Nudging the whole lattice one way is the same picture anyway — it
 * is the spacing between pores that the eye reads, not their offset from an origin
 * it cannot see.
 *
 * Callers pass non-negative grid coordinates; the truncating divide below is a floor
 * only for those (the render loop's x/y and the icon patch's both are).
 */
export function poreAt(x: number, y: number): boolean {
  const cx = (x / PORE_P) | 0;
  const cy = (y / PORE_P) | 0;
  // The checkerboard: every other period, so each pore keeps a wall of whole cells
  // around it on the axes and meets its diagonal neighbours corner to corner.
  if (((cx + cy) & 1) !== 0) return false;
  const h = poreHash(cx, cy);
  const s = 2 + (h & 1);
  const ox = cx * PORE_P + ((h >>> 5) & PORE_JITTER);
  const oy = cy * PORE_P + ((h >>> 6) & PORE_JITTER);
  return x >= ox && x < ox + s && y >= oy && y < oy + s;
}
