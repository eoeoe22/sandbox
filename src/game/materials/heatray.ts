import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { SMOKE } from './smoke';
import { STEAM } from './steam';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { URANIUM } from './uranium';
import { MOLTEN_URANIUM } from './moltenuranium';

// Heat Ray — the searing beam a critical uranium mass emits (see
// moltenuranium.ts). Where an Ember is ballistic debris (drooping arc, short
// life), a Heat Ray is a *beam*: it flies dead straight along one of the 8
// directions at constant speed, never feels gravity, and lives long enough to
// cross the screen several times. It reflects off the indestructible Wall and
// off the grid boundary (even in void-border mode — the ray bounces where
// ordinary particles would fall out), so a burst fired inside a container
// ricochets around it like a pinball until its life runs out. Sibling rays
// are transparent to each other — a beam passes straight over one it crosses,
// so two head-on rays never deadlock face to face (which they did when a
// sibling ended the flight: each blocked the other until both expired).
//
// The beam is ultra-hot, and since its `temp` slot is spent on packed flight
// state, its heat is expressed at the point of impact instead: every strike
// scorches the impact cell's surroundings (+SCORCH_HEAT into each non-empty
// neighbor), so a ray drilling through rock leaves tunnel walls hot enough to
// melt, boil, and ignite what it merely passed. Everything it strikes is
// destroyed: usually it punches straight through and keeps flying
// (PIERCE_CHANCE), drilling a one-cell tunnel; otherwise it smashes the cell
// — often leaving a lick of flame (water flashes to Steam instead) — and
// reflects away. That pierce-or-bounce coin flip is what lets a handful of
// critical uranium cells raze an entire screen: each ray shreds a long line
// of terrain, and the bounces fan the swarm out in ever-new directions. The
// one thing never destroyed is fuel: uranium (solid or molten) takes a huge
// slug of heat (+URANIUM_HEAT) as the ray glances off, so a stray beam
// rapidly drives any other uranium deposit — even one placed long after the
// blast began — to meltdown and criticality of its own: chain reactions jump
// between piles.
//
// Like Ember/Blast, the packed per-cell state (remaining life + flight
// direction) lives in `temp` with conductivity 0 so the heat pass leaves it
// alone: packed = life·16 + (vx+1)·3 + (vy+1), with vx,vy ∈ {-1,0,1}.
const SPEED_ORTH = 3; // cells per tick along an axis…
const SPEED_DIAG = 2; // …and per diagonal step (≈ 3/√2, so speed reads uniform)
const LIFE_MIN = 120;
const LIFE_VAR = 80; // 120..199 ticks — several screen-crossings' worth
const PIERCE_CHANCE = 0.75; // destroy → fly straight on through; else reflect
const IMPACT_FIRE_CHANCE = 0.5; // a smashed (non-pierced) cell ends up aflame…
const DECAY_SMOKE_CHANCE = 0.2; // …while a ray that expires leaves a wisp.
const URANIUM_HEAT = 500; // heat dumped into struck uranium — a few hits melt a cold block
const SCORCH_HEAT = 150; // heat splashed into each non-empty neighbor of an impact

function encodeRay(life: number, vx: number, vy: number): number {
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

/** The beam's ultra-high temperature, delivered at the impact point: splash
 *  heat into every non-empty neighbor of the struck cell so near-misses melt,
 *  boil and ignite. Cells whose conductivity is 0 are skipped — for those
 *  (Blast, Ember, a sibling ray) `temp` is packed private state, not heat,
 *  and adding to it would corrupt them. */
function scorch(sim: SimContext, x: number, y: number): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) continue;
    if (getMaterial(nid).thermal?.conductivity === 0) continue;
    sim.setTemp(nx, ny, sim.getTemp(nx, ny) + SCORCH_HEAT);
  }
}

/** Spawn a freshly emitted heat ray at (x,y) flying along the unit direction
 *  (dirX,dirY) — called by critical molten uranium as it burns off. */
export function emitHeatRay(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  sim.spawn(x, y, HEAT_RAY.id);
  sim.setTemp(x, y, encodeRay(LIFE_MIN + sim.randInt(LIFE_VAR), dirX, dirY));
}

function updateHeatRay(x: number, y: number, sim: SimContext): void {
  const packed = sim.getTemp(x, y) | 0;
  const life = packed >> 4;
  const code = packed & 15;
  let vx = ((code / 3) | 0) - 1;
  let vy = (code % 3) - 1;
  if (life < 1 || (vx === 0 && vy === 0)) {
    // Expired — or spawned without emitHeatRay (thermal.init 0 decodes to a
    // dead, direction-less ray), which dies quietly just like a hand-placed
    // Ember does.
    if (sim.chance(DECAY_SMOKE_CHANCE)) sim.spawn(x, y, SMOKE.id);
    else sim.set(x, y, EMPTY);
    return;
  }

  // Walk unit steps; every collision (bounce or smash) consumes the step it
  // happened on, so the loop always terminates even boxed into a corner.
  // Two cursors: (wx,wy) is where the walk currently is — it may sit on a
  // sibling ray it is passing over — while (cx,cy) is the last EMPTY cell,
  // the only kind the ray may land on when its steps run out.
  const steps = vx !== 0 && vy !== 0 ? SPEED_DIAG : SPEED_ORTH;
  let wx = x;
  let wy = y;
  let cx = x;
  let cy = y;
  for (let s = 0; s < steps; s++) {
    const nx = wx + vx;
    const ny = wy + vy;
    if (!sim.inBounds(nx, ny)) {
      // The grid boundary reflects in *both* border modes — the ray bounces
      // where ordinary particles would fall out, so the sweep never leaks away.
      if (nx < 0 || nx >= sim.width) vx = -vx;
      if (ny < 0 || ny >= sim.height) vy = -vy;
      continue;
    }
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
      continue;
    }
    if (nid === HEAT_RAY.id) {
      // Sibling rays don't interact: pass straight over (transparent, but not
      // landable — the walk cursor advances, the landing cursor doesn't).
      wx = nx;
      wy = ny;
      continue;
    }
    if (nid === URANIUM.id || nid === MOLTEN_URANIUM.id) {
      // Fuel is never destroyed — it's *fed*: the ray dumps a huge slug of
      // heat (driving that deposit toward meltdown/criticality within a few
      // hits) and glances off.
      sim.setTemp(nx, ny, sim.getTemp(nx, ny) + URANIUM_HEAT);
      [vx, vy] = bounce(sim, wx, wy, vx, vy);
      continue;
    }
    const m = getMaterial(nid);
    if (m.isWall) {
      [vx, vy] = bounce(sim, wx, wy, vx, vy);
      continue;
    }
    // Everything else — including blast-proof Diamond and water — is
    // destroyed, and the impact scorches the surroundings with the beam's
    // heat. Usually the ray drills straight through the fresh gap; otherwise
    // it smashes the cell (to flame — or steam, for water) and ricochets off.
    scorch(sim, nx, ny);
    if (sim.chance(PIERCE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
    } else {
      if (nid === WATER.id || nid === SALTWATER.id) sim.spawn(nx, ny, STEAM.id);
      else if (sim.chance(IMPACT_FIRE_CHANCE)) sim.spawn(nx, ny, FIRE.id);
      else sim.set(nx, ny, EMPTY);
      [vx, vy] = bounce(sim, wx, wy, vx, vy);
    }
  }

  if (cx !== x || cy !== y) {
    sim.set(x, y, EMPTY);
    sim.spawn(cx, cy, HEAT_RAY.id);
  }
  sim.setTemp(cx, cy, encodeRay(life - 1, vx, vy));
}

export const HEAT_RAY = register({
  id: 66,
  name: 'Heat Ray',
  phase: Phase.Gas,
  color: rgb(255, 70, 40),
  density: 1,
  category: '특수',
  // conductivity 0 is load-bearing, as in Ember/Blast: the heat pass leaves
  // `temp` alone so it can hold the packed life+direction state. init 0
  // decodes to a dead ray, so one placed by hand dies quietly on its first turn.
  thermal: { init: 0, conductivity: 0 },
  update: updateHeatRay,
});
