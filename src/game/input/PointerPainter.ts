import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import {
  $selectedMaterial,
  $brushSize,
  $brushShape,
  $brushMode,
  $overwriteLevel,
} from '../../state/store';
import { BRUSH_MIN, BRUSH_MAX, PARTICLE_FILL_RATE } from '../config';
import { createFloatingOverlay } from './floatingOverlay';
import { getMaterial } from '../materials';
import { Phase } from '../engine/types';

/**
 * Ordering of phases from "easiest to overwrite" to "hardest", used by the
 * brush overwrite gate. Wall is a tag on top of Phase.Solid rather than its
 * own phase, so it's checked separately and always sits at the top.
 */
const OVERWRITE_PHASE_ORDER = [Phase.Gas, Phase.Liquid, Phase.Powder, Phase.Solid];

/**
 * Whether the brush may paint over whatever currently occupies (x, y), given
 * the current overwrite level. Empty cells are always paintable. Level 0
 * means "never overwrite anything non-empty"; each level above that allows
 * one more phase, in `OVERWRITE_PHASE_ORDER`, with Wall gated behind the max
 * level regardless of its (Solid) phase.
 */
function canOverwrite(existingId: number, level: number): boolean {
  if (existingId === 0) return true;
  const existing = getMaterial(existingId);
  if (existing.isWall) return level >= OVERWRITE_PHASE_ORDER.length;
  const rank = OVERWRITE_PHASE_ORDER.indexOf(existing.phase);
  if (rank === -1) return true; // Empty-phase materials, if any: always paintable
  return level >= rank + 1;
}

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
    // A gesture can end without a pointerup (browser/OS takes it over for
    // scrolling, palm rejection, lost capture); without this, `down` would
    // stay stuck true and the per-frame `update()` would paint forever.
    window.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerenter', this.onEnter);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.cursorEl = createFloatingOverlay('brush-cursor');
    this.cursorEl.style.display = 'none';

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
    const level = $overwriteLevel.get();
    // The overwrite gate is about new material displacing existing particles;
    // the eraser (Empty) always erases regardless of the setting.
    const isEraser = id === 0;
    // Solid materials always paint Full — a sparse pile of solid grains
    // reads as a bug, not a feature, so Particle mode only applies to
    // non-solid materials (sand, water, gases, ...).
    const particle = $brushMode.get() === 'particle' && getMaterial(id).phase !== Phase.Solid;
    const r2 = rad * rad;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (shape === 'circle' && dx * dx + dy * dy > r2) continue;
        if (particle && Math.random() > PARTICLE_FILL_RATE) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.grid.inBounds(x, y)) continue;
        if (!isEraser && !canOverwrite(this.grid.get(x, y), level)) continue;
        this.grid.set(x, y, id);
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
    // Restore the CSS fallback cursor now that our overlay is hidden again.
    this.canvas.style.cursor = 'crosshair';
  };

  private onWheel = (e: WheelEvent): void => {
    // Trackpad pinch-zoom and ctrl+scroll-zoom are also reported as `wheel`
    // with ctrlKey set; leave those alone so the browser's zoom still works.
    if (e.ctrlKey) return;
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

    // Only hide the native cursor once the overlay is actually in place, so
    // there's no moment with neither cursor visible.
    this.canvas.style.cursor = 'none';
    this.cursorEl.style.display = 'block';
    this.cursorEl.style.left = `${clientX}px`;
    this.cursorEl.style.top = `${clientY}px`;
    this.cursorEl.style.width = `${size}px`;
    this.cursorEl.style.height = `${size}px`;
    this.cursorEl.style.borderRadius = shape === 'circle' ? '50%' : '0';
  }

  /**
   * Re-syncs the cursor overlay after the sandbox layout changes (window
   * resize, drag-resize handle) — cell size may have changed even though the
   * pointer didn't move. No-ops while not hovering.
   */
  refreshCursor(): void {
    this.updateCursor(this.lastClientX, this.lastClientY);
  }

  /**
   * Called once per animation frame from the main loop. Holding a pointer down
   * without moving it stops emitting pointermove events, so without this the
   * brush would silently stop painting while held still; re-stamping every
   * frame keeps it active for the whole press. This has to run every frame
   * rather than only on change: the simulation keeps moving the painted
   * material out of the brush's cells (e.g. falling sand), so re-stamping is
   * what makes holding still read as "pouring" instead of a single splat.
   */
  update(): void {
    if (this.down) this.stamp(this.px, this.py);
  }
}
