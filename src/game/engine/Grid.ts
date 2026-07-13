import { EMPTY } from './types';
import { AMBIENT_TEMP } from '../config';
import type { SimBody } from './objects';

/** A Uint8Array of `n` random bytes — used to seed the positional background
 *  tint field with an initial texture (see Grid.bgTint). */
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0;
  return a;
}

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
   * 겹침 (overlap) layer: a second material id per cell, holding at most ONE
   * fluid particle that shares the cell with its primary occupant — water
   * soaked into a sand grain, or a liquid/gas mid-passage through a porous
   * screen (Mesh/Turbine). 0 = nothing overlapped. Which primaries may host
   * which fluids is decided by `canHostOverlap` (SimContext); the fluid's
   * per-tick movement lives in SimContext.updateOverlay. An overlapped fluid is
   * pure id+position — it shares the host cell's temperature and carries no
   * aux/tint of its own. Travels with its host on a swap (the tuple stays
   * consistent), is persisted like `aux`, and renders as a color blend so wet
   * cells read as wet (see CanvasRenderer).
   */
  overlay: Uint8Array;
  /**
   * The overlap fluid's own `aux` state byte — its private per-material state
   * (Grid.aux) parked here while it rides in a host's overlap slot, since the
   * host is using the real `aux` for its own state. This is what carries a
   * Petroleum Vapor's condensate cut, a Molten Uranium's burn counter, etc.
   * intact across a passage through a Mesh/Turbine or a soak through sand,
   * instead of resetting to 0. 0 when no fluid is overlapped. Travels with the
   * overlay on every move and is persisted alongside it. Only read while
   * `overlay` is non-zero, so a stale value under a dry cell is inert.
   */
  overlayAux: Uint8Array;
  /** Per-tick "overlay already moved" guard — the overlap layer's own `moved`,
   *  independent of the primary's, since the two particles in a cell move on
   *  separate schedules within one step. */
  overlayMoved: Uint8Array;

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
   * emptied — the same lifecycle as `temp`. Persisted with the world (see
   * persistence.ts), so electrical state (a Spark's conductor, a Clone's adopted
   * id, …) survives a reload; older saves that predate aux-persistence reload it
   * as 0, so every use must still tolerate a 0 default. Materials that instead
   * need real-valued state keep using `temp` with `conductivity: 0`
   * (Blast/Ember); `aux` is the cheap integer companion.
   */
  aux: Uint8Array;

  /**
   * Per-particle color-variation byte (used by powders): each grain's individual
   * tint, seeded once when the grain is created and then fixed. Travels with the
   * cell on a swap, just like `temp`/`aux`, so a grain keeps its shade as it
   * moves, but it is never re-rolled. The renderer maps it to a small brightness
   * offset from the material's base color (see game/tint.ts). Runtime-only
   * cosmetic state: not persisted (a reload reseeds it via randomizeTints).
   */
  tint: Uint8Array;

  /**
   * Positional background tint field (used by liquids): one byte per grid cell,
   * tied to the *location* rather than the particle that occupies it. A liquid
   * cell is rendered with the background tint at its position, so as liquid flows
   * across space it picks up the shade of wherever it is. The field itself drifts
   * slowly over time (see Simulation.driftBackground), giving pools a living
   * shimmer with a texture bound to space, not to individual particles. Unlike
   * `tint` it does NOT travel on a swap. Runtime-only cosmetic state; seeded with
   * random values so there's an initial texture.
   */
  bgTint: Uint8Array;

  /**
   * Free rigid objects (the 독립 오브젝트 layer): bodies with their own
   * position/velocity/physics, living *beside* the cell grid rather than in it
   * (see engine/objects.ts). Stepped by Simulation as a pass separate from the
   * CA scan, drawn by the renderer as an overlay that never touches the cell
   * buffer, and hit-tested against the grid read-only. Empty in a world with no
   * objects; not tied to the flat TypedArrays, so a future Worker port would
   * carry this list alongside the transferred buffers.
   */
  objects: SimBody[] = [];

  // Still reserved for a future per-cell velocity field (see ember.ts, which
  // currently packs velocity into `temp`).
  // vel: Int8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cells = new Uint8Array(this.size); // initialized to EMPTY (0)
    this.moved = new Uint8Array(this.size);
    this.overlay = new Uint8Array(this.size); // 겹침: no fluid overlapped
    this.overlayAux = new Uint8Array(this.size);
    this.overlayMoved = new Uint8Array(this.size);
    this.temp = new Float32Array(this.size).fill(AMBIENT_TEMP);
    this.tempScratch = new Float32Array(this.size);
    this.aux = new Uint8Array(this.size);
    this.tint = new Uint8Array(this.size); // 0 = neutral until seeded on placement
    this.bgTint = randomBytes(this.size); // positional background texture
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

  getOverlay(x: number, y: number): number {
    return this.overlay[y * this.width + x];
  }

  setOverlay(x: number, y: number, id: number): void {
    this.overlay[y * this.width + x] = id;
    if (id === 0) this.overlayAux[y * this.width + x] = 0; // dry cell carries no state
  }

  getTint(x: number, y: number): number {
    return this.tint[y * this.width + x];
  }

  setTint(x: number, y: number, v: number): void {
    this.tint[y * this.width + x] = v;
  }

  /**
   * Reseed every non-empty cell with a fresh per-particle tint. Used after
   * loading a saved world (tint isn't persisted) so a restored powder pile is
   * already grainy instead of a flat block. The positional background field is
   * seeded separately (constructor / resizeFrom), so it isn't touched here.
   */
  randomizeTints(): void {
    const cells = this.cells;
    const tint = this.tint;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== EMPTY) tint[i] = (Math.random() * 256) | 0;
    }
  }

  clear(): void {
    this.cells.fill(EMPTY);
    this.overlay.fill(0);
    this.overlayAux.fill(0);
    this.temp.fill(AMBIENT_TEMP);
    this.aux.fill(0);
    this.tint.fill(0);
    this.objects.length = 0; // free objects live beside the grid; clear them too
  }

  /**
   * Resize the grid, preserving the overlapping cells from its own contents.
   * No-op if the dimensions are unchanged.
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.resizeFrom(width, height, this.cells, this.width, this.height, this.temp, this.aux, this.overlay, this.overlayAux, this.tint, this.bgTint);
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
    srcOverlay?: Uint8Array,
    srcOverlayAux?: Uint8Array,
    srcTint?: Uint8Array,
    srcBgTint?: Uint8Array,
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
    // The 겹침 overlap layer (fluid id + its parked aux) travels with its host
    // cells the same way (a soaked bed stays soaked across a resize). Missing
    // source (older save) → all dry.
    const nextOverlay = new Uint8Array(width * height);
    const nextOverlayAux = new Uint8Array(width * height);
    // Cosmetic per-particle tint travels with its cells the same way. When no
    // source tint is supplied it starts zeroed (neutral); callers seed it
    // afterward (Grid.randomizeTints) so a fresh load isn't a flat block.
    const nextTint = new Uint8Array(width * height);
    // The positional background field is location-bound, not content-bound. Seed
    // the whole thing with a fresh random texture, then (if a source is supplied)
    // copy the overlapping region so an in-session resize/drag doesn't reshuffle
    // the existing texture — only newly exposed area gets the fresh randomness.
    const nextBgTint = randomBytes(width * height);
    const copyW = Math.min(width, srcW);
    const copyRows = Math.min(height, srcH);
    for (let r = 0; r < copyRows; r++) {
      const srcY = srcH - 1 - r;
      const newY = height - 1 - r;
      const src = srcY * srcW;
      next.set(srcCells.subarray(src, src + copyW), newY * width);
      if (srcTemp) nextTemp.set(srcTemp.subarray(src, src + copyW), newY * width);
      if (srcAux) nextAux.set(srcAux.subarray(src, src + copyW), newY * width);
      if (srcOverlay) nextOverlay.set(srcOverlay.subarray(src, src + copyW), newY * width);
      if (srcOverlayAux) nextOverlayAux.set(srcOverlayAux.subarray(src, src + copyW), newY * width);
      if (srcTint) nextTint.set(srcTint.subarray(src, src + copyW), newY * width);
      if (srcBgTint) nextBgTint.set(srcBgTint.subarray(src, src + copyW), newY * width);
    }

    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cells = next;
    this.moved = new Uint8Array(this.size);
    this.overlay = nextOverlay;
    this.overlayAux = nextOverlayAux;
    this.overlayMoved = new Uint8Array(this.size);
    this.temp = nextTemp;
    this.tempScratch = new Float32Array(this.size);
    this.aux = nextAux;
    this.tint = nextTint;
    this.bgTint = nextBgTint;
  }
}
