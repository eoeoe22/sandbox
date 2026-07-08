import type { ViewRect } from '../render/viewport';
import { createFloatingOverlay } from './floatingOverlay';

/**
 * A draggable handle at the sandbox's top-left corner that moves the play area
 * within the viewport, independent of its size. Unlike SandboxResizer, motion
 * is relative to the pointer's own delta each move (not a fixed point), so the
 * handle tracks the cursor 1:1 as it drags.
 *
 * Geometry is measured against the canvas (its bounding rect), matching the
 * frame SandboxLayout positions the sandbox in. Move/up are bound on `window`
 * so a lost pointer capture can't wedge the drag with no way to release.
 */
export class SandboxMover {
  private el: HTMLDivElement;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  /** Called when a drag begins. */
  onMoveStart: () => void = () => {};
  /** Called with the pointer's movement delta (CSS px) while dragging. */
  onMove: (dx: number, dy: number) => void = () => {};
  /** Called when the drag ends (pointerup). */
  onMoveEnd: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    const el = createFloatingOverlay('sandbox-move-handle');
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', '샌드박스 위치 이동');
    el.title = '드래그: 화면 안에서 위치 이동';
    el.innerHTML = '<i class="bi bi-arrows-move"></i>';
    this.el = el;

    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onUp);
  }

  /** Position the handle at the sandbox rect's top-left corner (CSS px). */
  setRect(rect: ViewRect): void {
    const r = this.canvas.getBoundingClientRect();
    const cornerX = r.left + rect.x;
    const cornerY = r.top + rect.y;
    // Keep the handle fully on-screen even when the sandbox fills the viewport.
    const half = this.el.offsetWidth / 2 || 11;
    const x = Math.max(cornerX, r.left + half);
    const y = Math.max(cornerY, r.top + half);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw on some pointer types; window listeners
         still deliver move/up, so the drag works without capture */
    }
    this.el.classList.add('dragging');
    this.onMoveStart();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    e.preventDefault();
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.onMove(dx, dy);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.el.classList.remove('dragging');
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* releasePointerCapture can throw if capture was lost; safe to ignore */
    }
    this.onMoveEnd();
  };
}
