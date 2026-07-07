import { EMPTY } from './types';

/**
 * The simulation grid. State is held in flat TypedArrays indexed by
 * `y * width + x` — cache-friendly and cheap to iterate, and ready to be moved
 * into a Web Worker (transfer the ArrayBuffer) or a WASM core later.
 */
export class Grid {
  readonly width: number;
  readonly height: number;
  readonly size: number;

  /** Material id per cell. */
  readonly cells: Uint8Array;
  /** Per-tick "already moved" guard so a cell isn't processed twice in one step. */
  readonly moved: Uint8Array;

  // Reserved for future material properties (temperature, life, velocity, ...).
  // Declared here to document the extension point; not allocated until used.
  // readonly temp: Uint8Array;
  // readonly life: Uint8Array;

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
}
