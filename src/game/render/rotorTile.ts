// The bladed-rotor tiles — a Turbine's eight-blade wheel and a Fan's four-blade
// propeller, as the world sees them.
//
// Shared by the renderer (CanvasRenderer's `rotorPattern` branch) and the palette
// icon generator (materialSvg's replay of that branch), for the reason tntTile.ts
// states: a tile held as a *rule* is cheap enough to write twice, but a bitmap
// copied into two files diverges by one character and nobody sees it. These are
// bitmaps, so they live in one module and both sides index them.
//
// Why a bitmap at all, when the Woofer draws a circle from squared radii: a
// rotor is not a radial function. Its blades sweep — every one of them is lit on
// its leading edge and shaded on its trailing edge — and that handedness is the
// whole reason a wheel of spokes reads as something that *turns* rather than as
// a star. There is no closed form for it at this size that is shorter than
// writing the twelve rows out.
import { scaled } from './color';

/**
 * Tile edge, in cells, for both rotors.
 *
 * The drawings these come from are 24-cell chips, and 12 is the exact half: a
 * blade that spans two thirds of the chip spans two thirds of the tile, the hub
 * is a quarter of the wheel in both, and nothing has to be re-proportioned by
 * eye. Halving rather than shipping the 24 itself is the same call the gas cloud
 * makes (materialSvg's GAS_CLOUD) — a period is drawn in *world* cells, so a
 * 24-cell wheel would need a machine two dozen cells across before one whole
 * rotor appeared, and a Fan is routinely built four cells wide.
 *
 * The tiles keep their outermost row and column clear, so neighbouring rotors in
 * a dragged-out block stay separate wheels instead of merging into a mesh.
 */
export const ROTOR_N = 12;

/**
 * A rotor tile's alphabet.
 *
 * | char | drawn as |
 * |---|---|
 * | `.` | the material's own colour — the housing behind the wheel |
 * | `+` | `Material.lattice` — a blade's lit leading edge |
 * | `-` | the base scaled by ROTOR_SHADE — the same blade's trailing edge, in its own shadow |
 * | `#` | the base scaled by ROTOR_HUB — the hub the blades are keyed to |
 *
 * Every blade carries the `+`/`-` pair, and the pair always sits the same way
 * round as you go round the wheel: that is what makes eight identical spokes read
 * as eight blades turning one way rather than as a snowflake. Both tiles are
 * exactly symmetric under a 90° rotation about the hub, which is what a real
 * rotor is, and what makes a wrongly transposed row obvious in the golden.
 */

/**
 * The Turbine: eight blades — four on the axes, four on the diagonals — keyed to
 * a 2×2 hub.
 *
 * Eight is what the machine actually is (a steam wheel is a dense disc of blades,
 * not a household fan), and eight is also the most a 12-cell tile will hold: at
 * the rim the blades are four cells apart, so one more pair would put two blades
 * in adjacent cells and the wheel would fill in solid.
 *
 * The diagonal blades are 2-cell staircases rather than 1-cell lines — a 1-cell
 * diagonal is 0.7 cells thick and breaks up, the same reason the hand-drawn
 * layer's brief asks for two-unit minimum features.
 */
const ROTOR8 = [
  '............',
  '..-..+-.....',
  '..+-.+-..+-.',
  '...+-+-.+-..',
  '....++-+-...',
  '.----##++++.',
  '.++++##----.',
  '...-+-++....',
  '..-+.-+-+...',
  '.-+..-+.-+..',
  '.....-+..-..',
  '............',
];

/**
 * The Fan: four blades, each a paddle that widens away from the hub.
 *
 * Straight paddles rather than the drawn chip's swept ones. The chip has 24 cells
 * to curve a blade in and still read as a blade; at 12 a swept four-arm figure
 * degenerates into four bent one-cell lines, which is both illegible as a fan and
 * an unfortunate shape to stamp across a canvas. What carries over is the
 * structure — four blades, a keyed hub, lit leading edge and shaded trailing edge
 * — which is the same thing the Wall's masonry took from its own chip (structure,
 * not measurements; see docs/MATERIAL-ICONS.md §4.1).
 */
const ROTOR4 = [
  '............',
  '.....+--....',
  '....++--....',
  '....++-.....',
  '.--..+-.++..',
  '.----##++++.',
  '.++++##----.',
  '..++.-+..--.',
  '.....-++....',
  '....--++....',
  '....--+.....',
  '............',
];

/** Exported for `test/materialicons.ts` only — same argument as TNT_TILE_ROWS: a
 *  row narrower than ROTOR_N is indexed past its end and falls through to the base
 *  colour, which on these tiles reads as a chipped blade rather than as an error.
 *  Pinned in the harness rather than thrown at module load because this module
 *  ships to the browser (see tntTile.ts). */
export const ROTOR_TILE_ROWS: Readonly<Record<number, readonly string[]>> = { 8: ROTOR8, 4: ROTOR4 };

/** How dark a blade's trailing edge is, as a fraction of the material's colour.
 *  0.72 is the ratio the drawn Turbine chip already used (`#96a0ac` → `#6c737b`),
 *  so the wheel on the board is lit exactly the way the wheel in the palette is. */
export const ROTOR_SHADE = 0.72;
/** The hub, likewise: `#96a0ac × 0.45` is `#43484d`, the chip's own hub tone. */
export const ROTOR_HUB = 0.45;

/**
 * Resolve one rotor's ASCII against a material's two colours, giving the finished
 * tile as packed pixels.
 *
 * Called once per material — from the renderer's constructor and from the icon
 * generator's patch — never per cell, so the render loop's whole cost for this
 * pattern is one array index (the same shape as buildTntTile). `blades` picks
 * which wheel; anything but 4 or 8 falls back to the four-blade tile rather than
 * throwing, because this runs at page load in the browser.
 */
export function buildRotorTile(blades: number, base: number, lat: number): Uint32Array {
  const rows = blades === 8 ? ROTOR8 : ROTOR4;
  const shade = scaled(base, ROTOR_SHADE);
  const hub = scaled(base, ROTOR_HUB);
  const buf = new Uint32Array(ROTOR_N * ROTOR_N);
  for (let y = 0; y < ROTOR_N; y++) {
    const row = rows[y];
    for (let x = 0; x < ROTOR_N; x++) {
      const ch = row[x];
      buf[y * ROTOR_N + x] = ch === '+' ? lat : ch === '-' ? shade : ch === '#' ? hub : base;
    }
  }
  return buf;
}
