import { CELL_PX, MAX_CELLS, MIN_GRID_SIDE } from './config';
import { centeredRect, type ViewRect } from './render/viewport';

interface GridDims {
  /** Grid width in cells. */
  gw: number;
  /** Grid height in cells. */
  gh: number;
  /** Effective CSS pixels per cell (>= CELL_PX; grows when capped by MAX_CELLS). */
  cell: number;
}

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
 * Owns the sandbox's size and its mapping onto the screen. The sandbox always
 * fills its on-screen frame (the game canvas) at a fixed cell size, so the grid
 * resolution tracks the canvas — which the CSS layout sizes to the play area
 * left over beside the control bar (a left sidebar on desktop, a bottom bar on
 * mobile). The sandbox is centered in that frame; there is no user-driven
 * resize or move any more (the responsive layout owns the geometry).
 *
 * Both the renderer (to place and outline the grid) and the pointer painter (to
 * hit-test taps) read the rect from here, so they can never disagree.
 */
export class SandboxLayout {
  private viewW = 0;
  private viewH = 0;

  /** Derived grid resolution. */
  gw = 0;
  gh = 0;
  /** Effective CSS px per cell (see deriveGrid). */
  cell = CELL_PX;

  /** Update the viewport (canvas) size in CSS px; recomputes the grid. */
  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    const { gw, gh, cell } = deriveGrid(
      Math.max(MIN_GRID_SIDE, w),
      Math.max(MIN_GRID_SIDE, h),
    );
    this.gw = gw;
    this.gh = gh;
    this.cell = cell;
  }

  /** Rendered sandbox size in CSS px (grid snapped to whole cells). */
  private rectW(): number {
    return this.gw * this.cell;
  }
  private rectH(): number {
    return this.gh * this.cell;
  }

  /** Sandbox rectangle in CSS px: centered in the canvas frame. */
  cssRect(): ViewRect {
    return centeredRect(this.viewW, this.viewH, this.rectW(), this.rectH());
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
