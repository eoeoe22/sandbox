import { rgb } from './color';
import type { DrumFill, DrumPiecePart } from '../engine/objects';

/**
 * The drum sprite — the *display* half of the drum object, kept separate from its
 * physics (a capsule; see engine/objects.ts SimCapsule). Prebuilt once from the
 * pixel-art SVG the design supplied (viewBox 24×32, upright): a colored body
 * banded and outlined in black (#000000). Stored as a flat Uint32 grid of packed
 * 0xAABBGGRR colors (the renderer's native pixel format), with 0 meaning a fully
 * transparent pixel — never a real color here, since rgb() always sets alpha, so
 * 0 is a safe "no pixel" sentinel the rasterizer skips. The renderer samples this
 * at each grid cell's center (nearest-neighbor, no anti-aliasing) after rotating
 * by the drum's angle, so it reads as crisp pixel art in the same grain as the
 * cells — the rubber ball's philosophy, plus rotation.
 *
 * All drums share one silhouette; only the body color changes per `fill`, so the
 * three variants (빈/원유/산 드럼통) read apart at a glance while staying
 * mechanically identical — a blue empty drum, a dark-brown crude-oil drum, and a
 * toxic-green acid drum (colors echo their spill: Crude Oil and Acid).
 *
 * The three SHARDS a burst drum leaves live at the bottom of this file (PIECE_ART),
 * cut from the same 24×32 frame and tinted from the same per-fill body color.
 */
export const DRUM_SPRITE_W = 24;
export const DRUM_SPRITE_H = 32;

const BLACK = rgb(0x00, 0x00, 0x00);
/** Body color per fill (see DrumFill). Blue = empty, near-black = crude oil
 *  (원유 드럼통 색상 검은색 계열 — crude oil itself reads black, not brown), green = acid. */
const BODY_COLOR: Record<DrumFill, number> = {
  empty: rgb(0x25, 0x63, 0xeb),
  oil: rgb(0x33, 0x2c, 0x27),
  acid: rgb(0x86, 0xc2, 0x3a),
};

/** Fill an axis-aligned rect [x,x+w)×[y,y+h) of the sprite grid with `color`. */
function fillRect(
  buf: Uint32Array,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  for (let cy = y; cy < y + h; cy++) {
    for (let cx = x; cx < x + w; cx++) {
      buf[cy * DRUM_SPRITE_W + cx] = color;
    }
  }
}

function buildSprite(body: number): Uint32Array {
  const buf = new Uint32Array(DRUM_SPRITE_W * DRUM_SPRITE_H); // 0 = transparent
  // 1. Black silhouette / outline + the two banding rims (wider by 1px each side).
  fillRect(buf, 2, 0, 20, 9, BLACK);
  fillRect(buf, 1, 9, 22, 3, BLACK);
  fillRect(buf, 2, 12, 20, 8, BLACK);
  fillRect(buf, 1, 20, 22, 3, BLACK);
  fillRect(buf, 2, 23, 20, 9, BLACK);
  // 2. Colored body, inset 1px inside the black so the outline and bands show.
  fillRect(buf, 3, 1, 18, 8, body);
  fillRect(buf, 2, 10, 20, 1, body);
  fillRect(buf, 3, 12, 18, 8, body);
  fillRect(buf, 2, 21, 20, 1, body);
  fillRect(buf, 3, 23, 18, 8, body);
  return buf;
}

/** The prebuilt sprite pixels per fill (0xAABBGGRR; 0 = transparent). */
export const DRUM_SPRITES: Record<DrumFill, Uint32Array> = {
  empty: buildSprite(BODY_COLOR.empty),
  oil: buildSprite(BODY_COLOR.oil),
  acid: buildSprite(BODY_COLOR.acid),
};

/** The sprite pixels for a drum's fill (falls back to the empty/blue sprite). */
export function drumSpriteFor(fill: DrumFill): Uint32Array {
  return DRUM_SPRITES[fill] ?? DRUM_SPRITES.empty;
}

/**
 * The three shards a drum bursts into — one drawing cut three ways, exactly as
 * the wooden crate's art is (render/woodenBoxSprite.ts). They *partition* the drum
 * frame: every one of the 24×32 sprite's 652 opaque pixels belongs to exactly one
 * shard, with no gap and no overlap, so for the first instant after a drum comes
 * apart the wreckage still reads as the drum that just burst. (The only pixels
 * that differ from the intact drum are two on the lower rim, which the design
 * darkened to outline shard 3's torn bottom edge — a fresh cut edge, not a seam.)
 *
 * Written as ASCII rows rather than a fillRect list because the tears are jagged
 * (the drum body itself, all axis-aligned bands, stays fillRect above): the rows
 * below *are* the picture. Legend matches the crate's — '#' outline, 'o' body,
 * '.' transparent — and the body color is per `fill` like the whole drum's, so an
 * acid drum leaves green shards and a crude-oil drum near-black ones.
 *
 * Each shard also records where its own cropped pixel box sat inside the drum's
 * 24×32 frame (PIECE_OFFSET), which is what lets engine/objects.ts spawn each
 * shard at exactly the spot it occupied inside the barrel.
 */
const PIECE_ART: Record<DrumPiecePart, readonly string[]> = {
  // Shard 1 — the right-hand wall with both rim bands, torn off in one strip.
  piece1: [
    '.....#########.',
    '..ooooooooooo#.',
    'ooooooooooooo#.',
    'ooooooooooooo#.',
    '...oooooooooo#.',
    '.....oooooooo#.',
    '.....oooooooo#.',
    '.....oooooooo#.',
    '....ooooooooo#.',
    '..#############',
    '..oooooooooooo#',
    '....###########',
    '.....oooooooo#.',
    '.....oooooooo#.',
    '.oooooooooooo#.',
    '.oooooooooooo#.',
    '.oooo..oooooo#.',
    '.oooo..oooooo#.',
    '..oo....ooooo#.',
    '........ooooo#.',
    '.......######..',
    '.......oooo....',
    '.......##......',
  ],
  // Shard 2 — the bottom of the barrel, the lower rim band still around it.
  piece2: [
    '............oo........',
    '............oo........',
    '....ooooo..oooo.......',
    '....ooooooooooo.......',
    '#...##########......##',
    '#o..oooooooooo....ooo#',
    '##############..######',
    '.#oooooooooooooooooo#.',
    '.#oooooooooooooooooo#.',
    '.#oooooooooooooooooo#.',
    '.#oooooooooooooooooo#.',
    '.#oooooooooooooooooo#.',
    '.#oooooooooooooooooo#.',
    '.#oooooooooooooooooo#.',
    '.#oooooooooooooooooo#.',
    '.####################.',
  ],
  // Shard 3 — the left-hand wall and the drum's top lid.
  piece3: [
    '.###########',
    '.#ooooooo...',
    '.#ooooo.....',
    '.#ooooo.....',
    '.#oooooooo..',
    '.#oooooooooo',
    '.#oooooooooo',
    '.#oooooooooo',
    '.#ooooooooo.',
    '#########...',
    '#oooooooo...',
    '###########.',
    '.#oooooooooo',
    '.#oooooooooo',
    '.#oooooo....',
    '.#oooooo....',
    '.#oooooo....',
    '.#oooooo....',
    '.#oo........',
    '.#oo........',
    '.###........',
    '..##........',
  ],
};

/**
 * Offset (in sprite pixels) from the *drum's* center to each shard's own center —
 * i.e. where that shard's cropped pixel box sat inside the 24×32 frame. Halves
 * appear because a crop of odd width/height has its center on a pixel boundary.
 */
const PIECE_OFFSET: Record<DrumPiecePart, readonly [number, number]> = {
  piece1: [3.5, -4.5],
  piece2: [0, 8],
  piece3: [-5, -5],
};

/** One shard's art: the pixel buffer, its box in sprite pixels, and where that box
 *  sits inside the whole drum's frame (see PIECE_OFFSET). */
export interface DrumPieceSprite {
  /** Packed 0xAABBGGRR pixels, row-major, `w`×`h`; 0 = transparent. */
  pixels: Uint32Array;
  w: number;
  h: number;
  /** Offset from the drum's center to this shard's center, in sprite pixels. */
  ox: number;
  oy: number;
}

function buildPiece(part: DrumPiecePart, body: number): DrumPieceSprite {
  const art = PIECE_ART[part];
  const h = art.length;
  const w = art[0].length;
  const pixels = new Uint32Array(w * h); // 0 = transparent
  for (let y = 0; y < h; y++) {
    const row = art[y];
    for (let x = 0; x < w; x++) {
      const c = row[x];
      if (c === '#') pixels[y * w + x] = BLACK;
      else if (c === 'o') pixels[y * w + x] = body;
    }
  }
  const [ox, oy] = PIECE_OFFSET[part];
  return { pixels, w, h, ox, oy };
}

function buildPieces(body: number): Record<DrumPiecePart, DrumPieceSprite> {
  return {
    piece1: buildPiece('piece1', body),
    piece2: buildPiece('piece2', body),
    piece3: buildPiece('piece3', body),
  };
}

/** The prebuilt shard sprites + geometry, per fill. Built once at module load;
 *  engine/objects.ts scales these pixel boxes into cells to size the shard bodies,
 *  so the art and the physics can never drift apart. */
export const DRUM_PIECE_SPRITES: Record<DrumFill, Record<DrumPiecePart, DrumPieceSprite>> = {
  empty: buildPieces(BODY_COLOR.empty),
  oil: buildPieces(BODY_COLOR.oil),
  acid: buildPieces(BODY_COLOR.acid),
};

/** The sprite + geometry for one shard of a drum of this fill (falls back to the
 *  empty/blue set, like drumSpriteFor). */
export function drumPieceSpriteFor(fill: DrumFill, part: DrumPiecePart): DrumPieceSprite {
  return (DRUM_PIECE_SPRITES[fill] ?? DRUM_PIECE_SPRITES.empty)[part];
}
