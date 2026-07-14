import { rgb } from './color';
import type { DrumFill } from '../engine/objects';

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
