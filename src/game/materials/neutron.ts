import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { SMOKE } from './smoke';
import { STEAM } from './steam';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { URANIUM } from './uranium';
import { MOLTEN_URANIUM } from './moltenuranium';

// Neutron — the searing radiation ray a critical uranium mass emits (see
// moltenuranium.ts). Where an Ember is ballistic debris (drooping arc, short
// life), a Neutron is a *beam*: it flies dead straight along one of the 8
// directions at constant speed, never feels gravity, and lives long enough to
// cross the screen several times. It reflects off the indestructible Wall and
// off the grid boundary (even in void-border mode — the ray bounces where
// ordinary particles would fall out), so a burst fired inside a container
// ricochets around it like a pinball until its life runs out.
//
// Everything else it strikes is destroyed: usually it punches straight through
// and keeps flying (PIERCE_CHANCE), drilling a one-cell tunnel; otherwise it
// smashes the cell — sometimes leaving a lick of flame — and reflects away.
// That pierce-or-bounce coin flip is what lets a handful of critical uranium
// cells sweep an entire screen: each ray shreds a long line of terrain, and
// the bounces fan the swarm out in ever-new directions. Two exceptions:
//  • Uranium (solid or molten) is never destroyed — the ray dumps a slug of
//    heat into it and reflects, so stray neutrons push other uranium toward
//    meltdown and criticality: a chain reaction that jumps between deposits.
//  • Water (and Saltwater) absorbs the hit as a moderator: the struck cell
//    flashes to Steam and the ray always reflects, never pierces — a deep
//    enough pool is genuine radiation shielding.
//
// Like Ember/Blast, the packed per-cell state (remaining life + flight
// direction) lives in `temp` with conductivity 0 so the heat pass leaves it
// alone: packed = life·16 + (vx+1)·3 + (vy+1), with vx,vy ∈ {-1,0,1}.
const SPEED_ORTH = 3; // cells per tick along an axis…
const SPEED_DIAG = 2; // …and per diagonal step (≈ 3/√2, so speed reads uniform)
const LIFE_MIN = 90;
const LIFE_VAR = 60; // 90..149 ticks — several screen-crossings' worth
const PIERCE_CHANCE = 0.7; // destroy → fly straight on through; else reflect
const IMPACT_FIRE_CHANCE = 0.35; // a smashed (non-pierced) cell ends up aflame…
const DECAY_SMOKE_CHANCE = 0.2; // …while a ray that expires leaves a wisp.
const URANIUM_HEAT = 80; // heat dumped into a struck uranium cell (chain trigger)

function encodeNeutron(life: number, vx: number, vy: number): number {
  return life * 16 + (vx + 1) * 3 + (vy + 1);
}

/** True if the ray could fly into (x,y) — used only to pick which axis a
 *  bounce should flip, mirroring off whichever side is actually solid. */
function isOpen(sim: SimContext, x: number, y: number): boolean {
  return sim.inBounds(x, y) && sim.isEmpty(x, y);
}

/** Mirror-reflect a ray that just collided while at (cx,cy) heading (vx,vy).
 *  Diagonal flights flip only the blocked axis (glancing bounce) when exactly
 *  one of the two orthogonal neighbors is solid; head-on and corner hits
 *  reverse outright. */
function bounce(sim: SimContext, cx: number, cy: number, vx: number, vy: number): [number, number] {
  if (vx !== 0 && vy !== 0) {
    const hOpen = isOpen(sim, cx + vx, cy);
    const vOpen = isOpen(sim, cx, cy + vy);
    if (hOpen && !vOpen) return [vx, -vy];
    if (!hOpen && vOpen) return [-vx, vy];
  }
  return [-vx, -vy];
}

/** Spawn a freshly emitted neutron at (x,y) flying along the unit direction
 *  (dirX,dirY) — called by critical molten uranium as it burns off. */
export function emitNeutron(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  sim.spawn(x, y, NEUTRON.id);
  sim.setTemp(x, y, encodeNeutron(LIFE_MIN + sim.randInt(LIFE_VAR), dirX, dirY));
}

function updateNeutron(x: number, y: number, sim: SimContext): void {
  const packed = sim.getTemp(x, y) | 0;
  const life = packed >> 4;
  const code = packed & 15;
  let vx = ((code / 3) | 0) - 1;
  let vy = (code % 3) - 1;
  if (life < 1 || (vx === 0 && vy === 0)) {
    // Expired — or spawned without emitNeutron (thermal.init 0 decodes to a
    // dead, direction-less ray), which dies quietly just like a hand-placed
    // Ember does.
    if (sim.chance(DECAY_SMOKE_CHANCE)) sim.spawn(x, y, SMOKE.id);
    else sim.set(x, y, EMPTY);
    return;
  }

  // Walk unit steps; every collision (bounce or smash) consumes the step it
  // happened on, so the loop always terminates even boxed into a corner.
  const steps = vx !== 0 && vy !== 0 ? SPEED_DIAG : SPEED_ORTH;
  let cx = x;
  let cy = y;
  for (let s = 0; s < steps; s++) {
    const nx = cx + vx;
    const ny = cy + vy;
    if (!sim.inBounds(nx, ny)) {
      // The grid boundary reflects in *both* border modes — the ray bounces
      // where ordinary particles would fall out, so the sweep never leaks away.
      if (nx < 0 || nx >= sim.width) vx = -vx;
      if (ny < 0 || ny >= sim.height) vy = -vy;
      continue;
    }
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      cx = nx;
      cy = ny;
      continue;
    }
    if (nid === NEUTRON.id) break; // crossed a sibling ray: stop short, fly on next tick
    if (nid === URANIUM.id || nid === MOLTEN_URANIUM.id) {
      // Fuel is never destroyed — it's *fed*: the ray dumps heat (driving that
      // deposit toward meltdown/criticality) and glances off.
      sim.setTemp(nx, ny, sim.getTemp(nx, ny) + URANIUM_HEAT);
      [vx, vy] = bounce(sim, cx, cy, vx, vy);
      continue;
    }
    const m = getMaterial(nid);
    if (m.isWall) {
      [vx, vy] = bounce(sim, cx, cy, vx, vy);
      continue;
    }
    if (nid === WATER.id || nid === SALTWATER.id) {
      // Moderator: the struck cell flashes to steam and the ray always
      // reflects — water never lets it pierce, so pools shield what's behind.
      sim.spawn(nx, ny, STEAM.id);
      [vx, vy] = bounce(sim, cx, cy, vx, vy);
      continue;
    }
    // Everything else — including blast-proof Diamond — is destroyed. Usually
    // the ray drills straight through the fresh gap; otherwise it smashes the
    // cell (sometimes to flame) and ricochets off.
    if (sim.chance(PIERCE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      cx = nx;
      cy = ny;
    } else {
      if (sim.chance(IMPACT_FIRE_CHANCE)) sim.spawn(nx, ny, FIRE.id);
      else sim.set(nx, ny, EMPTY);
      [vx, vy] = bounce(sim, cx, cy, vx, vy);
    }
  }

  if (cx !== x || cy !== y) {
    sim.set(x, y, EMPTY);
    sim.spawn(cx, cy, NEUTRON.id);
  }
  sim.setTemp(cx, cy, encodeNeutron(life - 1, vx, vy));
}

export const NEUTRON = register({
  id: 66,
  name: 'Neutron',
  phase: Phase.Gas,
  color: rgb(190, 255, 130),
  density: 1,
  category: '특수',
  // conductivity 0 is load-bearing, as in Ember/Blast: the heat pass leaves
  // `temp` alone so it can hold the packed life+direction state. init 0
  // decodes to a dead ray, so one placed by hand dies quietly on its first turn.
  thermal: { init: 0, conductivity: 0 },
  update: updateNeutron,
});
