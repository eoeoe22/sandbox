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
import { MOLTEN_URANIUM, triggerMeltdownDecay } from './moltenuranium';
import { U238 } from './u238';
import { MOLTEN_U238 } from './moltenu238';

// Nuclear Ray — the searing beam a critical uranium mass emits (see
// moltenuranium.ts). Where an Ember is ballistic debris (drooping arc, short
// life), a Nuclear Ray is a *beam*: it flies dead straight along one of the 8
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
const URANIUM_HEAT = 800; // heat dumped into struck uranium — a hit or two melts a cold block
const SCORCH_HEAT = 400; // heat splashed into each non-empty neighbor of an impact
// How far (in 45° compass steps) a reflection may randomly deviate from the
// clean mirror angle. 2 → the ray can scatter anywhere across the ±90° arc
// facing away from the surface, so a burst never settles into tidy repeating
// billiard paths — it sprays chaotically like real debris.
const REFLECT_SPREAD = 2;
// Extra life a ray burns each time it reflects (on top of the −1 every ray
// pays per tick). A beam flying free through terrain — piercing, the main
// destructive act — pays nothing extra and crosses the whole screen; a beam
// trapped ricocheting in a corner or off the still-unburnt uranium body bounces
// every tick, so this drains it in a couple dozen ticks instead of ~200. That
// dissolves the two places rays visibly clump (screen corners and the emission
// source) without weakening the open-field sweep. Tuned so a handful of
// legitimate wall bounces over a long flight is still cheap.
const BOUNCE_LIFE_COST = 10;
// The heat-overlay thermal camera's white-hot ceiling (CanvasRenderer's
// HEAT_MAX) — pinning the ray's overlayTemp here (rather than duplicating the
// exact constant) just needs to land at/above that ceiling so it always reads
// fully white-hot, the correct look for the single hottest thing on screen.
const OVERLAY_TEMP = 1600;

// The 8 compass directions in clockwise ring order, so a reflection can be
// rotated by a whole number of 45° steps to randomize its angle.
const DIR_RING: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

function ringIndexOf(vx: number, vy: number): number {
  for (let i = 0; i < 8; i++) if (DIR_RING[i][0] === vx && DIR_RING[i][1] === vy) return i;
  return 0; // unreachable: every scatter() caller passes a unit 8-direction
}

function encodeRay(life: number, vx: number, vy: number): number {
  return life * 16 + (vx + 1) * 3 + (vy + 1);
}

/** True if the ray could fly into (x,y) — used to pick which axis a bounce
 *  flips and to bias a randomized reflection toward open space. */
function isOpen(sim: SimContext, x: number, y: number): boolean {
  return sim.inBounds(x, y) && sim.isEmpty(x, y);
}

/** Randomize a reflection angle: rotate the clean mirror direction (bvx,bvy)
 *  by a random ±REFLECT_SPREAD·45°. A rotated candidate is taken only when it
 *  points at open space from (cx,cy), so the ray actually leaves the surface;
 *  otherwise it falls back to the clean mirror, which keeps the ray sane even
 *  when it's boxed into a tight pocket. Shared by both material bounces and
 *  grid-boundary bounces so every reflection scatters. */
function scatter(sim: SimContext, cx: number, cy: number, bvx: number, bvy: number): [number, number] {
  const off = sim.randInt(REFLECT_SPREAD * 2 + 1) - REFLECT_SPREAD;
  if (off !== 0) {
    const base = ringIndexOf(bvx, bvy);
    const [rx, ry] = DIR_RING[(base + off + 8) % 8];
    if (isOpen(sim, cx + rx, cy + ry)) return [rx, ry];
    // Primary rotation is blocked (common in a corner, where it points off the
    // grid). Try the mirror rotation before giving up, so a cornered ray still
    // scatters sideways instead of always reversing straight back — reversal
    // retracing is what makes rays pile up in corners.
    const [sx, sy] = DIR_RING[(base - off + 8) % 8];
    if (isOpen(sim, cx + sx, cy + sy)) return [sx, sy];
  }
  return [bvx, bvy];
}

/** Reflect a ray that just collided with a material while at (cx,cy) heading
 *  (vx,vy). The clean mirror direction is computed first — a glancing diagonal
 *  flips only the blocked axis, a head-on/corner hit reverses — then scatter()
 *  randomizes the outgoing angle around it. */
function bounce(sim: SimContext, cx: number, cy: number, vx: number, vy: number): [number, number] {
  let bvx = -vx;
  let bvy = -vy;
  if (vx !== 0 && vy !== 0) {
    const hOpen = isOpen(sim, cx + vx, cy);
    const vOpen = isOpen(sim, cx, cy + vy);
    if (hOpen && !vOpen) {
      bvx = vx;
      bvy = -vy;
    } else if (!hOpen && vOpen) {
      bvx = -vx;
      bvy = vy;
    }
  }
  return scatter(sim, cx, cy, bvx, bvy);
}

/** The beam's ultra-high temperature, delivered at the impact point: splash
 *  heat into every non-empty neighbor of the struck cell so near-misses melt,
 *  boil and ignite. Two kinds of cell are skipped: a `packedTemp` material
 *  (Blast, Ember, a sibling ray) stores packed flight/life state in `temp`, not
 *  heat, so adding to it would corrupt the packed value; and a zero-conductivity
 *  insulator (Wall, Aerogel) sits outside the heat system and shouldn't be warmed
 *  by a splash. (Every packedTemp material also has conductivity 0 today, so the
 *  flag is redundant now — but it keeps this correct if a packed material ever
 *  carries real conductivity, the case Material.packedTemp exists to cover.) */
function scorch(sim: SimContext, x: number, y: number): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) continue;
    const m = getMaterial(nid);
    if (m.packedTemp || m.thermal?.conductivity === 0) continue;
    sim.setTemp(nx, ny, sim.getTemp(nx, ny) + SCORCH_HEAT);
  }
}

/** Spawn a freshly emitted heat ray at (x,y) flying along the unit direction
 *  (dirX,dirY) — called by critical molten uranium as it burns off. */
export function emitNuclearRay(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  sim.spawn(x, y, NUCLEAR_RAY.id);
  sim.setTemp(x, y, encodeRay(LIFE_MIN + sim.randInt(LIFE_VAR), dirX, dirY));
}

function updateHeatRay(x: number, y: number, sim: SimContext): void {
  const packed = sim.getTemp(x, y) | 0;
  const life = packed >> 4;
  const code = packed & 15;
  let vx = ((code / 3) | 0) - 1;
  let vy = (code % 3) - 1;
  if (life < 1 || (vx === 0 && vy === 0)) {
    // Expired — or spawned without emitNuclearRay (thermal.init 0 decodes to a
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
  // Life spent this tick: 1 baseline, plus BOUNCE_LIFE_COST for every reflection
  // so trapped, endlessly-ricocheting rays expire fast (see the constant).
  let lifeCost = 1;
  for (let s = 0; s < steps; s++) {
    const nx = wx + vx;
    const ny = wy + vy;
    if (!sim.inBounds(nx, ny)) {
      // The grid boundary reflects in *both* border modes — the ray bounces
      // where ordinary particles would fall out, so the sweep never leaks
      // away. Flip the axis(es) that ran off the edge for the clean mirror,
      // then scatter() randomizes the outgoing angle just like a wall hit.
      let bvx = vx;
      let bvy = vy;
      if (nx < 0 || nx >= sim.width) bvx = -vx;
      if (ny < 0 || ny >= sim.height) bvy = -vy;
      [vx, vy] = scatter(sim, wx, wy, bvx, bvy);
      lifeCost += BOUNCE_LIFE_COST;
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
    if (nid === NUCLEAR_RAY.id) {
      // Sibling rays don't interact: pass straight over (transparent, but not
      // landable — the walk cursor advances, the landing cursor doesn't).
      wx = nx;
      wy = ny;
      continue;
    }
    if (nid === URANIUM.id) {
      // Solid uranium struck by a ray flashes *straight to meltdown*: the cell
      // turns to Molten Uranium (hot, at its own init temperature) on the spot,
      // rather than needing a hit or two of conducted heat to reach the melt
      // point. spawn() marks it moved so it isn't reprocessed this tick; the ray
      // glances off. So a stray beam liquefies any uranium deposit it grazes,
      // which then self-heats toward its own criticality — chain reactions jump
      // between piles fast.
      sim.spawn(nx, ny, MOLTEN_URANIUM.id);
      [vx, vy] = bounce(sim, wx, wy, vx, vy);
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }
    if (nid === MOLTEN_URANIUM.id) {
      // Molten uranium is *fed*: the ray dumps a huge slug of heat (driving the
      // pool toward criticality) and triggers that cell's decay (see
      // triggerMeltdownDecay), so a swarm of rays burns a critical pool away
      // instead of only heating it — a big meltdown clears faster the more its
      // own rays criss-cross it. The ray glances off.
      sim.setTemp(nx, ny, sim.getTemp(nx, ny) + URANIUM_HEAT);
      triggerMeltdownDecay(sim, nx, ny);
      [vx, vy] = bounce(sim, wx, wy, vx, vy);
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }
    if (nid === U238.id) {
      // U238 is fuel too, so a ray never destroys it — it flashes straight to
      // meltdown just like U235 (a stray beam liquefies any uranium deposit it
      // grazes). The difference is downstream: Molten U238 is non-explosive, so
      // this only starts that pile cooking down toward Nuke Waste, never toward
      // a criticality of its own.
      sim.spawn(nx, ny, MOLTEN_U238.id);
      [vx, vy] = bounce(sim, wx, wy, vx, vy);
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }
    if (nid === MOLTEN_U238.id) {
      // Molten U238 is fuel as well: the ray glances off (never destroyed) and
      // dumps heat, which merely delays the pool's cooling into Nuke Waste.
      // There's no criticality or decay-burn to trigger — it isn't an explosive
      // melt — so, unlike Molten U235, a beam can't make it burn away faster.
      sim.setTemp(nx, ny, sim.getTemp(nx, ny) + URANIUM_HEAT);
      [vx, vy] = bounce(sim, wx, wy, vx, vy);
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }
    const m = getMaterial(nid);
    if (m.isWall || m.indestructible) {
      // Wall stops the beam, and so does a truly indestructible solid (Clone) —
      // the one thing besides Wall that a Nuclear Ray can't punch through (it even
      // pierces blast-proof Diamond, but not these).
      [vx, vy] = bounce(sim, wx, wy, vx, vy);
      lifeCost += BOUNCE_LIFE_COST;
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
      lifeCost += BOUNCE_LIFE_COST;
    }
  }

  // Sibling-ray gridlock (the "뭉침" a *large* U235 decay makes): rays are
  // transparent to each other but can only *land* on an EMPTY cell, so a ray
  // whose entire step path this tick was other rays — the dense pack a big
  // critical mass throws — advances its walk cursor over them yet finds no empty
  // landing (cx,cy never moved). Left alone it would just sit here shedding the
  // baseline 1 life/tick for its full ~150-tick life, so the pack lingers as a
  // stationary clump. Detect exactly that case (no landing, no bounce this tick,
  // but it did walk over siblings) and drain it like a reflection, so such
  // clumps dissolve in a couple dozen ticks instead of ~150. A ray crossing a
  // lone sibling in open space still lands in the gap beyond and is untouched.
  if (cx === x && cy === y && lifeCost === 1 && (wx !== x || wy !== y)) {
    lifeCost += BOUNCE_LIFE_COST;
  }

  if (cx !== x || cy !== y) {
    sim.set(x, y, EMPTY);
    sim.spawn(cx, cy, NUCLEAR_RAY.id);
  }
  // A ray whose life is spent (baseline + bounce penalties) is written with a
  // non-positive life, so it dies on its next turn like any expired ray.
  sim.setTemp(cx, cy, encodeRay(Math.max(0, life - lifeCost), vx, vy));
}

export const NUCLEAR_RAY = register({
  id: 66,
  name: 'Nuclear Ray',
  phase: Phase.Gas,
  color: rgb(255, 70, 40),
  density: 1,
  category: '특수',
  // conductivity 0 is load-bearing, as in Ember/Blast: the heat pass leaves
  // `temp` alone so it can hold the packed life+direction state. init 0
  // decodes to a dead ray, so one placed by hand dies quietly on its first turn.
  thermal: { init: 0, conductivity: 0 },
  packedTemp: true,
  // The beam's `temp` holds packed flight state, not a real reading (see
  // Material.packedTemp) — without this the heat-overlay thermal camera would
  // draw it as invisible background, hiding the single hottest thing on
  // screen. Pin it to the overlay's white-hot ceiling instead.
  overlayTemp: OVERLAY_TEMP,
  update: updateHeatRay,
});
