import { rgb } from './color';
import type { MolotovBottle } from '../engine/objects';

/**
 * The Molotov cocktail sprites — the *display* half of the molotov object, kept
 * apart from its physics (a capsule body; see engine/objects.ts SimMolotov)
 * exactly like the drum/dynamite/smoke-bomb/crate sprites: flat Uint32 grids of
 * packed 0xAABBGGRR colors with 0 = transparent, sampled by the renderer at
 * OBJECT_SCALE.
 *
 * Two sprites live here, and they are one bottle drawn twice — the same
 * silhouette with its contents swapped, the `Record<DrumFill, …>` colour-swap
 * pattern (drumSprite.ts) rather than two unrelated drawings:
 *   - `full`  — the thrown bottle: amber fuel behind glass, paper label, cloth wick.
 *   - `empty` — what's left after the fuel has burnt off for fifteen seconds: the
 *     same bottle with clear glass where the fuel was and an open, wickless neck.
 * The wick's FLAME is deliberately not drawn in either: a lit molotov emits real
 * Fire particles into the grid at its neck (see objects.ts), the same way the
 * dynamite's fuse and the burning crate do, so the sprite never claims a fire
 * the world doesn't have.
 *
 * The art is transcribed from the design's reference SVG as ASCII rows rather
 * than as a list of fillRect calls (form B in the create-svg-assets skill): the
 * bottle's stepped shoulders and its per-column shading would be an unreadable
 * pile of rects, while the rows below *are* the picture. Its 12×28 pixel box is
 * the single source of truth for the body geometry too — engine/objects.ts scales
 * it into the capsule's radius/half-length — so art and physics cannot drift.
 *
 * The palette is the handoff's, and it is wider than the two-to-four colours the
 * other bodies use because a bottle is genuinely four materials in one
 * silhouette (glass, fuel, paper, cloth). Each of those *faces* still carries at
 * most three tones — base, a left-edge highlight, a right-edge shade — which is
 * the part of the house style that governs how a surface reads.
 */
/** Hard outline (#000000). */
const BLACK = rgb(0x00, 0x00, 0x00);
/** Brown bottle glass: face / lit left edge / shaded right edge. */
const GLASS = rgb(0x5c, 0x3a, 0x17);
const GLASS_HI = rgb(0x8a, 0x5a, 0x2a);
const GLASS_DARK = rgb(0x26, 0x15, 0x06);
/** The amber fuel behind the glass: face / lit edge / the pool at the base. */
const LIQUID = rgb(0x9c, 0x63, 0x18);
const LIQUID_HI = rgb(0xc0, 0x8a, 0x30);
const LIQUID_DARK = rgb(0x6b, 0x42, 0x10);
/** The paper label band, and the cloth wick — pale, so both read against the
 *  dark bottle. The two share one shade tone (#6E644A). */
const LABEL = rgb(0xc4, 0xb8, 0x96);
const LABEL_HI = rgb(0xdc, 0xd2, 0xb4);
const RAG = rgb(0xb8, 0xae, 0x8e);
const RAG_HI = rgb(0xd2, 0xc9, 0xab);
const SHADE = rgb(0x6e, 0x64, 0x4a);

/** ASCII legend → packed colour. '.' (absent) is transparent. */
const PALETTE: Record<string, number> = {
  '#': BLACK,
  G: GLASS_HI,
  g: GLASS,
  d: GLASS_DARK,
  L: LIQUID_HI,
  l: LIQUID,
  b: LIQUID_DARK,
  A: LABEL_HI,
  a: LABEL,
  s: SHADE,
  R: RAG_HI,
  r: RAG,
};

const ART: Record<MolotovBottle, readonly string[]> = {
  // The thrown bottle: cloth wick, straight neck, stepped shoulders, amber fuel
  // split by a paper label band.
  full: [
    '....####....',
    '....#Rr#....',
    '....#Rr#....',
    '....#Rs#....',
    '....#Gg#....',
    '....#Gg#....',
    '....#Gg#....',
    '....#Gg#....',
    '...#Gggd#...',
    '..#Gggggd#..',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Aaaaaaas#.',
    '.#Aaaaaaas#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#Llllllld#.',
    '.#bbbbbbbd#.',
    '..########..',
  ],
  // Burnt out: the wick is gone (an open, dark neck bore) and the fuel with it,
  // so the body is clear glass through and through. The label survives, which is
  // what keeps the spent bottle readable as the same object.
  empty: [
    '....####....',
    '....#dd#....',
    '....#dd#....',
    '....#dd#....',
    '....#Gg#....',
    '....#Gg#....',
    '....#Gg#....',
    '....#Gg#....',
    '...#Gggd#...',
    '..#Gggggd#..',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Aaaaaaas#.',
    '.#Aaaaaaas#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#Gggggggd#.',
    '.#dddddddd#.',
    '..########..',
  ],
};

/** The bottle's pixel box. Both variants are authored at this size, and
 *  engine/objects.ts scales it into the capsule the world collides with, so the
 *  two can't disagree. */
export const MOLOTOV_SPRITE_W = 12;
export const MOLOTOV_SPRITE_H = 28;

function build(bottle: MolotovBottle): Uint32Array {
  const art = ART[bottle];
  const pixels = new Uint32Array(MOLOTOV_SPRITE_W * MOLOTOV_SPRITE_H); // 0 = transparent
  // The rows ARE the geometry (objects.ts sizes the body from the box above), so
  // a mistyped row would silently shift the art off its collision shape. Cheap
  // module-load check rather than a subtly wrong bottle.
  if (art.length !== MOLOTOV_SPRITE_H) {
    throw new Error(`molotov ${bottle}: ${art.length} rows, expected ${MOLOTOV_SPRITE_H}`);
  }
  for (let y = 0; y < MOLOTOV_SPRITE_H; y++) {
    const row = art[y];
    if (row.length !== MOLOTOV_SPRITE_W) {
      throw new Error(`molotov ${bottle} row ${y}: ${row.length} px, expected ${MOLOTOV_SPRITE_W}`);
    }
    for (let x = 0; x < MOLOTOV_SPRITE_W; x++) {
      const c = PALETTE[row[x]];
      if (c !== undefined) pixels[y * MOLOTOV_SPRITE_W + x] = c;
    }
  }
  return pixels;
}

/** The prebuilt sprite pixels for each bottle state (0xAABBGGRR; 0 =
 *  transparent). Built once at module load. */
export const MOLOTOV_SPRITES: Record<MolotovBottle, Uint32Array> = {
  full: build('full'),
  empty: build('empty'),
};
