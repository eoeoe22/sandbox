import { rgb } from './color';

/**
 * The flashbang sprite — the *display* half of the flashbang object, kept apart
 * from its physics (a capsule; see engine/objects.ts SimFlashbang), exactly like
 * the drum, dynamite and smoke-bomb sprites: a flat Uint32 grid of packed
 * 0xAABBGGRR colors with 0 = transparent, sampled by the renderer at
 * OBJECT_SCALE.
 *
 * The art is an olive stun grenade: a flanged can (wider at the cap and the base
 * than through the middle) whose body is shaded left-to-right in three tones,
 * with four black emission slits down the front and a paler band around its
 * waist. It's transcribed pixel-for-pixel from the design's reference SVG —
 * every row below is that drawing's rows, translated into the sprite's own frame
 * (the reference's x2,y3 corner is this sprite's 0,0).
 *
 * **ASCII rows rather than a fillRect list** (형식 B; see the create-svg-assets
 * skill): the drawing is eight tones arranged as horizontal bands, which as rect
 * calls would be ~70 unreadable one-pixel-tall fills. As rows the flange step,
 * the slits and the waist band are all visible in the source.
 *
 * Nothing about the fuse is drawn. This grenade deliberately has no burning-fuse
 * stage at all (터지기 전까지 도화선 효과 없음 — see objects.ts stepFlashbang), so
 * unlike the dynamite there is not even an in-world flame to leave out; the can
 * simply sits there looking inert until it goes off. The flash itself is real
 * Flash cells the detonation writes into the grid (materials/flash.ts).
 */
export const FLASHBANG_SPRITE_W = 8;
export const FLASHBANG_SPRITE_H = 18;

/** Casing outline / the dark rim the body is inset inside (#12180F). */
const DARK = rgb(0x12, 0x18, 0x0f);
/** Emission slits — punched black, the only pure black in the can (#000000). */
const SLIT = rgb(0x00, 0x00, 0x00);
/** Lit (left) face of the olive body (#80A45A). */
const LIT = rgb(0x80, 0xa4, 0x5a);
/** Body mid-tone (#506E32). */
const BODY = rgb(0x50, 0x6e, 0x32);
/** Shaded (right) face of the body (#30441E). */
const SHADE = rgb(0x30, 0x44, 0x1e);
/** Waist band, lit face (#B2C69B). */
const BAND_LIT = rgb(0xb2, 0xc6, 0x9b);
/** Waist band, mid-tone (#88A06E). */
const BAND = rgb(0x88, 0xa0, 0x6e);
/** Waist band, shaded face (#5A7044). */
const BAND_SHADE = rgb(0x5a, 0x70, 0x44);

/**
 * The can, one string per sprite row. `.` is transparent; every other character
 * maps through `PALETTE` below. The silhouette is the drawing: rows 1–3 and
 * 15–16 are the full-width flanges at the cap and the base, the rows between
 * them are the narrower barrel, and the three-row `P/m/d` block is the waist.
 */
const ART: readonly string[] = [
  '.######.',
  '#Loooos#',
  '#Loooos#',
  '#Loooos#',
  '.#Loos#.',
  '.#Lkks#.',
  '.#Loos#.',
  '.#Loos#.',
  '.#Pmmd#.',
  '.#Pkkd#.',
  '.#Pmmd#.',
  '.#Loos#.',
  '.#Lkks#.',
  '.#Loos#.',
  '.#Loos#.',
  '#Loooos#',
  '#Loooos#',
  '.######.',
];

const PALETTE: Record<string, number> = {
  '.': 0, // transparent
  '#': DARK,
  k: SLIT,
  L: LIT,
  o: BODY,
  s: SHADE,
  P: BAND_LIT,
  m: BAND,
  d: BAND_SHADE,
};

function buildSprite(): Uint32Array {
  const buf = new Uint32Array(FLASHBANG_SPRITE_W * FLASHBANG_SPRITE_H); // 0 = transparent
  for (let y = 0; y < FLASHBANG_SPRITE_H; y++) {
    const row = ART[y];
    for (let x = 0; x < FLASHBANG_SPRITE_W; x++) {
      buf[y * FLASHBANG_SPRITE_W + x] = PALETTE[row[x]];
    }
  }
  return buf;
}

/** The prebuilt flashbang sprite pixels (0xAABBGGRR; 0 = transparent). */
export const FLASHBANG_SPRITE = buildSprite();
