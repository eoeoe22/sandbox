/**
 * Maps the fixed-aspect simulation grid onto an arbitrary display surface.
 *
 * The grid has a fixed aspect ratio (GRID_W:GRID_H, ~16:9), but the canvas
 * fills a viewport of any shape. Stretching the grid to fill the canvas makes
 * cells non-square — on a portrait phone each cell is far taller than wide, so
 * a circular brush renders as a vertical ellipse (height > width). Instead we
 * letterbox: fit the grid at a single uniform scale, centered, so cells stay
 * square and the brush reads as a true circle on every screen.
 */
export interface ViewRect {
  /** Left offset within the container (same units as the inputs). */
  x: number;
  /** Top offset within the container. */
  y: number;
  /** Rendered grid width. */
  width: number;
  /** Rendered grid height. */
  height: number;
}

/**
 * Largest rectangle with the grid's aspect ratio that fits inside the
 * container, centered (letterboxed). Works in any consistent unit — device
 * pixels for rendering, CSS pixels for hit-testing — because the scale is
 * uniform on both axes.
 */
export function fitGridRect(
  containerW: number,
  containerH: number,
  gridW: number,
  gridH: number,
): ViewRect {
  const scale = Math.min(containerW / gridW, containerH / gridH);
  const width = gridW * scale;
  const height = gridH * scale;
  return {
    x: (containerW - width) / 2,
    y: (containerH - height) / 2,
    width,
    height,
  };
}
