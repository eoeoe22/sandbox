// Active-tile tracking for the CA scan (docs/WASM-ENGINE-PORTING.md §3 "값싼
// 순수-JS 승리", docs/PERFORMANCE.md). Phase 0 measured the material scan at 80%+
// of a populated tick, most of it wasted walking empty air — `updateCell` does
// literally nothing for an empty, un-overlapped cell. This splits the grid into
// coarse tiles and lets the scan skip tiles that hold only such inert cells.
//
// ## Why this is bit-identical
//
// A cell is "active" iff `cells[i] != EMPTY || overlay[i] != 0`; only active
// cells do any work in Simulation.updateCell. A tile with no active cell is
// therefore provably inert, and skipping it changes nothing. The scan still
// visits every active cell in the exact same order — so with the flag on the
// simulation is bit-for-bit the same as the full scan (asserted by
// wasm/test/active-tiles.mjs... i.e. test/dirtyTiles equivalence harness).
//
// ## The forgiving invariant
//
// The one thing that must never happen is an active cell sitting in a tile the
// scan skipped. We uphold that with a deliberately over-eager rule: *every* grid
// write marks its tile awake (`Grid.set`/`setOverlay` and the direct-buffer
// writers in SimContext). Over-marking a tile that turns out empty only wastes a
// little scan work — the lazy re-arm below reaps it. Under-marking would be a
// bug, so "mark on every write" is the safe default, and marks are a superset of
// real activations.
//
// ## Double-buffer + re-arm
//
// Two tile bitsets swap roles each tick: `scanSet` is what this tick scans,
// `awake` accumulates what next tick must scan. During the scan a tile is
// re-armed into `awake` if it still contains any active cell (so a settled sand
// pile keeps being scanned — this is the conservative "occupied stays awake"
// policy; sleeping *occupied-but-static* tiles is a separate, non-bit-identical
// follow-up). Writes during the tick also land in `awake`, so a cell that moved
// into a previously-empty tile wakes it for next tick.
//
// ## Multiplayer note
//
// The set of tiles marked in a tick is exactly the "what changed" dirty-rect
// set. A future Durable-Objects lockstep sync can reuse it as the per-tick delta
// region (short sync), and this layer adds no nondeterminism — no RNG, no
// iteration-order dependence — so it won't obstruct deterministic replay.

/** Tile edge in cells; power of two so cell→tile is a shift. 16 → a 360×203 grid
 *  is 23×13 = 299 tiles, fine-grained enough to skip empty air cheaply. */
export const TILE_BITS = 4;
export const TILE = 1 << TILE_BITS;

export class DirtyTiles {
  readonly tilesX: number;
  readonly tilesY: number;
  private readonly count: number;
  /** Tiles to scan this tick. */
  private scanSet: Uint8Array;
  /** Accumulator: tiles to scan next tick (marks + re-arms land here). */
  private awake: Uint8Array;
  /** Master switch; when false every method is inert (full-scan path). */
  enabled = false;

  constructor(width: number, height: number) {
    this.tilesX = (width + TILE - 1) >> TILE_BITS;
    this.tilesY = (height + TILE - 1) >> TILE_BITS;
    this.count = this.tilesX * this.tilesY;
    this.scanSet = new Uint8Array(this.count);
    this.awake = new Uint8Array(this.count);
  }

  /** Tile index for a cell. Callers guarantee (x,y) is in bounds. */
  tileOf(x: number, y: number): number {
    return (y >> TILE_BITS) * this.tilesX + (x >> TILE_BITS);
  }

  /** Mark the tile containing (x,y) awake for next tick. Called from every grid
   *  write. No-op when disabled (production full-scan path pays one branch). */
  mark(x: number, y: number): void {
    if (this.enabled) this.awake[(y >> TILE_BITS) * this.tilesX + (x >> TILE_BITS)] = 1;
  }

  /** Directly arm a tile by index (used by the scan's re-arm and rebuild). */
  arm(ti: number): void {
    this.awake[ti] = 1;
  }

  /** True if tile `ti` must be scanned this tick. */
  shouldScan(ti: number): boolean {
    return this.scanSet[ti] === 1;
  }

  /** Roll to the next tick: last tick's accumulator becomes this tick's scan
   *  set, and a fresh (empty) accumulator collects this tick's marks/re-arms. */
  beginTick(): void {
    const t = this.scanSet;
    this.scanSet = this.awake;
    this.awake = t;
    this.awake.fill(0);
  }

  /** Rebuild the awake set from scratch by scanning occupancy — used after a
   *  load/resize/clear, where marks weren't tracked incrementally. Every tile
   *  holding an active cell is armed so the next beginTick scans it. */
  rebuild(cells: Uint8Array, overlay: Uint8Array, width: number, height: number): void {
    this.awake.fill(0);
    this.scanSet.fill(0);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const trow = (y >> TILE_BITS) * this.tilesX;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        if (cells[i] !== 0 || overlay[i] !== 0) this.awake[trow + (x >> TILE_BITS)] = 1;
      }
    }
  }
}
