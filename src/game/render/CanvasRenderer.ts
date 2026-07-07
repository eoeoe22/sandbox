import type { Renderer } from './Renderer';
import type { Grid } from '../engine/Grid';
import { getMaterial } from '../materials/registry';

/**
 * Canvas 2D renderer. Writes one packed Uint32 color per cell into an offscreen
 * ImageData at grid resolution, then scales it up to the visible canvas with
 * smoothing off (crisp pixels). Fast enough for a wide range of grid sizes and
 * swappable for a WebGL renderer via the Renderer interface.
 */
export class CanvasRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private buf32: Uint32Array;
  private palette: Uint32Array;

  constructor(
    private canvas: HTMLCanvasElement,
    grid: Grid,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.off = document.createElement('canvas');
    this.off.width = grid.width;
    this.off.height = grid.height;
    const offCtx = this.off.getContext('2d');
    if (!offCtx) throw new Error('Offscreen 2D context unavailable');
    this.offCtx = offCtx;

    this.image = this.offCtx.createImageData(grid.width, grid.height);
    this.buf32 = new Uint32Array(this.image.data.buffer);

    // Precompute id → color. Materials are registered before the renderer is
    // constructed, so this stays in sync for the milestone's fixed set.
    this.palette = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const m = getMaterial(i);
      this.palette[i] = m ? m.color : 0;
    }
  }

  render(grid: Grid): void {
    const cells = grid.cells;
    const buf = this.buf32;
    const pal = this.palette;
    for (let i = 0; i < cells.length; i++) {
      buf[i] = pal[cells[i]];
    }
    this.offCtx.putImageData(this.image, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
}
