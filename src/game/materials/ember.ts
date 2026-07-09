import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { SMOKE } from './smoke';
import { WATER } from './water';
import { SALTWATER } from './saltwater';

// Ember — the glowing ejecta a detonation hurls outward. Where Blast is the
// *shockwave* (an instant filled disc bounded to the blast radius), an Ember is
// ballistic debris: launched from the crater rim at several cells per tick,
// it flies in a nearly straight, slightly drooping line far beyond the
// destruction radius. On impact it *smashes* the first destructible cell it
// hits (one cell per ember — pockmarks, not a second crater) and may leave a
// lick of flame — which is also what lets a blast set off distant flammables
// and chain-detonate far-away explosives. The indestructible Wall and
// explosives themselves are never smashed — an ember that reaches an explosive
// shatters and drops fire beside it, so it chain-detonates the charge instead of
// silently erasing it.
//
// Velocity is stored in fixed-point quarter-cells per tick, packed together
// with the remaining flight time into the cell's `temp` (conductivity 0 makes
// the heat pass treat it as inert per-cell state — the same trick Blast uses).
const Q = 4; // fixed-point scale: 4 quarter-cells = 1 cell
const V_MAX_Q = 16; // |velocity| clamp per axis: 4 cells/tick
const V_SPAN = V_MAX_Q * 2 + 1; // encodable velocity values per axis
// Downward pull, applied only on every *other* tick of an ember's life (see
// updateEmber) for an effective 0.125 cell/tick² — enough droop that debris
// still reads as thrown rather than beamed, while keeping the flight path
// predominantly straight along its launch direction.
const GRAVITY_Q = 1;

// Launch tuning (see launchEmber): base speed 2.25–3.5 cells/tick along the
// rim's outward direction, scattered by a small per-axis jitter and a slight
// upward kick, for 12–21 ticks of flight (~0.2–0.35 s at 60 Hz). Fast enough to
// carry debris well past the crater the instant blast just carved, short enough
// that the whole burst resolves in under half a second.
const LAUNCH_SPEED_MIN_Q = 9;
const LAUNCH_SPEED_VAR_Q = 6;
const LAUNCH_JITTER_Q = 2;
const LAUNCH_UP_BIAS_Q = 1;
const LIFE_MIN = 12;
const LIFE_VAR = 10;

const IMPACT_FIRE_CHANCE = 0.5; // a smashed/struck cell ends up as flame…
const BURNOUT_SMOKE_CHANCE = 0.25; // …while burning out midair leaves a puff.

// `life` and the two velocity axes share the cell's temp as one packed float.
// Max encodable value ≈ 22·33² ≈ 24k, far inside Float32's 2^24 exact-integer
// range.
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
 * (dirX,dirY) (a unit 8-direction step — the radial outward direction of a
 * blast's rim cell). Speed, per-axis jitter, upward bias and flight time are all
 * randomized so the ring of rim cells fans out as an irregular all-directions
 * spray instead of tidy rays. Written via spawn() so it can transform any cell,
 * with the moved mark keeping that cell from being reprocessed within the same
 * tick.
 */
export function launchEmber(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  let speedQ = LAUNCH_SPEED_MIN_Q + sim.randInt(LAUNCH_SPEED_VAR_Q);
  // Diagonal launches cover √2 more ground per step; scale by ~1/√2 so the
  // spray reads as a circle, not a square with fast corners.
  if (dirX !== 0 && dirY !== 0) speedQ = (speedQ * 3) >> 2;
  const jitterSpan = LAUNCH_JITTER_Q * 2 + 1;
  const vxQ = clampV(dirX * speedQ + sim.randInt(jitterSpan) - LAUNCH_JITTER_Q);
  const vyQ = clampV(dirY * speedQ + sim.randInt(jitterSpan) - LAUNCH_JITTER_Q - LAUNCH_UP_BIAS_Q);
  sim.spawn(x, y, EMBER.id);
  sim.setTemp(x, y, encodeEmber(LIFE_MIN + sim.randInt(LIFE_VAR), vxQ, vyQ));
}

/** Flight ended against something it can't smash (Wall, an explosive, the
 *  container edge, fire/blast): the spark shatters at (cx,cy), the last open
 *  cell on its path (adjacent to whatever it hit), sometimes leaving flame
 *  there — the handoff that lets the existing Fire rules ignite the obstacle
 *  or trigger the adjacent explosive. */
function shatter(sim: SimContext, x: number, y: number, cx: number, cy: number): void {
  if (sim.chance(IMPACT_FIRE_CHANCE)) {
    sim.spawn(cx, cy, FIRE.id);
    if (cx !== x || cy !== y) sim.set(x, y, EMPTY);
  } else {
    sim.set(x, y, EMPTY);
  }
}

/** Flight ended against a destructible cell: the impact destroys it — one
 *  cell per ember, so debris pockmarks the surroundings without carving a
 *  second crater — leaving flame or clear air where it struck. Writing the
 *  struck neighbor is spawn()-marked (fire) or an EMPTY write, both safe
 *  against same-tick reprocessing. */
function smash(sim: SimContext, x: number, y: number, nx: number, ny: number): void {
  if (sim.chance(IMPACT_FIRE_CHANCE)) sim.spawn(nx, ny, FIRE.id);
  else sim.set(nx, ny, EMPTY);
  sim.set(x, y, EMPTY);
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
  // Gravity only bites on alternate ticks (life decrements every tick, so
  // parity alternates) — half-rate droop that keeps the flight mostly
  // straight without a fractional-velocity field.
  const vyQ = (st.life & 1) === 0 ? clampV(st.vyQ + GRAVITY_Q) : st.vyQ;
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
      // Open air (including the fresh crater the blast just cleared): keep flying.
      cx = nx;
      cy = ny;
      continue;
    }
    if (nid === EMBER.id) break; // crossed a sibling spark: stop short this tick, fly on next
    if (nid === WATER.id || nid === SALTWATER.id) {
      sim.set(x, y, EMPTY); // quenched — no flame, no steam, just gone
      return;
    }
    const m = getMaterial(nid);
    // Wall and explosion-proof solids (Diamond) are indestructible, explosives
    // are left intact so a stray ember can chain-detonate them via the fire it
    // drops rather than silently erasing them, and gases (fire, smoke, the blast
    // flash itself) aren't terrain to smash — those just end the flight.
    if (m.isWall || m.explosionProof || m.explosive || m.phase === Phase.Gas) {
      shatter(sim, x, y, cx, cy);
    }
    else smash(sim, x, y, nx, ny); // sand, stone, plants, … — punch out the struck cell
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
  category: '불·열',
  // conductivity 0 is load-bearing, exactly as in Blast: the heat pass leaves
  // `temp` alone so it can hold the packed life+velocity state. init 0
  // decodes to life 0 → an ember placed without launchEmber dies quietly on
  // its first turn instead of flying with garbage velocity.
  thermal: { init: 0, conductivity: 0 },
  update: updateEmber,
});
