import type { Grid } from '../engine/Grid';

/**
 * Rendering seam. The Game depends only on this interface, so a WebGL renderer
 * can be dropped in later by swapping the constructor — no engine changes.
 */
export interface Renderer {
  /** Draw the current grid state. */
  render(grid: Grid): void;
  /** Resize the output surface (device pixels). */
  resize(width: number, height: number): void;
}
