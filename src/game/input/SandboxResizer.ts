import type { ViewRect } from '../render/viewport';

/**
 * A draggable handle at the sandbox's bottom-right corner that resizes the play
 * area. Resizing is symmetric about the viewport center, so the sandbox stays
 * centered as it grows or shrinks and the drag reads as "set the size and
 * aspect ratio of the space." Double-clicking the handle resets to the device
 * default.
 *
 * Lives in the DOM on top of the canvas with its own pointer capture, so it
 * never triggers the PointerPainter underneath.
 */
export class SandboxResizer {
  private el: HTMLDivElement;
  private dragging = false;

  /** Called with the requested sandbox size in CSS px while dragging. */
  onResize: (w: number, h: number) => void = () => {};
  /** Called on double-click to reset to the device default. */
  onReset: () => void = () => {};

  constructor() {
    const el = document.createElement('div');
    el.className = 'sandbox-handle';
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', '샌드박스 크기 조절');
    el.title = '드래그: 크기·화면비 조절 · 더블클릭: 기기에 맞춤';
    el.innerHTML = '<i class="bi bi-arrows-angle-expand"></i>';
    document.body.appendChild(el);
    this.el = el;

    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.onReset();
    });
  }

  /** Position the handle at the sandbox rect's bottom-right corner (CSS px). */
  setRect(rect: ViewRect): void {
    const cornerX = rect.x + rect.width;
    const cornerY = rect.y + rect.height;
    // Keep the handle fully on-screen even when the sandbox fills the viewport.
    const half = this.el.offsetWidth / 2 || 11;
    const x = Math.min(cornerX, window.innerWidth - half);
    const y = Math.min(cornerY, window.innerHeight - half);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.dragging = true;
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add('dragging');
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    // Symmetric about the viewport center: half-extent = pointer − center.
    const w = 2 * Math.abs(e.clientX - window.innerWidth / 2);
    const h = 2 * Math.abs(e.clientY - window.innerHeight / 2);
    this.onResize(w, h);
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
  };
}
