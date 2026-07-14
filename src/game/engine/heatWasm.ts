import wasmUrl from './heat.wasm?url';

/**
 * Host-side plumbing for the Rust/WASM heat-diffusion kernel (see
 * `wasm/README.md` and docs/WASM-ENGINE-PORTING.md Phase 2). The kernel is the
 * first "region A" pure numeric loop moved off JS: it takes the grid's flat
 * buffers in, runs `HEAT_DIFFUSION_SUBSTEPS` conduction substeps, and hands the
 * temperature field back — bit-identical to `Simulation.diffuseHeat` (proven by
 * `wasm/test/golden.mjs`), so enabling it never changes behavior.
 *
 * Loading is async (`WebAssembly.instantiate`) while `Simulation.step()` is
 * sync, so callers keep running the JS path until `heatWasmReady()` flips true;
 * if the module never loads (unsupported, fetch failure) they simply stay on JS.
 * That is the automatic fallback the porting plan requires — degrade to slower,
 * never to broken.
 */

interface HeatExports {
  memory: WebAssembly.Memory;
  heat_alloc: (bytes: number) => number;
  heat_free: (ptr: number, bytes: number) => void;
  diffuse_heat: (
    cells: number,
    cond: number,
    temp: number,
    scratch: number,
    w: number,
    h: number,
    rate: number,
    substeps: number,
  ) => void;
}

let mod: HeatExports | null = null;
let condPtr = 0; // conductivity LUT region (256 f32), allocated once
let initStarted = false;

// Grid-sized regions, (re)allocated when the cell count changes (resize).
let bufCells = 0;
let cellsPtr = 0;
let tempPtr = 0;
let scratchPtr = 0;

/** True once the kernel has loaded and callers may use {@link diffuseHeatWasm}. */
export function heatWasmReady(): boolean {
  return mod !== null;
}

/**
 * Kick off async loading of the WASM kernel. Safe to call once at startup; a
 * second call is a no-op. Never throws — on any failure the module stays null
 * and callers keep using the JS diffusion path.
 */
export async function initHeatWasm(): Promise<void> {
  if (initStarted) return;
  initStarted = true;
  try {
    if (typeof WebAssembly === 'undefined') return;
    const res = await fetch(wasmUrl);
    // Instantiate from the fetched bytes (not instantiateStreaming) so a static
    // host serving `.wasm` with a non-`application/wasm` MIME type still works.
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    const ex = instance.exports as unknown as HeatExports;
    if (
      typeof ex.diffuse_heat !== 'function' ||
      typeof ex.heat_alloc !== 'function' ||
      !(ex.memory instanceof WebAssembly.Memory)
    ) {
      return; // unexpected shape — stay on JS
    }
    const cp = ex.heat_alloc(256 * 4);
    if (cp === 0) return; // allocation failed — stay on JS
    condPtr = cp;
    mod = ex;
  } catch {
    mod = null; // any failure → JS fallback
  }
}

/** (Re)size the grid-buffer regions to `n` cells, freeing the previous set. */
function ensureBuffers(m: HeatExports, n: number): boolean {
  if (n === bufCells) return true;
  if (bufCells > 0) {
    m.heat_free(cellsPtr, bufCells);
    m.heat_free(tempPtr, bufCells * 4);
    m.heat_free(scratchPtr, bufCells * 4);
    bufCells = 0;
    cellsPtr = tempPtr = scratchPtr = 0;
  }
  const cp = m.heat_alloc(n);
  const tp = m.heat_alloc(n * 4);
  const sp = m.heat_alloc(n * 4);
  if (cp === 0 || tp === 0 || sp === 0) {
    // Out of memory: release whatever succeeded and report failure so the
    // caller falls back to JS for this tick.
    if (cp !== 0) m.heat_free(cp, n);
    if (tp !== 0) m.heat_free(tp, n * 4);
    if (sp !== 0) m.heat_free(sp, n * 4);
    return false;
  }
  cellsPtr = cp;
  tempPtr = tp;
  scratchPtr = sp;
  bufCells = n;
  return true;
}

/**
 * Run the WASM heat kernel over the grid buffers. Copies `cells`/`cond`/`temp`
 * into linear memory, runs `substeps` conduction substeps, and writes the
 * result back into `temp` in place. Returns false if WASM isn't ready or a
 * buffer allocation failed, in which case the caller must run the JS path.
 *
 * `cond` is the 256-entry conductivity LUT; `temp` is overwritten with output.
 */
export function diffuseHeatWasm(
  cells: Uint8Array,
  cond: Float32Array,
  temp: Float32Array,
  w: number,
  h: number,
  rate: number,
  substeps: number,
): boolean {
  const m = mod;
  if (m === null) return false;
  const n = w * h;
  if (n === 0) return true;
  if (!ensureBuffers(m, n)) return false;

  // Memory views are created after ensureBuffers: an allocation can grow the
  // WebAssembly.Memory and detach the old ArrayBuffer. Within this function no
  // further allocation happens, so these views stay valid through the call.
  const buf = m.memory.buffer;
  new Uint8Array(buf, cellsPtr, n).set(cells.subarray(0, n));
  new Float32Array(buf, condPtr, 256).set(cond.subarray(0, 256));
  new Float32Array(buf, tempPtr, n).set(temp.subarray(0, n));

  m.diffuse_heat(cellsPtr, condPtr, tempPtr, scratchPtr, w, h, rate, substeps);

  temp.set(new Float32Array(buf, tempPtr, n));
  return true;
}
