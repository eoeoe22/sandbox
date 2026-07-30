// The Woofer's speaker driver — the radial geometry of one driver, and how far its
// diaphragm is pushed out at each step of a thump.
//
// Shared by the renderer (CanvasRenderer's `wooferPattern` branch) and the palette
// icon generator (materialSvg's replay of it) rather than mirrored on both sides,
// which is what every other *rule*-shaped pattern here does (see materialSvg's note
// on the mirrored tile constants). The driver stopped being rule-shaped the moment
// the diaphragm started moving: three radii are cheap enough to write twice, three
// radii × four excursion steps — with the rest step having to be *exactly* the one
// the palette chip draws — is a table, and a table copied into two files diverges by
// one number and nobody sees it. Same argument as the bitmap tiles (tntTile.ts).

/**
 * Tiling period, in cells: one round driver per WOOFER_P² tile, 8 cells across at
 * rest with 4 cells of baffle between neighbours.
 *
 * Every number in this module is the hand-drawn Woofer chip's, halved. The chip is a
 * 24-cell tile holding a driver of diameter 16, a cone starting at r = 6.5 and a cap
 * of r = 4; this is a 12-cell tile holding diameter 8, cone at r = 3.25 and cap
 * r = 2. So the driver takes the same 0.67 of its tile in both, the rim is the same
 * 1/12 of the tile thick in both, and the cap is the same third of the driver across
 * — the chip and the board are one picture at two scales rather than two drawings of
 * a speaker.
 *
 * The period was 9 with a 7-cell driver, which was the same *idea* built by eye: 0.78
 * of the tile, a 1-cell rim where the chip has two cells' worth, and a cap barely a
 * third the cone's width. Before that it was 8 with a 6-cell driver, and that one was
 * wrong rather than merely off-proportion — an EVEN diameter has no centre row, so it
 * rasterized 4/6/6/6/6/4 and read as a hexagon. 8 is even too, but at this radius the
 * widths come out 4/6/8/8/8/8/6/4: two graduated steps into each pole, which is what
 * reads as round. (The chip's own 16-across driver is even for the same reason and
 * rasterizes the same way, which is exactly why halving it works.)
 */
export const WOOFER_P = 12;

// ── The thump (진동판 애니메이션) ──────────────────────────────────────────────
// A Woofer's driver is drawn as three radial bands — a dust cap, a cone, a rim — and
// while the cabinet is thumping the whole driver **swells and settles back**, which
// is the cue that it fired. Before this it drew the same still driver whether it had
// just thumped or had never been wired to anything: the shockwave was the only sign,
// and a Woofer whose wave was blocked by an adjacent wall gave no sign at all.
//
// The bands are held as one array per band, indexed by *excursion step* — 0 the cone
// at rest, the last entry fully out — so the render branch stays the same three
// compares it already was, with the constant swapped for one array read. Step 0 is
// the geometry the palette chip is drawn at, so the chip and an idle cabinet are the
// same picture, exactly as before the animation existed.
//
// Membership is tested on SQUARED radii in doubled coordinates, so a cell's band
// falls out of integer arithmetic with no sqrt and no lookup table:
// `2*(x % P) - (P-1)` puts the tile's centre at 0 whether the period is odd or even.
// A doubled offset is always odd, so the only squared distances that exist in the
// tile are sums of two odd squares — 2, 10, 18, 26, 34, 50, 58, 74, 82, 90, 98, … —
// and the steps below are cuts between *those*, not evenly spaced radii. That is why
// they look irregular: each one is the next actual ring of cells, and anything
// between two of them draws identically to the lower one.
//
// What the four steps come out as, in cells of a 12-cell tile:
//
// | step | cap | cone | rim | driver | widest row |
// |---|---|---|---|---|---|
// | 0 (rest) | 12 | 20 | 20 | 52 | 8 |
// | 1 | 16 | 28 | 16 | 60 | 8 |
// | 2 | 24 | 20 | 24 | 68 | 10 |
// | 3 (full) | 32 | 20 | 28 | 80 | 10 |
//
// So the driver grows by half again over the thump and its widest row by two cells,
// the dust cap goes from 4 across to 6, and at full excursion two cells of baffle are
// still left between neighbouring drivers — a cabinet never fuses into one blob.
//
// The rim rides outward with the cone rather than staying put as a fixed basket. At
// twelve cells the honest reading (a moving cone inside a fixed surround) has exactly
// one cell of travel before the cone eats the rim and the driver loses its outline;
// letting the whole driver swell keeps all three bands legible at every step, and a
// cone pushed toward the viewer reading as *bigger* is the same foreshortening trick
// the drawing already uses.

/** Squared radius (doubled coordinates) of the dust cap, per excursion step. */
export const WOOFER_CAP_R2 = [16, 18, 26, 34];
/** …of the cone, i.e. the outer edge of the `lattice`-coloured band. */
export const WOOFER_CONE_R2 = [42, 50, 50, 58];
/** …of the driver itself, i.e. the outer edge of the rim. Past this is baffle. */
export const WOOFER_R2 = [64, 74, 82, 98];

/** Excursion step of a driver at rest — the one the palette chip draws. */
export const WOOFER_REST = 0;
/** How many excursion steps there are, rest included. */
export const WOOFER_THUMP_STEPS = WOOFER_CAP_R2.length;

/**
 * Which driver tile a cell belongs to: the row-major index of its WOOFER_P tile on a
 * board `tilesW` tiles across.
 *
 * The tile is the animation unit because it is already the drawing unit — the pattern
 * is positional (`x % WOOFER_P`), so one tile is exactly one driver. Grouping the
 * excursion per *cell* instead would tear a driver in half whenever two separate
 * cabinets shared a tile and only one of them fired, the same failure the rotor wheels
 * had (see rotorTile.ts's `rotorBlockIndex`). Two bodies sharing a tile now swell
 * together when either fires, which is a much smaller lie than half a driver bulging.
 */
export function wooferTileIndex(x: number, y: number, tilesW: number): number {
  return ((y / WOOFER_P) | 0) * tilesW + ((x / WOOFER_P) | 0);
}

/**
 * How far the diaphragm is out, given how far this firing's own shockwave front has
 * travelled (`r`) of the reach it will travel in all (`maxR`).
 *
 * **This is the synchronisation**, and it is deliberately expressed against the wave's
 * *position* rather than against a frame count or a wall clock: the cone is fully out
 * at the instant the front leaves the cabinet and is back at rest as the front reaches
 * the rim and dissolves, whatever speed the wave is drawn at and however far it
 * reaches. One thump, one excursion, one clock — a Woofer can't get out of step with
 * its own wave, and nothing has to be re-tuned if SHOCK_SPEED ever changes.
 *
 * Out-and-decay rather than a symmetric in-and-out: the pulse is what *launches* the
 * wave, so the cone's furthest point is the wave's own origin in time. A cone that
 * eased outward would be pushing air the wave had already left with.
 *
 * At the shipped SHOCK_SPEED (1.2 cells/frame) and reach (8), a firing runs the steps
 * 3, 2, 2, 1, 1, 0, 0 over its seven drawn frames — about an eighth of a second of
 * swell at 60 fps, which is a thump rather than a wobble. Seven and not eight because
 * a wave's first pass (age 0, radius 0) paints no ring at all: the spawn dither gates
 * it out at fade 0. That is also what keeps the swell and the ring in the same frame
 * rather than one apart — see the build loop in CanvasRenderer.render.
 */
export function wooferExcursion(r: number, maxR: number): number {
  const top = WOOFER_THUMP_STEPS - 1;
  if (!(maxR > 0)) return WOOFER_REST; // degenerate reach — nothing to be in step with
  const left = 1 - r / maxR; // 1 at the body's surface → 0 at the rim
  if (left <= 0) return WOOFER_REST;
  const step = Math.round(left * top);
  return step > top ? top : step; // r < 0 can't happen, but a clamp costs nothing
}
