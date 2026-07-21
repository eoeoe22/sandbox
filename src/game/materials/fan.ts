import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { DIR_RIGHT, DIR_LEFT, DIR_UP, DIR_DOWN, dirVecFor } from './direction4';
import { spawnWindStreak } from './windstreak';

// Fan — an electric appliance that blows Wind (바람) in the direction it was
// drawn, like a Conveyor's belt direction but for all 4 cardinals instead of
// just left/right (see direction4.ts — the aux byte reuses Conveyor's own
// RIGHT/LEFT values, extended with UP/DOWN, and PointerPainter records the
// drag direction into it exactly like a Conveyor's belt direction).
//
// ── Power: outside → inside, whole body at once (Woofer's pattern, see
// woofer.ts's own design note "Reaching a future device") ───────────────────
// A Fan is NOT `conductive` — it's a one-way sink, not a wire, so it can never
// back-feed a circuit or act as a free relay. Instead, exactly like Woofer,
// every *source* of a pulse (a direct Battery contact in battery.ts, or a
// relayed Spark's arc phase in spark.ts) special-cases `FAN.id` and calls
// `fanBodyPulse` straight away: the pulse floods the whole connected Fan body
// (4-connected, mirroring Turbine's own body-flood in turbine.ts — the
// reference this feature's spec points at) and every cell in that body blows
// its own gust *this same tick*, whichever way that particular cell was
// drawn. So a 3-wide fan bank wired at one corner blows as one wide gust, not
// three independent ones with different timings.
//
// ── Wind is a pure per-tick force, never a stored state ─────────────────────
// There's no lingering "Wind" grid state to fade out: fanPulse shoves loose
// matter and nudges free objects directly, once, the instant the pulse
// arrives. Stop powering the Fan (pull the battery, cut the wire) and the
// very next tick simply does nothing — nothing to decay, nothing left behind.
// The only thing that visibly outlives a single pulse is the decorative
// Wind Streak trail (windstreak.ts), and that's a deliberately short-lived
// material of its own, not a property of the Fan.
export const FAN_RIGHT = DIR_RIGHT;
export const FAN_LEFT = DIR_LEFT;
export const FAN_UP = DIR_UP;
export const FAN_DOWN = DIR_DOWN;

/** How far a gust reaches: pushes loose matter and nudges free objects up to
 *  this many cells ahead of the Fan face. */
const REACH = 26;

/** A single Fan cell doesn't blow a 1-wide laser — real air spreads out as it
 *  travels, so the gust widens into a cone: every `CONE_WIDEN_EVERY` cells of
 *  forward travel, the affected width grows by one cell to each side, capped
 *  at `MAX_HALF_SPREAD` (so the cone tops out at 2*MAX_HALF_SPREAD+1 cells
 *  wide). A lone Fan tile still reaches far and wide, not just straight
 *  ahead — a bank of several just starts that much wider up front. */
const CONE_WIDEN_EVERY = 3;
const MAX_HALF_SPREAD = 4;

/** Backstop on how far one flood walks the connected Fan body in a single
 *  pass (mirrors Turbine's/Woofer's own MAX_BODY) — a giant bank can't make
 *  one pulse unbounded. */
const MAX_BODY = 256;

/** Cells in front of the Fan face a fresh Wind Streak is seeded at per pulse —
 *  staggered, so a gust reads as a short layered burst of several lines (see
 *  the reference "서서히 말리는 바람" animation's several parallel lines)
 *  rather than one lone dash. */
const STREAK_SEED_OFFSETS = [1, 2, 4];

/** True if `id` is loose matter Wind can shove (powder or liquid) — the same
 *  pairing Conveyor carries (see conveyor.ts's isLoose): this engine has no
 *  movable Phase.Solid, so "고체" in the spec is the grains/piles that
 *  actually move, while a genuine Solid (Wall, Stone, …) is correctly an
 *  obstruction that blocks the gust outright below. */
function isLoose(id: number): boolean {
  if (id === EMPTY) return false;
  const p = getMaterial(id).phase;
  return p === Phase.Powder || p === Phase.Liquid;
}

/** Walk one lane (one perpendicular offset `w` from the Fan's own column/row)
 *  up to REACH cells along (dx,dy), shoving any loose matter one step further
 *  whenever the next cell is open, and stopping dead at a solid wall (wind
 *  doesn't blow through a wall). A lane only starts acting once the cone has
 *  widened enough to include it (`step >= laneStart`) — before that it just
 *  walks its coordinates forward without touching anything, so every lane's
 *  wall-stop still lines up with its own actual starting point. */
function fanLane(sim: SimContext, x: number, y: number, dx: number, dy: number, px: number, py: number, w: number): void {
  const laneStart = Math.abs(w) * CONE_WIDEN_EVERY;
  let cx = x + px * w;
  let cy = y + py * w;
  for (let step = 1; step <= REACH; step++) {
    cx += dx;
    cy += dy;
    if (step < laneStart) continue; // cone hasn't spread this wide yet
    if (!sim.inBounds(cx, cy)) break;
    const id = sim.get(cx, cy);
    if (id !== EMPTY && getMaterial(id).phase === Phase.Solid) break; // a wall stops the gust outright
    if (id !== EMPTY && isLoose(id) && !sim.hasMoved(cx, cy)) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (sim.inBounds(tx, ty) && sim.get(tx, ty) === EMPTY) sim.swap(cx, cy, tx, ty);
    }
  }
}

/** Fire one Fan cell's gust: a widening cone of lanes (see fanLane/
 *  CONE_WIDEN_EVERY) fanning out from dead ahead. Also queues the beam for
 *  the free-object layer (see engine/objects.ts's applyFanKnockback) and
 *  seeds a few decorative Wind Streaks. */
function fanPulse(sim: SimContext, x: number, y: number): void {
  const dirAux = sim.getAux(x, y);
  const [dx, dy] = dirVecFor(dirAux);
  const px = -dy; // perpendicular unit step, 90° from the wind direction
  const py = dx;

  for (let w = -MAX_HALF_SPREAD; w <= MAX_HALF_SPREAD; w++) {
    fanLane(sim, x, y, dx, dy, px, py, w);
  }

  sim.fanPulseX.push(x);
  sim.fanPulseY.push(y);
  sim.fanPulseDirX.push(dx);
  sim.fanPulseDirY.push(dy);

  for (const off of STREAK_SEED_OFFSETS) {
    spawnWindStreak(sim, x + dx * off, y + dy * off, dirAux);
  }
}

/** Flood the connected Fan body (4-connected) containing (sx,sy) and fire
 *  every cell's own gust — the mirror image of Turbine's outward body-flood
 *  (turbine.ts) and structurally identical to Woofer's inward one
 *  (woofer.ts's `wooferBodyPulse`), which this is modeled directly on.
 *  Memoized per tick via `SimContext.fanFlooded` so a body touched from
 *  several directions/sources in one tick still fires exactly once. */
export function fanBodyPulse(sim: SimContext, sx: number, sy: number): void {
  if (sim.tick !== sim.fanFloodTick) {
    sim.fanFloodTick = sim.tick;
    sim.fanFlooded.clear();
    sim.fanPulseX.length = 0;
    sim.fanPulseY.length = 0;
    sim.fanPulseDirX.length = 0;
    sim.fanPulseDirY.length = 0;
  }
  const w = sim.width;
  const startIdx = sy * w + sx;
  if (sim.fanFlooded.has(startIdx)) return;

  const seen = new Set<number>([startIdx]);
  const stack: number[] = [sx, sy];
  let count = 0;
  while (stack.length > 0 && count < MAX_BODY) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    count++;
    sim.fanFlooded.add(y * w + x);
    fanPulse(sim, x, y);
    for (const [ddx, ddy] of DIR4) {
      const nx = x + ddx;
      const ny = y + ddy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== FAN.id) continue;
      const k = ny * w + nx;
      if (seen.has(k) || sim.fanFlooded.has(k)) continue;
      seen.add(k);
      stack.push(nx, ny);
    }
  }
}

export const FAN = register({
  id: 110,
  name: 'Fan',
  phase: Phase.Solid,
  // Dull housing; the direction chevron (see Material.arrow / direction4.ts)
  // is drawn in `lattice` over this base, showing which way it blows.
  color: rgb(70, 78, 88),
  lattice: rgb(190, 210, 224),
  arrow: true,
  density: 1000,
  category: '전기',
  thermal: { conductivity: 0.3 },
});
