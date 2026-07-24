import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { GLASS } from './glass';
import { BROKEN_GLASS } from './brokenglass';
import { MERCURY } from './mercury';

// Heat Ray — the laser beam a powered Laser emitter fires (see laser.ts). It
// borrows the Nuclear Ray's *flight* (nuclearray.ts): packed per-cell state in
// `temp`, dead-straight travel along one of the 8 compass directions at constant
// speed, no gravity, reflecting off Wall and the grid boundary. But where a
// Nuclear Ray is a wrecking beam that shreds terrain, a Heat Ray has **no
// destructive power at all** — it never removes a cell. Its whole effect is
// *heat*, delivered where it lands:
//   • Solids / powders it can't see through STOP it: it dumps heat into the
//     struck cell (and splashes a little into the neighbours) and mirror-reflects
//     away, scorching what it hits instead of smashing it. So a beam trained on a
//     wall slowly cooks it — igniting, melting, boiling — without ever breaking it.
//   • Glass and Broken Glass are TRANSPARENT: the beam passes straight through a
//     pane, untouched, like clear air.
//   • Mercury is a MIRROR: the beam reflects off a Mercury surface cleanly (no
//     random scatter), so a puddle of Mercury aims the beam — build reflector
//     mazes with it.
//   • Gases SCATTER it: the beam flows through a gas cloud, and each cell it
//     crosses it has a small chance to jink one 45° step (산란) — a beam through
//     smoke frays slightly instead of staying a razor line.
//   • Liquids REFRACT and ABSORB it: crossing a liquid boundary bends the beam by
//     a fixed step (경계면 굴절), and every liquid cell it travels through it may
//     be absorbed (확률적 소멸) — when it dies in the liquid it dumps its heat into
//     that cell, so a beam played across water boils it away cell by cell.
//
// Reflections here are CLEAN mirrors (unlike the Nuclear Ray's chaotic scatter),
// so a Heat Ray is a predictable, buildable beam — the point of a laser toy.
//
// As with the Nuclear Ray / Ember / Blast, the packed per-cell state (remaining
// life + flight direction) lives in `temp` with conductivity 0 so the heat pass
// leaves it alone: packed = life·16 + (vx+1)·3 + (vy+1), with vx,vy ∈ {-1,0,1}.
const SPEED_ORTH = 3; // cells per tick along an axis…
const SPEED_DIAG = 2; // …and per diagonal step (≈ 3/√2, so speed reads uniform)
const LIFE_MIN = 90;
const LIFE_VAR = 40; // 90..129 ticks — a couple of screen-crossings' worth
// Heat dumped into a solid the beam strikes (파괴 없이 가열), and the smaller
// splash into each non-empty neighbour of that impact so a near-miss warms too.
const IMPACT_HEAT = 140;
const SPLASH_HEAT = 45;
// Heat left behind when the beam is absorbed inside a liquid cell (사라질 때 가열).
const VANISH_HEAT = 130;
// Per-gas-cell chance the beam jinks one 45° step as it passes through (산란).
const GAS_SCATTER_CHANCE = 0.06;
// Per-liquid-cell chance the beam is absorbed and dies there (확률적 소멸).
const LIQUID_VANISH_CHANCE = 0.22;
// Extra life a beam burns each time it reflects, on top of the −1 every ray pays
// per tick — so a beam trapped ricocheting in a pocket drains fast instead of
// lingering its whole life (mirrors nuclearray.ts's BOUNCE_LIFE_COST).
const BOUNCE_LIFE_COST = 10;
// Pins the beam white-hot in the heat-overlay thermal camera (its `temp` holds
// packed flight state, not a real reading) — same trick the Nuclear Ray uses.
const OVERLAY_TEMP = 1600;

// The 8 compass directions in clockwise ring order, so a reflection/refraction
// can be rotated by a whole number of 45° steps.
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
  return 0; // unreachable: every rotate() caller passes a unit 8-direction
}

/** Rotate a unit direction by `k` 45° steps around the compass ring. */
function rotate(vx: number, vy: number, k: number): [number, number] {
  const [rx, ry] = DIR_RING[(ringIndexOf(vx, vy) + k + 8) % 8];
  return [rx, ry];
}

function encodeRay(life: number, vx: number, vy: number): number {
  return life * 16 + (vx + 1) * 3 + (vy + 1);
}

/** True if the ray could fly into (x,y) — used to pick which axis a mirror bounce
 *  flips and to keep a gas scatter pointed at open space. */
function isOpen(sim: SimContext, x: number, y: number): boolean {
  return sim.inBounds(x, y) && sim.isEmpty(x, y);
}

/** A glass pane the beam sees straight through (유리·깨진유리 투과). */
function isTransparent(nid: number): boolean {
  return nid === GLASS.id || nid === BROKEN_GLASS.id;
}

/** Clean mirror reflection off a surface the beam hit while at (cx,cy) heading
 *  (vx,vy): a glancing diagonal flips only the blocked axis, a head-on/corner hit
 *  reverses. Unlike the Nuclear Ray's bounce there is NO random scatter — a Heat
 *  Ray reflects predictably so Mercury mirrors and walls aim it. */
function mirror(sim: SimContext, cx: number, cy: number, vx: number, vy: number): [number, number] {
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
  return [bvx, bvy];
}

/** A small random jink as the beam crosses a gas cell: rotate ±1 step, keeping to
 *  open space where possible so the scattered beam actually leaves the cell. */
function gasScatter(sim: SimContext, cx: number, cy: number, vx: number, vy: number): [number, number] {
  const s = sim.chance(0.5) ? 1 : -1;
  let [rx, ry] = rotate(vx, vy, s);
  if (isOpen(sim, cx + rx, cy + ry)) return [rx, ry];
  [rx, ry] = rotate(vx, vy, -s);
  if (isOpen(sim, cx + rx, cy + ry)) return [rx, ry];
  return [vx, vy];
}

/** Deposit the beam's heat where it strikes a solid: warm the struck cell and
 *  splash a little into each non-empty neighbour, so a near-miss cooks too. Skips
 *  a `packedTemp` cell (its `temp` is packed flight state, not a reading) and a
 *  zero-conductivity insulator (Wall, Aerogel) — the same guard nuclearray.ts's
 *  scorch uses. Purely additive: the Heat Ray never removes a cell. */
function heatImpact(sim: SimContext, x: number, y: number): void {
  const id = sim.get(x, y);
  const m = getMaterial(id);
  if (!(m.packedTemp || m.thermal?.conductivity === 0)) {
    sim.setTemp(x, y, sim.getTemp(x, y) + IMPACT_HEAT);
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) continue;
    const nm = getMaterial(nid);
    if (nm.packedTemp || nm.thermal?.conductivity === 0) continue;
    sim.setTemp(nx, ny, sim.getTemp(nx, ny) + SPLASH_HEAT);
  }
}

/** Spawn a Heat Ray beam cell at (x,y) flying along the unit direction
 *  (dirX,dirY) — called by a powered Laser as it fires (see laser.ts). */
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
    // Expired — or spawned without emitHeatRay (thermal.init 0 decodes to a dead,
    // direction-less ray), which dies quietly just like a hand-placed Ember.
    sim.set(x, y, EMPTY);
    return;
  }

  // Walk unit steps; every reflection consumes the step it happened on so the loop
  // always terminates. Two cursors: (wx,wy) is where the walk currently is — it may
  // sit on a transparent cell (glass, gas, liquid, a sibling beam) it is passing
  // over — while (cx,cy) is the last EMPTY cell, the only kind the beam may land on
  // when its steps run out. `inLiquid` tracks whether the walk is currently inside a
  // liquid body so a boundary crossing refracts exactly once each way.
  const steps = vx !== 0 && vy !== 0 ? SPEED_DIAG : SPEED_ORTH;
  let wx = x;
  let wy = y;
  let cx = x;
  let cy = y;
  let inLiquid = false;
  let lifeCost = 1;
  for (let s = 0; s < steps; s++) {
    const nx = wx + vx;
    const ny = wy + vy;
    if (!sim.inBounds(nx, ny)) {
      // The grid boundary mirrors in both border modes — flip whichever axis ran
      // off the edge. No scatter: a Heat Ray reflects cleanly.
      if (nx < 0 || nx >= sim.width) vx = -vx;
      if (ny < 0 || ny >= sim.height) vy = -vy;
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }
    const nid = sim.get(nx, ny);

    if (nid === EMPTY) {
      if (inLiquid) {
        [vx, vy] = rotate(vx, vy, -1); // left the liquid — refract back
        inLiquid = false;
      }
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
      continue;
    }

    // Transparent to the beam: a sibling Heat Ray, a Nuclear Ray or other packed
    // flier, or a glass pane. The walk passes over it (not landable), and stepping
    // out of a liquid into it still refracts back.
    if (nid === HEAT_RAY.id || getMaterial(nid).packedTemp || isTransparent(nid)) {
      if (inLiquid) {
        [vx, vy] = rotate(vx, vy, -1);
        inLiquid = false;
      }
      wx = nx;
      wy = ny;
      continue;
    }

    if (nid === MERCURY.id) {
      // Mercury is a mirror — reflect cleanly, no heat, nothing destroyed.
      [vx, vy] = mirror(sim, wx, wy, vx, vy);
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }

    const m = getMaterial(nid);

    if (m.phase === Phase.Gas) {
      // Flow through the gas; a small chance to scatter one step (산란).
      if (inLiquid) {
        [vx, vy] = rotate(vx, vy, -1);
        inLiquid = false;
      }
      if (sim.chance(GAS_SCATTER_CHANCE)) [vx, vy] = gasScatter(sim, wx, wy, vx, vy);
      wx = nx;
      wy = ny;
      continue;
    }

    if (m.phase === Phase.Liquid) {
      // A non-Mercury liquid: refract on entry, then risk absorption each cell.
      if (!inLiquid) {
        [vx, vy] = rotate(vx, vy, 1); // crossed into the liquid — refract
        inLiquid = true;
      }
      if (sim.chance(LIQUID_VANISH_CHANCE)) {
        // Absorbed inside the liquid — dump the beam's heat here and die.
        sim.setTemp(nx, ny, sim.getTemp(nx, ny) + VANISH_HEAT);
        sim.set(x, y, EMPTY);
        return;
      }
      wx = nx;
      wy = ny;
      continue;
    }

    // Opaque solid/powder/wall: no destruction — heat the impact and mirror away.
    heatImpact(sim, nx, ny);
    [vx, vy] = mirror(sim, wx, wy, vx, vy);
    lifeCost += BOUNCE_LIFE_COST;
  }

  // The transparent-gridlock drain (mirrors nuclearray.ts): a beam whose whole
  // step path this tick was transparent cells (a wide gas cloud, a thick pane, a
  // pack of sibling beams) advances its walk cursor yet finds no empty landing, so
  // (cx,cy) never moved. Drain it like a reflection so such a beam doesn't hang in
  // place shedding only 1 life/tick.
  if (cx === x && cy === y && lifeCost === 1 && (wx !== x || wy !== y)) {
    lifeCost += BOUNCE_LIFE_COST;
  }

  if (cx !== x || cy !== y) {
    sim.set(x, y, EMPTY);
    sim.spawn(cx, cy, HEAT_RAY.id);
  }
  sim.setTemp(cx, cy, encodeRay(Math.max(0, life - lifeCost), vx, vy));
}

export const HEAT_RAY = register({
  id: 120,
  name: 'Heat Ray',
  phase: Phase.Gas,
  color: rgb(255, 60, 150),
  density: 1,
  category: '특수',
  // conductivity 0 is load-bearing (as in Nuclear Ray/Ember/Blast): the heat pass
  // leaves `temp` alone so it can hold the packed life+direction state. init 0
  // decodes to a dead ray, so one placed by hand dies quietly on its first turn.
  thermal: { init: 0, conductivity: 0 },
  packedTemp: true,
  overlayTemp: OVERLAY_TEMP,
  update: updateHeatRay,
});
