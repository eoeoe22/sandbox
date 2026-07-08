import { EMPTY } from './types';
import { AMBIENT_TEMP } from '../config';

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

  /**
   * Per-cell temperature for the heat-conduction system (see config.ts). Floats
   * because the diffusion pass exchanges fractional amounts of heat each tick.
   * Starts uniformly at `AMBIENT_TEMP`. `tempScratch` is the double-buffer the
   * diffusion pass computes the next state into before swapping (so every cell
   * updates from the same snapshot, order-independently).
   */
  temp: Float32Array;
  tempScratch: Float32Array;

  /**
   * Per-cell auxiliary state byte, interpreted privately by whichever material
   * occupies the cell (0 means "no state" / freshly placed). This is the
   * reserved `life`/state slot the comment here used to promise, generalized:
   * a conductor uses it as a spark-refractory countdown, a Battery as a pulse
   * cadence, Clone as the adopted material id, Thermite as a burn timer, and so
   * on. It travels with the cell on a swap and is cleared when the cell is
   * emptied — the same lifecycle as `temp`. Runtime-only: not persisted (like
   * `moved`), so all uses must be transient state that can safely reset to 0 on
   * reload. Materials that instead need real-valued state keep using `temp`
   * with `conductivity: 0` (Blast/Ember); `aux` is the cheap integer companion.
   */
  aux: Uint8Array;

  // Still reserved for a future per-cell velocity field (see ember.ts, which
  // currently packs velocity into `temp`).
  // vel: Int8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cells = new Uint8Array(this.size); // initialized to EMPTY (0)
    this.moved = new Uint8Array(this.size);
    this.temp = new Float32Array(this.size).fill(AMBIENT_TEMP);
    this.tempScratch = new Float32Array(this.size);
    this.aux = new Uint8Array(this.size);
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

  getTemp(x: number, y: number): number {
    return this.temp[y * this.width + x];
  }

  setTemp(x: number, y: number, t: number): void {
    this.temp[y * this.width + x] = t;
  }

  getAux(x: number, y: number): number {
    return this.aux[y * this.width + x];
  }

  setAux(x: number, y: number, v: number): void {
    this.aux[y * this.width + x] = v;
  }

  clear(): void {
    this.cells.fill(EMPTY);
    this.temp.fill(AMBIENT_TEMP);
    this.aux.fill(0);
  }

  /**
   * Resize the grid, preserving the overlapping cells from its own contents.
   * No-op if the dimensions are unchanged.
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.resizeFrom(width, height, this.cells, this.width, this.height, this.temp, this.aux);
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
    srcTemp?: Float32Array,
    srcAux?: Uint8Array,
  ): void {
    const next = new Uint8Array(width * height);
    // Temperature must follow the cells it belongs to — otherwise preserved
    // material would snap back to ambient on a resize (e.g. molten lava would
    // read as cold and instantly solidify). New area starts at ambient.
    const nextTemp = new Float32Array(width * height).fill(AMBIENT_TEMP);
    // Aux (per-cell material state) travels with its cells the same way. When no
    // source aux is supplied (a fresh world load, or a drag whose snapshot
    // predates aux) it starts zeroed — safe because every aux use is transient
    // state that self-heals (a Clone re-adopts, a conductor's refractory clears).
    const nextAux = new Uint8Array(width * height);
    const copyW = Math.min(width, srcW);
    const copyRows = Math.min(height, srcH);
    for (let r = 0; r < copyRows; r++) {
      const srcY = srcH - 1 - r;
      const newY = height - 1 - r;
      const src = srcY * srcW;
      next.set(srcCells.subarray(src, src + copyW), newY * width);
      if (srcTemp) nextTemp.set(srcTemp.subarray(src, src + copyW), newY * width);
      if (srcAux) nextAux.set(srcAux.subarray(src, src + copyW), newY * width);
    }

    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cells = next;
    this.moved = new Uint8Array(this.size);
    this.temp = nextTemp;
    this.tempScratch = new Float32Array(this.size);
    this.aux = nextAux;
  }
}
