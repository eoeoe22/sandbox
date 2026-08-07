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
//   • A PHOTOVOLTAIC material (Solar Panel — anything declaring
//     `Material.lightPulse`) CONVERTS it: the beam is swallowed on contact and
//     the material's hook runs instead of any heating, so the struck cell stays
//     cold while the panel pushes a Spark into whatever conductor touches it.
//     Checked before the opaque-solid absorb/reflect branch (but after the gas and
//     liquid ones, which no solid ever reaches), so a new light-driven SOLID opts
//     in with that one tag and nothing here changes.
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
//   • A free OBJECT body (드럼통·나무 상자·고무공·다이너마이트·섬광탄 — the rigid
//     bodies of engine/objects.ts) also ABSORBS it, exactly like an opaque solid:
//     the beam stops at the body and its heat goes into that body's own reservoir,
//     so a laser trained on a crate cooks it (녹이거나 태우거나 유폭시킨다) and never
//     reaches whatever is behind it. Objects live *beside* the grid, so this one
//     can't be resolved in the walk below — the beam has no way to see them. The
//     object layer reads the grid instead (the direction every object↔cell
//     interaction runs in) and calls `absorbHeatRayCell` on any beam cell resting
//     inside its footprint; see objects.ts footprintHazards.
//
// The clean reflections here are true mirrors (unlike the Nuclear Ray's chaotic
// scatter), so a Heat Ray is a predictable, buildable beam — the point of a laser
// toy — while the rough 난반사 off ordinary solids adds a little spray.
//
// As with the Nuclear Ray / Ember / Blast, the packed per-cell state (remaining
// life + flight direction) lives in `temp` with conductivity 0 so the heat pass
// leaves it alone: packed = life·16 + (vx+1)·3 + (vy+1), with vx,vy ∈ {-1,0,1}.
//
// ## Speed and the afterimage tail (레이저다운 즉시성)
//
// A beam used to crawl: 3 cells a tick, which at the ×1 pace is 90 cells/s, so a
// shot took the better part of four seconds to cross the board and read as a slow
// bullet rather than as light. It now flies at SPEED_ORTH below — fast enough that
// a shot lands almost as soon as you fire it.
//
// Speed alone would have made it *less* visible, not more: one bright cell hopping
// ten at a time is a strobing dot with nine dark cells behind it. So the walk
// leaves an AFTERIMAGE (잔상) in every open-air cell it crosses — an ordinary Heat
// Ray cell whose packed life is 0, which does nothing but sit there and expire on
// its next turn. The line from muzzle to impact is drawn out of the cells the beam
// genuinely travelled through, so it reads as a continuous beam while remaining,
// physically, the single travelling particle it always was.
//
// Neither change touches how much a laser heats. Life is now a DISTANCE budget
// (cells of open travel) rather than a countdown of ticks, so the beam reaches
// exactly as far as it used to — it just gets there sooner. And the emitter still
// fires one beam per tick, each of which still crosses its path exactly once and
// deposits exactly one IMPACT_HEAT where it lands, so a wall under a steady beam
// cooks at precisely the rate it did before.
const SPEED_ORTH = 10; // cells per tick along an axis…
const SPEED_DIAG = 7; // …and per diagonal step (≈ 10/√2, so speed reads uniform)
// Life is a budget of CELLS TRAVELLED, not of ticks (it used to be the latter,
// which meant every change to SPEED silently rescaled every beam's range). At the
// old 90..129 ticks × 3 cells a tick this is the same 270..389 cells of reach.
const LIFE_MIN = 270;
const LIFE_VAR = 120;
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
const DIFFUSE_LIFE_MIN = 9; // in cells (was 3 ticks × 3 cells a tick)
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
// Extra life a beam burns each time it reflects, on top of the 1 it pays per cell
// travelled — so a beam trapped ricocheting in a pocket drains fast instead of
// lingering its whole life (mirrors nuclearray.ts's BOUNCE_LIFE_COST). In cells,
// like the life budget itself: the old 10 ticks bought 30 cells of travel.
const BOUNCE_LIFE_COST = 30;
// Hard cap on cells walked in one tick, so a beam crossing a very wide medium (see
// the walk loop) can't loop unbounded. Air, glass and diamond travel spend the
// SPEED budget (a beam moves through them at a fixed speed, no teleport); passing
// through the still-"free" media — gas, liquid, sibling beams — doesn't spend the
// budget, so light crosses a whole pool/cloud within the tick rather than stalling
// a cell in. This bounds that free traversal. Above any ordinary medium's width.
const MAX_STEPS = 96;
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

/**
 * Is (x,y) an AFTERIMAGE — one of the spent trail cells the walk leaves behind to
 * draw the beam line (see the header)? Encoded as a Heat Ray cell whose packed
 * life is 0, which `updateHeatRay` already treats as "expired, vacate quietly", so
 * the tail costs no new material id and no new state machine.
 *
 * Afterimages are laid ONLY over cells that were open air, so one always means
 * exactly "air that happens to be glowing" — never a glass pane in disguise. That
 * is what lets every reader below treat it as air without also having to carry a
 * host material around: the walk lands on it, a mirror aims through it, and
 * `restoreCell` clears it to EMPTY. The visible cost is a one- or two-cell gap in
 * the drawn line where the beam crosses a pane, which reads as refraction rather
 * than as a bug.
 *
 * Life 0 alone is NOT enough to recognise one, which is the subtle half. A live
 * head that comes to rest inside a pane and spends the last of its life there is
 * written back as a life-0 cell that still carries the pane in `aux`, waiting for
 * its own next turn to put the glass back — by packing alone it is identical to an
 * afterimage. Reading it as one hands a following beam a cell it believes is air,
 * which it lands on with `cHost` 0 and thereby deletes the pane. So the aux check
 * is what actually enforces "afterimage ⇒ air": aux 0 means no pane is being held
 * here, and `layAfterimage` writes that 0 explicitly for exactly this reason.
 */
export function isHeatRayAfterimage(sim: SimContext, x: number, y: number): boolean {
  if (!sim.inBounds(x, y) || sim.get(x, y) !== HEAT_RAY.id) return false;
  if (sim.getAux(x, y) !== 0) return false; // an expiring head still holding a pane
  return ((sim.getTemp(x, y) | 0) >> 4) === 0;
}

/** Leave an afterimage in the open-air cell (x,y), heading (vx,vy) so the object
 *  layer can follow the line it belongs to (see absorbHeatRayCell). `spawn` marks
 *  it moved, so it survives the tick it is laid in and expires on its next turn. */
function layAfterimage(sim: SimContext, x: number, y: number, vx: number, vy: number): void {
  sim.spawn(x, y, HEAT_RAY.id);
  sim.setTemp(x, y, encodeRay(0, vx, vy));
  sim.setAux(x, y, 0);
}

/** True if the ray could fly into (x,y) — used to pick which axis a mirror bounce
 *  flips and to keep a gas scatter pointed at open space. An afterimage counts as
 *  open: it is this beam's own tail, and a mirror that refused to aim through it
 *  would bounce differently depending on where the last shot happened to be. */
function isOpen(sim: SimContext, x: number, y: number): boolean {
  return sim.inBounds(x, y) && (sim.isEmpty(x, y) || isHeatRayAfterimage(sim, x, y));
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

/**
 * The beam is gone from (x,y) — either it moved on or it died here. Draw
 * everything it crossed this tick as afterimages (the beam line), then vacate the
 * cell it was sitting in: an open-air one becomes the tail's last link, a
 * transparent pane is simply put back.
 *
 * `cx,cy` is the last landable cell the walk reached. On a death it is passed so
 * the line runs all the way to where the beam actually stopped; on a move the
 * caller passes the origin for it, because that cell is about to hold the live
 * beam head rather than a spent afterimage.
 */
function endBeamAt(
  sim: SimContext,
  x: number,
  y: number,
  hostId: number,
  cx: number,
  cy: number,
  cHost: number,
  trailX: number[],
  trailY: number[],
  vx: number,
  vy: number,
): void {
  if ((cx !== x || cy !== y) && cHost === 0) {
    trailX.push(cx);
    trailY.push(cy);
  }
  for (let i = 0; i < trailX.length; i++) layAfterimage(sim, trailX[i], trailY[i], vx, vy);
  // The origin is never in `trailX/Y` (the first push happens while the landing
  // cursor still sits on it, and is guarded out), so it is laid exactly once here.
  if (hostId === 0) layAfterimage(sim, x, y, vx, vy);
  else restoreCell(sim, x, y, hostId);
}

/** Vacate the cell a beam is leaving. A beam that was riding over open air clears
 *  to EMPTY; one that was resting inside a transparent pane (glass/broken glass/
 *  diamond, carried in its `aux`) puts that pane back — resetting the cell to
 *  ambient so the beam's packed `temp` doesn't linger as a bogus reading and its
 *  own `aux` doesn't stay behind as stale state. The `hostId` guard means a
 *  corrupt/legacy aux value falls back to EMPTY rather than spawning junk. */
function restoreCell(sim: SimContext, x: number, y: number, hostId: number): void {
  if (hostId === GLASS.id || hostId === BROKEN_GLASS.id || hostId === DIAMOND.id) {
    sim.set(x, y, hostId);
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.setAux(x, y, 0);
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

/**
 * Absorb the Heat Ray beam cell at (x,y) on behalf of something the beam struck
 * that does NOT live on the grid — a free rigid body (engine/objects.ts). The
 * cell is vacated exactly as when the beam moves off it (putting back any
 * transparent pane it was resting inside, so the glass is never disturbed), and
 * the heat one strike carries is RETURNED for the caller to deposit into whatever
 * it hit, rather than written to the grid: an object's heat lives in its own
 * reservoir (`SimBody.temp`), not in a cell.
 *
 * Returns 0 — and touches nothing — if (x,y) doesn't hold a beam, so a caller may
 * probe cells freely. This is the single seam through which the object layer sees
 * the beam, which keeps the strike's heat (IMPACT_HEAT) defined in exactly one
 * place for grid and objects alike.
 */
export function absorbHeatRayCell(sim: SimContext, x: number, y: number): number {
  if (!sim.inBounds(x, y) || sim.get(x, y) !== HEAT_RAY.id) return 0;
  // Wipe the whole beam LINE through this cell, not just the cell: walk out both
  // ways along its heading, clearing the run of beam cells (head and afterimages
  // alike) that the body is standing in the middle of.
  //
  // Both halves of that matter. Forward, it is what makes a body block the beam
  // again now that a shot covers SPEED_ORTH cells a tick: the walk can't see
  // objects (they don't live on the grid), so it lays its line straight through a
  // crate, and without this the laser would visibly shine out of the far side.
  // Backward, it is what keeps the STRENGTH honest — `footprintHazards` sums this
  // function over every cell of the footprint, so a body lying across eight cells
  // of beam would otherwise collect eight strikes' worth of heat per tick where it
  // used to collect one. Clearing the run means the first cell found reports the
  // strike and the rest of the footprint finds nothing left to report.
  const [vx, vy] = decodeRayDir(sim.getTemp(x, y) | 0);
  eraseBeamRun(sim, x, y, vx, vy);
  return IMPACT_HEAT;
}

/** Unpack a packed ray's flight direction (see encodeRay). */
function decodeRayDir(packed: number): [number, number] {
  const code = packed & 15;
  return [((code / 3) | 0) - 1, (code % 3) - 1];
}

/**
 * Clear exactly ONE beam — the one occupying (x,y) — putting back any transparent
 * pane each of its cells was resting in.
 *
 * "Exactly one" is the whole difficulty, because a firing Laser puts a beam on the
 * line every tick and each of them is a run of afterimages led by a live head, so
 * the cells from muzzle to target are one unbroken stretch of Heat Ray with no gap
 * to separate them by. The packing does separate them, though: within a beam the
 * head is at the FRONT of its own tail, so walking backwards along the flight
 * direction, the first live cell (life > 0) met is the head of the beam *behind*
 * this one. That is the boundary.
 *
 *   • backwards — erase afterimages, and stop *at* a live head without taking it.
 *   • forwards — erase through, and stop *after* taking the first live head, which
 *     is this beam's own.
 *
 * Getting that boundary right is not cosmetic, it is conservation. Every beam this
 * erases is one the emitter already paid for, and the caller charges the body for
 * exactly one strike, so over-erasing silently throws away heat that was in
 * flight: an earlier draft cleared the entire stretch in both directions, which
 * emptied the pipeline on every hit and dropped a held beam's heating to one
 * strike per flight-time instead of one per tick (a drum that used to melt open
 * stalled at 791°). Under-erasing is the opposite failure — leftover cells past
 * the body let the beam shine out of its far side, and leftovers inside the
 * footprint each bill the body for another strike.
 *
 * Bounded by MAX_RUN so a pathological line can't make one absorption walk the
 * whole board. A direction-less packing (a hand-placed beam) clears just its cell.
 */
const MAX_RUN = 512;
function eraseBeamRun(sim: SimContext, x: number, y: number, vx: number, vy: number): void {
  const live = (cx: number, cy: number): boolean => ((sim.getTemp(cx, cy) | 0) >> 4) > 0;
  const hitLive = live(x, y);
  restoreCell(sim, x, y, sim.getAux(x, y));
  if (vx === 0 && vy === 0) return;
  // Forwards: through this beam's remaining tail and its head, then stop. If the
  // cell we were handed WAS the head, there is nothing of this beam ahead of it.
  if (!hitLive) {
    let cx = x;
    let cy = y;
    for (let n = 0; n < MAX_RUN; n++) {
      cx += vx;
      cy += vy;
      if (!sim.inBounds(cx, cy) || sim.get(cx, cy) !== HEAT_RAY.id) break;
      const wasHead = live(cx, cy);
      restoreCell(sim, cx, cy, sim.getAux(cx, cy));
      if (wasHead) break;
    }
  }
  // Backwards: this beam's own tail only — a live cell there belongs to the next
  // beam down the line, which is still in flight and must be left alone.
  let bx = x;
  let by = y;
  for (let n = 0; n < MAX_RUN; n++) {
    bx -= vx;
    by -= vy;
    if (!sim.inBounds(bx, by) || sim.get(bx, by) !== HEAT_RAY.id) break;
    if (live(bx, by)) break;
    restoreCell(sim, bx, by, sim.getAux(bx, by));
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
  // Landable now means EMPTY air OR a transparent pane (glass/broken glass/diamond):
  // the beam moves through a pane at the same speed as air and can stop inside a
  // thick one, carrying the displaced pane in `aux` (see cHost / the landing below).
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
  // Open-air cells the landing cursor passed THROUGH on its way to the cell it
  // finally rests in — the beam's drawn tail (see the header's afterimage note).
  // Collected rather than stamped as we go because the walk may still turn out to
  // die mid-flight (absorbed in a liquid, swallowed by a Solar Panel, fanned out
  // of a Diamond), and in those cases the tail has to stop where the beam did
  // instead of running on to wherever the cursor had reached.
  const trailX: number[] = [];
  const trailY: number[] = [];
  // The transparent pane at the current landing cell (0 = open air), stamped onto
  // the beam's aux when it finally comes to rest there.
  let cHost = hostId;
  let inDiamond = hostId === DIAMOND.id;
  // Life is spent per CELL TRAVELLED, not per tick (see LIFE_MIN): each budgeted
  // step costs 1 and each reflection costs BOUNCE_LIFE_COST, so a beam's range in
  // cells is the same number whatever SPEED is set to.
  let lifeCost = 0;
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

    // An afterimage is this beam family's own spent tail, and to the walk it is
    // simply air: landable, budget-spending, and overwritten when landed on. It
    // must NOT fall through to the sibling-beam branch below — that one passes for
    // free without advancing the landing cursor, so a beam following the line a
    // moment behind another would ride its predecessor's tail at no cost and
    // overshoot by the whole length of it.
    if (nid === EMPTY || isHeatRayAfterimage(sim, nx, ny)) {
      if (inDiamond) {
        // Leaving the gem into open air — scatter forward into a fan (전방 부채꼴
        // 난반사), provided there's enough life left to make a worthwhile sparkle.
        inDiamond = false;
        const childLife = Math.floor(Math.max(0, life - lifeCost) * DIFFUSE_LIFE_FRACTION);
        if (childLife >= DIFFUSE_LIFE_MIN) {
          diamondForwardScatter(sim, nx, ny, vx, vy, childLife);
          endBeamAt(sim, x, y, hostId, cx, cy, cHost, trailX, trailY, vx, vy);
          return;
        }
        // Too weak to sparkle — fall through and just exit straight.
      }
      // Only an OPEN-AIR landing cell joins the drawn tail. `cHost !== 0` means the
      // cursor is standing inside a transparent pane (glass/broken glass/diamond),
      // and an afterimage there would overwrite the pane with a cell whose aux is 0
      // — i.e. delete it. That is not hypothetical: it is precisely how a beam
      // crossing a window used to eat the whole row it passed through, since the
      // pane is *never* the cell the walk started on and so nothing else put it
      // back. Skipping the push leaves the pane exactly as it was (the walk only
      // reads the cells it crosses) at the cost of a short gap in the drawn line
      // where the beam is inside glass — the refraction-looking gap the header
      // describes, and the reason the "afterimage ⇒ air" invariant holds.
      if ((cx !== x || cy !== y) && cHost === 0) {
        trailX.push(cx);
        trailY.push(cy);
      }
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
      cHost = 0;
      airSteps--;
      lifeCost++;
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
      lifeCost++;
      continue;
    }

    if (isTransparent(nid)) {
      // Glass / Broken Glass — passed as if it weren't there: normal-speed,
      // landable travel. The beam can rest inside a thick pane, carrying it in aux.
      inDiamond = false;
      wx = nx;
      wy = ny;
      cx = nx;
      cy = ny;
      cHost = nid;
      airSteps--;
      lifeCost++;
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
        endBeamAt(sim, x, y, hostId, cx, cy, cHost, trailX, trailY, vx, vy);
        return;
      }
      if (sim.chance(LIQUID_SCATTER_CHANCE)) [vx, vy] = gasScatter(sim, wx, wy, vx, vy);
      wx = nx;
      wy = ny;
      continue;
    }

    // 광전 효과: a material that *converts* the light (a Solar Panel — see
    // Material.lightPulse) fires its hook and swallows the beam whole. Checked
    // before the ordinary absorption below so it deposits NO heat at all: the
    // photons leave as electricity, not as warmth, which is the whole point of a
    // panel that can sit in a laser without cooking.
    if (m.lightPulse) {
      m.lightPulse(sim, nx, ny);
      endBeamAt(sim, x, y, hostId, cx, cy, cHost, trailX, trailY, vx, vy);
      return;
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
    endBeamAt(sim, x, y, hostId, cx, cy, cHost, trailX, trailY, vx, vy);
    return;
  }

  // Safety drain (mirrors nuclearray.ts): a beam that only ever walked over the
  // free media (gas/liquid/sibling beams) and never found a landing — a body wider
  // than MAX_STEPS — advances its walk cursor yet leaves (cx,cy) unmoved. Drain it
  // like a reflection so it can't hang in place shedding only 1 life/tick.
  if (cx === x && cy === y && lifeCost === 0 && (wx !== x || wy !== y)) {
    lifeCost += BOUNCE_LIFE_COST;
  }
  // Floor: life is spent per cell travelled, so a beam that found nowhere to go at
  // all this tick would otherwise pay nothing and hang forever. One cell a tick is
  // the same slow bleed the old per-tick accounting gave it.
  if (lifeCost === 0) lifeCost = 1;

  const newTemp = encodeRay(Math.max(0, life - lifeCost), vx, vy);
  if (cx !== x || cy !== y) {
    // Move: put back whatever pane the beam was resting on at the old cell, then
    // spawn the beam at the landing cell, stamping the pane it now rests inside (if
    // any) into its aux so it can be restored on the next move.
    // The beam's own cell and every open-air cell it passed through become the
    // drawn line; the landing cell takes the live head. `cx,cy` is passed as the
    // origin so endBeamAt doesn't also lay an afterimage there — it is about to be
    // overwritten by the head one line down either way, but laying it would push a
    // spawn the head then has to undo.
    endBeamAt(sim, x, y, hostId, x, y, cHost, trailX, trailY, vx, vy);
    sim.spawn(cx, cy, HEAT_RAY.id);
    sim.setTemp(cx, cy, newTemp);
    // Always written, not only for a pane: the landing cell may have held an
    // afterimage (aux 0) or plain air carrying a stale aux from an older occupant,
    // and a live beam must not inherit either as a phantom host to "restore".
    sim.setAux(cx, cy, cHost);
  } else {
    // Stayed put — the pane under it (aux) is unchanged; just re-encode its state.
    sim.setTemp(cx, cy, newTemp);
  }
}

export const HEAT_RAY = register({
  id: 120,
  name: 'Heat Ray',
  phase: Phase.Gas,
  color: rgb(255, 60, 150),
  density: 1,
  category: 'exotic',
  // conductivity 0 is load-bearing (as in Nuclear Ray/Ember/Blast): the heat pass
  // leaves `temp` alone so it can hold the packed life+direction state. init 0
  // decodes to a dead ray, so one placed by hand dies quietly on its first turn.
  thermal: { init: 0, conductivity: 0 },
  packedTemp: true,
  // A beam cell may be RESTING INSIDE a glass/broken-glass/diamond pane, carrying
  // it in `aux` (see updateHeatRay/restoreCell). While it does, the movement layer
  // must treat it as the solid it is covering for rather than as the gas its phase
  // says it is — otherwise a grain landing on a glass roof sinks into the beam and
  // carries the pane off with it. See Material.auxHost.
  auxHost: true,
  overlayTemp: OVERLAY_TEMP,
  update: updateHeatRay,
});
