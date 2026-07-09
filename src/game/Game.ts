import { Grid } from './engine/Grid';
import { Simulation } from './engine/Simulation';
import { CanvasRenderer } from './render/CanvasRenderer';
import { PointerPainter } from './input/PointerPainter';
import { SandboxLayout } from './layout';
import { TICK_HZ, MAX_STEPS_PER_FRAME, WORLD_AUTOSAVE_MS } from './config';
import { initSettingsPersistence, loadWorld, saveWorld } from '../state/persistence';
import {
  $running,
  $fps,
  $fpsPeak,
  $gridDims,
  $clearSignal,
  $stepSignal,
  $borderMode,
  $simSpeed,
} from '../state/store';
import './materials'; // register all materials (side effect)

/**
 * Wires the engine, renderer, and input together and drives the main loop on
 * the main thread with `requestAnimationFrame`. The simulation is stepped at a
 * fixed rate (decoupled from render rate); rendering runs every frame so
 * painting stays responsive even while paused.
 *
 * The sandbox has a dynamic aspect ratio: a shared SandboxLayout derives the
 * grid resolution from the canvas at a fixed cell size, and the grid is resized
 * in place when that changes (window resize, or a responsive layout switch that
 * changes the canvas size). The canvas is sized by CSS to the play area left
 * beside the control bar, so the sandbox never overlaps the UI.
 *
 * Future performance seam: the Grid + Simulation are self-contained and could be
 * moved into a Web Worker (transfer the ArrayBuffer) or a WASM core without
 * touching material definitions or the UI.
 */
export function startGame(canvas: HTMLCanvasElement): void {
  // Restore saved settings before anything subscribes to the atoms, so the
  // border-mode subscription below seeds the engine with the restored value.
  initSettingsPersistence();

  const layout = new SandboxLayout();
  layout.setViewport(canvas.clientWidth, canvas.clientHeight);

  // Restore the previous session's world. The saved cells are copied into the
  // current sandbox (whatever size this device's canvas derives) with the same
  // bottom-left-anchored rule a live resize uses, so a saved world survives
  // being reopened on a different screen size.
  const savedWorld = loadWorld();

  const grid = new Grid(layout.gw, layout.gh);
  if (savedWorld) {
    grid.resizeFrom(layout.gw, layout.gh, savedWorld.cells, savedWorld.w, savedWorld.h, savedWorld.temp);
  }
  const sim = new Simulation(grid);
  const renderer = new CanvasRenderer(canvas, grid, layout);
  const painter = new PointerPainter(canvas, grid, layout);

  // Reflect the layout onto the cursor overlay and HUD (cheap; runs after any
  // change).
  const syncLayoutOutputs = (): void => {
    painter.refreshCursor();
    $gridDims.set({ w: layout.gw, h: layout.gh });
  };
  // Resize the grid from its own contents, then sync (window resize / layout
  // switch between the desktop sidebar and mobile bottom bar).
  const applyLayout = (): void => {
    grid.resize(layout.gw, layout.gh);
    syncLayoutOutputs();
  };

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    renderer.resize(
      Math.max(1, Math.floor(canvas.clientWidth * dpr)),
      Math.max(1, Math.floor(canvas.clientHeight * dpr)),
    );
    layout.setViewport(canvas.clientWidth, canvas.clientHeight);
    applyLayout();
  };
  resize();
  window.addEventListener('resize', resize);

  // Sandbox edge behavior (wall vs. void). subscribe fires immediately, so this
  // also seeds the engine and renderer with the current mode on startup.
  $borderMode.subscribe((mode) => {
    sim.setBorderMode(mode);
    renderer.setBorderMode(mode);
  });

  // UI command signals.
  $clearSignal.listen(() => grid.clear());
  $stepSignal.listen(() => {
    if (!$running.get()) sim.step();
  });

  // Auto-save the world: on a fixed interval from the frame loop (below), and
  // immediately when the tab is hidden or closed so the last few seconds of
  // painting aren't lost. saveWorld itself skips the write when nothing changed.
  const saveNow = (): void => saveWorld(grid);
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  // Fixed simulation step interval, driven by the UI speed multiplier. TICK_HZ
  // is full speed (×2); the default (×1) runs at half that, so the interval is
  // 2000/(TICK_HZ*mult) ms. subscribe fires immediately, seeding stepMs with the
  // restored/default speed, and updates it live when the user toggles ×1/×2.
  let stepMs = 2000 / (TICK_HZ * $simSpeed.get());
  $simSpeed.subscribe((mult) => {
    stepMs = 2000 / (TICK_HZ * mult);
  });
  let last = performance.now();
  let acc = 0;
  let frames = 0;
  let fpsLast = last;
  // Rendering runs every frame at the display refresh rate — nothing here caps
  // it to 60. The reported value is smoothed so an adaptive-refresh display
  // ramping between rates doesn't make the number flicker, and the peak is kept
  // so the HUD can show the device's real capability.
  let fpsSmooth = 0;
  let fpsPeak = 0;
  let lastAutosave = last;

  const frame = (now: number): void => {
    acc += now - last;
    last = now;

    // Re-stamp the held brush so a stationary press keeps painting/heating
    // (pointermove stops firing once the pointer stops moving). While running we
    // re-stamp once per fixed sim tick, so continuous brushes (the paint "pour"
    // and the heat/cool/mix tools) accumulate at simulation time rather than the
    // display refresh rate — otherwise a 144Hz screen would pour/heat ~2.4× as
    // fast as 60Hz, which matters more for heat since it drives irreversible
    // phase changes (boil/freeze). While paused, time isn't advancing, so we
    // re-stamp once per frame to still allow painting and temperature sculpting.
    if ($running.get()) {
      let steps = 0;
      while (acc >= stepMs && steps < MAX_STEPS_PER_FRAME) {
        painter.update();
        sim.step();
        acc -= stepMs;
        steps++;
      }
      if (acc > stepMs * MAX_STEPS_PER_FRAME) acc = 0; // drop backlog after a stall
    } else {
      painter.update();
      acc = 0;
    }

    renderer.render(grid);

    frames++;
    if (now - fpsLast >= 500) {
      const raw = (frames * 1000) / (now - fpsLast);
      fpsSmooth = fpsSmooth === 0 ? raw : fpsSmooth * 0.6 + raw * 0.4;
      if (fpsSmooth > fpsPeak) fpsPeak = fpsSmooth;
      $fps.set(Math.round(fpsSmooth));
      $fpsPeak.set(Math.round(fpsPeak));
      frames = 0;
      fpsLast = now;
    }

    if (now - lastAutosave >= WORLD_AUTOSAVE_MS) {
      saveNow();
      lastAutosave = now;
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
