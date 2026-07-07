import type { Renderer } from './Renderer';
import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import { getMaterial } from '../materials/registry';

/**
 * Canvas 2D renderer. Writes one packed Uint32 color per cell into an offscreen
 * ImageData at grid resolution, then scales it up to the sandbox rectangle with
 * smoothing off (crisp pixels). The rectangle comes from the shared
 * SandboxLayout, so the grid, its outline, and pointer hit-testing all agree on
 * where the sandbox is — even as its size and aspect ratio change at runtime.
 *
 * The offscreen buffer is rebuilt whenever the grid's dimensions change (the
 * sandbox was resized). Fast enough for a wide range of grid sizes and
 * swappable for a WebGL renderer via the Renderer interface.
 */
export class CanvasRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private image!: ImageData;
  private buf32!: Uint32Array;
  private palette: Uint32Array;

  constructor(
    private canvas: HTMLCanvasElement,
    grid: Grid,
    private layout: SandboxLayout,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.off = document.createElement('canvas');
    const offCtx = this.off.getContext('2d');
    if (!offCtx) throw new Error('Offscreen 2D context unavailable');
    this.offCtx = offCtx;
    this.allocForGrid(grid);

    // Precompute id → color. Materials are registered before the renderer is
    // constructed, so this stays in sync for the milestone's fixed set.
    this.palette = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const m = getMaterial(i);
      this.palette[i] = m ? m.color : 0;
    }
  }

  /** (Re)size the offscreen buffer to match the grid resolution. */
  private allocForGrid(grid: Grid): void {
    this.off.width = grid.width;
    this.off.height = grid.height;
    this.image = this.offCtx.createImageData(grid.width, grid.height);
    this.buf32 = new Uint32Array(this.image.data.buffer);
  }

  render(grid: Grid): void {
    if (this.off.width !== grid.width || this.off.height !== grid.height) {
      this.allocForGrid(grid);
    }

    const cells = grid.cells;
    const buf = this.buf32;
    const pal = this.palette;
    for (let i = 0; i < cells.length; i++) {
      buf[i] = pal[cells[i]];
    }
    this.offCtx.putImageData(this.image, 0, 0);

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = cw / Math.max(1, this.canvas.clientWidth);
    const rect = this.layout.deviceRect(scale);

    // Clear to transparent (reveals the page background outside the sandbox),
    // then draw the grid crisp and outline the play area.
    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.off, rect.x, rect.y, rect.width, rect.height);
    this.drawBoundary(rect.x, rect.y, rect.width, rect.height, scale);
  }

  /** Outline the real sandbox space so its edges are visible against the page. */
  private drawBoundary(
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
  ): void {
    const lw = Math.max(1, Math.round(1.5 * scale));
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(110, 168, 254, 0.65)';
    ctx.shadowColor = 'rgba(110, 168, 254, 0.35)';
    ctx.shadowBlur = 6 * scale;
    // Inset by half the line width so the full stroke stays inside the rect.
    const o = lw / 2;
    ctx.strokeRect(x + o, y + o, w - lw, h - lw);
    ctx.restore();
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
}
