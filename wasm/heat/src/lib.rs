//! Heat-diffusion kernel — the first WASM port of a "region A" pure numeric
//! kernel (see wasm/README.md). This is a straight,
//! self-contained rewrite of `Simulation.diffuseHeat` in TypeScript: one
//! explicit finite-difference conduction step per substep, exchanging heat with
//! the 4 orthogonal neighbors, the exchanged fraction gated by the lower of the
//! two cells' conductivities.
//!
//! ## Numeric parity with the JS reference
//!
//! The TS version reads `Float32Array` temperatures (f32) but accumulates in a
//! JS number (f64) before rounding the result back to f32 on store. This kernel
//! mirrors that exactly: every value is read as `f32`, widened to `f64`, all
//! arithmetic runs in `f64` in the same left-to-right order, and only the final
//! store narrows to `f32`. With the identical operation order this reproduces
//! the JS output bit-for-bit (the golden test in `wasm/test/golden.mjs` asserts
//! it), so switching the kernel on never changes simulation behavior.
//!
//! ## ABI
//!
//! No `wasm-bindgen`: the module exports plain C-ABI functions operating on raw
//! pointers into its own linear memory, plus a tiny allocator so the JS host can
//! reserve scratch regions. This keeps the toolchain to `cargo build` alone and
//! the artifact to a single committed `.wasm`.

use core::ptr;
use std::alloc::{alloc, dealloc, Layout};

/// Alignment for all host-visible allocations. 8 bytes satisfies both the `u8`
/// cell buffer and the `f32` temperature/conductivity buffers.
const ALIGN: usize = 8;

/// Reserve `bytes` of linear memory and return the offset. The host mirrors the
/// grid's flat buffers into regions carved out here (see engine/heatWasm.ts).
/// Returns a null pointer if the layout is invalid; the host treats that as
/// "WASM unavailable" and stays on the JS path.
#[no_mangle]
pub extern "C" fn heat_alloc(bytes: usize) -> *mut u8 {
    if bytes == 0 {
        return ptr::null_mut();
    }
    match Layout::from_size_align(bytes, ALIGN) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => ptr::null_mut(),
    }
}

/// Release a region previously returned by [`heat_alloc`]. `bytes` must match
/// the original request (the host tracks sizes and only frees on grid resize).
#[no_mangle]
pub extern "C" fn heat_free(ptr: *mut u8, bytes: usize) {
    if ptr.is_null() || bytes == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(bytes, ALIGN) {
        unsafe { dealloc(ptr, layout) };
    }
}

/// Largest tile shift this kernel will honour. A mask coarser than 2^16 cells
/// per tile is nonsense at any grid size the game runs, so anything past this
/// is treated as a malformed mask and falls back to the full grid rather than
/// computing wild offsets.
const MAX_TILE_BITS: u32 = 16;

/// The per-cell body of one conduction step, for the cells `[x0, x1) × [y0, y1)`.
/// Mirrors the inner loop of the TS `diffuseHeat` exactly, including the
/// perfect-insulator early-out (`ci == 0` cells never exchange and copy through
/// unchanged). Neighbor reads still address the whole grid, so a cell on a tile
/// edge sees its neighbor in the next tile as it always did.
///
/// # Safety
/// All pointers must be valid for `w * h` elements; `cond` must be valid for the
/// 256 possible material ids, and the bounds must lie inside the grid. Callers
/// uphold this from `diffuse_heat`.
#[inline]
#[allow(clippy::too_many_arguments)]
unsafe fn diffuse_block(
    cells: *const u8,
    cond: *const f32,
    cur: *const f32,
    next: *mut f32,
    w: usize,
    h: usize,
    rate: f64,
    x0: usize,
    x1: usize,
    y0: usize,
    y1: usize,
) {
    for y in y0..y1 {
        let row = y * w;
        for x in x0..x1 {
            let i = row + x;
            let ci = *cond.add(*cells.add(i) as usize) as f64;
            let ti = *cur.add(i) as f64;
            if ci == 0.0 {
                // Perfect insulator (air/Empty): never exchanges, copies through.
                *next.add(i) = ti as f32;
                continue;
            }
            let mut acc = ti;
            if x > 0 {
                let cj = *cond.add(*cells.add(i - 1) as usize) as f64;
                let mc = if ci < cj { ci } else { cj };
                acc += rate * mc * (*cur.add(i - 1) as f64 - ti);
            }
            if x < w - 1 {
                let cj = *cond.add(*cells.add(i + 1) as usize) as f64;
                let mc = if ci < cj { ci } else { cj };
                acc += rate * mc * (*cur.add(i + 1) as f64 - ti);
            }
            if y > 0 {
                let cj = *cond.add(*cells.add(i - w) as usize) as f64;
                let mc = if ci < cj { ci } else { cj };
                acc += rate * mc * (*cur.add(i - w) as f64 - ti);
            }
            if y < h - 1 {
                let cj = *cond.add(*cells.add(i + w) as usize) as f64;
                let mc = if ci < cj { ci } else { cj };
                acc += rate * mc * (*cur.add(i + w) as f64 - ti);
            }
            *next.add(i) = acc as f32;
        }
    }
}

/// One finite-difference conduction step over the whole grid, or — when `tiles`
/// is non-null — only over the tiles the host marked as holding at least one
/// conducting cell.
///
/// Skipping an all-inert tile is bit-identical, not an approximation: every cell
/// in it has `cond == 0`, which both copies its own temperature through and
/// zeroes the `min(ci, cj)` gate for any neighbor looking in. `diffuse_heat`
/// pre-seeds `scratch` from `temp` so the copy-through those cells would have
/// done is already in both ping-pong buffers. And since this is a Jacobi step
/// (reads `cur`, writes `next`, never both), visiting the remaining cells
/// tile-by-tile instead of row-by-row reorders nothing that can be observed.
///
/// The tile size arrives as `tile_bits` rather than living here as a constant.
/// The host is the only party that knows the mask's geometry — it is the one
/// building it — and a second copy of that number in this file could drift out
/// of sync with `engine/dirtyTiles.ts` while every WASM test kept passing, since
/// the tests would agree with *this* file. Taking it as a parameter makes that
/// class of split-brain unrepresentable.
///
/// # Safety
/// As `diffuse_block`, plus: `tiles`, if non-null, must be valid for
/// `tiles_x * tiles_y` bytes covering the grid at `tile_bits` granularity.
#[inline]
#[allow(clippy::too_many_arguments)]
unsafe fn diffuse_step(
    cells: *const u8,
    cond: *const f32,
    cur: *const f32,
    next: *mut f32,
    w: usize,
    h: usize,
    rate: f64,
    tiles: *const u8,
    tiles_x: usize,
    tiles_y: usize,
    tile_bits: u32,
) {
    // Validate the tile size BEFORE shifting by it — `1usize << tile_bits` is an
    // overflowing shift for anything ≥ the pointer width, which on wasm32 would
    // silently mask down to a plausible-looking wrong tile size rather than fail.
    if tiles.is_null() || tile_bits == 0 || tile_bits > MAX_TILE_BITS {
        diffuse_block(cells, cond, cur, next, w, h, rate, 0, w, 0, h);
        return;
    }
    let tile = 1usize << tile_bits;
    // The mask geometry must be *exactly* the tiling of this grid at this tile
    // size. Requiring equality rather than "at least big enough" is what lets
    // this catch the nastiest shape of host bug: a mask with a plausible tile
    // count but the wrong tile size, which would otherwise pass a size check and
    // then read each tile's mark for the wrong physical region — skipping live
    // cells. Falling back is slower and never wrong, the same rule the whole
    // WASM path follows. No real host trips this; the kernel just refuses to
    // take the host's word for it.
    if tiles_x != w.div_ceil(tile) || tiles_y != h.div_ceil(tile) {
        diffuse_block(cells, cond, cur, next, w, h, rate, 0, w, 0, h);
        return;
    }
    // With the geometry pinned above, `ty < tiles_y == ceil(h / tile)` gives
    // `y0 = ty * tile < h`, and likewise for x — the block bounds can't run off
    // the grid, so only the partial last row/column needs clamping.
    for ty in 0..tiles_y {
        let trow = ty * tiles_x;
        let y0 = ty << tile_bits;
        let y1 = core::cmp::min(y0 + tile, h);
        for tx in 0..tiles_x {
            if *tiles.add(trow + tx) == 0 {
                continue; // all-inert tile: proven no-op
            }
            let x0 = tx << tile_bits;
            let x1 = core::cmp::min(x0 + tile, w);
            diffuse_block(cells, cond, cur, next, w, h, rate, x0, x1, y0, y1);
        }
    }
}

/// Run `substeps` conduction substeps in one call, ping-ponging between the
/// `temp` and `scratch` buffers, and leave the final result in `temp` (matching
/// the TS `step()`, which calls `diffuseHeat` in a loop and always ends with the
/// latest field in `grid.temp`). Doing all substeps in a single call amortizes
/// the JS↔WASM boundary crossing to once per tick.
///
/// - `cells`: material id per cell (`w * h` bytes), read-only.
/// - `cond`: conductivity look-up table indexed by material id (256 `f32`).
/// - `temp`: current temperature field (`w * h` `f32`); overwritten with output.
/// - `scratch`: same-sized double buffer; contents are scratch.
/// - `rate`: base per-neighbor exchange fraction (`HEAT_DIFFUSION_RATE`).
/// - `tiles`: optional inert-tile mask, one byte per tile of `2^tile_bits`
///   cells a side (1 = contains a conducting cell). Null runs the full grid.
/// - `tiles_x`/`tiles_y`/`tile_bits`: mask geometry, owned by the host (see
///   `diffuse_step`). Anything that doesn't describe a mask covering the whole
///   grid falls back to the full sweep instead of trusting it.
///
/// # Safety
/// `cells`, `temp`, and `scratch` must each be valid for `w * h` elements and
/// `cond` for 256 `f32`; `tiles`, if non-null, for `tiles_x * tiles_y` bytes.
/// The host guarantees this by sizing the regions to the grid before the call.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn diffuse_heat(
    cells: *const u8,
    cond: *const f32,
    temp: *mut f32,
    scratch: *mut f32,
    w: usize,
    h: usize,
    rate: f64,
    substeps: u32,
    tiles: *const u8,
    tiles_x: usize,
    tiles_y: usize,
    tile_bits: u32,
) {
    if w == 0 || h == 0 || substeps == 0 {
        return;
    }
    let n = w * h;
    // Seed the back buffer with the current field. Cells inside skipped tiles are
    // never written again for the rest of the pass, so this one copy is exactly
    // the copy-through they would each have done, in both ping-pong buffers, for
    // every substep. Redundant but harmless when `tiles` is null (every cell is
    // overwritten below), which keeps the masked and unmasked paths identical.
    ptr::copy_nonoverlapping(temp as *const f32, scratch, n);
    // `a` holds the current field, `b` the buffer the next field is written to.
    let mut a = temp;
    let mut b = scratch;
    for _ in 0..substeps {
        diffuse_step(cells, cond, a, b, w, h, rate, tiles, tiles_x, tiles_y, tile_bits);
        core::mem::swap(&mut a, &mut b);
    }
    // After an odd number of swaps the latest field sits in `scratch`; copy it
    // back so callers can always read the result from `temp`.
    if a as *const f32 != temp as *const f32 {
        ptr::copy_nonoverlapping(a, temp, n);
    }
}
