import { Grid } from './engine/Grid';
import { Simulation } from './engine/Simulation';
import { CanvasRenderer } from './render/CanvasRenderer';
import { PointerPainter } from './input/PointerPainter';
import { SandboxResizer } from './input/SandboxResizer';
import { SandboxLayout } from './layout';
import { TICK_HZ, MAX_STEPS_PER_FRAME, WORLD_AUTOSAVE_MS } from './config';
import { initSettingsPersistence, loadWorld, saveWorld } from '../state/persistence';
import {
  $running,
  $fps,
  $fpsPeak,
  $aspectMode,
  $gridDims,
  $clearSignal,
  $stepSignal,
  $resetAspectSignal,
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
 * grid resolution from the viewport (or a user-dragged size) at a fixed cell
 * size, and the grid is resized in place when that changes.
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

  // Restore the previous session's world. A saved custom sandbox size is
  // applied before the grid is built; the saved cells are then copied in with
  // the same bottom-left-anchored rule a live resize uses, so a saved world
  // also survives being reopened on a different screen size.
  const savedWorld = loadWorld();
  if (savedWorld?.aspect?.mode === 'custom') {
    layout.setSize(savedWorld.aspect.w, savedWorld.aspect.h);
  }

  const grid = new Grid(layout.gw, layout.gh);
  if (savedWorld) {
    grid.resizeFrom(layout.gw, layout.gh, savedWorld.cells, savedWorld.w, savedWorld.h, savedWorld.temp);
  }
  const sim = new Simulation(grid);
  const renderer = new CanvasRenderer(canvas, grid, layout);
  const painter = new PointerPainter(canvas, grid, layout);
  const resizer = new SandboxResizer(canvas);

  // Reflect the layout onto the handle and HUD (cheap; runs after any change).
  const syncLayoutOutputs = (): void => {
    resizer.setRect(layout.cssRect());
    painter.refreshCursor();
    $aspectMode.set(layout.mode);
    $gridDims.set({ w: layout.gw, h: layout.gh });
  };
  // Resize the grid from its own contents, then sync (window resize / reset).
  const applyLayout = (): void => {
    grid.resize(layout.gw, layout.gh);
    syncLayoutOutputs();
  };

  // Drag state. A drag emits a size per pointermove (which can outpace the frame
  // rate), so the requested size is coalesced and applied once per frame — one
  // grid rebuild per frame instead of per event. The grid is rebuilt from a
  // snapshot taken at drag start, so the resize is non-destructive within the
  // gesture: overshooting inward and back out restores content instead of
  // cropping it away.
  let pendingSize: { w: number; h: number } | null = null;
  let dragSnapshot: { cells: Uint8Array; temp: Float32Array; w: number; h: number } | null = null;

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

  // Drag the corner handle to resize the sandbox; double-click / button resets.
  resizer.onResizeStart = (): void => {
    dragSnapshot = {
      cells: grid.cells.slice(),
      temp: grid.temp.slice(),
      w: grid.width,
      h: grid.height,
    };
  };
  resizer.onResize = (w, h): void => {
    pendingSize = { w, h }; // applied in the frame loop (coalesced)
  };
  resizer.onResizeEnd = (): void => {
    dragSnapshot = null;
  };
  resizer.onReset = (): void => {
    layout.reset();
    applyLayout();
  };

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
  $resetAspectSignal.listen(() => {
    layout.reset();
    applyLayout();
  });

  // Auto-save the world: on a fixed interval from the frame loop (below), and
  // immediately when the tab is hidden or closed so the last few seconds of
  // painting aren't lost. saveWorld itself skips the write when nothing changed.
  const saveNow = (): void => saveWorld(grid, layout);
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
    // Apply a coalesced drag resize (at most once per frame). Rebuild from the
    // drag-start snapshot so the gesture is non-destructive.
    if (pendingSize) {
      layout.setSize(pendingSize.w, pendingSize.h);
      pendingSize = null;
      if (dragSnapshot) {
        grid.resizeFrom(
          layout.gw,
          layout.gh,
          dragSnapshot.cells,
          dragSnapshot.w,
          dragSnapshot.h,
          dragSnapshot.temp,
        );
      } else {
        grid.resize(layout.gw, layout.gh);
      }
      syncLayoutOutputs();
    }

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
