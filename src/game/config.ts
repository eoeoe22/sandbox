// Global tunables for the simulation. Kept in one place so cell size, tick
// rate, and the dynamic-grid limits are easy to change as the game grows.

/**
 * Rendered size of one cell, in CSS pixels. This is what "fixed cell size"
 * means: a grain reads the same physical size on every screen. The grid
 * resolution is derived from the sandbox rectangle divided by this value, so a
 * larger sandbox holds proportionally more cells (see layout.ts).
 *
 * 8px reproduces the classic 240×135 grid on a 1920×1080 viewport.
 */
export const CELL_PX = 8;

/**
 * Upper bound on total cells. The simulation runs on the main thread at
 * TICK_HZ, so an unbounded 4K sandbox would blow the frame budget. When the
 * derived grid would exceed this, the effective cell size is scaled up
 * uniformly (coarser cells, same aspect) to stay under budget.
 */
export const MAX_CELLS = 60_000;

/** Smallest grid dimension, so a tiny drag still leaves a usable sandbox. */
export const MIN_GRID_SIDE = 16;

/** Reference grid the app opens with before the viewport is measured (~16:9). */
export const GRID_W = 240;
export const GRID_H = 135;

/** Fixed simulation update rate (Hz). Rendering runs at display refresh rate. */
export const TICK_HZ = 60;

/** Max simulation steps per animation frame (prevents spiral-of-death after a stall). */
export const MAX_STEPS_PER_FRAME = 5;
