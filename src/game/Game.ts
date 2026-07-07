import { Grid } from './engine/Grid';
import { Simulation } from './engine/Simulation';
import { CanvasRenderer } from './render/CanvasRenderer';
import { PointerPainter } from './input/PointerPainter';
import { GRID_W, GRID_H, TICK_HZ, MAX_STEPS_PER_FRAME } from './config';
import { $running, $fps, $clearSignal, $stepSignal } from '../state/store';
import './materials'; // register all materials (side effect)

/**
 * Wires the engine, renderer, and input together and drives the main loop on
 * the main thread with `requestAnimationFrame`. The simulation is stepped at a
 * fixed rate (decoupled from render rate); rendering runs every frame so
 * painting stays responsive even while paused.
 *
 * Future performance seam: the Grid + Simulation are self-contained and could be
 * moved into a Web Worker (transfer the ArrayBuffer) or a WASM core without
 * touching material definitions or the UI.
 */
export function startGame(canvas: HTMLCanvasElement): void {
  const grid = new Grid(GRID_W, GRID_H);
  const sim = new Simulation(grid);
  const renderer = new CanvasRenderer(canvas, grid);
  new PointerPainter(canvas, grid);

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    renderer.resize(
      Math.max(1, Math.floor(canvas.clientWidth * dpr)),
      Math.max(1, Math.floor(canvas.clientHeight * dpr)),
    );
  };
  resize();
  window.addEventListener('resize', resize);

  // UI command signals.
  $clearSignal.listen(() => grid.clear());
  $stepSignal.listen(() => {
    if (!$running.get()) sim.step();
  });

  const stepMs = 1000 / TICK_HZ;
  let last = performance.now();
  let acc = 0;
  let frames = 0;
  let fpsLast = last;

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
      $fps.set(Math.round((frames * 1000) / (now - fpsLast)));
      frames = 0;
      fpsLast = now;
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
