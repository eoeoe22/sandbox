import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { SMOKE } from './smoke';
import { WATER } from './water';
import { SALTWATER } from './saltwater';

// Ember — the glowing ejecta a detonation hurls outward. Where Blast is the
// *destructive* shockwave (bounded to the blast radius, one cell per tick),
// an Ember is pure ballistic debris: launched from the crater rim at several
// cells per tick, it arcs under gravity far beyond the destruction radius,
// and on impact may leave a lick of flame — which is also what lets a blast
// set off *distant* flammables and chain-detonate far-away explosives. It
// never destroys anything by itself; all its damage is delivered via the
// existing Fire rules.
//
// Velocity is stored in fixed-point quarter-cells per tick, packed together
// with the remaining flight time into the cell's `temp` (conductivity 0 makes
// the heat pass treat it as inert per-cell state — the same trick Blast uses).
const Q = 4; // fixed-point scale: 4 quarter-cells = 1 cell
const V_MAX_Q = 16; // |velocity| clamp per axis: 4 cells/tick
const V_SPAN = V_MAX_Q * 2 + 1; // encodable velocity values per axis
// Downward pull per tick (0.25 cell/tick²) — turns straight rays into the
// up-and-out arcs that make debris read as thrown, not beamed.
const GRAVITY_Q = 1;

// Launch tuning (see launchEmber): base speed 2.25–3.5 cells/tick along the
// spent shard's outward direction, scattered by per-axis jitter and a slight
// upward kick, for 12–21 ticks of flight (~0.2–0.35 s at 60 Hz). Fast enough
// to clearly outrun the one-cell-per-tick shockwave, short enough that the
// whole burst resolves in under half a second.
const LAUNCH_SPEED_MIN_Q = 9;
const LAUNCH_SPEED_VAR_Q = 6;
const LAUNCH_JITTER_Q = 3;
const LAUNCH_UP_BIAS_Q = 2;
const LIFE_MIN = 12;
const LIFE_VAR = 10;

const IMPACT_FIRE_CHANCE = 0.5; // shattering on an obstacle leaves flame…
const BURNOUT_SMOKE_CHANCE = 0.25; // …while burning out midair leaves a puff.

// `life` and the two velocity axes share the cell's temp as one packed float.
// Max encodable value ≈ 22·33² ≈ 24k, far inside Float32's 2^24 exact-integer
// range, and always ≥ 0 so it can never be mistaken for Blast's negative
// crater marker.
function encodeEmber(life: number, vxQ: number, vyQ: number): number {
  return (life * V_SPAN + (vxQ + V_MAX_Q)) * V_SPAN + (vyQ + V_MAX_Q);
}
function decodeEmber(temp: number): { life: number; vxQ: number; vyQ: number } {
  const vyQ = (temp % V_SPAN) - V_MAX_Q;
  const rest = Math.floor(temp / V_SPAN);
  return { life: Math.floor(rest / V_SPAN), vxQ: (rest % V_SPAN) - V_MAX_Q, vyQ };
}

function clampV(v: number): number {
  return v < -V_MAX_Q ? -V_MAX_Q : v > V_MAX_Q ? V_MAX_Q : v;
}

/** Whole cells to travel this tick along one axis: the integer part of the
 *  quarter-cell velocity, plus one extra cell with probability equal to the
 *  fractional remainder — sub-cell speeds without a sub-cell position field. */
function cellsThisTick(sim: SimContext, vQ: number): number {
  const mag = Math.abs(vQ);
  let cells = (mag / Q) | 0;
  if (sim.chance((mag % Q) / Q)) cells++;
  return vQ < 0 ? -cells : cells;
}

/**
 * Turn the cell at (x,y) into a freshly launched ember flying outward along
 * (dirX,dirY) (a unit 8-direction step, e.g. a Blast shard's travel
 * direction). Speed, per-axis jitter, upward bias and flight time are all
 * randomized so a ring of rim shards fans out as an irregular all-directions
 * spray instead of eight tidy rays. In-place transform of the caller's own
 * cell — same pattern as Fire burning out to Smoke.
 */
export function launchEmber(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  let speedQ = LAUNCH_SPEED_MIN_Q + sim.randInt(LAUNCH_SPEED_VAR_Q);
  // Diagonal launches cover √2 more ground per step; scale by ~1/√2 so the
  // spray reads as a circle, not a square with fast corners.
  if (dirX !== 0 && dirY !== 0) speedQ = (speedQ * 3) >> 2;
  const jitterSpan = LAUNCH_JITTER_Q * 2 + 1;
  const vxQ = clampV(dirX * speedQ + sim.randInt(jitterSpan) - LAUNCH_JITTER_Q);
  const vyQ = clampV(dirY * speedQ + sim.randInt(jitterSpan) - LAUNCH_JITTER_Q - LAUNCH_UP_BIAS_Q);
  sim.set(x, y, EMBER.id);
  sim.setTemp(x, y, encodeEmber(LIFE_MIN + sim.randInt(LIFE_VAR), vxQ, vyQ));
}

/** Flight ended against an obstacle: the spark shatters at (cx,cy), the last
 *  open cell on its path (adjacent to whatever it hit), sometimes leaving
 *  flame there — the handoff that lets the existing Fire rules ignite the
 *  obstacle or trigger an adjacent explosive. */
function shatter(sim: SimContext, x: number, y: number, cx: number, cy: number): void {
  if (sim.chance(IMPACT_FIRE_CHANCE)) {
    sim.spawn(cx, cy, FIRE.id);
    if (cx !== x || cy !== y) sim.set(x, y, EMPTY);
  } else {
    sim.set(x, y, EMPTY);
  }
}

function updateEmber(x: number, y: number, sim: SimContext): void {
  const st = decodeEmber(sim.getTemp(x, y));
  if (st.life < 1) {
    // Burnt out midair. This is also the graceful death for an ember spawned
    // without an explicit launch (thermal.init 0 decodes to life 0).
    if (sim.chance(BURNOUT_SMOKE_CHANCE)) sim.spawn(x, y, SMOKE.id);
    else sim.set(x, y, EMPTY);
    return;
  }
  const vxQ = st.vxQ;
  const vyQ = clampV(st.vyQ + GRAVITY_Q);
  const dx = cellsThisTick(sim, vxQ);
  const dy = cellsThisTick(sim, vyQ);

  // Walk the straight line to the target cell one step at a time so the
  // ember collides with the first thing on its path, not just the endpoint.
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  let cx = x;
  let cy = y;
  for (let s = 1; s <= steps; s++) {
    const nx = x + Math.round((dx * s) / steps);
    const ny = y + Math.round((dy * s) / steps);
    if (nx === cx && ny === cy) continue;
    if (!sim.inBounds(nx, ny)) {
      // Open (void) edges: the spark simply leaves the world, like any
      // particle that moves out of bounds. A solid container edge is an
      // obstacle like any other.
      if (sim.borderMode === 'void') sim.set(x, y, EMPTY);
      else shatter(sim, x, y, cx, cy);
      return;
    }
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      // Note: entering a crater-marked Empty cell (see blast.ts) overwrites
      // the marker with this ember's state. Accepted: rim embers fly *away*
      // from the crater, and even if one crosses it, the worst case is a
      // wobbling shard re-entering that single cell — still life-bounded.
      cx = nx;
      cy = ny;
      continue;
    }
    if (nid === EMBER.id) break; // crossed a sibling spark: stop short this tick, fly on next
    if (nid === WATER.id || nid === SALTWATER.id) {
      sim.set(x, y, EMPTY); // quenched — no flame, no steam, just gone
      return;
    }
    shatter(sim, x, y, cx, cy); // anything else — solid, powder, fire, blast — ends the flight
    return;
  }

  // Clear flight: settle at the final cell with one tick of life spent.
  if (cx !== x || cy !== y) {
    sim.set(x, y, EMPTY);
    sim.spawn(cx, cy, EMBER.id);
  }
  sim.setTemp(cx, cy, encodeEmber(st.life - 1, vxQ, vyQ));
}

export const EMBER = register({
  id: 18,
  name: 'Ember',
  phase: Phase.Gas,
  color: rgb(255, 200, 90),
  density: 1,
  // conductivity 0 is load-bearing, exactly as in Blast: the heat pass leaves
  // `temp` alone so it can hold the packed life+velocity state. init 0
  // decodes to life 0 → an ember placed without launchEmber dies quietly on
  // its first turn instead of flying with garbage velocity.
  thermal: { init: 0, conductivity: 0 },
  update: updateEmber,
});
