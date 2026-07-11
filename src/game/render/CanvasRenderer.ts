import type { Renderer } from './Renderer';
import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import { getMaterial } from '../materials/registry';
import type { BorderMode } from '../engine/types';
import { varyAmplitude, varyMode, VARY_PARTICLE, TINT_NEUTRAL } from '../tint';

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
/** Precomputed temperature→color ramp for a glowing material (see Material.glow). */
interface GlowRamp {
  min: number;
  invRange: number;
  // cool-end channels and the per-channel delta up to the hot (base) color.
  cr: number;
  cg: number;
  cb: number;
  dr: number;
  dg: number;
  db: number;
}

export class CanvasRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private image!: ImageData;
  private buf32!: Uint32Array;
  private palette: Uint32Array;
  /** id → temperature ramp, or null for materials drawn with a flat color. */
  private glow: (GlowRamp | null)[];
  /** id → brightness spread (0 = flat, no tint). See game/tint.ts. */
  private vary: Uint8Array;
  /** id → which tint field to sample (VARY_PARTICLE = per-grain, else background). */
  private varyMode: Uint8Array;
  /** id → freezing point; a cell of a `freeze` material at/below this temperature
   *  is drawn frosted (see Material.freeze). -Infinity for materials that never
   *  freeze, so the per-cell `temp <= freezeTemp` test never matches them. */
  private freezeTemp: Float32Array;
  /** id → precomputed frosted colour used when a freeze material is frozen. */
  private frost: Uint32Array;
  /** Current edge mode — only affects how the boundary outline is drawn. */
  private borderMode: BorderMode = 'wall';

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
    this.glow = new Array(256).fill(null);
    this.vary = new Uint8Array(256);
    this.varyMode = new Uint8Array(256);
    this.freezeTemp = new Float32Array(256).fill(-Infinity);
    this.frost = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const m = getMaterial(i);
      this.palette[i] = m ? m.color : 0;
      if (m?.glow) this.glow[i] = CanvasRenderer.buildGlow(m.glow, m.color);
      if (m) {
        this.vary[i] = varyAmplitude(m);
        this.varyMode[i] = varyMode(m);
        if (m.freeze) {
          this.freezeTemp[i] = m.freeze.temp;
          this.frost[i] = CanvasRenderer.frosted(m.color);
        }
      }
    }
  }

  /** Blend a packed colour toward an icy white-blue, for rendering a frozen
   *  liquid (see Material.freeze) as a frosted block distinct from its liquid
   *  self. Keeps a little of the base hue so frozen oil still reads dark-frosty
   *  and frozen mercury pale-frosty. */
  private static frosted(base: number): number {
    const fr = 210;
    const fg = 232;
    const fb = 248;
    const mix = (c: number, f: number): number => ((c * 45 + f * 55) / 100) | 0;
    const r = mix(base & 0xff, fr);
    const g = mix((base >> 8) & 0xff, fg);
    const b = mix((base >> 16) & 0xff, fb);
    return ((base & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
  }

  /** Shift a packed 0xAABBGGRR color's brightness by `d` (per channel, clamped),
   *  preserving alpha. Used to render each particle's individual tint. */
  private static tinted(base: number, d: number): number {
    let r = (base & 0xff) + d;
    let g = ((base >> 8) & 0xff) + d;
    let b = ((base >> 16) & 0xff) + d;
    if (r < 0) r = 0;
    else if (r > 255) r = 255;
    if (g < 0) g = 0;
    else if (g > 255) g = 255;
    if (b < 0) b = 0;
    else if (b > 255) b = 255;
    return ((base & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
  }

  /** Split the cool and base (hot) colors into channels so the render loop can
   *  lerp between them per cell without unpacking on every pixel. */
  private static buildGlow(
    glow: { min: number; max: number; cool: number },
    hot: number,
  ): GlowRamp {
    return {
      min: glow.min,
      invRange: 1 / Math.max(1, glow.max - glow.min),
      cr: glow.cool & 0xff,
      cg: (glow.cool >> 8) & 0xff,
      cb: (glow.cool >> 16) & 0xff,
      dr: (hot & 0xff) - (glow.cool & 0xff),
      dg: ((hot >> 8) & 0xff) - ((glow.cool >> 8) & 0xff),
      db: ((hot >> 16) & 0xff) - ((glow.cool >> 16) & 0xff),
    };
  }

  /** Interpolate a glow ramp at temperature `t` into a packed 0xAABBGGRR color. */
  private static shade(g: GlowRamp, t: number): number {
    let f = (t - g.min) * g.invRange;
    if (f < 0) f = 0;
    else if (f > 1) f = 1;
    const r = (g.cr + g.dr * f) & 0xff;
    const gr = (g.cg + g.dg * f) & 0xff;
    const b = (g.cb + g.db * f) & 0xff;
    return (0xff000000 | (b << 16) | (gr << 8) | r) >>> 0;
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
    const temp = grid.temp;
    const tintArr = grid.tint;
    const bgArr = grid.bgTint;
    const buf = this.buf32;
    const pal = this.palette;
    const glow = this.glow;
    const vary = this.vary;
    const mode = this.varyMode;
    const freezeTemp = this.freezeTemp;
    const frost = this.frost;
    for (let i = 0; i < cells.length; i++) {
      const id = cells[i];
      const g = glow[id];
      if (g) {
        buf[i] = CanvasRenderer.shade(g, temp[i]);
        continue;
      }
      // A frozen liquid (see Material.freeze) is drawn frosted. freezeTemp is
      // -Infinity for non-freeze materials, so this never fires for them.
      if (temp[i] <= freezeTemp[id]) {
        buf[i] = frost[id];
        continue;
      }
      const amp = vary[id];
      if (amp === 0) {
        buf[i] = pal[id];
        continue;
      }
      // Powders read their own fixed per-grain tint; liquids sample the
      // positional background field at this cell (see game/tint.ts).
      const src = mode[id] === VARY_PARTICLE ? tintArr[i] : bgArr[i];
      // Map the tint byte to a signed brightness offset in [-amp, +amp]:
      // (tint - 128) / 128 * amp, done in integer math (>> 7 divides by 128).
      const d = ((src - TINT_NEUTRAL) * amp) >> 7;
      buf[i] = CanvasRenderer.tinted(pal[id], d);
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

  /** Pick which edge mode to signal in the boundary outline. */
  setBorderMode(mode: BorderMode): void {
    this.borderMode = mode;
  }

  /** Outline the real sandbox space so its edges are visible against the page.
   *  A solid glowing frame reads as a closed wall; in 'void' mode the frame is
   *  drawn dimmer and dashed to signal that the edges are open. */
  private drawBoundary(
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
  ): void {
    const lw = Math.max(1, Math.round(1.5 * scale));
    const ctx = this.ctx;
    const isVoid = this.borderMode === 'void';
    ctx.save();
    ctx.lineWidth = lw;
    if (isVoid) {
      // Open edges: a faint dashed outline, no glow — the box is "not there".
      ctx.strokeStyle = 'rgba(150, 160, 180, 0.45)';
      ctx.setLineDash([6 * scale, 5 * scale]);
    } else {
      ctx.strokeStyle = 'rgba(110, 168, 254, 0.65)';
      ctx.shadowColor = 'rgba(110, 168, 254, 0.35)';
      ctx.shadowBlur = 6 * scale;
    }
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
