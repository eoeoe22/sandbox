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
// The chip's holes sit on a regular row-and-column grid, which is fine for a
// 24-cell picture read at 18 px but not for a wall the player drags out fifty
// cells wide: a fixed period with a fixed hole size stops reading as foam and
// starts reading as *perforated sheet metal*. So the world field keeps the chip's
// proportions and randomises what would otherwise be legible about them — size,
// position within the period, and whether a given period has a hole at all —
// from a hash of the period's coordinates.
//
// It is a hash and not `Math.random()` for two reasons: the field has to be the
// same on every frame (a re-rolled field would boil), and it has to be the same
// for the icon generator, which is forbidden randomness outright.
//
// ── Why a lattice of holes rather than a free scatter ───────────────────────
// One hole per period keeps this affordable in the render loop. A free (Poisson)
// scatter has no bound on how far away a hole that covers a given cell might have
// been placed, so every cell would have to test a whole neighbourhood of
// candidates; anchoring one hole per period bounds it at four.
//
// Four, and not one, because the hole is anchored anywhere in its period and may
// extend past the period's right and bottom edges — see PORE_MAX. The cheaper
// version, where a hole is confined to its own period, was measurably worse in a
// way that is easy to miss by eye but is exactly what this pattern exists to
// avoid: confining the hole means its offset has to shrink as its size grows, so
// the middle columns of every period end up covered by far more (size, offset)
// combinations than the edge columns. Measured over 300 × 300 cells, the middle
// of a period was **2.9× as likely to be void** as its edge — a six-cell rhythm
// in density, faint per hole but coherent across a whole wall. Letting holes
// spill over the edges makes every phase of the period equally likely (the anchor
// is uniform over the period, and a hole covers `s` consecutive cells from it), and
// the measured spread falls to 1.06×. `test/materialicons.ts` pins that number.
//
// The spill is worth something in itself: holes from neighbouring periods now
// overlap and merge into larger irregular voids, which is what an open-cell foam
// actually looks like.

/** Cells per period, one hole to a period. Six is the chip's own proportion
 *  brought to world scale: its 24-cell tile carries four holes across, so a hole
 *  and its surrounding wall occupy six cells. */
export const PORE_P = 6;

/** Widest a hole can be, and therefore how far past its own period one can reach.
 *  The neighbour scan in `poreAt` is a 2×2 of periods, which is only enough while
 *  this stays ≤ PORE_P: a hole wider than a period could reach in from two periods
 *  away and would be missed, leaving a bite out of its own side. */
export const PORE_MAX = 4;

/** Patch edge for a `poresPattern` icon: three whole periods, so the derived tile
 *  is a *sample* of the field (about nine holes, at a range of sizes) rather than
 *  the crop of one that the default 9-cell patch would give — and 18 lands on
 *  whole device pixels in the 18 px swatch exactly as 9 does (see materialSvg's
 *  `N`), which 12 would not. */
export const PORE_N = 3 * PORE_P;

/** Salt mixed into the field's hash.
 *
 *  Any value gives the same statistics; this one is chosen so that the corner of
 *  the field the icon samples — cells (0,0)…(17,17), since a palette chip has no
 *  world position to sample at — comes out at 22.5% void against the field's 22.3%
 *  average, with holes at all three sizes in it. At salt 0 that same window happens
 *  to land on a run of skipped and small holes and reads 15%, which would make the
 *  derived tile (and the golden
 *  pinned on it in test/materialicons.ts) a picture of an aerogel block that is
 *  barely porous. Nothing about the wall the player paints changes with this
 *  number — only which patch of foam the chip generator is looking at. */
const PORE_SALT = 12;

/**
 * Pure 32-bit mix of a period's lattice coordinates.
 *
 * This is `tintNoise.hash8`'s mixer with one extra fold on the end. `hash8` hands
 * back its *top* byte and says so — that is the part a multiply mixes best, since
 * bit 0 of a product depends only on bit 0 of its inputs. This field slices the
 * low bits instead (the skip flag is bits 0..2), so it folds the high half down
 * over them first and gets the same guarantee for one xor.
 *
 * Measured, this particular mixer's low bits come out even without the fold — the
 * `h ^= h >>> 13` before the last multiply has already carried the high bits down.
 * The fold stays anyway: it costs one instruction per period, and it makes the
 * field's evenness a property of the code rather than of a measurement someone
 * took once and wrote in a comment.
 *
 * Lattice coordinates may be −1: a cell in the world's first row or column is
 * tested against the period *before* it, which is what keeps the board's edge from
 * being the one place where no hole ever spills in.
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
 * Is cell (x, y) inside the hole anchored in period (cx, cy)?
 *
 * The three rolls, all sliced out of the one hash:
 *
 *   • **solid period** — 1 in 8 periods has no hole at all. This is what breaks up
 *     the rows: without it every 6-cell band across a wall contains a hole
 *     somewhere, and the eye finds the band.
 *   • **size** — 2, 3, 3 or 4 cells square (3 twice as likely as either end): the
 *     chip's 3-4 cells in 24, plus a smaller one so the field has grain as well as
 *     holes.
 *   • **anchor** — any of the six cells of the period, top-left corner of the hole.
 *
 * Holes are square because the chip's are, and because at world scale a hole is
 * 2-4 cells across: a rasterised circle of that radius IS a square with at most its
 * corners nipped, and nipping them costs a compare per cell to draw the same
 * picture.
 */
function poreAnchored(cx: number, cy: number, x: number, y: number): boolean {
  const h = poreHash(cx, cy);
  if ((h & 7) === 0) return false; // solid period
  const s = 2 + ((h >>> 3) & 1) + ((h >>> 4) & 1); // 2 / 3 / 3 / 4
  // Wide slices so `% PORE_P` is near-uniform: 8192 leaves a remainder of 2, i.e.
  // 0.02% of bias toward the low anchors. A byte would leave 4 in 256.
  const ox = cx * PORE_P + (((h >>> 5) & 0x1fff) % PORE_P);
  const oy = cy * PORE_P + (((h >>> 18) & 0x1fff) % PORE_P);
  return x >= ox && x < ox + s && y >= oy && y < oy + s;
}

/**
 * Is this cell inside a hole?
 *
 * Positional (keyed to x/y, not to the particle) like the Mesh weave and the
 * Wall's courses, so a block dragged out with the brush is one continuous piece of
 * foam rather than a fresh pattern per stroke — and so a void stays where it was
 * while the player builds around it.
 *
 * A cell is covered by the hole of its own period or by one spilling in from the
 * period to its left, above, or diagonally up-left; holes only ever extend right
 * and down from their anchor, so those four are the whole search (PORE_MAX).
 * Average coverage works out at 22.3%, against 22% grey in the chip.
 *
 * Most cells do not need all four. A hole anchored in the period to the left starts
 * at worst on that period's last cell and is at worst PORE_MAX wide, so it cannot
 * reach further than PORE_MAX − 2 cells into this one — a cell past that is out of
 * reach of everything to its left, and the same holds downward. Half the columns and
 * half the rows of a period are therefore exempt, which takes the average from 3.4
 * hashes per cell to 2.25 (measured: a board filled edge to edge with aerogel, the
 * worst case there is, costs 3.0 ms a frame at 400 × 300 rather than 3.8).
 *
 * Callers pass non-negative grid coordinates; the truncating divide below is a
 * floor only for those (the render loop's x/y and the icon patch's both are).
 */
export function poreAt(x: number, y: number): boolean {
  const cx = (x / PORE_P) | 0;
  const cy = (y / PORE_P) | 0;
  const spillX = x - cx * PORE_P < PORE_MAX - 1;
  const spillY = y - cy * PORE_P < PORE_MAX - 1;
  return (
    poreAnchored(cx, cy, x, y) ||
    (spillX && poreAnchored(cx - 1, cy, x, y)) ||
    (spillY && poreAnchored(cx, cy - 1, x, y)) ||
    (spillX && spillY && poreAnchored(cx - 1, cy - 1, x, y))
  );
}
