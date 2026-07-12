import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import {
  GRAVITY_Q,
  clampV,
  cellsThisTick,
  decodeFlight,
  encodeFlight,
  launchBallistic,
  walkFlight,
  advanceFlight,
  type LaunchSpec,
} from './ballistic';
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
// The fixed-point flight bookkeeping (velocity + life packed into `temp`, the
// conductivity-0 trick, the launch jitter) lives in ballistic.ts, shared with
// its heavier cousins Debris/Bomblet/Napalm Gel; here Ember supplies only its
// own launch tuning and its smash-on-impact behavior.

// Launch tuning (see launchBallistic): base speed 2.25–3.5 cells/tick along the
// rim's outward direction, scattered by a small per-axis jitter and a slight
// upward kick, for 12–21 ticks of flight (~0.2–0.35 s at 60 Hz). Fast enough to
// carry debris well past the crater the instant blast just carved, short enough
// that the whole burst resolves in under half a second.
const EMBER_LAUNCH: LaunchSpec = {
  speedMinQ: 9,
  speedVarQ: 6,
  jitterQ: 2,
  upBiasQ: 1,
  lifeMin: 12,
  lifeVar: 10,
};

const IMPACT_FIRE_CHANCE = 0.5; // a smashed/struck cell ends up as flame…
const BURNOUT_SMOKE_CHANCE = 0.25; // …while burning out midair leaves a puff.

/**
 * Turn the cell at (x,y) into a freshly launched ember flying outward along
 * (dirX,dirY) (a unit 8-direction step — the radial outward direction of a
 * blast's rim cell).
 */
export function launchEmber(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  launchBallistic(sim, x, y, dirX, dirY, EMBER.id, EMBER_LAUNCH);
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
  const st = decodeFlight(sim.getTemp(x, y));
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

  // The shared straight-line walk handles the flight; the ember supplies only
  // what happens where it lands (smash/shatter/quench) and how it settles.
  walkFlight(sim, x, y, cellsThisTick(sim, vxQ), cellsThisTick(sim, vyQ), {
    siblingId: EMBER.id,
    onImpact(sim, x, y, cx, cy, nx, ny, nid) {
      // A solid container edge (nx < 0) ends the flight like any obstacle.
      if (nx < 0) {
        shatter(sim, x, y, cx, cy);
        return;
      }
      if (nid === WATER.id || nid === SALTWATER.id) {
        sim.set(x, y, EMPTY); // quenched — no flame, no steam, just gone
        return;
      }
      const m = getMaterial(nid);
      // Wall, explosion-proof solids (Diamond) and truly indestructible ones
      // (Clone) can't be smashed, explosives are left intact so a stray ember
      // can chain-detonate them via the fire it drops rather than silently
      // erasing them, and gases (fire, smoke, the blast flash itself) aren't
      // terrain to smash — those just end the flight.
      if (m.isWall || m.explosionProof || m.indestructible || m.explosive || m.phase === Phase.Gas) {
        shatter(sim, x, y, cx, cy);
      } else {
        smash(sim, x, y, nx, ny); // sand, stone, plants, … — punch out the struck cell
      }
    },
    onArrive(sim, x, y, cx, cy) {
      advanceFlight(sim, x, y, cx, cy, EMBER.id, encodeFlight(st.life - 1, vxQ, vyQ));
    },
  });
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
