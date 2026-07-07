import type { Grid } from '../engine/Grid';
import { $selectedMaterial, $brushSize } from '../../state/store';
import { fitGridRect } from '../render/viewport';

/**
 * Translates pointer (mouse/touch/pen) input into grid painting. Reads the
 * selected material and brush size from the shared store, interpolates a line
 * between move events (so fast drags don't leave gaps), and stamps a circular
 * brush at each point.
 */
export class PointerPainter {
  private down = false;
  private px = 0;
  private py = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private grid: Grid,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private toCell(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    // Match the renderer's letterbox so pointer coords land on the right cell.
    // Taps in the letterbox margin map out of bounds and get filtered by stamp.
    const rect = fitGridRect(r.width, r.height, this.grid.width, this.grid.height);
    const localX = e.clientX - r.left - rect.x;
    const localY = e.clientY - r.top - rect.y;
    const gx = Math.floor((localX / rect.width) * this.grid.width);
    const gy = Math.floor((localY / rect.height) * this.grid.height);
    return [gx, gy];
  }

  private stamp(cx: number, cy: number): void {
    const id = $selectedMaterial.get();
    const rad = $brushSize.get();
    const r2 = rad * rad;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (this.grid.inBounds(x, y)) this.grid.set(x, y, id);
      }
    }
  }

  /** Bresenham line so a quick drag paints a continuous stroke. */
  private stroke(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.stamp(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  private onDown = (e: PointerEvent): void => {
    this.down = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw on some pointer types; safe to ignore */
    }
    const [x, y] = this.toCell(e);
    this.px = x;
    this.py = y;
    this.stamp(x, y);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.down) return;
    const [x, y] = this.toCell(e);
    this.stroke(this.px, this.py, x, y);
    this.px = x;
    this.py = y;
  };

  private onUp = (): void => {
    this.down = false;
  };
}
