//! Heat-diffusion kernel — the first WASM port of a "region A" pure numeric
//! kernel (see docs/WASM-ENGINE-PORTING.md, Phase 2). This is a straight,
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

/// One finite-difference conduction step: `next[i]` = `cur[i]` plus the heat
/// exchanged with each in-bounds orthogonal neighbor. Mirrors the inner loop of
/// the TS `diffuseHeat` exactly, including the perfect-insulator early-out
/// (`ci == 0` cells never exchange and copy through unchanged).
///
/// # Safety
/// All pointers must be valid for `w * h` elements; `cond` must be valid for the
/// 256 possible material ids. Callers uphold this from `diffuse_heat`.
#[inline]
unsafe fn diffuse_step(
    cells: *const u8,
    cond: *const f32,
    cur: *const f32,
    next: *mut f32,
    w: usize,
    h: usize,
    rate: f64,
    radiant_rate: f64,
) {
    for y in 0..h {
        let row = y * w;
        for x in 0..w {
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
                if cj > 0.0 {
                    let mc = if ci < cj { ci } else { cj };
                    acc += rate * mc * (*cur.add(i - 1) as f64 - ti);
                } else if x > 1 {
                    let ck = *cond.add(*cells.add(i - 2) as usize) as f64;
                    if ck > 0.0 {
                        let mc = if ci < ck { ci } else { ck };
                        acc += radiant_rate * mc * (*cur.add(i - 2) as f64 - ti);
                    }
                }
            }
            if x < w - 1 {
                let cj = *cond.add(*cells.add(i + 1) as usize) as f64;
                if cj > 0.0 {
                    let mc = if ci < cj { ci } else { cj };
                    acc += rate * mc * (*cur.add(i + 1) as f64 - ti);
                } else if x < w - 2 {
                    let ck = *cond.add(*cells.add(i + 2) as usize) as f64;
                    if ck > 0.0 {
                        let mc = if ci < ck { ci } else { ck };
                        acc += radiant_rate * mc * (*cur.add(i + 2) as f64 - ti);
                    }
                }
            }
            if y > 0 {
                let cj = *cond.add(*cells.add(i - w) as usize) as f64;
                if cj > 0.0 {
                    let mc = if ci < cj { ci } else { cj };
                    acc += rate * mc * (*cur.add(i - w) as f64 - ti);
                } else if y > 1 {
                    let ck = *cond.add(*cells.add(i - 2 * w) as usize) as f64;
                    if ck > 0.0 {
                        let mc = if ci < ck { ci } else { ck };
                        acc += radiant_rate * mc * (*cur.add(i - 2 * w) as f64 - ti);
                    }
                }
            }
            if y < h - 1 {
                let cj = *cond.add(*cells.add(i + w) as usize) as f64;
                if cj > 0.0 {
                    let mc = if ci < cj { ci } else { cj };
                    acc += rate * mc * (*cur.add(i + w) as f64 - ti);
                } else if y < h - 2 {
                    let ck = *cond.add(*cells.add(i + 2 * w) as usize) as f64;
                    if ck > 0.0 {
                        let mc = if ci < ck { ci } else { ck };
                        acc += radiant_rate * mc * (*cur.add(i + 2 * w) as f64 - ti);
                    }
                }
            }
            *next.add(i) = acc as f32;
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
///
/// # Safety
/// `cells`, `temp`, and `scratch` must each be valid for `w * h` elements and
/// `cond` for 256 `f32`. The host guarantees this by sizing the regions to the
/// grid before the call.
#[no_mangle]
pub unsafe extern "C" fn diffuse_heat(
    cells: *const u8,
    cond: *const f32,
    temp: *mut f32,
    scratch: *mut f32,
    w: usize,
    h: usize,
    rate: f64,
    radiant_rate: f64,
    substeps: u32,
) {
    if w == 0 || h == 0 || substeps == 0 {
        return;
    }
    let n = w * h;
    // `a` holds the current field, `b` the buffer the next field is written to.
    let mut a = temp;
    let mut b = scratch;
    for _ in 0..substeps {
        diffuse_step(cells, cond, a, b, w, h, rate, radiant_rate);
        core::mem::swap(&mut a, &mut b);
    }
    // After an odd number of swaps the latest field sits in `scratch`; copy it
    // back so callers can always read the result from `temp`.
    if a as *const f32 != temp as *const f32 {
        ptr::copy_nonoverlapping(a, temp, n);
    }
}
