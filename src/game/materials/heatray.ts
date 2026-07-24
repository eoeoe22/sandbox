import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { AMBIENT_TEMP } from '../config';
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
//     pane *as if it weren't there at all* — travelling at the same speed it does
//     through open air (유리가 없는 것처럼 투과), so you watch it cross a pane cell by
//     cell instead of teleporting to the far side. It can even come to rest inside
//     a thick pane: a beam cell carries the pane it sits on in its own `aux` byte
//     and puts it right back when it moves off (see updateHeatRay), so the glass is
//     never actually disturbed — a 가루/액체 겹침-style share of the cell.
//   • Reflective metals (Mercury, Iron, Heatpipe, Gallium, Liquid Gallium — any
//     material flagged `laserReflective`) are MIRRORS: the beam reflects off them
//     cleanly (정반사, no scatter), so a metal surface aims the beam. New shiny
//     metals become mirrors just by setting the flag — no change here needed.
//   • Diamond is a PRISM: the beam enters the gem straight (no direction change)
//     and travels through it at normal speed just like glass; where it exits back
//     into open air it scatters into a forward-pointing fan of child beams (전방
//     부채꼴 난반사) — a diffuse spray aimed along its heading, not the old
//     all-directions starburst.
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
// A Diamond exit-fan (전방 부채꼴 난반사) seeds child beams each carrying this
// fraction of the parent's remaining life, so the sparkle decays geometrically
// gem-to-gem and can't grow without bound. Below DIFFUSE_LIFE_MIN the beam is too
// weak to sparkle and simply exits straight instead.
const DIFFUSE_LIFE_FRACTION = 0.45;
const DIFFUSE_LIFE_MIN = 3;
// The forward fan the exit spray fills: dead-ahead (seeded at the exit cell) plus
// these flanking directions, each a whole number of 45° ring steps off the beam's
// heading. The ±45° flanks always fire; the ±90° edges only sometimes, so the
// spray is densest straight ahead and thins toward the sides — a fan, not a burst.
const FAN_EDGE_CHANCE = 0.5;
const FAN_SIDE_STEPS: ReadonlyArray<readonly [number, number]> = [
  [-1, 1], // −45°, always
  [1, 1], // +45°, always
  [-2, FAN_EDGE_CHANCE], // −90°, sometimes
  [2, FAN_EDGE_CHANCE], // +90°, sometimes
];
// Extra life a beam burns each time it reflects, on top of the −1 every ray pays
// per tick — so a beam trapped ricocheting in a pocket drains fast instead of
// lingering its whole life (mirrors nuclearray.ts's BOUNCE_LIFE_COST).
const BOUNCE_LIFE_COST = 10;
// Hard cap on cells walked in one tick, so a beam crossing a very wide medium (see
// the walk loop) can't loop unbounded. Air, glass and diamond travel spend the
// SPEED budget (a beam moves through them at a fixed speed, no teleport); passing
// through the still-"free" media — gas, liquid, sibling beams — doesn't spend the
// budget, so light crosses a whole pool/cloud within the tick rather than stalling
// a cell in. This bounds that free traversal. Above any ordinary medium's width.
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

/** The Diamond exit-fan (전방 부채꼴 난반사): from the open cell (ex,ey) where the
 *  beam leaves the gem, seed a forward-pointing fan of child beams — one dead ahead
 *  at (ex,ey), plus the flanks in FAN_SIDE_STEPS (±45° always, ±90° sometimes) into
 *  whatever open cells lie that way — each carrying `childLife`. The spray stays in
 *  the beam's forward hemisphere (aimed along its heading) rather than bursting in
 *  every direction. The fractional life (DIFFUSE_LIFE_FRACTION) makes it decay
 *  gem-to-gem so it stays bounded. The caller restores the parent cell afterwards. */
function diamondForwardScatter(
  sim: SimContext,
  ex: number,
  ey: number,
  fvx: number,
  fvy: number,
  childLife: number,
): void {
  // Dead-ahead ray occupies the exit cell itself.
  sim.spawn(ex, ey, HEAT_RAY.id);
  sim.setTemp(ex, ey, encodeRay(childLife, fvx, fvy));
  for (const [k, chance] of FAN_SIDE_STEPS) {
    if (chance < 1 && !sim.chance(chance)) continue;
    const [dx, dy] = rotate(fvx, fvy, k);
    const tx = ex + dx;
    const ty = ey + dy;
    if (isOpen(sim, tx, ty)) {
      sim.spawn(tx, ty, HEAT_RAY.id);
      sim.setTemp(tx, ty, encodeRay(childLife, dx, dy));
    }
  }
}

/** Vacate the cell a beam is leaving. A beam that was riding over open air clears
 *  to EMPTY; one that was resting inside a transparent pane (glass/broken glass/
 *  diamond, carried in its `aux`) puts that pane back — resetting the cell to
 *  ambient so the beam's packed `temp` doesn't linger as a bogus reading and its
 *  own `aux` doesn't stay behind as stale state. The pane's original grain `tint`
 *  is stashed on the beam cell (see the landing in updateHeatRay) and re-applied
 *  here, because `set()` re-rolls the tint on every non-empty write — without this
 *  a pane a beam keeps crossing would shimmer/flicker as its brightness re-rolls
 *  each tick. The `hostId` guard means a corrupt/legacy aux value falls back to
 *  EMPTY rather than spawning junk. */
function restoreCell(sim: SimContext, x: number, y: number, hostId: number): void {
  if (hostId === GLASS.id || hostId === BROKEN_GLASS.id || hostId === DIAMOND.id) {
    const paneTint = sim.getTint(x, y); // the pane tint parked on the beam cell
    sim.set(x, y, hostId);
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.setAux(x, y, 0);
    sim.setTint(x, y, paneTint);
  } else {
    sim.set(x, y, EMPTY);
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
  // The transparent pane this beam cell is currently resting inside (glass, broken
  // glass or diamond), carried in `aux` so it can be put back the moment the beam
  // moves off — 0 when the beam is over open air. This is what lets the beam travel
  // through a solid pane at normal speed without ever disturbing it.
  const hostId = sim.getAux(x, y);
  if (life < 1 || (vx === 0 && vy === 0)) {
    // Expired — or spawned without emitHeatRay (thermal.init 0 decodes to a dead,
    // direction-less ray), which dies quietly just like a hand-placed Ember.
    restoreCell(sim, x, y, hostId);
    return;
  }

  // Two cursors: (wx,wy) is where the walk currently is — it may sit on a cell it
  // is only passing over (gas, liquid, a sibling/packed beam) — while (cx,cy) is
  // the last *landable* cell the beam may come to rest on when its steps run out.
  // Landable now means EMPTY air OR a *dry* transparent pane (glass/broken glass/
  // diamond): the beam moves through a pane at the same speed as air and can stop
  // inside a thick one, carrying the displaced pane in `aux` (see cHost / the
  // landing below). The one carve-out is a soaked pane (Broken Glass holding a water
  // 겹침 overlay) — the beam free-passes it instead of landing so it can't overwrite
  // and destroy the absorbed water (see the isTransparent branch).
  // `inDiamond` tracks whether the walk is currently inside a Diamond body so the
  // exit into open air fans forward (부채꼴 난반사); it's seeded from `hostId` so a
  // beam that came to rest mid-gem last tick still knows it's inside one.
  //
  // Air/glass/diamond travel spends `airSteps` (the SPEED budget) and reflections
  // consume a step too, exactly like the Nuclear Ray. Passing *through* the still-
  // free media (gas, liquid, sibling beams) doesn't spend the budget — a beam
  // crosses a whole pool/cloud within one tick (light-like) and either lands in the
  // air/pane beyond, vanishes inside a liquid, or reflects/dies at a solid past it.
  // That's what stops a beam fizzling at the surface of a pool/cloud wider than the
  // 2-3 cell step budget: the landing cursor stays valid because the whole crossing
  // resolves in one call. MAX_STEPS bounds that free traversal.
  let airSteps = vx !== 0 && vy !== 0 ? SPEED_DIAG : SPEED_ORTH;
  let wx = x;
  let wy = y;
  let cx = x;
  let cy = y;
  // The transparent pane at the current landing cell (0 = open air), stamped onto
  // the beam's aux when it finally comes to rest there.
  let cHost = hostId;
  let inDiamond = hostId === DIAMOND.id;
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
        // Leaving the gem into open air — scatter forward into a fan (전방 부채꼴
        // 난반사), provided there's enough life left to make a worthwhile sparkle.
        inDiamond = false;
        const childLife = Math.floor(Math.max(0, life - lifeCost) * DIFFUSE_LIFE_FRACTION);
        if (childLife >= DIFFUSE_LIFE_MIN) {
          diamondForwardScatter(sim, nx, ny, vx, vy, childLife);
          restoreCell(sim, x, y, hostId);
          return;
        }
        // Too weak to sparkle — fall through and just exit straight.
      }
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
      cHost = 0;
      airSteps--;
      continue;
    }

    // Sibling beams / other packed fliers: transient particles the beam can't rest
    // on, so it passes over them for free (they don't advance the landing cursor).
    if (nid === HEAT_RAY.id || getMaterial(nid).packedTemp) {
      wx = nx;
      wy = ny;
      continue;
    }

    if (nid === DIAMOND.id) {
      // Enter/continue through the gem at normal speed (landable), no direction
      // change; it fans forward on the way out (the EMPTY branch above).
      inDiamond = true;
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
      cHost = DIAMOND.id;
      airSteps--;
      continue;
    }

    if (isTransparent(nid)) {
      // Glass / Broken Glass — passed as if it weren't there: normal-speed,
      // landable travel. The beam can rest inside a thick pane, carrying it in aux.
      inDiamond = false;
      // A soaked pane (Broken Glass is a Powder that can hold a water 겹침 overlay)
      // is not landable: overwriting it to park the beam would destroy the absorbed
      // fluid (spawn can't re-host it). Pass over it for free instead, leaving the
      // wet cell — and its water — untouched. Glass/diamond never carry an overlay.
      if (sim.getOverlay(nx, ny) !== 0) {
        wx = nx;
        wy = ny;
        continue;
      }
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
      cHost = nid;
      airSteps--;
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
        restoreCell(sim, x, y, hostId);
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
    restoreCell(sim, x, y, hostId);
    return;
  }

  // Safety drain (mirrors nuclearray.ts): a beam that only ever walked over the
  // free media (gas/liquid/sibling beams) and never found a landing — a body wider
  // than MAX_STEPS — advances its walk cursor yet leaves (cx,cy) unmoved. Drain it
  // like a reflection so it can't hang in place shedding only 1 life/tick.
  if (cx === x && cy === y && lifeCost === 1 && (wx !== x || wy !== y)) {
    lifeCost += BOUNCE_LIFE_COST;
  }

  const newTemp = encodeRay(Math.max(0, life - lifeCost), vx, vy);
  if (cx !== x || cy !== y) {
    // Move: put back whatever pane the beam was resting on at the old cell, then
    // spawn the beam at the landing cell, stamping the pane it now rests inside (if
    // any) into its aux so it can be restored on the next move. When landing inside
    // a pane, grab that pane's grain tint *before* spawn overwrites the cell and
    // park it on the beam cell (aux carries the id, tint carries the shade — the
    // beam's own tint is unused for rendering), so restoreCell can hand the pane
    // back its exact brightness instead of a re-rolled one.
    restoreCell(sim, x, y, hostId);
    const paneTint = cHost !== 0 ? sim.getTint(cx, cy) : 0;
    sim.spawn(cx, cy, HEAT_RAY.id);
    sim.setTemp(cx, cy, newTemp);
    if (cHost !== 0) {
      sim.setAux(cx, cy, cHost);
      sim.setTint(cx, cy, paneTint);
    }
  } else {
    // Stayed put — the pane under it (aux/tint) is unchanged; just re-encode state.
    sim.setTemp(cx, cy, newTemp);
  }
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
