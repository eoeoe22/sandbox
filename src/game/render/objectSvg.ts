// SVG previews of the 독립 오브젝트 layer's bodies, for the material selector's
// object palette. These are the *same* shapes the renderer draws in-world — the
// drum and dynamite sprites are generated pixel-for-pixel from the very Uint32
// sprite buffers the CanvasRenderer samples (drumSprite.ts / dynamiteSprite.ts),
// and the ball mirrors rasterizeBall's flat red disc with its thin dark rim. So
// a palette chip shows exactly what a click spawns, scaled down to the cell (the
// SVG's viewBox is the sprite's native pixel box; the chip's CSS sizes it and
// `preserveAspectRatio` fits it), rather than a hand-approximated swatch.
import { drumSpriteFor, DRUM_SPRITE_W, DRUM_SPRITE_H } from './drumSprite';
import { DYN_SPRITE, DYN_SPRITE_W, DYN_SPRITE_H, FUSE_CORD_COLOR } from './dynamiteSprite';
import type { DrumFill } from '../engine/objects';
import type { ObjectKind } from '../../state/store';

/** A packed 0xAABBGGRR color → `#rrggbb`. Alpha is dropped (sprite pixels are
 *  fully opaque; 0 is the transparent sentinel handled before this is called). */
function hex(packed: number): string {
  const r = packed & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = (packed >> 16) & 0xff;
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/**
 * Turn a sprite pixel buffer into SVG `<rect>`s, merging horizontal runs of the
 * same color into one rect each so the markup stays compact (a drum is a few
 * dozen rects, not ~700). Transparent pixels (0) are skipped. `ox`/`oy` offset
 * every rect, so callers can leave room in the viewBox for extra art drawn
 * around the sprite (the dynamite fuse).
 */
function spriteRects(buf: Uint32Array, w: number, h: number, ox = 0, oy = 0): string {
  let out = '';
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const c = buf[y * w + x];
      if (c === 0) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < w && buf[y * w + x + run] === c) run++;
      out += `<rect x="${x + ox}" y="${y + oy}" width="${run}" height="1" fill="${hex(c)}"/>`;
      x += run;
    }
  }
  return out;
}

/** Wrap inner SVG in a pixel-art `<svg>`: crisp edges (nearest-neighbor look,
 *  matching the in-world rasterizer) and `meet` so the shape scales to fit the
 *  chip's box while keeping its aspect ratio, centered. */
function pixelSvg(vbW: number, vbH: number, inner: string): string {
  return (
    `<svg class="obj-svg" viewBox="0 0 ${vbW} ${vbH}" ` +
    `preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`
  );
}

function drumSvg(fill: DrumFill): string {
  return pixelSvg(
    DRUM_SPRITE_W,
    DRUM_SPRITE_H,
    spriteRects(drumSpriteFor(fill), DRUM_SPRITE_W, DRUM_SPRITE_H),
  );
}

// The dynamite: the red stick sprite plus the short dark fuse-cord nub the
// renderer draws poking past the top cap (the flame itself is real Fire
// particles in-world, so it's not part of the static preview). The viewBox gains
// FUSE_LEN rows above the sprite for the cord; the sprite is pushed down by that.
const FUSE_LEN = 3;
const dynamiteSvg = pixelSvg(
  DYN_SPRITE_W,
  DYN_SPRITE_H + FUSE_LEN,
  `<rect x="3" y="0" width="2" height="${FUSE_LEN + 1}" fill="${hex(FUSE_CORD_COLOR)}"/>` +
    spriteRects(DYN_SPRITE, DYN_SPRITE_W, DYN_SPRITE_H, 0, FUSE_LEN),
);

// The rubber ball: a flat red disc with a thin dark rim, mirroring rasterizeBall
// (BALL_COLOR / BALL_BORDER_COLOR). A vector circle here (not pixel rects) — the
// in-world ball is a rasterized disc, and a smooth circle reads truer at this
// small size than a jagged pixel approximation would. Rim width ≈ 12% of radius,
// matching the rasterizer's `r * 0.12`.
const BALL_COLOR = '#d84652';
const BALL_RIM_COLOR = '#1a1012';
const ballSvg =
  `<svg class="obj-svg" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" ` +
  `xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
  `<circle cx="12" cy="12" r="10.8" fill="${BALL_COLOR}" ` +
  `stroke="${BALL_RIM_COLOR}" stroke-width="2.4"/></svg>`;

/** The generated SVG markup for each object kind, keyed by ObjectKind. Built once
 *  at module load from the shared sprite data. */
const OBJECT_SVG: Record<ObjectKind, string> = {
  ball: ballSvg,
  drum: drumSvg('empty'),
  oildrum: drumSvg('oil'),
  aciddrum: drumSvg('acid'),
  dynamite: dynamiteSvg,
};

/** SVG markup for an object kind's palette preview — inject with Svelte `{@html}`.
 *  The string is built from trusted constant sprite data (no user input). */
export function objectSvgFor(kind: ObjectKind): string {
  return OBJECT_SVG[kind];
}
