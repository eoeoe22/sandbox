import type { Renderer } from './Renderer';
import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import { getMaterial } from '../materials/registry';
import { EMPTY, type BorderMode } from '../engine/types';
import { varyAmplitude, varyMode, VARY_PARTICLE, TINT_NEUTRAL } from '../tint';
import type { ViewRect } from './viewport';

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
/** Heat-overlay ramp bounds and resolution. Cells at/below HEAT_MIN read fully
 *  cold, at/above HEAT_MAX fully white-hot; everything between is interpolated
 *  through HEAT_STOPS into a HEAT_LUT_SIZE-entry lookup table. */
const HEAT_MIN = -50;
const HEAT_MAX = 1500;
const HEAT_LUT_SIZE = 256;
/** Thermal-camera colour stops: [temperature°, r, g, b], cold → hot. */
const HEAT_STOPS: readonly [number, number, number, number][] = [
  [-50, 20, 40, 130],
  [20, 30, 64, 96],
  [120, 70, 44, 96],
  [320, 150, 40, 44],
  [620, 232, 72, 24],
  [1000, 255, 168, 36],
  [1500, 255, 244, 210],
];

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
  /** id → 1 if the cell is drawn as the material named by its `aux` byte instead
   *  of its own color (Debris renders as the material it carries). */
  private renderAsAux: Uint8Array;
  /** id → freezing point; a cell of a `freeze` material at/below this temperature
   *  is drawn frosted (see Material.freeze). -Infinity for materials that never
   *  freeze, so the per-cell `temp <= freezeTemp` test never matches them. */
  private freezeTemp: Float32Array;
  /** id → precomputed frosted colour used when a freeze material is frozen. */
  private frost: Uint32Array;
  /** id → 1 if the material draws a positional lattice checkerboard (Mesh). */
  private hasLattice: Uint8Array;
  /** id → the packed lattice colour woven through the base (valid where hasLattice). */
  private lattice: Uint32Array;
  /** id → 1 if the material draws a directional chevron from its aux byte
   *  (Conveyor), in the `lattice` colour over the base (see Material.arrow). */
  private arrow: Uint8Array;
  /** Current edge mode — only affects how the boundary outline is drawn. */
  private borderMode: BorderMode = 'wall';
  /** When true, occupied cells are drawn by temperature (thermal camera) instead
   *  of their material colour (see setHeatOverlay / HEAT_LUT). */
  private heatOverlay = false;
  /** Reference-grid line spacing in cells; 0 = no overlay (see setGridDivision). */
  private gridDivision = 0;
  /** Packed temperature→colour lookup for the heat overlay, spanning
   *  [HEAT_MIN, HEAT_MAX]° in HEAT_LUT_SIZE steps (built once in the ctor). */
  private heatLut: Uint32Array;

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
    this.heatLut = CanvasRenderer.buildHeatLut();

    // Precompute id → color. Materials are registered before the renderer is
    // constructed, so this stays in sync for the milestone's fixed set.
    this.palette = new Uint32Array(256);
    this.glow = new Array(256).fill(null);
    this.vary = new Uint8Array(256);
    this.varyMode = new Uint8Array(256);
    this.renderAsAux = new Uint8Array(256);
    this.freezeTemp = new Float32Array(256).fill(-Infinity);
    this.frost = new Uint32Array(256);
    this.hasLattice = new Uint8Array(256);
    this.lattice = new Uint32Array(256);
    this.arrow = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const m = getMaterial(i);
      this.palette[i] = m ? m.color : 0;
      if (m?.glow) this.glow[i] = CanvasRenderer.buildGlow(m.glow, m.color);
      if (m) {
        this.vary[i] = varyAmplitude(m);
        this.varyMode[i] = varyMode(m);
        if (m.renderAsAux) this.renderAsAux[i] = 1;
        if (m.lattice !== undefined) {
          this.hasLattice[i] = 1;
          this.lattice[i] = m.lattice;
        }
        if (m.arrow) this.arrow[i] = 1;
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

  /** Blend a cell's rendered color toward its 겹침 overlap fluid's base color
   *  (5/8 host, 3/8 fluid), so wet sand and a screen with water or steam passing
   *  through read as such at a glance while the host's own look (lattice weave,
   *  grain) still shows through. */
  private static wetted(host: number, fluid: number): number {
    const r = (((host & 0xff) * 5 + (fluid & 0xff) * 3) >> 3) & 0xff;
    const g = ((((host >> 8) & 0xff) * 5 + ((fluid >> 8) & 0xff) * 3) >> 3) & 0xff;
    const b = ((((host >> 16) & 0xff) * 5 + ((fluid >> 16) & 0xff) * 3) >> 3) & 0xff;
    return ((host & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
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

  /** Build the temperature→colour lookup for the heat overlay by linearly
   *  interpolating HEAT_STOPS across HEAT_LUT_SIZE entries spanning
   *  [HEAT_MIN, HEAT_MAX]. Packed 0xAABBGGRR, fully opaque. */
  private static buildHeatLut(): Uint32Array {
    const lut = new Uint32Array(HEAT_LUT_SIZE);
    for (let i = 0; i < HEAT_LUT_SIZE; i++) {
      const t = HEAT_MIN + (i / (HEAT_LUT_SIZE - 1)) * (HEAT_MAX - HEAT_MIN);
      // Find the bracketing stop pair.
      let s = 0;
      while (s < HEAT_STOPS.length - 2 && t > HEAT_STOPS[s + 1][0]) s++;
      const [t0, r0, g0, b0] = HEAT_STOPS[s];
      const [t1, r1, g1, b1] = HEAT_STOPS[s + 1];
      const f = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      const r = (r0 + (r1 - r0) * f) & 0xff;
      const g = (g0 + (g1 - g0) * f) & 0xff;
      const b = (b0 + (b1 - b0) * f) & 0xff;
      lut[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    }
    return lut;
  }

  /** Map a temperature to its packed heat-overlay colour via the LUT. */
  private heatColor(t: number): number {
    let idx = ((t - HEAT_MIN) / (HEAT_MAX - HEAT_MIN)) * (HEAT_LUT_SIZE - 1);
    if (idx < 0) idx = 0;
    else if (idx > HEAT_LUT_SIZE - 1) idx = HEAT_LUT_SIZE - 1;
    return this.heatLut[idx | 0];
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
    const auxArr = grid.aux;
    const buf = this.buf32;
    const pal = this.palette;
    const glow = this.glow;
    const vary = this.vary;
    const mode = this.varyMode;
    const asAux = this.renderAsAux;
    const freezeTemp = this.freezeTemp;
    const frost = this.frost;
    const hasLat = this.hasLattice;
    const latCol = this.lattice;
    const arrow = this.arrow;
    const ovArr = grid.overlay;
    const w = grid.width;
    const heat = this.heatOverlay;
    for (let i = 0; i < cells.length; i++) {
      // Heat overlay: recolor occupied cells by temperature (a live thermal
      // camera); empty cells keep the ambient background so shapes read against
      // it. Bypasses all the material-color machinery below.
      if (heat) {
        buf[i] = cells[i] === EMPTY ? pal[EMPTY] : this.heatColor(temp[i]);
        continue;
      }
      let id = cells[i];
      // A carrier cell (Debris) draws as the material named in its aux byte, so a
      // flung grain wears its own material's color instead of the carrier's.
      if (asAux[id]) {
        const carried = auxArr[i];
        if (carried !== 0) id = carried;
      }
      let c: number;
      // A directional-arrow material (Conveyor) draws a chevron pointing the way
      // its aux byte says it runs, so the belt's travel direction is visible. The
      // chevron is a period-4 tent: over four rows the lit column steps 0,1,1,0
      // (a '>' whose tip is the middle rows) — mirrored for a left-running belt.
      if (arrow[id]) {
        const x = i % w;
        const y = (i / w) | 0;
        const fold = y & 2 ? 3 - (y & 3) : y & 3; // y%4 → 0,1,1,0
        const phase = x & 3; // x % 4
        const on = auxArr[i] === 2 ? phase === 3 - fold : phase === fold;
        c = on ? latCol[id] : pal[id];
      } else if (hasLat[id]) {
        // A lattice material (Mesh) is a two-tone positional checkerboard, so a
        // screen reads as a woven grid rather than a flat slab. Computed from the
        // cell's x/y so the weave is tied to space, not to the particle.
        const x = i % w;
        const y = (i / w) | 0;
        c = (x ^ y) & 1 ? latCol[id] : pal[id];
      } else if (glow[id]) {
        c = CanvasRenderer.shade(glow[id]!, temp[i]);
      } else if (temp[i] <= freezeTemp[id]) {
        // A frozen liquid (see Material.freeze) is drawn frosted. freezeTemp is
        // -Infinity for non-freeze materials, so this never fires for them.
        c = frost[id];
      } else {
        const amp = vary[id];
        if (amp === 0) {
          c = pal[id];
        } else {
          // Powders read their own fixed per-grain tint; liquids sample the
          // positional background field at this cell (see game/tint.ts).
          const src = mode[id] === VARY_PARTICLE ? tintArr[i] : bgArr[i];
          // Map the tint byte to a signed brightness offset in [-amp, +amp]:
          // (tint - 128) / 128 * amp, done in integer math (>> 7 divides by 128).
          const d = ((src - TINT_NEUTRAL) * amp) >> 7;
          c = CanvasRenderer.tinted(pal[id], d);
        }
      }
      // 겹침 (overlap): a cell sharing space with a fluid — wet sand, water or
      // steam mid-passage through a Mesh/Turbine — is tinted toward the fluid's
      // color, so a soaked bed reads visibly wetter than a dry one.
      const ov = ovArr[i];
      buf[i] = ov !== 0 ? CanvasRenderer.wetted(c, pal[ov]) : c;
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
    if (this.gridDivision > 0) {
      this.drawGrid(rect.x, rect.y, rect.width, rect.height, grid.width, grid.height, scale);
    }
    // Free objects (the 독립 오브젝트 layer) are drawn as a vector overlay on top
    // of the scaled grid image — an independent pass that never touches the cell
    // buffer (grid.cells / buf32). Drawn before the boundary so the frame stays
    // on top.
    this.drawObjects(grid, rect);
    this.drawBoundary(rect.x, rect.y, rect.width, rect.height, scale);
  }

  /**
   * Draw the free rigid objects (see Grid.objects / engine/objects.ts) as filled
   * circles over the sandbox rectangle. Grid coordinates map to device pixels
   * through the same rect the grid image was drawn into, so an object sits
   * exactly where its cell-space center says. This milestone renders every
   * object as a glossy rubber ball (the only object type); the physics shape is
   * a circle, so a plain `ctx.arc` is the whole of it — no sprite, no rotation.
   */
  private drawObjects(grid: Grid, rect: ViewRect): void {
    const objs = grid.objects;
    if (objs.length === 0) return;
    // Uniform cell→device scale (rect preserves the grid aspect, so x and y
    // scales are equal); use it for both the center and the radius.
    const s = rect.width / grid.width;
    const ctx = this.ctx;
    ctx.save();
    for (const o of objs) {
      const cx = rect.x + o.x * s;
      const cy = rect.y + o.y * s;
      const r = Math.max(1, o.r * s);
      // Body.
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#d84652'; // rubber red
      ctx.fill();
      // Rim, so the ball reads against a same-colored background.
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.strokeStyle = 'rgba(90, 20, 26, 0.9)';
      ctx.stroke();
      // Specular highlight (upper-left) for a glossy look.
      ctx.beginPath();
      ctx.arc(cx - r * 0.32, cy - r * 0.32, Math.max(0.5, r * 0.28), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fill();
    }
    ctx.restore();
  }

  /** Draw a faint reference grid every `gridDivision` cells over the sandbox
   *  rectangle. Line positions are snapped to whole cell boundaries and skip the
   *  outer edges (the boundary outline already draws those). */
  private drawGrid(
    x: number,
    y: number,
    w: number,
    h: number,
    cols: number,
    rows: number,
    scale: number,
  ): void {
    const step = this.gridDivision;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(150, 160, 180, 0.16)';
    ctx.lineWidth = Math.max(1, Math.round(scale));
    ctx.beginPath();
    // Vertical lines at every `step`-th column boundary (interior only).
    for (let c = step; c < cols; c += step) {
      // Round to the device pixel so the thin line stays crisp.
      const px = Math.round(x + (c / cols) * w) + 0.5;
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + h);
    }
    // Horizontal lines at every `step`-th row boundary (interior only).
    for (let r = step; r < rows; r += step) {
      const py = Math.round(y + (r / rows) * h) + 0.5;
      ctx.moveTo(x, py);
      ctx.lineTo(x + w, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Pick which edge mode to signal in the boundary outline. */
  setBorderMode(mode: BorderMode): void {
    this.borderMode = mode;
  }

  /** Toggle the temperature heat-map overlay (occupied cells drawn by temp). */
  setHeatOverlay(on: boolean): void {
    this.heatOverlay = on;
  }

  /** Set the reference-grid line spacing in cells (0 = off). */
  setGridDivision(cells: number): void {
    this.gridDivision = cells;
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
