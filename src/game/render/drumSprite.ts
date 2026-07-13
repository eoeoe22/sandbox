import { rgb } from './color';

/**
 * The blue-drum sprite — the *display* half of the drum object, kept separate
 * from its physics (a capsule; see engine/objects.ts SimCapsule). Prebuilt once
 * from the pixel-art SVG the design supplied (viewBox 24×32, upright): a blue
 * body (#2563eb) banded and outlined in black (#000000). Stored as a flat
 * Uint32 grid of packed 0xAABBGGRR colors (the renderer's native pixel format),
 * with 0 meaning a fully transparent pixel — never a real color here, since
 * rgb() always sets alpha, so 0 is a safe "no pixel" sentinel the rasterizer
 * skips. The renderer samples this at each grid cell's center (nearest-neighbor,
 * no anti-aliasing) after rotating by the drum's angle, so it reads as crisp
 * pixel art in the same grain as the cells — the rubber ball's philosophy, plus
 * rotation.
 */
export const DRUM_SPRITE_W = 24;
export const DRUM_SPRITE_H = 32;

const BLACK = rgb(0x00, 0x00, 0x00);
const BLUE = rgb(0x25, 0x63, 0xeb);

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

function buildSprite(): Uint32Array {
  const buf = new Uint32Array(DRUM_SPRITE_W * DRUM_SPRITE_H); // 0 = transparent
  // 1. Black silhouette / outline + the two banding rims (wider by 1px each side).
  fillRect(buf, 2, 0, 20, 9, BLACK);
  fillRect(buf, 1, 9, 22, 3, BLACK);
  fillRect(buf, 2, 12, 20, 8, BLACK);
  fillRect(buf, 1, 20, 22, 3, BLACK);
  fillRect(buf, 2, 23, 20, 9, BLACK);
  // 2. Blue body, inset 1px inside the black so the outline and bands show.
  fillRect(buf, 3, 1, 18, 8, BLUE);
  fillRect(buf, 2, 10, 20, 1, BLUE);
  fillRect(buf, 3, 12, 18, 8, BLUE);
  fillRect(buf, 2, 21, 20, 1, BLUE);
  fillRect(buf, 3, 23, 18, 8, BLUE);
  return buf;
}

/** The prebuilt sprite pixels (0xAABBGGRR; 0 = transparent). */
export const DRUM_SPRITE = buildSprite();
