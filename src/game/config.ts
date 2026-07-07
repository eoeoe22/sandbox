// Global tunables for the simulation. Kept in one place so the grid size,
// display scaling, and tick rate are easy to change as the game grows.

/** Simulation grid width in cells. */
export const GRID_W = 240;

/** Simulation grid height in cells (roughly 16:9). */
export const GRID_H = 135;

/** Fixed simulation update rate (Hz). Rendering runs at display refresh rate. */
export const TICK_HZ = 60;

/** Max simulation steps per animation frame (prevents spiral-of-death after a stall). */
export const MAX_STEPS_PER_FRAME = 5;
