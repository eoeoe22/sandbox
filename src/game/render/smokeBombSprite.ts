import { rgb } from './color';

/**
 * RETIRED ASSET — kept as dummy data, referenced by nothing.
 *
 * The 연막탄 (smoke bomb) object was removed from the game: its two-stage
 * trickle→discharge lifecycle was the weakest thing in the object layer, so the
 * body, its palette entry and its whole smoke-flood machinery went with it (see
 * docs/OBJECTS.md). Only this art survived, deliberately, so a future smoke-y
 * object doesn't have to be redrawn from scratch. Nothing imports it — if you
 * bring it back, wire it into render/objectSvg.ts and CanvasRenderer the way the
 * flashbang sprite is.
 *
 * The sprite itself is what every body's art is: a flat Uint32 grid of packed
 * 0xAABBGGRR colors with 0 = transparent, sized to be sampled by the renderer at
 * OBJECT_SCALE.
 *
 * The art is a grenade-style canister: a green body with a white label band, a
 * steel cap and safety lever running down its right side, and the pull-ring
 * hanging off to the left. It's transcribed pixel-for-pixel from the design's
 * reference SVG — every rect below is one of that drawing's shapes, translated
 * into the sprite's own frame (the reference's x8,y5 corner is this sprite's
 * 0,0). Draw order matters and matches the reference: the body is painted over
 * the lever, so the steel strip only shows where it clears the can.
 *
 * The *smoke* was never drawn here: while the object existed, its plume was real
 * Smoke particles the engine spawned into the grid, the way the dynamite's fuse
 * flame still is.
 */
export const SMOKE_BOMB_SPRITE_W = 13;
export const SMOKE_BOMB_SPRITE_H = 20;

const BLACK = rgb(0x12, 0x12, 0x12); // outlines
const STEEL = rgb(0x9e, 0xa7, 0xb1); // pull ring, cap, lever
const GREEN = rgb(0x2e, 0xcc, 0x71); // canister body
const WHITE = rgb(0xff, 0xff, 0xff); // label band

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
      buf[cy * SMOKE_BOMB_SPRITE_W + cx] = color;
    }
  }
}

function buildSprite(): Uint32Array {
  const buf = new Uint32Array(SMOKE_BOMB_SPRITE_W * SMOKE_BOMB_SPRITE_H); // 0 = transparent

  // Pull ring (safety pin), hanging off the left of the cap. The reference art
  // fills the ring's middle with the steel wire as a light plus, but at this size
  // that plus was the loudest thing in the corner and read as a stray icon rather
  // than as a pin — so the middle is punched out to TRANSPARENT instead. The ring
  // is then a real loop with a hole you see the world through, not a blob with a
  // shape painted on it.
  fillRect(buf, 1, 0, 3, 1, BLACK);
  fillRect(buf, 0, 1, 5, 3, BLACK);
  fillRect(buf, 1, 4, 3, 1, BLACK);
  fillRect(buf, 2, 1, 1, 3, 0);
  fillRect(buf, 1, 2, 3, 1, 0);

  // Cap and safety lever (outline): the wide cap on top, stepping down into the
  // narrow lever that runs the length of the can's right side.
  fillRect(buf, 5, 0, 5, 1, BLACK);
  fillRect(buf, 5, 1, 6, 1, BLACK);
  fillRect(buf, 5, 2, 1, 1, BLACK);
  fillRect(buf, 10, 2, 2, 1, BLACK);
  fillRect(buf, 5, 3, 1, 1, BLACK);
  fillRect(buf, 10, 3, 3, 1, BLACK);
  fillRect(buf, 11, 4, 2, 10, BLACK);
  fillRect(buf, 11, 14, 1, 1, BLACK);
  // Cap and lever metal, inset inside that outline.
  fillRect(buf, 7, 1, 2, 3, STEEL);
  fillRect(buf, 10, 2, 1, 1, STEEL);
  fillRect(buf, 11, 3, 1, 11, STEEL);

  // Canister body outline, then the green body and its white label band. Painted
  // last (as in the reference art) so the can covers the lower run of the lever.
  fillRect(buf, 4, 4, 8, 1, BLACK);
  fillRect(buf, 3, 5, 10, 14, BLACK);
  fillRect(buf, 4, 19, 8, 1, BLACK);
  fillRect(buf, 4, 5, 8, 14, GREEN);
  fillRect(buf, 4, 10, 8, 3, WHITE);

  return buf;
}

/** The prebuilt smoke-bomb sprite pixels (0xAABBGGRR; 0 = transparent). */
export const SMOKE_BOMB_SPRITE = buildSprite();
