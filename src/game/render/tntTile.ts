// The TNT block's tile — a bundle of dynamite behind a printed paper label.
//
// Shared by the renderer (CanvasRenderer's `tntPattern` branch) and the palette
// icon generator (materialSvg's replay of that branch). Every other tile in the
// pair is a *rule* — a modulo and a comparison — cheap enough to state twice and
// small enough that a divergence between the two copies shows up in the golden
// tile. This one is a 256-cell bitmap, so a stray character in one copy would be
// invisible in review and would only ever be seen by whichever of the two the
// reader wasn't looking at. It lives in one module and both sides index it.
//
// It is also the one piece of art in the project with **lettering** on it.
// MATERIAL-ICON-BRIEF.md bans letters outright, and that ban is right for what it
// governs: a 24-cell drawing shown in an 18 px swatch, in an app that switches
// between Korean and English. Neither reason reaches here. This is a *world* tile
// — cells are as large as the zoom makes them, not fixed at ¾ of a pixel — and
// "TNT" on a red block is not a word being read but the same three glyphs a
// cartoon charge has always carried, in every language the game ships. It stays a
// one-off: the exception is this tile, not a licence for labelled materials.
import { rgb, tinted } from './color';

/**
 * Tile edge, in cells.
 *
 * Not a taste choice — the label sets it. A legible glyph on a pixel grid is 3
 * cells wide and 4 tall (a 2-cell-wide `T` has no stem to centre, a 3-row `N` has
 * no room for its diagonal), and three of them with a cell of letter-spacing need
 * 14; the paper needs a cell of margin above and below the text plus a shade row
 * on each edge, which is 6 rows; and the dynamite has to read as sticks on both
 * sides of the band, which wants at least 5 rows each. 5 + 6 + 5 = 16, and 16
 * columns is what leaves the word one cell of paper at each end.
 *
 * That is far coarser than the 6×6 crate grid this replaced, and the trade is
 * deliberate: a 6-cell period puts a block in every small charge, and a 16-cell
 * one puts a *readable* block in anything a charge is actually built at. A single
 * painted cell now shows a slice of red, or of paper, rather than a miniature
 * crate — which is what a single cell of a real crate looks like too.
 */
export const TNT_N = 16;

/**
 * One period, as ASCII. Authored as characters rather than generated so that what
 * ships is what someone read, and so `test/materialicons.ts` can golden it
 * directly (same argument as materialSvg's GAS_CLOUD and HAZARD_TREFOIL).
 *
 * | char | drawn as |
 * |---|---|
 * | `.` | the material's own colour — the body of a stick |
 * | `+` | that colour lit `TNT_LIT` — the round of each stick catching the light |
 * | `-` | `Material.lattice` — the shaded side where two sticks meet |
 * | `u` | the label's top edge, in shadow under the sticks above it |
 * | `p` | the label's paper |
 * | `d` | the label's bottom edge, darker than the top (it faces away from the light) |
 * | `#` | the printed ink |
 *
 * The stick columns repeat every 4 cells — lit, body, body, shade — so a bundle
 * reads as four cylinders rather than as stripes: the shade of one stick sits
 * immediately left of the next stick's highlight, and that light/dark pair is the
 * seam between two rounds. Rows above and below the label are identical on
 * purpose; a stick is straight, and offsetting the two halves would read as the
 * bundle being snapped in the middle.
 *
 * The two shade rows on the paper are what stop the label reading as a hole
 * punched through the block: the top edge is in the sticks' shadow and the bottom
 * edge is turned away from the light, so the band reads as a strip *wrapped
 * around* the bundle.
 */
const TILE = [
  '+..-+..-+..-+..-',
  '+..-+..-+..-+..-',
  '+..-+..-+..-+..-',
  '+..-+..-+..-+..-',
  '+..-+..-+..-+..-',
  'uuuuuuuuuuuuuuuu',
  'pp###p#pp#p###pp',
  'ppp#pp##p#pp#ppp',
  'ppp#pp#p##pp#ppp',
  'ppp#pp#pp#pp#ppp',
  'dddddddddddddddd',
  '+..-+..-+..-+..-',
  '+..-+..-+..-+..-',
  '+..-+..-+..-+..-',
  '+..-+..-+..-+..-',
  '+..-+..-+..-+..-',
];

/** Exported for `test/materialicons.ts` only.
 *
 *  A row that is not `TNT_N` characters long gets indexed past its end, and an
 *  out-of-range character falls through to the base colour in `buildTntTile` — so
 *  a short row paints as plain red rather than failing. As TILE stands the golden
 *  tile does catch that anywhere, because no row ends in a base-coloured character:
 *  the fallthrough always changes a pixel. What the harness pin adds is a legible
 *  reason instead of an ASCII diff, plus cover for a future row ending in `.`,
 *  where the truncated cell would fall through to the colour it already had.
 *
 *  Pinned in the harness rather than by a throw at module load: this module is
 *  imported by the renderer *and* by the palette components, so it ships to the
 *  browser, where a throw at import time would take the whole page down over a
 *  malformed string constant (same call as materialSvg's GAS_CLOUD_ROWS and the
 *  `tintBlock` mask). */
export const TNT_TILE_ROWS: readonly string[] = TILE;

/**
 * How far a stick's lit column is lifted above the material's colour.
 *
 * 65 rather than something smaller because the base is already saturated red
 * (TNT is `#db2a2a`, i.e. 219 on the red channel): the offset saturates red at
 * 255 and lifts green and blue by the full 65, which is exactly the reference
 * art's `#ff6b6b`. On a red that hot, a highlight *has* to desaturate — there is
 * nowhere left to go on the red channel — and that is what makes the round of a
 * stick read as a round rather than as a brighter red stripe.
 *
 * That exact hex is pinned by `test/materialicons.ts` ("the TNT tile is the
 * reference art's palette"), not by the golden tile — the golden names its tones
 * by luminance *rank*, so any offset leaving this the brightest tone goldens
 * identically. 40 draws `#ff5252` and used to pass everything.
 */
export const TNT_LIT = 65;

// The label is paper and ink, not shaded material, so these are literals rather
// than offsets from the base colour — the same call the batteries' flat black and
// the hazard trefoil's flat black make. A label that tinted with whatever it was
// printed on would stop reading as a label.
const PAPER = rgb(0xf0, 0xec, 0xe1);
const PAPER_TOP = rgb(0xd3, 0xce, 0xc4);
const PAPER_BOT = rgb(0xb5, 0xae, 0xa0);
const INK = rgb(0x1a, 0x1a, 0x1a);

/**
 * Resolve `TILE` against one material's two colours, giving the finished tile as
 * packed pixels.
 *
 * Called once per material — from the renderer's constructor and from the icon
 * generator's patch — never per cell, so the render loop's whole cost for this
 * pattern is one array index. `base` is `Material.color` and `lat` is
 * `Material.lattice` (falling back to `base` when a material carries none, as the
 * rest of the branch chain does), which is what keeps the pattern a *hint* rather
 * than a picture of TNT specifically: the reds come from whatever material sets
 * `tntPattern`, and only the paper label is fixed.
 */
export function buildTntTile(base: number, lat: number): Uint32Array {
  const lit = tinted(base, TNT_LIT);
  const buf = new Uint32Array(TNT_N * TNT_N);
  for (let y = 0; y < TNT_N; y++) {
    const row = TILE[y];
    for (let x = 0; x < TNT_N; x++) {
      const ch = row[x];
      buf[y * TNT_N + x] =
        ch === '+'
          ? lit
          : ch === '-'
            ? lat
            : ch === 'u'
              ? PAPER_TOP
              : ch === 'p'
                ? PAPER
                : ch === 'd'
                  ? PAPER_BOT
                  : ch === '#'
                    ? INK
                    : base;
    }
  }
  return buf;
}
