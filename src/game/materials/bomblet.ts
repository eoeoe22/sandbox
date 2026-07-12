import { register } from './registry';
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
  type LaunchSpec,
} from './ballistic';
import { detonate } from './blast';

// Bomblet — a cluster submunition. A Cluster shell's main blast scatters a
// handful of these from its crater rim; each arcs out on a ballistic lob and
// then *detonates a small secondary crater* wherever it lands — the "쿵—포물선—
// 파바바밧" of a cluster strike, a shell that turns one bang into a scattered
// field of little ones. Like Ember/Debris it's never painted (only ever exists
// mid-flight) and shares the ballistic flight core; its own contribution is the
// go-off-on-impact landing.

const BOMBLET_LAUNCH: LaunchSpec = {
  speedMinQ: 8,
  speedVarQ: 6,
  jitterQ: 3,
  upBiasQ: 3, // a pronounced loft so they rain down over a spread, not a line
  lifeMin: 10,
  lifeVar: 12,
};
/** Reach of each submunition's secondary blast. Small — the spread, not any one
 *  crater, is the payload. computeReach(4,4) ≈ 4 cells. */
const SEED_YIELD = 4;

/** Fling a Bomblet from a cluster rim cell along its outward normal. */
export function launchBomblet(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  launchBallistic(sim, x, y, dirX, dirY, BOMBLET.id, BOMBLET_LAUNCH);
}

/** Go off: clear the bomblet's own cell (if it travelled this tick) and detonate
 *  a small blast at the last open cell (cx,cy), carving a secondary crater into
 *  whatever it hit. */
function blow(sim: SimContext, x: number, y: number, cx: number, cy: number): void {
  if (cx !== x || cy !== y) sim.set(x, y, EMPTY);
  detonate(sim, cx, cy, SEED_YIELD);
}

function updateBomblet(x: number, y: number, sim: SimContext): void {
  const st = decodeFlight(sim.getTemp(x, y));
  if (st.life < 1) {
    // Flight spent with nothing hit → an airburst right here.
    detonate(sim, x, y, SEED_YIELD);
    return;
  }
  const vxQ = st.vxQ;
  const vyQ = clampV(st.vyQ + GRAVITY_Q); // heavy lob: gravity every tick
  const dx = cellsThisTick(sim, vxQ);
  const dy = cellsThisTick(sim, vyQ);

  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  let cx = x;
  let cy = y;
  for (let s = 1; s <= steps; s++) {
    const nx = x + Math.round((dx * s) / steps);
    const ny = y + Math.round((dy * s) / steps);
    if (nx === cx && ny === cy) continue;
    if (!sim.inBounds(nx, ny)) {
      // Void edge: just leaves the world. Wall edge: goes off against it.
      if (sim.borderMode === 'void') sim.set(x, y, EMPTY);
      else blow(sim, x, y, cx, cy);
      return;
    }
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      cx = nx;
      cy = ny;
      continue;
    }
    if (nid === BOMBLET.id) break; // sibling: stop short this tick, fly on next
    // Hit terrain/liquid/an explosive → detonate its little crater right here.
    blow(sim, x, y, cx, cy);
    return;
  }

  // Clear flight (or stopped short at a sibling): advance and spend a tick.
  if (cx !== x || cy !== y) {
    sim.set(x, y, EMPTY);
    sim.spawn(cx, cy, BOMBLET.id);
  }
  sim.setTemp(cx, cy, encodeFlight(st.life - 1, vxQ, vyQ));
}

export const BOMBLET = register({
  id: 75,
  name: 'Bomblet',
  phase: Phase.Gas,
  color: rgb(74, 78, 86), // small dark submunition
  density: 1,
  category: '폭발',
  thermal: { init: 0, conductivity: 0 },
  update: updateBomblet,
});
