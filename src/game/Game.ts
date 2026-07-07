import { Grid } from './engine/Grid';
import { Simulation } from './engine/Simulation';
import { CanvasRenderer } from './render/CanvasRenderer';
import { PointerPainter } from './input/PointerPainter';
import { SandboxResizer } from './input/SandboxResizer';
import { SandboxLayout } from './layout';
import { TICK_HZ, MAX_STEPS_PER_FRAME } from './config';
import {
  $running,
  $fps,
  $fpsPeak,
  $aspectMode,
  $gridDims,
  $clearSignal,
  $stepSignal,
  $resetAspectSignal,
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
  const layout = new SandboxLayout();
  layout.setViewport(canvas.clientWidth, canvas.clientHeight);

  const grid = new Grid(layout.gw, layout.gh);
  const sim = new Simulation(grid);
  const renderer = new CanvasRenderer(canvas, grid, layout);
  new PointerPainter(canvas, grid, layout);
  const resizer = new SandboxResizer();

  // Push the current layout onto the grid, handle, and HUD after any change.
  const applyLayout = (): void => {
    grid.resize(layout.gw, layout.gh);
    resizer.setRect(layout.cssRect());
    $aspectMode.set(layout.mode);
    $gridDims.set({ w: layout.gw, h: layout.gh });
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

  // Drag the corner handle to resize the sandbox; double-click to reset.
  resizer.onResize = (w, h): void => {
    layout.setSize(w, h);
    applyLayout();
  };
  resizer.onReset = (): void => {
    layout.reset();
    applyLayout();
  };

  // UI command signals.
  $clearSignal.listen(() => grid.clear());
  $stepSignal.listen(() => {
    if (!$running.get()) sim.step();
  });
  $resetAspectSignal.listen(() => {
    layout.reset();
    applyLayout();
  });

  const stepMs = 1000 / TICK_HZ;
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

  const frame = (now: number): void => {
    acc += now - last;
    last = now;

    if ($running.get()) {
      let steps = 0;
      while (acc >= stepMs && steps < MAX_STEPS_PER_FRAME) {
        sim.step();
        acc -= stepMs;
        steps++;
      }
      if (acc > stepMs * MAX_STEPS_PER_FRAME) acc = 0; // drop backlog after a stall
    } else {
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

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
