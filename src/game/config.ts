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

/**
 * Heat conduction (direct conduction only — no convection or radiation).
 *
 * Every cell carries a temperature on an arbitrary unitless scale where
 * `AMBIENT_TEMP` is the room baseline every cell starts at. Each tick, cells
 * exchange heat with their 4 orthogonal neighbors in proportion to both cells'
 * conductivities — that, and material cells physically moving, are the only
 * ways heat travels. `EMPTY` (air) has zero conductivity, so a blob with no
 * conductive cold sink touching it never loses heat (lava alone stays molten);
 * it only cools when something like water bridges the heat out.
 */
export const AMBIENT_TEMP = 20;

/**
 * Base per-neighbor heat-exchange fraction, scaled by the two cells'
 * conductivities (0..1). Kept at 0.2 so that even four maximally-conductive
 * neighbors exchange < 1.0 of the gap per tick, which keeps the explicit
 * finite-difference diffusion numerically stable (no runaway oscillation).
 */
export const HEAT_DIFFUSION_RATE = 0.2;

/** Conductivity (0..1) for a material that doesn't declare `thermal.conductivity`. */
export const DEFAULT_CONDUCTIVITY = 0.3;

/** Brush radius bounds, in cells (shared by the store, painter, and UI slider/wheel). */
export const BRUSH_MIN = 0;
export const BRUSH_MAX = 12;

/** Max simulation steps per animation frame (prevents spiral-of-death after a stall). */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * Steady-state cadence for auto-saving the world to localStorage (see
 * state/persistence.ts). Saves also fire when the tab is hidden or closed;
 * this interval just bounds how much progress a crash can lose. Encoding is a
 * single pass over the grid (~ms at the cell budget), so every few seconds is
 * imperceptible.
 */
export const WORLD_AUTOSAVE_MS = 3000;

/** In Particle brush mode, fraction of non-solid cells within the brush area that get filled. */
export const PARTICLE_FILL_RATE = 0.55;

/**
 * Special (non-painting) brush tools — see the store's `$tool` and
 * PointerPainter. Instead of placing material, they act on the cells already
 * under the brush: heat/cool nudge each cell's temperature, mix shuffles the
 * non-solid particles.
 */
/** Temperature change applied per stamp by the heat (+) / cool (−) brush. Held
 *  presses re-stamp every frame (see PointerPainter.update), so this accumulates
 *  — sized so a brief hold noticeably warms/cools without instantly saturating. */
export const HEAT_BRUSH_DELTA = 12;
/** Upper clamp for the heat brush, comfortably above every material's own
 *  temperature (Lava ~1500, Fire ~1000) so superheating still has headroom. */
export const HEAT_BRUSH_MAX = 2000;
/** Lower clamp for the cool brush — a bit below ambient (20), enough to make a
 *  cold sink that pulls heat out of neighbors without a runaway to absolute cold. */
export const HEAT_BRUSH_MIN = -50;

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
