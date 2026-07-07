// Global tunables for the simulation. Kept in one place so cell size, tick
// rate, and the dynamic-grid limits are easy to change as the game grows.

/**
 * Rendered size of one cell, in CSS pixels. This is what "fixed cell size"
 * means: a grain reads the same physical size on every screen. The grid
 * resolution is derived from the sandbox rectangle divided by this value, so a
 * larger sandbox holds proportionally more cells (see layout.ts).
 *
 * 4px keeps grains crisp and fine — a fit-to-device sandbox is roughly
 * 480×270 on 1080p, ~97×195 on a 390×780 phone. Smaller = finer/more space.
 */
export const CELL_PX = 4;

/**
 * Upper bound on total cells. The simulation runs on the main thread at
 * TICK_HZ, so an unbounded 4K sandbox would blow the frame budget. When the
 * derived grid would exceed this, the effective cell size is scaled up
 * uniformly (coarser cells, same aspect) to stay under budget. Sized so a
 * full 1080p viewport (~130k cells) renders at the true cell size uncapped;
 * only larger screens (QHD/4K fullscreen) get coarsened to protect the tick.
 */
export const MAX_CELLS = 130_000;

/** Smallest grid dimension, so a tiny drag still leaves a usable sandbox. */
export const MIN_GRID_SIDE = 16;

/** Reference grid the app opens with before the viewport is measured (~16:9). */
export const GRID_W = 240;
export const GRID_H = 135;

/** Fixed simulation update rate (Hz). Rendering runs at display refresh rate. */
export const TICK_HZ = 60;

/** Brush radius bounds, in cells (shared by the store, painter, and UI slider/wheel). */
export const BRUSH_MIN = 0;
export const BRUSH_MAX = 12;

/** Max simulation steps per animation frame (prevents spiral-of-death after a stall). */
export const MAX_STEPS_PER_FRAME = 5;

/** In Particle brush mode, fraction of non-solid cells within the brush area that get filled. */
export const PARTICLE_FILL_RATE = 0.55;

/**
 * Progressive brush overwrite levels, from most conservative to most permissive.
 * Each level also allows everything the previous levels allow (Empty cells are
 * always paintable regardless of level).
 */
export const OVERWRITE_LEVELS = [
  '덮어쓰기 없음',
  '기체만',
  '기체+액체',
  '기체+가루+액체',
  '기체+가루+액체+고체',
  '전체 (Wall 포함)',
] as const;
export const OVERWRITE_LEVEL_MIN = 0;
export const OVERWRITE_LEVEL_MAX = OVERWRITE_LEVELS.length - 1;
