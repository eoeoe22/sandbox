import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { GLASS } from './glass';
import { BROKEN_GLASS } from './brokenglass';
import { DIAMOND } from './diamond';

// Heat Ray — the laser beam a powered Laser emitter fires (see laser.ts). It
// borrows the Nuclear Ray's *flight* (nuclearray.ts): packed per-cell state in
// `temp`, dead-straight travel along one of the 8 compass directions at constant
// speed, no gravity, reflecting off Wall and the grid boundary. But where a
// Nuclear Ray is a wrecking beam that shreds terrain, a Heat Ray has **no
// destructive power at all** — it never removes a cell. Its whole effect is
// *heat*, and how a cell answers the beam depends on what the cell is:
//   • Solids / powders it can't see through mostly ABSORB it: it dumps heat into
//     the struck cell (and splashes a little into the neighbours) and then, most
//     of the time, dies there — scorching what it hits without smashing it. Only
//     a small fraction of hits bounce off as a rough, scattered 난반사 reflection.
//     So a beam trained on a wall slowly cooks it (igniting, melting, boiling)
//     rather than mirroring away as a clean line.
//   • Glass and Broken Glass are TRANSPARENT: the beam passes straight through a
//     pane, untouched, like clear air.
//   • Reflective metals (Mercury, Iron, Heatpipe, Gallium, Liquid Gallium — any
//     material flagged `laserReflective`) are MIRRORS: the beam reflects off them
//     cleanly (정반사, no scatter), so a metal surface aims the beam. New shiny
//     metals become mirrors just by setting the flag — no change here needed.
//   • Diamond is a PRISM: the beam enters the gem straight, travels through it,
//     and where it exits back into open air it bursts into a starburst spraying
//     in every direction (사방으로 확산) — a sparkle of shorter-lived child beams.
//   • Gases SCATTER it: the beam flows through a gas cloud, and each cell it
//     crosses it has a small chance to jink one 45° step (산란) — a beam through
//     smoke frays slightly instead of staying a razor line.
//   • Liquids mostly let it THROUGH: the beam travels straight on through a body
//     of liquid, and only a small fraction of the cells it crosses do anything —
//     a low chance to scatter one step (산란), or a low chance to be absorbed and
//     die, dumping its heat there (가열 후 소멸). So a beam mostly bores through
//     water, warming it here and there, instead of stopping at the surface.
//
// The clean reflections here are true mirrors (unlike the Nuclear Ray's chaotic
// scatter), so a Heat Ray is a predictable, buildable beam — the point of a laser
// toy — while the rough 난반사 off ordinary solids adds a little spray.
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
// Passing through a liquid, most cells do nothing — a small fraction either jink
// one step (산란) or absorb the beam and kill it (확률적 소멸, 가열 후 소멸).
const LIQUID_SCATTER_CHANCE = 0.05;
const LIQUID_VANISH_CHANCE = 0.06;
// Striking an ordinary (non-reflective) solid: most of the time the beam is
// absorbed — it heats the spot and dies — and only this fraction of hits bounce
// off as a rough, scattered 난반사 reflection instead.
const SOLID_REFLECT_CHANCE = 0.18;
// A Diamond exit-burst (사방으로 확산) seeds child beams each carrying this
// fraction of the parent's remaining life, so the sparkle decays geometrically
// gem-to-gem and can't grow without bound. Below DIFFUSE_LIFE_MIN the beam is too
// weak to sparkle and simply exits straight instead.
const DIFFUSE_LIFE_FRACTION = 0.45;
const DIFFUSE_LIFE_MIN = 3;
// Extra life a beam burns each time it reflects, on top of the −1 every ray pays
// per tick — so a beam trapped ricocheting in a pocket drains fast instead of
// lingering its whole life (mirrors nuclearray.ts's BOUNCE_LIFE_COST).
const BOUNCE_LIFE_COST = 10;
// Hard cap on cells walked in one tick, so a beam crossing a very wide medium (see
// the walk loop) can't loop unbounded. Air travel spends the SPEED budget; passing
// through transparent media (glass, gas, liquid, sibling beams) is "free" — light
// crosses a medium within the tick rather than stalling a cell or two in — and this
// only bounds that free traversal. Comfortably above any ordinary medium's width.
const MAX_STEPS = 64;
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

/** Would a beam arriving at (x,y) reflect off it (a wall) rather than pass through
 *  or land? True for a reflective metal or an opaque solid/powder and for the grid
 *  edge; false for empty air and everything the beam sees through — glass, gas, an
 *  ordinary (non-reflective) liquid, Diamond, and sibling/packed beams. Used only
 *  to read the local surface orientation for a diagonal (45°) reflection. */
function blocksBeam(sim: SimContext, x: number, y: number): boolean {
  if (!sim.inBounds(x, y)) return true; // the grid edge acts as a wall
  const id = sim.get(x, y);
  if (id === EMPTY || id === HEAT_RAY.id || id === DIAMOND.id) return false;
  if (isTransparent(id)) return false;
  const m = getMaterial(id);
  if (m.packedTemp) return false; // a sibling beam / other packed flier
  if (m.laserReflective) return true; // a metal mirror, whatever its phase
  if (m.phase === Phase.Gas || m.phase === Phase.Liquid) return false;
  return true; // opaque solid / powder
}

/** Clean mirror reflection off a surface the beam hit while at (cx,cy) heading
 *  (vx,vy). Two families:
 *   • An orthogonally-moving beam that strikes a thin DIAGONAL edge (a 45° metal
 *     surface — its two opposite diagonal neighbours are wall, the other two open)
 *     turns 90° like a real mirror (대각선 정반사): "\\" sends → to ↓, "/" sends →
 *     to ↑. A flat wall (both diagonals wall, or neither) can't be a 45° face, so
 *     it reverses straight back as before — build a diagonal line of metal to bend
 *     a laser around a corner.
 *   • A diagonally-moving beam does a glancing reflection: it flips only the axis
 *     that's blocked, and a head-on/corner hit reverses.
 *  There is NO random scatter — a Heat Ray reflects predictably so metal mirrors
 *  and walls aim it. */
function mirror(sim: SimContext, cx: number, cy: number, vx: number, vy: number): [number, number] {
  // Orthogonal incoming: look for a 45° face to turn off, else reverse.
  if ((vx === 0) !== (vy === 0)) {
    const nx = cx + vx;
    const ny = cy + vy;
    // A true 45° face needs BOTH cells of one diagonal pair to be wall (the run of
    // the diagonal line through the hit) while the other pair is open. Requiring
    // both (not either) is what keeps a flat or chunky wall — where only a single
    // corner cell is wall — from falsely reading as a diagonal and getting turned.
    const back = blocksBeam(sim, nx - 1, ny - 1) && blocksBeam(sim, nx + 1, ny + 1); // "\" run
    const slash = blocksBeam(sim, nx - 1, ny + 1) && blocksBeam(sim, nx + 1, ny - 1); // "/" run
    if (back !== slash) {
      // A "\" face reflects (vx,vy)→(vy,vx); a "/" face reflects →(−vy,−vx).
      const rvx = back ? vy : -vy;
      const rvy = back ? vx : -vx;
      if (isOpen(sim, cx + rvx, cy + rvy)) return [rvx, rvy];
    }
    return [-vx, -vy];
  }
  // Diagonal incoming: flip only the blocked axis; head-on/corner reverses.
  let bvx = -vx;
  let bvy = -vy;
  const hOpen = isOpen(sim, cx + vx, cy);
  const vOpen = isOpen(sim, cx, cy + vy);
  if (hOpen && !vOpen) {
    bvx = vx;
    bvy = -vy;
  } else if (!hOpen && vOpen) {
    bvx = -vx;
    bvy = vy;
  }
  return [bvx, bvy];
}

/** A small random jink as the beam crosses a gas/liquid cell: rotate ±1 step,
 *  keeping to open space where possible so the scattered beam leaves the cell. */
function gasScatter(sim: SimContext, cx: number, cy: number, vx: number, vy: number): [number, number] {
  const s = sim.chance(0.5) ? 1 : -1;
  let [rx, ry] = rotate(vx, vy, s);
  if (isOpen(sim, cx + rx, cy + ry)) return [rx, ry];
  [rx, ry] = rotate(vx, vy, -s);
  if (isOpen(sim, cx + rx, cy + ry)) return [rx, ry];
  return [vx, vy];
}

/** A rough (난반사) bounce off an ordinary solid: take the clean mirror reflection,
 *  then usually nudge it one 45° step toward open space, so a beam that bounces off
 *  a rough wall sprays a little instead of returning as a razor line. */
function diffuseReflect(sim: SimContext, cx: number, cy: number, vx: number, vy: number): [number, number] {
  const [mx, my] = mirror(sim, cx, cy, vx, vy);
  if (sim.chance(0.6)) {
    const s = sim.chance(0.5) ? 1 : -1;
    let [jx, jy] = rotate(mx, my, s);
    if (isOpen(sim, cx + jx, cy + jy)) return [jx, jy];
    [jx, jy] = rotate(mx, my, -s);
    if (isOpen(sim, cx + jx, cy + jy)) return [jx, jy];
  }
  return [mx, my];
}

/** The Diamond exit-burst (사방으로 확산): from the open cell (ex,ey) where the beam
 *  leaves the gem, seed a starburst of child beams — one flying forward, and one
 *  into every open neighbour heading outward — each carrying `childLife`. The
 *  fractional life (DIFFUSE_LIFE_FRACTION) makes the spray decay gem-to-gem so it
 *  stays bounded. The caller clears the parent cell afterwards. */
function diamondBurst(sim: SimContext, ex: number, ey: number, fvx: number, fvy: number, childLife: number): void {
  sim.spawn(ex, ey, HEAT_RAY.id);
  sim.setTemp(ex, ey, encodeRay(childLife, fvx, fvy));
  for (const [dx, dy] of DIR_RING) {
    if (dx === fvx && dy === fvy) continue; // forward already seeded at (ex,ey)
    const tx = ex + dx;
    const ty = ey + dy;
    if (isOpen(sim, tx, ty)) {
      sim.spawn(tx, ty, HEAT_RAY.id);
      sim.setTemp(tx, ty, encodeRay(childLife, dx, dy));
    }
  }
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

  // Two cursors: (wx,wy) is where the walk currently is — it may sit on a
  // transparent cell (glass, gas, liquid, a Diamond, a sibling/packed beam) it is
  // passing over — while (cx,cy) is the last EMPTY cell, the only kind the beam may
  // land on when its steps run out. `inDiamond` tracks whether the walk is
  // currently inside a Diamond body so the exit into open air can burst (사방 확산).
  //
  // Air travel spends `airSteps` (the SPEED budget) and reflections consume a step
  // too, exactly like the Nuclear Ray. Passing *through* transparent media, though,
  // is FREE — it doesn't spend the air budget — so a beam crosses a medium of any
  // width within this one tick (light-like) and either lands in the air beyond,
  // vanishes inside a liquid, bursts out of a diamond, or reflects/dies at a solid
  // past it. That's what stops a beam fizzling at the surface of a pool/cloud/gem
  // wider than the 2-3 cell step budget: the landing cursor stays valid because the
  // whole crossing resolves in one call. MAX_STEPS bounds the free traversal so a
  // pathologically wide medium can't loop.
  let airSteps = vx !== 0 && vy !== 0 ? SPEED_DIAG : SPEED_ORTH;
  let wx = x;
  let wy = y;
  let cx = x;
  let cy = y;
  let inDiamond = false;
  let lifeCost = 1;
  let iter = 0;
  while (airSteps > 0 && iter < MAX_STEPS) {
    iter++;
    const nx = wx + vx;
    const ny = wy + vy;
    if (!sim.inBounds(nx, ny)) {
      // The grid boundary mirrors in both border modes — flip whichever axis ran
      // off the edge. No scatter: a Heat Ray reflects cleanly.
      if (nx < 0 || nx >= sim.width) vx = -vx;
      if (ny < 0 || ny >= sim.height) vy = -vy;
      airSteps--;
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }
    const nid = sim.get(nx, ny);

    if (nid === EMPTY) {
      if (inDiamond) {
        // Leaving the gem into open air — burst into a starburst (사방으로 확산),
        // provided there's enough life left to make a worthwhile sparkle.
        inDiamond = false;
        const childLife = Math.floor(Math.max(0, life - lifeCost) * DIFFUSE_LIFE_FRACTION);
        if (childLife >= DIFFUSE_LIFE_MIN) {
          diamondBurst(sim, nx, ny, vx, vy, childLife);
          sim.set(x, y, EMPTY);
          return;
        }
        // Too weak to sparkle — fall through and just exit straight.
      }
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
      airSteps--;
      continue;
    }

    // Transparent sibling beams/packed fliers: pass over for free
    if (nid === HEAT_RAY.id || getMaterial(nid).packedTemp) {
      wx = nx;
      wy = ny;
      continue;
    }

    // Glass / Broken Glass: pass through via 겹침 overlay layer
    if (isTransparent(nid)) {
      sim.grid.setOverlay(nx, ny, HEAT_RAY.id);
      sim.grid.overlayAux[ny * sim.width + nx] = sim.tick & 0xff;
      wx = nx;
      wy = ny;
      continue;
    }

    if (nid === DIAMOND.id) {
      // Enter the gem and travel through it for free; it bursts on the way out
      // (handled at the EMPTY branch above once inDiamond is set).
      inDiamond = true;
      wx = nx;
      wy = ny;
      continue;
    }

    const m = getMaterial(nid);

    if (m.laserReflective) {
      // A polished metal surface (Mercury, Iron, Heatpipe, Gallium, Liquid
      // Gallium, …) is a mirror — reflect cleanly, no heat, nothing destroyed.
      // Checked before the phase branches so Liquid Gallium mirrors rather than
      // absorbs like an ordinary liquid.
      [vx, vy] = mirror(sim, wx, wy, vx, vy);
      airSteps--;
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }

    if (m.phase === Phase.Gas) {
      // Flow through the gas for free; a small chance to scatter one step (산란).
      if (sim.chance(GAS_SCATTER_CHANCE)) [vx, vy] = gasScatter(sim, wx, wy, vx, vy);
      wx = nx;
      wy = ny;
      continue;
    }

    if (m.phase === Phase.Liquid) {
      // A non-reflective liquid mostly lets the beam straight through (free, so a
      // whole pool is crossed this tick). Only a small fraction of cells act: a
      // low chance to be absorbed and die here (dumping heat, 가열 후 소멸), else a
      // low chance to jink one step (산란); otherwise it passes untouched.
      if (sim.chance(LIQUID_VANISH_CHANCE)) {
        sim.setTemp(nx, ny, sim.getTemp(nx, ny) + VANISH_HEAT);
        sim.set(x, y, EMPTY);
        return;
      }
      if (sim.chance(LIQUID_SCATTER_CHANCE)) [vx, vy] = gasScatter(sim, wx, wy, vx, vy);
      wx = nx;
      wy = ny;
      continue;
    }

    // Opaque solid/powder/wall: no destruction. Heat the impact, then mostly die
    // there (대부분 가열 후 소멸); only a small fraction bounce off as a rough,
    // scattered 난반사 reflection.
    heatImpact(sim, nx, ny);
    if (sim.chance(SOLID_REFLECT_CHANCE)) {
      [vx, vy] = diffuseReflect(sim, wx, wy, vx, vy);
      airSteps--;
      lifeCost += BOUNCE_LIFE_COST;
      continue;
    }
    sim.set(x, y, EMPTY);
    return;
  }

  // Safety drain (mirrors nuclearray.ts): a beam that only ever walked over
  // transparent cells and never found an empty landing — a medium wider than
  // MAX_STEPS — advances its walk cursor yet leaves (cx,cy) unmoved. Drain it like a
  // reflection so it can't hang in place shedding only 1 life/tick.
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
