import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import { $selectedMaterial, $brushSize, $brushShape } from '../../state/store';
import { BRUSH_MIN, BRUSH_MAX } from '../config';

/**
 * Translates pointer (mouse/touch/pen) input into grid painting. Reads the
 * selected material, brush size, and brush shape from the shared store,
 * interpolates a line between move events (so fast drags don't leave gaps),
 * and stamps a circular or square brush at each point.
 *
 * Also owns two pieces of pointer-adjacent UX: a brush-size cursor outline
 * that follows the pointer, and mouse-wheel resizing of the brush.
 */
export class PointerPainter {
  private down = false;
  private px = 0;
  private py = 0;
  private cursorEl: HTMLDivElement;

  constructor(
    private canvas: HTMLCanvasElement,
    private grid: Grid,
    private layout: SandboxLayout,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerenter', this.onEnter);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'brush-cursor';
    this.cursorEl.style.display = 'none';
    document.body.appendChild(this.cursorEl);

    // Brush size/shape can change from the control panel while the pointer
    // sits still over the canvas; keep the cursor in sync either way.
    $brushSize.listen(() => this.updateCursor(this.lastClientX, this.lastClientY));
    $brushShape.listen(() => this.updateCursor(this.lastClientX, this.lastClientY));
  }

  private lastClientX = 0;
  private lastClientY = 0;
  private hovering = false;

  private toCell(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    // Use the same sandbox rect the renderer draws into (CSS px) so pointer
    // coords land on the right cell. Taps outside the sandbox map out of bounds
    // and get filtered by stamp.
    const rect = this.layout.cssRect();
    const localX = e.clientX - r.left - rect.x;
    const localY = e.clientY - r.top - rect.y;
    const gx = Math.floor((localX / rect.width) * this.grid.width);
    const gy = Math.floor((localY / rect.height) * this.grid.height);
    return [gx, gy];
  }

  private stamp(cx: number, cy: number): void {
    const id = $selectedMaterial.get();
    const rad = $brushSize.get();
    const shape = $brushShape.get();
    const r2 = rad * rad;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (shape === 'circle' && dx * dx + dy * dy > r2) continue;
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
    this.updateCursor(e.clientX, e.clientY);
    if (!this.down) return;
    const [x, y] = this.toCell(e);
    this.stroke(this.px, this.py, x, y);
    this.px = x;
    this.py = y;
  };

  private onUp = (): void => {
    this.down = false;
  };

  private onEnter = (e: PointerEvent): void => {
    this.hovering = true;
    this.updateCursor(e.clientX, e.clientY);
  };

  private onLeave = (): void => {
    this.hovering = false;
    this.cursorEl.style.display = 'none';
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const cur = $brushSize.get();
    const dir = e.deltaY > 0 ? -1 : 1;
    const next = Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, cur + dir));
    if (next !== cur) $brushSize.set(next);
  };

  /** Position and size the brush-outline cursor to match the current brush. */
  private updateCursor(clientX: number, clientY: number): void {
    this.lastClientX = clientX;
    this.lastClientY = clientY;
    if (!this.hovering) return;

    const rad = $brushSize.get();
    const shape = $brushShape.get();
    const cell = this.layout.cell;
    const size = (2 * rad + 1) * cell;

    this.cursorEl.style.display = 'block';
    this.cursorEl.style.left = `${clientX}px`;
    this.cursorEl.style.top = `${clientY}px`;
    this.cursorEl.style.width = `${size}px`;
    this.cursorEl.style.height = `${size}px`;
    this.cursorEl.style.borderRadius = shape === 'circle' ? '50%' : '0';
  }

  /**
   * Called once per animation frame from the main loop. Holding a pointer down
   * without moving it stops emitting pointermove events, so without this the
   * brush would silently stop painting while held still; re-stamping every
   * frame keeps it active for the whole press.
   */
  update(): void {
    if (this.down) this.stamp(this.px, this.py);
  }
}
