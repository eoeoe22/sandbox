import { atom } from 'nanostores';
import { SAND } from '../game/materials';
import { GRID_W, GRID_H, OVERWRITE_LEVEL_MAX } from '../game/config';
import type { AspectMode } from '../game/layout';
import type { BorderMode } from '../game/engine/types';

// Framework-neutral bridge between the Svelte control panel and the vanilla
// engine (the Astro-recommended nanostores pattern). The engine reads/listens;
// the UI writes. Swapping the UI framework never touches the engine.
//
// Note: nanostores atoms already satisfy Svelte's store contract, so a Svelte
// component can `import { $running as running }` and use `$running` directly.

/** Currently selected material id (defaults to Sand). */
export const $selectedMaterial = atom<number>(SAND.id);

/** Brush radius in cells. */
export const $brushSize = atom<number>(3);

/** Brush stamp shape. */
export type BrushShape = 'circle' | 'square';
export const $brushShape = atom<BrushShape>('circle');

/**
 * Brush fill mode. 'full' fills every eligible cell in the brush area;
 * 'particle' randomly leaves gaps. Solid materials always paint as 'full'
 * regardless of this setting (see PointerPainter.stamp).
 */
export type BrushMode = 'full' | 'particle';
export const $brushMode = atom<BrushMode>('full');

/**
 * Active brush tool. 'material' (the default) paints the selected material —
 * the existing behavior. The others are "special brushes" that act on the
 * cells already under the brush instead of placing material: 'heat'/'cool'
 * nudge each cell's temperature, and 'mix' shuffles the non-solid particles
 * (solids stay put). See PointerPainter and config.ts. Selecting a material in
 * the palette snaps this back to 'material'.
 */
export type Tool = 'material' | 'heat' | 'cool' | 'mix';
export const $tool = atom<Tool>('material');

/**
 * How aggressively the brush overwrites existing (non-Empty) particles, as a
 * step from 0 (never overwrite) to `OVERWRITE_LEVEL_MAX` (overwrite anything,
 * including Wall). Each step also allows every phase the previous steps
 * allow — see `OVERWRITE_LEVELS` in config.ts for the level labels.
 */
export const $overwriteLevel = atom<number>(OVERWRITE_LEVEL_MAX);

/** Whether the simulation is advancing. */
export const $running = atom<boolean>(true);

/** Smoothed frames-per-second (for the HUD). */
export const $fps = atom<number>(0);

/**
 * Peak frame rate observed this session. On adaptive-refresh displays
 * (ProMotion / Adaptive Sync) the current rate drops when idle to save power,
 * so showing the peak alongside keeps the HUD honest about the device's real
 * capability instead of looking like a bug.
 */
export const $fpsPeak = atom<number>(0);

/** How the sandbox size is chosen ('device' = fills viewport, 'custom' = dragged). */
export const $aspectMode = atom<AspectMode>('device');

/**
 * Sandbox edge behavior: 'wall' (solid indestructible container, the default and
 * original behavior) or 'void' (open edges — particles that reach an edge fall
 * out of the world). The engine reads this via Simulation.setBorderMode and the
 * renderer restyles the boundary outline to signal which mode is active.
 */
export const $borderMode = atom<BorderMode>('wall');

/** Current grid resolution in cells (for the HUD). */
export const $gridDims = atom<{ w: number; h: number }>({ w: GRID_W, h: GRID_H });

// One-shot command signals: bump the counter to request the action. The engine
// listens for changes.
export const $clearSignal = atom<number>(0);
export const $stepSignal = atom<number>(0);
export const $resetAspectSignal = atom<number>(0);

/** Clear the whole grid. */
export const requestClear = (): void => $clearSignal.set($clearSignal.get() + 1);

/** Advance the simulation by exactly one tick (used while paused). */
export const requestStep = (): void => $stepSignal.set($stepSignal.get() + 1);

/** Reset the sandbox to fill the device viewport (default aspect). */
export const requestResetAspect = (): void =>
  $resetAspectSignal.set($resetAspectSignal.get() + 1);
