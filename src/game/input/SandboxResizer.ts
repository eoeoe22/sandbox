import type { ViewRect } from '../render/viewport';

/**
 * A draggable handle at the sandbox's bottom-right corner that resizes the play
 * area. Resizing is symmetric about the viewport center, so the sandbox stays
 * centered as it grows or shrinks and the drag reads as "set the size and
 * aspect ratio of the space." Double-clicking the handle resets to the device
 * default.
 *
 * All geometry is measured against the canvas (its bounding rect and client
 * size) — the exact frame the SandboxLayout centers the sandbox in — so the
 * handle tracks the pointer even when `window.innerHeight` disagrees with
 * `100vh` (e.g. the iOS Safari URL bar). Move/up are bound on `window` so a lost
 * pointer capture can't wedge the drag with no way to release.
 */
export class SandboxResizer {
  private el: HTMLDivElement;
  private dragging = false;

  /** Called when a drag begins, before the first size — snapshot point. */
  onResizeStart: () => void = () => {};
  /** Called with the requested sandbox size in CSS px while dragging. */
  onResize: (w: number, h: number) => void = () => {};
  /** Called when the drag ends (pointerup). */
  onResizeEnd: () => void = () => {};
  /** Called on double-click to reset to the device default. */
  onReset: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    const el = document.createElement('div');
    el.className = 'sandbox-handle';
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', '샌드박스 크기 조절');
    el.title = '드래그: 크기·화면비 조절 · 더블클릭: 기기에 맞춤';
    el.innerHTML = '<i class="bi bi-arrows-angle-expand"></i>';
    document.body.appendChild(el);
    this.el = el;

    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.onReset();
    });
  }

  /** The viewport center, in the same client coords pointer events report. */
  private center(): { cx: number; cy: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      cx: r.left + this.canvas.clientWidth / 2,
      cy: r.top + this.canvas.clientHeight / 2,
    };
  }

  /** Position the handle at the sandbox rect's bottom-right corner (CSS px). */
  setRect(rect: ViewRect): void {
    const r = this.canvas.getBoundingClientRect();
    const cornerX = r.left + rect.x + rect.width;
    const cornerY = r.top + rect.y + rect.height;
    // Keep the handle fully on-screen even when the sandbox fills the viewport.
    const half = this.el.offsetWidth / 2 || 11;
    const x = Math.min(cornerX, r.left + this.canvas.clientWidth - half);
    const y = Math.min(cornerY, r.top + this.canvas.clientHeight - half);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.dragging = true;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw on some pointer types; window listeners
         still deliver move/up, so the drag works without capture */
    }
    this.el.classList.add('dragging');
    this.onResizeStart();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    e.preventDefault();
    // Symmetric about the viewport center: half-extent = pointer − center.
    const { cx, cy } = this.center();
    this.onResize(2 * Math.abs(e.clientX - cx), 2 * Math.abs(e.clientY - cy));
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
    this.onResizeEnd();
  };
}
