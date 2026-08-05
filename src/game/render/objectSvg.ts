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
import {
  SMOKE_BOMB_SPRITE,
  SMOKE_BOMB_SPRITE_W,
  SMOKE_BOMB_SPRITE_H,
} from './smokeBombSprite';
import {
  FLASHBANG_SPRITE,
  FLASHBANG_SPRITE_W,
  FLASHBANG_SPRITE_H,
} from './flashbangSprite';
import { WOOD_BOX_SPRITES } from './woodenBoxSprite';
import { MOLOTOV_SPRITES, MOLOTOV_SPRITE_W, MOLOTOV_SPRITE_H } from './molotovSprite';
import type { DrumFill } from '../engine/objects';
import type { ObjectKind } from '../../state/store';
import { hex } from './color';
import { spriteRects, pixelSvg } from './spriteSvg';

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

// The smoke bomb: the canister sprite straight through, with nothing drawn around
// it — its smoke is real Smoke particles the engine spawns in-world (like the
// dynamite's flame), so the static preview is the can alone.
const smokeBombSvg = pixelSvg(
  SMOKE_BOMB_SPRITE_W,
  SMOKE_BOMB_SPRITE_H,
  spriteRects(SMOKE_BOMB_SPRITE, SMOKE_BOMB_SPRITE_W, SMOKE_BOMB_SPRITE_H),
);

// The wooden crate: the whole box's sprite straight through — no extra art, the
// crate carries no procedural flourish in-world either. The three shards it
// breaks into are deliberately absent: they exist only as a broken crate's
// wreckage (나무 상자를 부술 때만 소환), so they are not palette items to preview.
const crateArt = WOOD_BOX_SPRITES.crate;
const crateSvg = pixelSvg(
  crateArt.w,
  crateArt.h,
  spriteRects(crateArt.pixels, crateArt.w, crateArt.h),
);

// The molotov: the FULL bottle straight through — the palette spawns a fresh,
// fuelled one, so that is what the chip previews. The spent 빈 유리병 has no chip of
// its own for the same reason the crate's shards don't: it only ever exists as a
// molotov that has burnt out (팔레트에서 소환 불가). And the lit wick's flame is
// absent here too — it's real Fire particles in-world, like the dynamite's.
const molotovSvg = pixelSvg(
  MOLOTOV_SPRITE_W,
  MOLOTOV_SPRITE_H,
  spriteRects(MOLOTOV_SPRITES.full, MOLOTOV_SPRITE_W, MOLOTOV_SPRITE_H),
);

// The flashbang: the can straight through — there is nothing to leave out. It has
// no fuse to draw (the object deliberately shows nothing at all before it goes
// off — see engine/objects.ts SimFlashbang) and its flash is real Flash cells
// in-world, so the chip is the whole of what a click spawns.
const flashbangSvg = pixelSvg(
  FLASHBANG_SPRITE_W,
  FLASHBANG_SPRITE_H,
  spriteRects(FLASHBANG_SPRITE, FLASHBANG_SPRITE_W, FLASHBANG_SPRITE_H),
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
  smokebomb: smokeBombSvg,
  flashbang: flashbangSvg,
  crate: crateSvg,
  molotov: molotovSvg,
};

/** SVG markup for an object kind's palette preview — inject with Svelte `{@html}`.
 *  The string is built from trusted constant sprite data (no user input). */
export function objectSvgFor(kind: ObjectKind): string {
  return OBJECT_SVG[kind];
}
