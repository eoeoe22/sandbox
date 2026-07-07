import { EMPTY } from './types';

/**
 * The simulation grid. State is held in flat TypedArrays indexed by
 * `y * width + x` — cache-friendly and cheap to iterate, and ready to be moved
 * into a Web Worker (transfer the ArrayBuffer) or a WASM core later.
 *
 * The grid can be resized at runtime (dynamic sandbox aspect ratio). Resizing
 * reallocates the backing arrays and copies the overlapping region, anchored to
 * the bottom-left, so settled material keeps sitting on the floor.
 */
export class Grid {
  width: number;
  height: number;
  size: number;

  /** Material id per cell. */
  cells: Uint8Array;
  /** Per-tick "already moved" guard so a cell isn't processed twice in one step. */
  moved: Uint8Array;

  // Reserved for future material properties (temperature, life, velocity, ...).
  // Declared here to document the extension point; not allocated until used.
  // temp: Uint8Array;
  // life: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cells = new Uint8Array(this.size); // initialized to EMPTY (0)
    this.moved = new Uint8Array(this.size);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  get(x: number, y: number): number {
    return this.cells[y * this.width + x];
  }

  set(x: number, y: number, id: number): void {
    this.cells[y * this.width + x] = id;
  }

  clear(): void {
    this.cells.fill(EMPTY);
  }

  /**
   * Resize the grid, preserving the overlapping cells from its own contents.
   * No-op if the dimensions are unchanged.
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.resizeFrom(width, height, this.cells, this.width, this.height);
  }

  /**
   * Resize to `width×height`, filling from an arbitrary source grid instead of
   * the current cells. The kept region is anchored to the bottom-left: columns
   * from the left, rows from the bottom, so a pile that had settled on the floor
   * stays on the floor. New area (extra height above, extra width to the right)
   * starts Empty.
   *
   * Sourcing from a snapshot lets an interactive drag be non-destructive: every
   * intermediate size is rebuilt from the pre-drag grid, so overshooting inward
   * and back out restores content instead of nibbling it away.
   */
  resizeFrom(
    width: number,
    height: number,
    srcCells: Uint8Array,
    srcW: number,
    srcH: number,
  ): void {
    const next = new Uint8Array(width * height);
    const copyW = Math.min(width, srcW);
    const copyRows = Math.min(height, srcH);
    for (let r = 0; r < copyRows; r++) {
      const srcY = srcH - 1 - r;
      const newY = height - 1 - r;
      const src = srcY * srcW;
      next.set(srcCells.subarray(src, src + copyW), newY * width);
    }

    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cells = next;
    this.moved = new Uint8Array(this.size);
  }
}
