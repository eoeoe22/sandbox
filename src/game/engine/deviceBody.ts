import { DIR4 } from './directions';
import type { SimContext } from './SimContext';

// 전기 장치의 몸체 전도 — the one body-flood every electric device shares.
//
// An electric device (Fan, Laser, Pump, Electromagnet, Woofer — and the Turbine,
// which is the same walk pointed the other way) is deliberately NOT `conductive`:
// a machine wall must never double as free wire (see woofer.ts's "one-way
// outside → inside sink" write-up). Instead each declares a `directPulse` hook,
// and power reaching *any* face of the connected body activates *all* of it.
//
// Two rules define that activation, and both live here rather than in each
// material, so every device answers to power identically:
//
//   1. 전기 세기에 관계없이 — strength never enters. A pulse carries a strength
//      that decays as it crosses a resistive medium (spark.ts), but that value
//      only decides how far current *reaches*; it is never read on this side of
//      the wire. Activation is binary: whatever pulse survived to touch a face —
//      a battery terminal flush against the housing, a spark that crawled the
//      last cell of a long brine channel with 1 point of strength left — powers
//      the machine to exactly the same degree.
//   2. 연결 부위 전역 즉시 활성화 — one flood covers the *whole* 4-connected body
//      in a single pass, in the tick the pulse arrives. There is no per-flood cell
//      cap. Each of these devices used to stop its walk after 256 cells "so a
//      giant body can't make one pulse unbounded", which quietly meant a big build
//      only half worked: the walk restarted from the same entry cell every pulse,
//      so the far side of a large fan wall or emitter array was never reached at
//      all — the machine looked like it was rationing power by distance from the
//      wire. Uncapped, a body is a body: touch it anywhere and all of it runs.
//
// The work that buys is bounded by the memo below, not by a cap: a flood visits
// each cell of a body once and marks it, so N cells cost O(N) *per tick* no matter
// how many faces, sources, or body cells try to trigger it. A device whose
// per-cell effect is itself expensive (the Woofer fires a shockwave from every
// cell) thins its own *effect* sources instead of its activation — see
// woofer.ts — so the whole cabinet still activates as one.

/**
 * Per-tick "this body already flooded" memo for one device kind, held on
 * SimContext (sim-local: two Simulations over identically-sized grids run the
 * same tick numbers, so module state keyed by tick would let one world's floods
 * suppress the other's and break the lockstep-determinism harness).
 *
 * Holds the flat cell indices covered by a flood this tick and self-resets the
 * first time it's touched in a later tick, so a tick with no activity for that
 * device costs nothing.
 */
export class BodyFlood {
  private tick = -1;
  /** Flat cell indices (y*width + x) flooded this tick. */
  readonly cells: Set<number> = new Set();

  /** Roll the memo over to the sim's current tick if it's stale. Returns true
   *  when it just rolled (the caller may have its own per-tick state to clear
   *  in the same breath — see woofer.ts's knockback queue). */
  begin(sim: SimContext): boolean {
    if (this.tick === sim.tick) return false;
    this.tick = sim.tick;
    this.cells.clear();
    return true;
  }

  /** Has (x,y) already been covered by a flood this tick? Assumes `begin` has
   *  been called for the current tick (every caller floods through
   *  `floodDeviceBody`, or calls `begin` itself first). */
  has(sim: SimContext, x: number, y: number): boolean {
    return this.cells.has(y * sim.width + x);
  }
}

/**
 * Walk the whole 4-connected body of `bodyId` containing (sx,sy) and run `visit`
 * on every one of its cells exactly once — the shared activation pass behind
 * every electric device's `directPulse` hook (and the Turbine's outward
 * generation pass, which is the same walk emitting instead of accepting).
 *
 * Returns true if this call actually flooded, false if the body was already
 * covered this tick (several faces of one machine touched by several sources in
 * a single tick still activate it exactly once — the memo, not a cap, is what
 * keeps repeated contact from costing repeated work).
 *
 * `visit` may freely write to the cells it's handed (that's the point — stamping
 * a powered countdown, firing an effect); it must not turn body cells into some
 * other material, since the walk reads `sim.get` as it goes.
 *
 * `canWalk`, when given, narrows the walk to the cells it accepts — the body is
 * still "everything 4-connected", but only through cells that pass. The seed cell
 * is the caller's own and is never tested. This is for a pass that acts on part of
 * a body rather than powering it: the Electromagnet's per-tick field sweep walks
 * only *powered* cells, so a freshly painted extension that no pulse has reached
 * yet doesn't seed a pull the magnet isn't making. Activation itself never passes
 * one — powering a device is always the whole connected body.
 */
export function floodDeviceBody(
  sim: SimContext,
  sx: number,
  sy: number,
  bodyId: number,
  memo: BodyFlood,
  visit: (x: number, y: number) => void,
  canWalk?: (x: number, y: number) => boolean,
): boolean {
  memo.begin(sim);
  const w = sim.width;
  const start = sy * w + sx;
  if (memo.cells.has(start)) return false;

  // The memo doubles as the walk's own visited set: a flood always covers a
  // whole body now, so "already flooded this tick" and "already queued by this
  // walk" are the same question, and marking at push time keeps a cell from
  // being stacked twice by two neighbors.
  memo.cells.add(start);
  const stack: number[] = [sx, sy];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    visit(x, y);
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== bodyId) continue;
      if (canWalk !== undefined && !canWalk(nx, ny)) continue;
      const k = ny * w + nx;
      if (memo.cells.has(k)) continue;
      memo.cells.add(k);
      stack.push(nx, ny);
    }
  }
  return true;
}
