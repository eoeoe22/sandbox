import { atom } from 'nanostores';
import { SAND, WATER } from '../game/materials';
import {
  GRID_W,
  GRID_H,
  OVERWRITE_LEVEL_MAX,
  SIM_SPEED_DEFAULT,
  SMOKE_LEVEL_DEFAULT,
  BRUSH_SIZE_DEFAULT,
  GRAVITY_DIR_DEFAULT,
  GRAVITY_STRENGTH_DEFAULT,
  CELL_SCALE_DEFAULT,
  GRID_DIVISION_DEFAULT,
  RECENT_MATERIALS_MAX,
} from '../game/config';
import type {
  SimSpeed,
  SmokeLevel,
  GravityDir,
  CellScale,
  GridDivision,
} from '../game/config';
import type { BorderMode } from '../game/engine/types';
import type { InspectStats } from '../game/engine/brushTools';

// Framework-neutral bridge between the Svelte control panel and the vanilla
// engine (the Astro-recommended nanostores pattern). The engine reads/listens;
// the UI writes. Swapping the UI framework never touches the engine.
//
// Note: nanostores atoms already satisfy Svelte's store contract, so a Svelte
// component can `import { $running as running }` and use `$running` directly.

/** Currently selected material id (defaults to Sand). */
export const $selectedMaterial = atom<number>(SAND.id);

/** Brush radius in cells. */
export const $brushSize = atom<number>(BRUSH_SIZE_DEFAULT);

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
 * drag, promoted to its own selectable tool). 'object' spawns a free rigid
 * object (the rubber ball) at the click instead of painting cells — the 독립
 * 오브젝트 layer's placement tool. 'view' (보기) is an inert brush: a
 * left-click/drag places nothing, so you can move the pointer over the world
 * without disturbing it — a right-button drag still erases (the secondary
 * button always erases, see PointerPainter). Handy paired with the 돋보기
 * inspect overlay ($inspect) to survey the world without painting. See
 * PointerPainter and config.ts. Selecting a material in the palette snaps this
 * back to 'material'.
 */
export type Tool = 'material' | 'heat' | 'cool' | 'mix' | 'erase' | 'blend' | 'object' | 'view';
export const $tool = atom<Tool>('material');

/**
 * Which free object the 'object' tool spawns on a canvas click — the object
 * layer's answer to `$selectedMaterial`. The 독립 오브젝트 palette tab sets this
 * when an item is picked; PointerPainter reads it to build the right body (a
 * rubber ball, or a drum: empty 빈 드럼통, 원유 드럼통, or 산 드럼통 — the three
 * drums share one capsule and differ only in what they spill when destroyed).
 * See MaterialPalette and PointerPainter.
 */
export type ObjectKind = 'ball' | 'drum' | 'oildrum' | 'aciddrum';
export const $selectedObject = atom<ObjectKind>('ball');

/**
 * The 돋보기 (inspect) overlay toggle. Independent of `$tool` — it can be on
 * alongside any brush — this is a separate mode that, while on, surveys the
 * cells under the brush and reports what's there (material breakdown, counts,
 * composition ratio, average temperature) via `$inspectData`. It never paints
 * or alters the world; it only reads. Toggle it on and it works whenever the
 * pointer hovers the canvas. See PointerPainter and InspectPanel.svelte.
 */
export const $inspect = atom<boolean>(false);

/**
 * Live readout for the 돋보기 inspect overlay: a survey of the cells currently
 * under the brush, refreshed by PointerPainter as the pointer moves and as the
 * simulation runs beneath a still cursor. `null` when inspect is off or the
 * pointer isn't over the canvas. See `InspectStats` (engine/brushTools) and
 * InspectPanel.svelte.
 */
export const $inspectData = atom<InspectStats | null>(null);

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
/** The out-of-the-box blend: a 50/50 sand·water mix. Kept as a named constant so
 *  the atom seed and the "restore defaults" action share one source of truth. */
export const DEFAULT_BLEND: BlendComponent[] = [
  { id: SAND.id, ratio: 50 },
  { id: WATER.id, ratio: 50 },
];
/** Materials + ratios the blend brush paints. Defaults to a 50/50 sand·water mix. */
export const $blendBrush = atom<BlendComponent[]>(DEFAULT_BLEND.map((c) => ({ ...c })));

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

/**
 * Gravity direction — which way "down" points for all falling/rising material.
 * The engine reads it via Simulation.setGravity (Game.ts subscribes); flipping
 * it re-orients every powder/liquid/gas at once. See config `GravityDir`.
 */
export const $gravityDir = atom<GravityDir>(GRAVITY_DIR_DEFAULT);

/**
 * Gravity strength, 0..1 — how strongly gravity pulls (a per-tick move
 * probability). `1` is normal, fractional values give a floaty settle, `0` is
 * weightless. Only bulk motion slows; reactions/heat keep running. See config.
 */
export const $gravityStrength = atom<number>(GRAVITY_STRENGTH_DEFAULT);

/**
 * Cell-size / resolution multiplier (relative to CELL_PX): larger = coarser grid
 * with bigger cells, smaller = finer. The layout re-derives the grid from this
 * and the engine resizes in place (Game.ts subscribes). See config `CellScale`.
 */
export const $cellScale = atom<CellScale>(CELL_SCALE_DEFAULT);

/**
 * Temperature heat-map overlay. When on, the renderer recolors every occupied
 * cell by its temperature (a cold-blue → hot-red ramp) instead of its material
 * color, turning the sandbox into a live thermal camera. Purely a render mode —
 * the simulation is untouched. The renderer reads it via setHeatOverlay.
 */
export const $heatOverlay = atom<boolean>(false);

/**
 * Grid-overlay line spacing in cells (0 = off). The renderer draws a faint
 * reference grid every N cells so structures line up and the cell scale is
 * legible. Read via CanvasRenderer.setGridDivision. See config `GridDivision`.
 */
export const $gridDivision = atom<GridDivision>(GRID_DIVISION_DEFAULT);

/**
 * Favorited material ids (starred in the palette's quick-access bar). Persisted,
 * ordered by when they were starred. User data, not a "setting" — untouched by
 * restore-defaults.
 */
export const $favorites = atom<number[]>([]);

/**
 * Recently-used material ids, most-recent first, capped at RECENT_MATERIALS_MAX.
 * Updated by `recordMaterialUse` on every material pick. Persisted; user data.
 */
export const $recentMaterials = atom<number[]>([]);

/** Current grid resolution in cells (for the HUD). */
export const $gridDims = atom<{ w: number; h: number }>({ w: GRID_W, h: GRID_H });

/** Live particle count — occupied (non-Empty) cells, refreshed by the frame loop
 *  a couple of times a second for the HUD. */
export const $particleCount = atom<number>(0);

/** Smoothed frame time in milliseconds (the render frame budget), for the HUD. */
export const $frameMs = atom<number>(0);

// One-shot command signals: bump the counter to request the action. The engine
// listens for changes.
export const $clearSignal = atom<number>(0);
export const $stepSignal = atom<number>(0);

/** Clear the whole grid. */
export const requestClear = (): void => $clearSignal.set($clearSignal.get() + 1);

/** Advance the simulation by exactly one tick (used while paused). */
export const requestStep = (): void => $stepSignal.set($stepSignal.get() + 1);

/**
 * Record that material `id` was just selected, moving it to the front of the
 * recent-materials list (deduped, capped at RECENT_MATERIALS_MAX). Called from
 * every palette pick so the quick-access bar tracks what the user actually uses.
 */
export const recordMaterialUse = (id: number): void => {
  const prev = $recentMaterials.get();
  if (prev[0] === id) return; // already most-recent — no churn
  const next = [id, ...prev.filter((m) => m !== id)].slice(0, RECENT_MATERIALS_MAX);
  $recentMaterials.set(next);
};

/** Toggle a material id in the favorites list (star / unstar). */
export const toggleFavorite = (id: number): void => {
  const prev = $favorites.get();
  $favorites.set(prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]);
};

/**
 * Restore every tunable *setting* to its default. Deliberately leaves the world
 * (grid contents), the selected material, and the user's favorites/recent list
 * alone — those aren't "settings", and wiping them on a defaults-restore would
 * be a nasty surprise. Everything a slider/toggle in the settings sheet controls
 * is reset here; persistence follows automatically via the atom listeners.
 */
export const resetSettings = (): void => {
  $running.set(true);
  $simSpeed.set(SIM_SPEED_DEFAULT);
  $brushSize.set(BRUSH_SIZE_DEFAULT);
  $brushShape.set('circle');
  $brushMode.set('full');
  $tool.set('material');
  $inspect.set(false);
  $overwriteLevel.set(OVERWRITE_LEVEL_MAX);
  $borderMode.set('wall');
  $smokeLevel.set(SMOKE_LEVEL_DEFAULT);
  $blendBrush.set(DEFAULT_BLEND.map((c) => ({ ...c })));
  $gravityDir.set(GRAVITY_DIR_DEFAULT);
  $gravityStrength.set(GRAVITY_STRENGTH_DEFAULT);
  $cellScale.set(CELL_SCALE_DEFAULT);
  $heatOverlay.set(false);
  $gridDivision.set(GRID_DIVISION_DEFAULT);
};
