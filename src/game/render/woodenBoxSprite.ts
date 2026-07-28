import { rgb } from './color';
import type { WoodBoxPart } from '../engine/objects';

/**
 * The wooden-crate sprites — the *display* half of the wooden box object, kept
 * apart from its physics (a non-rotating disc body; see engine/objects.ts
 * SimWoodBox) exactly like the drum/dynamite/smoke-bomb sprites: flat Uint32
 * grids of packed 0xAABBGGRR colors with 0 = transparent, sampled by the renderer
 * at OBJECT_SCALE.
 *
 * Four sprites live here, and they are one drawing cut four ways. `crate` is the
 * whole 24×24 box; `piece1`/`piece2`/`piece3` are the three jagged shards it
 * breaks into, and they *partition* it exactly — every one of the crate's 576
 * opaque pixels belongs to exactly one shard, so the three fragments reassemble
 * into the box with no seam and no overlap. That's why each shard also records
 * where its own pixel box sat inside the crate's frame (OFFSET below): a
 * shattering crate can spawn its pieces exactly where they were, and for the
 * first instant the wreckage still reads as the box that just came apart.
 *
 * The art is transcribed straight from the design's reference SVGs as ASCII rows
 * — '#' outline, 'o' timber, '.' transparent — rather than as a list of fillRect
 * calls: at 240 rects for the crate alone the rect form would be unreadable,
 * while the rows below *are* the picture (the plank diagonals and the banding are
 * visible in the source). Each part's pixel box is derived from its own rows, so
 * the art is the single source of truth for both the sprite and the body geometry
 * that engine/objects.ts scales into cells.
 */
/** Dark outline / plank seams (#2a1206). */
const DARK = rgb(0x2a, 0x12, 0x06);
/** Timber face (#ee9422). */
const TIMBER = rgb(0xee, 0x94, 0x22);

const ART: Record<WoodBoxPart, readonly string[]> = {
  // The whole crate: banded top and bottom rails with a diagonally-planked body.
  crate: [
    '########################',
    '#oooooooooooooooooooooo#',
    '#oooooooooooooooooooooo#',
    '########################',
    '#oo##ooo#ooo#ooo#ooo#oo#',
    '#oo#ooo#ooo#ooo#ooo##oo#',
    '#oo#oo#ooo#ooo#ooo#o#oo#',
    '#oo#o#ooo#ooo#ooo#oo#oo#',
    '#oo##ooo#ooo#ooo#ooo#oo#',
    '#oo#ooo#ooo#ooo#ooo##oo#',
    '#oo#oo#ooo#ooo#ooo#o#oo#',
    '#oo#o#ooo#ooo#ooo#oo#oo#',
    '#oo##ooo#ooo#ooo#ooo#oo#',
    '#oo#ooo#ooo#ooo#ooo##oo#',
    '#oo#oo#ooo#ooo#ooo#o#oo#',
    '#oo#o#ooo#ooo#ooo#oo#oo#',
    '#oo##ooo#ooo#ooo#ooo#oo#',
    '#oo#ooo#ooo#ooo#ooo##oo#',
    '#oo#oo#ooo#ooo#ooo#o#oo#',
    '#oo#o#ooo#ooo#ooo#oo#oo#',
    '########################',
    '#oooooooooooooooooooooo#',
    '#oooooooooooooooooooooo#',
    '########################',
  ],
  // Shard 1 — the top rail and the right-hand wall (the biggest fragment).
  piece1: [
    '################',
    'ooooooooooooooo#',
    '...oooooooooooo#',
    '....############',
    '.....ooo#ooo#oo#',
    '.....oo#ooo##oo#',
    '..#ooo#ooo#o#oo#',
    '..ooo#ooo#oo#oo#',
    '....#ooo#ooo#oo#',
    '.....oo#ooo##oo#',
    '.....o#ooo#o#oo#',
    '...oo#ooo#oo#oo#',
    '..oo#..o#ooo#oo#',
    '..o#...#ooo##oo#',
    '.......ooo#o#oo#',
    '.......oo#oo#oo#',
    '.......o#ooo#oo#',
    '......o#oo...oo#',
    '......#oo....oo#',
    '.............oo#',
    '.............##.',
  ],
  // Shard 2 — the bottom rail and the floor of the box.
  piece2: [
    '.............oo.........',
    '#o..........ooo.........',
    '#o.....ooo#ooo#.........',
    '#oo...ooo#ooo#o.........',
    '#oo#..oo#ooo#oo.........',
    '#oo#ooo#ooo#oo....o##...',
    '#oo#oo#ooo#ooo...o#o#...',
    '#oo#o#ooo#ooo#ooo#oo#...',
    '#####################..#',
    '#oooooooooooooooooooooo#',
    '#oooooooooooooooooooooo#',
    '########################',
  ],
  // Shard 3 — the upper-left corner and the left-hand wall.
  piece3: [
    '########.....',
    '#ooooooo.....',
    '#oooooooooo..',
    '############.',
    '#oo##ooo#ooo#',
    '#oo#ooo#ooo#o',
    '#oo#oo#ooo...',
    '#oo#o#ooo#...',
    '#oo##ooo#ooo.',
    '#oo#ooo#ooo#o',
    '#oo#oo#ooo#oo',
    '#oo#o#ooo#o..',
    '#oo##ooo#o...',
    '..o#ooo#oo...',
    '..o#oo#......',
    '...#o#.......',
    '....#o.......',
  ],
};

/**
 * Offset (in sprite pixels) from the *crate's* center to each part's own center
 * — i.e. where the shard's cropped pixel box sat inside the 24×24 frame. The
 * crate is its own frame, so its offset is zero. Halves appear because a crop of
 * odd width/height has its center on a pixel boundary.
 */
const OFFSET: Record<WoodBoxPart, readonly [number, number]> = {
  crate: [0, 0],
  piece1: [4, -1.5],
  piece2: [0, 6],
  piece3: [-5.5, -3.5],
};

/** One part's art: the pixel buffer, its box in sprite pixels, and where that box
 *  sits inside the whole crate's frame (see OFFSET). */
export interface WoodBoxSprite {
  /** Packed 0xAABBGGRR pixels, row-major, `w`×`h`; 0 = transparent. */
  pixels: Uint32Array;
  w: number;
  h: number;
  /** Offset from the crate's center to this part's center, in sprite pixels. */
  ox: number;
  oy: number;
}

function build(part: WoodBoxPart): WoodBoxSprite {
  const art = ART[part];
  const h = art.length;
  const w = art[0].length;
  const pixels = new Uint32Array(w * h); // 0 = transparent
  for (let y = 0; y < h; y++) {
    const row = art[y];
    for (let x = 0; x < w; x++) {
      const c = row[x];
      if (c === '#') pixels[y * w + x] = DARK;
      else if (c === 'o') pixels[y * w + x] = TIMBER;
    }
  }
  const [ox, oy] = OFFSET[part];
  return { pixels, w, h, ox, oy };
}

/** The prebuilt sprite + geometry for every part of the wooden box. Built once at
 *  module load; engine/objects.ts scales these pixel boxes into cells to size the
 *  bodies, so the art and the physics can never drift apart. */
export const WOOD_BOX_SPRITES: Record<WoodBoxPart, WoodBoxSprite> = {
  crate: build('crate'),
  piece1: build('piece1'),
  piece2: build('piece2'),
  piece3: build('piece3'),
};
