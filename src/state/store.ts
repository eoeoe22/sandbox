import { atom } from 'nanostores';
import { SAND, WATER } from '../game/materials';
import {
  GRID_W,
  GRID_H,
  OVERWRITE_LEVEL_MAX,
  SIM_SPEED_DEFAULT,
  SMOKE_LEVEL_DEFAULT,
} from '../game/config';
import type { SimSpeed, SmokeLevel } from '../game/config';
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
 * the existing behavior. 'blend' paints a stochastic mixture of the materials
 * configured in `$blendBrush`. The rest are "special brushes" that act on the
 * cells already under the brush instead of placing material: 'heat'/'cool'
 * nudge each cell's temperature, 'mix' shuffles the non-solid particles (solids
 * stay put), and 'erase' clears cells to Empty (the same as a right-button
 * drag, promoted to its own selectable tool). See PointerPainter and config.ts.
 * Selecting a material in the palette snaps this back to 'material'.
 */
export type Tool = 'material' | 'heat' | 'cool' | 'mix' | 'erase' | 'blend';
export const $tool = atom<Tool>('material');

/**
 * One component of the blend (혼합) brush: a material id and the percentage
 * weight it gets when the brush paints. Ratios are whole multiples of
 * `BLEND_RATIO_STEP` and the components' ratios sum to 100 (see config.ts and
 * PointerPainter.paintBlend). Up to `BLEND_MAX_SLOTS` components.
 */
export interface BlendComponent {
  id: number;
  ratio: number;
}
/** Materials + ratios the blend brush paints. Defaults to a 50/50 sand·water mix. */
export const $blendBrush = atom<BlendComponent[]>([
  { id: SAND.id, ratio: 50 },
  { id: WATER.id, ratio: 50 },
]);

/**
 * How aggressively the brush overwrites existing (non-Empty) particles, as a
 * step from 0 (never overwrite) to `OVERWRITE_LEVEL_MAX` (overwrite anything,
 * including Wall). Each step also allows every phase the previous steps
 * allow — see `OVERWRITE_LEVELS` in config.ts for the level labels.
 */
export const $overwriteLevel = atom<number>(OVERWRITE_LEVEL_MAX);

/** Whether the simulation is advancing. */
export const $running = atom<boolean>(true);

/**
 * Simulation speed multiplier. `1` (the default) runs at half the base tick rate
 * for a calmer pace; `2` restores the original full speed. The engine (Game.ts)
 * turns this into the fixed step interval; rendering is unaffected. See
 * `SIM_SPEEDS` in config.ts.
 */
export const $simSpeed = atom<SimSpeed>(SIM_SPEED_DEFAULT);

/** Smoothed frames-per-second (for the HUD). */
export const $fps = atom<number>(0);

/**
 * Peak frame rate observed this session. On adaptive-refresh displays
 * (ProMotion / Adaptive Sync) the current rate drops when idle to save power,
 * so showing the peak alongside keeps the HUD honest about the device's real
 * capability instead of looking like a bug.
 */
export const $fpsPeak = atom<number>(0);

/**
 * Sandbox edge behavior: 'wall' (solid indestructible container, the default and
 * original behavior) or 'void' (open edges — particles that reach an edge fall
 * out of the world). The engine reads this via Simulation.setBorderMode and the
 * renderer restyles the boundary outline to signal which mode is active.
 */
export const $borderMode = atom<BorderMode>('wall');

/**
 * How much Smoke reactions emit: 'high' (the original "smoke on" level),
 * 'medium' (the default — a thinned-out amount), or 'off' (no reaction Smoke at
 * all). This replaces the old on/off toggle. Governs every combustion/explosion
 * reaction (Fire, Blue Flame, Ember, Molten Uranium, Heat Ray, …) through one
 * seam in SimContext; the engine reads it via Simulation.setSmokeLevel. Manual
 * Smoke painting bypasses that seam, so it still works at any level. See
 * `SmokeLevel` / `SMOKE_MEDIUM_KEEP` in config.ts.
 */
export const $smokeLevel = atom<SmokeLevel>(SMOKE_LEVEL_DEFAULT);

/** Current grid resolution in cells (for the HUD). */
export const $gridDims = atom<{ w: number; h: number }>({ w: GRID_W, h: GRID_H });

// One-shot command signals: bump the counter to request the action. The engine
// listens for changes.
export const $clearSignal = atom<number>(0);
export const $stepSignal = atom<number>(0);

/** Clear the whole grid. */
export const requestClear = (): void => $clearSignal.set($clearSignal.get() + 1);

/** Advance the simulation by exactly one tick (used while paused). */
export const requestStep = (): void => $stepSignal.set($stepSignal.get() + 1);
