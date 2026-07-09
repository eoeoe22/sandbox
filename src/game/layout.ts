import { CELL_PX, MAX_CELLS, MIN_GRID_SIDE } from './config';
import { centeredRect, type ViewRect } from './render/viewport';

/** How the sandbox size is chosen. */
export type AspectMode = 'device' | 'custom';

interface GridDims {
  /** Grid width in cells. */
  gw: number;
  /** Grid height in cells. */
  gh: number;
  /** Effective CSS pixels per cell (>= CELL_PX; grows when capped by MAX_CELLS). */
  cell: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Derive the grid resolution for a sandbox of the given CSS-pixel size. Cell
 * size is fixed (CELL_PX) so a bigger sandbox holds more cells — until the cell
 * count would exceed MAX_CELLS, at which point the cell size is scaled up
 * uniformly (preserving aspect) to keep the simulation within its frame budget.
 */
function deriveGrid(cssW: number, cssH: number): GridDims {
  let cell = CELL_PX;
  let gw = Math.floor(cssW / cell);
  let gh = Math.floor(cssH / cell);
  const total = gw * gh;
  if (total > MAX_CELLS) {
    cell = CELL_PX * Math.sqrt(total / MAX_CELLS);
    gw = Math.floor(cssW / cell);
    gh = Math.floor(cssH / cell);
  }
  gw = Math.max(MIN_GRID_SIDE, gw);
  gh = Math.max(MIN_GRID_SIDE, gh);
  // Safety: keep the cell budget even at an extreme aspect where the MIN clamp
  // just raised one side (e.g. a wide, one-cell-tall sliver). Cap the long side
  // so the product never exceeds MAX_CELLS.
  if (gw * gh > MAX_CELLS) {
    if (gw >= gh) gw = Math.max(MIN_GRID_SIDE, Math.floor(MAX_CELLS / gh));
    else gh = Math.max(MIN_GRID_SIDE, Math.floor(MAX_CELLS / gw));
  }
  return { gw, gh, cell };
}

/**
 * Owns the sandbox's size and its mapping onto the screen. The grid resolution
 * follows the sandbox rectangle at a fixed cell size (dynamic aspect ratio).
 *
 * - `device` mode: the sandbox fills the viewport, tracking it on resize — the
 *   default, so the play area matches the device out of the box.
 * - `custom` mode: the user dragged the resize handle to a specific size; it is
 *   clamped to the viewport on resize but otherwise left alone.
 *
 * Independent of size, the sandbox can also be dragged around within the
 * viewport (see moveBy/offsetX/offsetY) — the offset is clamped so the
 * sandbox always stays fully on-screen, and resets whenever the layout resets
 * to the device default.
 *
 * Both the renderer (to place and outline the grid) and the pointer painter (to
 * hit-test taps) read the rect from here, so they can never disagree.
 */
export class SandboxLayout {
  private viewW = 0;
  private viewH = 0;
  mode: AspectMode = 'device';
  /**
   * The user's intended sandbox size in CSS px (equals the viewport in device
   * mode). This is the *intent*, kept unclamped, so the effective size is
   * `min(want, viewport)`: a viewport that shrinks and grows back restores the
   * custom size instead of stranding it at the shrunken value.
   */
  private wantW = 0;
  private wantH = 0;

  /** Derived grid resolution. */
  gw = 0;
  gh = 0;
  /** Effective CSS px per cell (see deriveGrid). */
  cell = CELL_PX;

  /**
   * User-dragged offset from the centered position, in CSS px. Lets the
   * sandbox be moved around within the viewport (not just resized) while
   * always staying fully on-screen — see clampOffset.
   */
  private offsetX = 0;
  private offsetY = 0;

  /**
   * CSS px reserved at the bottom of the viewport for a docked control bar
   * (narrow/mobile layout). The sandbox is sized and centered within the space
   * *above* this inset, so the bar acts as a solid screen edge the sandbox
   * never overlaps. Zero on the wide layout, where the panel floats over the
   * canvas instead.
   */
  private insetBottom = 0;

  /** Effective viewport height available to the sandbox (minus the bottom bar). */
  private availH(): number {
    return Math.max(MIN_GRID_SIDE, this.viewH - this.insetBottom);
  }

  /** Reserve `bottom` CSS px at the foot of the viewport; recomputes the grid. */
  setInsets(bottom: number): void {
    const next = Math.max(0, bottom);
    if (next === this.insetBottom) return;
    this.insetBottom = next;
    this.recompute();
  }

  /** Update the viewport size (CSS px); recomputes the grid. */
  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    if (this.mode === 'device') {
      this.wantW = w;
      this.wantH = h;
    }
    // Custom intent is left untouched; recompute clamps it to the new viewport.
    this.recompute();
  }

  /** Move the sandbox by (dx, dy) CSS px, clamped so it stays fully on-screen. */
  moveBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.clampOffset();
  }

  /** Set an explicit sandbox size from the resize handle (switches to custom). */
  setSize(w: number, h: number): void {
    this.mode = 'custom';
    this.wantW = Math.max(MIN_GRID_SIDE, w);
    this.wantH = Math.max(MIN_GRID_SIDE, h);
    this.recompute();
  }

  /**
   * The current size intent — mode plus the unclamped wanted CSS size — in the
   * exact shape `setSize` accepts, so persistence can round-trip a custom
   * sandbox size across sessions.
   */
  sizeIntent(): { mode: AspectMode; w: number; h: number } {
    return { mode: this.mode, w: this.wantW, h: this.wantH };
  }

  /** Snap back to filling the viewport, centered. */
  reset(): void {
    this.mode = 'device';
    this.wantW = this.viewW;
    this.wantH = this.viewH;
    this.offsetX = 0;
    this.offsetY = 0;
    this.recompute();
  }

  private recompute(): void {
    // Effective size never exceeds the *available* viewport (height minus the
    // reserved bottom bar), but the intent (wantW/H) does.
    const effW = clamp(this.wantW, MIN_GRID_SIDE, this.viewW);
    const effH = clamp(this.wantH, MIN_GRID_SIDE, this.availH());
    const { gw, gh, cell } = deriveGrid(effW, effH);
    this.gw = gw;
    this.gh = gh;
    this.cell = cell;
    this.clampOffset();
  }

  /** Keep the offset within the room left by the viewport around the centered
   *  rect, so a drag (or a shrinking viewport/window resize) can never push
   *  the sandbox partly off-screen. */
  private clampOffset(): void {
    const maxX = Math.max(0, (this.viewW - this.rectW()) / 2);
    const maxY = Math.max(0, (this.availH() - this.rectH()) / 2);
    this.offsetX = clamp(this.offsetX, -maxX, maxX);
    this.offsetY = clamp(this.offsetY, -maxY, maxY);
  }

  /** Rendered sandbox size in CSS px (grid snapped to whole cells). */
  private rectW(): number {
    return this.gw * this.cell;
  }
  private rectH(): number {
    return this.gh * this.cell;
  }

  /** Sandbox rectangle in CSS px: centered in the viewport, then shifted by
   *  the user-dragged offset (see moveBy). */
  cssRect(): ViewRect {
    // Centre within the space above the bottom inset, so the sandbox sits fully
    // clear of a docked control bar (y stays in [0, availH]).
    const r = centeredRect(this.viewW, this.availH(), this.rectW(), this.rectH());
    return { ...r, x: r.x + this.offsetX, y: r.y + this.offsetY };
  }

  /** Sandbox rectangle in device px, given the CSS→device scale. */
  deviceRect(scale: number): ViewRect {
    const r = this.cssRect();
    return {
      x: r.x * scale,
      y: r.y * scale,
      width: r.width * scale,
      height: r.height * scale,
    };
  }
}
