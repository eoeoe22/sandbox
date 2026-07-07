import { atom } from 'nanostores';
import { SAND } from '../game/materials';

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

/** Whether the simulation is advancing. */
export const $running = atom<boolean>(true);

/** Most recent measured frames-per-second (for the HUD). */
export const $fps = atom<number>(0);

// One-shot command signals: bump the counter to request the action. The engine
// listens for changes.
export const $clearSignal = atom<number>(0);
export const $stepSignal = atom<number>(0);

/** Clear the whole grid. */
export const requestClear = (): void => $clearSignal.set($clearSignal.get() + 1);

/** Advance the simulation by exactly one tick (used while paused). */
export const requestStep = (): void => $stepSignal.set($stepSignal.get() + 1);
