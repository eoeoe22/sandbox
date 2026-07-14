import { rgb } from './color';

/**
 * The dynamite sprite — the *display* half of the dynamite object, kept separate
 * from its physics (a capsule; see engine/objects.ts SimDynamite). It's just the
 * red stick body: a colored cylinder banded and outlined in black, in the same
 * pixel-art idiom as the drum sprite (a flat Uint32 grid of packed 0xAABBGGRR
 * colors, 0 = transparent). The fuse *flame* is NOT drawn here at all — the lit
 * fuse emits real Fire particles into the grid at its tip (see objects.ts). The
 * renderer draws only a short dark fuse-cord nub past the cap so the fuse reads as
 * physical even on a spent dud. The sprite's 8×24 box maps
 * onto the physics capsule's box (2·radius wide × 2·(halfLength+radius) tall), so
 * display and collision agree and it samples near its native resolution at
 * OBJECT_SCALE = 2. Colors echo the design's reference art (body red #FF3B30).
 */
export const DYN_SPRITE_W = 8;
export const DYN_SPRITE_H = 24;

const BLACK = rgb(0x00, 0x00, 0x00);
const RED = rgb(0xff, 0x3b, 0x30); // body, matching the reference art
const RED_DARK = rgb(0xb0, 0x24, 0x1c); // wrapper bands
const RED_HI = rgb(0xff, 0x7a, 0x70); // a soft left-edge sheen so it reads cylindrical

/** Fill an axis-aligned rect [x,x+w)×[y,y+h) of the sprite grid with `color`. */
function fillRect(buf: Uint32Array, x: number, y: number, w: number, h: number, color: number): void {
  for (let cy = y; cy < y + h; cy++) {
    for (let cx = x; cx < x + w; cx++) {
      buf[cy * DYN_SPRITE_W + cx] = color;
    }
  }
}

function buildSprite(): Uint32Array {
  const buf = new Uint32Array(DYN_SPRITE_W * DYN_SPRITE_H); // 0 = transparent
  // Black silhouette (cols 1..6, full height), rounded by clearing the 4 corners.
  fillRect(buf, 1, 0, 6, DYN_SPRITE_H, BLACK);
  buf[0 * DYN_SPRITE_W + 1] = 0;
  buf[0 * DYN_SPRITE_W + 6] = 0;
  buf[(DYN_SPRITE_H - 1) * DYN_SPRITE_W + 1] = 0;
  buf[(DYN_SPRITE_H - 1) * DYN_SPRITE_W + 6] = 0;
  // Red body, inset 1px inside the black outline.
  fillRect(buf, 2, 1, 4, DYN_SPRITE_H - 2, RED);
  // Left-edge sheen (one column) for a cylindrical highlight.
  fillRect(buf, 2, 2, 1, DYN_SPRITE_H - 4, RED_HI);
  // Two darker wrapper bands across the body.
  fillRect(buf, 2, 6, 4, 2, RED_DARK);
  fillRect(buf, 2, 16, 4, 2, RED_DARK);
  return buf;
}

/** The prebuilt dynamite sprite pixels (0xAABBGGRR; 0 = transparent). */
export const DYN_SPRITE = buildSprite();

/** The short dark fuse cord the renderer draws poking past the top cap (the flame
 *  itself is real Fire particles, spawned by the engine — see objects.ts). */
export const FUSE_CORD_COLOR = rgb(0x46, 0x3c, 0x30);
