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
 * Simulation ticks each animation frame is held for, as a right-shift on the
 * spin counter (see `rotorFrame`). 1 = every two ticks.
 *
 * The sim runs at 30 Hz at ×1 (config's SIM_HZ_AT_1X), so this alternates the two
 * frames at 7.5 Hz. Flipping every tick reads as a strobe rather than as a wheel;
 * every four is slow enough that you see two pictures instead of one turning
 * thing. Both frames are half a blade pitch apart, so one flip is the largest
 * apparent step the wheel can make — which is what buys the low rate.
 */
export const ROTOR_SPIN_SHIFT = 1;

/**
 * One cell's contribution to its wheel's spin: the machine's own working counter,
 * dug out of the cell's aux byte.
 *
 * Deliberately driven by sim state rather than by a renderer clock (contrast the
 * wind streaks' `windPhase`), because both machines already carry a counter that
 * advances exactly when they are *working*:
 *
 *   - a Fan's `aux >> 2` is its powered countdown, which ticks down while energized
 *     and sits at 0 when it isn't (materials/fan.ts POWERED_TICKS);
 *   - a Turbine's whole aux is its steam-tick count, which advances only on ticks
 *     where steam is actually passing through and is deliberately *held* across a
 *     gap rather than reset (materials/turbine.ts).
 *
 * So the wheel turns while the machine runs and freezes the instant it stops, with
 * no extra state and nothing for the renderer to keep in sync. A renderer clock
 * would have needed a separate "is it running" test, and for the Turbine there is
 * no correct one — a stalled turbine's counter stays non-zero, so "aux ≠ 0" would
 * have left a dead turbine spinning forever.
 *
 * `shift` drops the bits of aux that are not the counter — 2 for the Fan, whose low
 * two bits are its blow direction, 0 for the Turbine. Clamped to a byte so the
 * renderer can hold a whole wheel's aggregate in a Uint8Array; both counters are
 * far below that (Fan ≤ POWERED_TICKS, Turbine < PULSE_PERIOD) and a clamp keeps a
 * stray large aux from wrapping into a *small* number and faking a rewind.
 */
export function rotorSpin(aux: number, shift: number): number {
  const c = aux >> shift;
  return c < 0 ? 0 : c > 255 ? 255 : c;
}

/**
 * Which of the two frames a spin counter draws.
 *
 * Takes the counter rather than a raw aux because the unit of animation is the
 * *wheel*, not the cell: the renderer aggregates `rotorSpin` across a whole tile
 * first and only then asks for a frame (see CanvasRenderer's rotorBlockFrame). A
 * Turbine advances the counter only on the cells steam is actually passing through,
 * so asking each cell for its own frame drew a wheel spinning along the steam's
 * path and standing still on the rest of itself.
 *
 * A stopped machine freezes on whichever frame it was on, not necessarily frame 0.
 * A freshly painted cell has aux 0 and so does the palette chip, which is why the
 * icon always shows frame 0.
 */
export function rotorFrame(spin: number): number {
  return (spin >> ROTOR_SPIN_SHIFT) & 1;
}

/**
 * Which wheel a cell belongs to: the row-major index of its ROTOR_N tile on a
 * board `blocksW` tiles across.
 *
 * The tile is the animation unit *because* it is already the drawing unit — the
 * pattern is positional (`x % ROTOR_N`), so one tile is exactly one wheel, and
 * grouping the phase by anything else would group parts of two wheels together.
 */
export function rotorBlockIndex(x: number, y: number, blocksW: number): number {
  return ((y / ROTOR_N) | 0) * blocksW + ((x / ROTOR_N) | 0);
}

/**
 * Fold one cell's aux into its wheel's spin accumulator: a wheel's counter is the
 * **maximum** of its cells'.
 *
 * Max rather than an OR of the cells' frames, which is the other obvious way to
 * make a tile agree with itself. A Turbine mid-operation holds a cell at nearly
 * every count (soaked cells leading, grazed cells lagging, dry cells at 0), so an
 * OR is 1 as good as always and the wheel would have swapped tearing for standing
 * still on the spun frame. The max is the leading cell's count, which advances one
 * per tick like a real counter — so the wheel turns at the machine's own rate, and
 * a stalled one freezes on the frame its leader died on rather than snapping back
 * to rest because most of its cells read 0.
 *
 * Max rather than a mean for a duller reason too: a wheel being driven anywhere
 * should look driven, and the leader is the part of it the steam is actually
 * hitting.
 */
export function rotorAccumulate(acc: Uint8Array, bi: number, aux: number, shift: number): void {
  const spin = rotorSpin(aux, shift);
  if (spin > acc[bi]) acc[bi] = spin;
}

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
 * The Turbine, half a blade pitch on — eight spokes at 22.5°/67.5° instead of on
 * the axes and diagonals.
 *
 * **Half a pitch, not the 45° the four-blade frame turns.** An eight-blade wheel
 * has 45° between blades, so turning it 45° lands every blade exactly where its
 * neighbour was and the picture does not change at all — the animation would be a
 * still. 22.5° is the largest step that actually moves the blades, and it is also
 * the step that reads as the fastest rotation, which is why the frame rate above
 * can be as low as it is.
 *
 * Authored rather than rotated from ROTOR8 by program. A nearest-neighbour rotate
 * of a wheel whose spokes are one and two cells thick comes back as scattered dots
 * — it was tried, and it destroyed the spokes. Instead the same construction is
 * repeated at the new angles: one spoke traced along each of 22.5° and 67.5° from
 * the tile centre, each a lit run with a shaded run beside it, then both turned
 * three times. That keeps the wheel exactly symmetric under a quarter turn (the
 * harness checks it) and keeps the same 60 painted cells as ROTOR8.
 */
const ROTOR8_SPUN = [
  '............',
  '...+-..+-...',
  '...+-.+-....',
  '.-..+-+-.++.',
  '.+--+-.++--.',
  '..++.##--...',
  '...--##.++..',
  '.--++.-+--+.',
  '.++.-+-+..-.',
  '....-+.-+...',
  '...-+..-+...',
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

/**
 * The Fan, half a blade pitch on — the same four paddles turned 45° onto the
 * diagonals.
 *
 * Four blades sit 90° apart, so half a pitch is exactly the 45° an X is from a +,
 * and the two frames are about as different as two pictures of one wheel can be.
 * That is what lets the flip rate stay low enough not to strobe.
 *
 * Same construction as ROTOR4, one blade rotated three times, so the paddle keeps
 * its twelve cells and its lit-leading / shaded-trailing split, and the tile stays
 * symmetric under a quarter turn.
 */
const ROTOR4_SPUN = [
  '............',
  '.++......-+.',
  '.-++....-++.',
  '..-++..-++..',
  '...-++-++...',
  '....-##+....',
  '....+##-....',
  '...++-++-...',
  '..++-..++-..',
  '.++-....++-.',
  '.+-......++.',
  '............',
];

/** Exported for `test/materialicons.ts` only — same argument as TNT_TILE_ROWS: a
 *  row narrower than ROTOR_N is indexed past its end and falls through to the base
 *  colour, which on these tiles reads as a chipped blade rather than as an error.
 *  Pinned in the harness rather than thrown at module load because this module
 *  ships to the browser (see tntTile.ts). */
export const ROTOR_TILE_ROWS: Readonly<Record<string, readonly string[]>> = {
  '8': ROTOR8,
  '4': ROTOR4,
  '8-spun': ROTOR8_SPUN,
  '4-spun': ROTOR4_SPUN,
};

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
 * Called once per material *per frame of the animation* — from the renderer's
 * constructor and from the icon generator's patch — never per cell, so the render
 * loop's whole cost for this pattern is one array index (the same shape as
 * buildTntTile). `blades` picks which wheel and `spun` which of its two frames;
 * anything but 4 or 8 falls back to the four-blade tile rather than throwing,
 * because this runs at page load in the browser.
 */
export function buildRotorTile(blades: number, base: number, lat: number, spun = false): Uint32Array {
  const rows = blades === 8 ? (spun ? ROTOR8_SPUN : ROTOR8) : spun ? ROTOR4_SPUN : ROTOR4;
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
