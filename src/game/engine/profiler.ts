// Phase 0 measurement harness (docs/WASM-ENGINE-PORTING.md §Phase 0).
//
// A tiny per-pass profiler: the frame loop and Simulation.step accumulate the
// wall-clock time each pass spends, and the HUD reads a rolling average a couple
// of times a second. The point is to answer "where does the tick actually go?"
// (heat vs. CA scan vs. objects vs. drift vs. render) with real numbers before
// deciding what to port/vectorize next — no blind optimization.
//
// It is OFF by default and gated behind a dev flag (`?perf` in the URL), so it
// costs nothing in production: when disabled every `mark`/`add` is a single
// boolean check and the instrumented call sites skip their `performance.now()`
// pairs entirely (see Simulation.step / Game.frame).

/** The tick/frame passes we break the frame budget into. Order = display order. */
export type PassName = 'heat' | 'ca' | 'objects' | 'drift' | 'render';

export const PASS_NAMES: readonly PassName[] = ['heat', 'ca', 'objects', 'drift', 'render'];

/** Averaged pass times (ms) over the last window, plus how many ticks/frames
 *  each average is drawn from. `heat`/`ca`/`objects`/`drift` are per sim tick;
 *  `render` is per rendered frame. */
export interface PassStats {
  ms: Record<PassName, number>;
  /** Sim ticks accumulated in this window (the sim passes' sample count). */
  ticks: number;
  /** Rendered frames accumulated in this window (render's sample count). */
  frames: number;
}

class Profiler {
  /** Master switch. When false the whole thing is inert; set once at startup. */
  enabled = false;

  private total: Record<PassName, number> = { heat: 0, ca: 0, objects: 0, drift: 0, render: 0 };
  private ticks = 0;
  private frames = 0;

  /** Add a measured duration (ms) to a pass bucket. No-op when disabled, so
   *  callers still guard with `if (profiler.enabled)` to skip timing overhead. */
  add(pass: PassName, ms: number): void {
    this.total[pass] += ms;
  }

  /** Count one completed sim tick (the denominator for the sim passes). */
  tick(): void {
    this.ticks++;
  }

  /** Count one rendered frame (the denominator for the render pass). */
  frame(): void {
    this.frames++;
  }

  /** Average each bucket over the window and reset it, so the HUD shows a rolling
   *  mean rather than an ever-growing sum. Returns null if nothing accumulated. */
  snapshot(): PassStats | null {
    if (this.ticks === 0 && this.frames === 0) return null;
    const t = Math.max(1, this.ticks);
    const f = Math.max(1, this.frames);
    const ms: Record<PassName, number> = {
      heat: this.total.heat / t,
      ca: this.total.ca / t,
      objects: this.total.objects / t,
      drift: this.total.drift / t,
      render: this.total.render / f,
    };
    const out: PassStats = { ms, ticks: this.ticks, frames: this.frames };
    this.total.heat = this.total.ca = this.total.objects = this.total.drift = this.total.render = 0;
    this.ticks = 0;
    this.frames = 0;
    return out;
  }
}

/** Process-wide profiler singleton — the sim and the frame loop share it. */
export const profiler = new Profiler();
