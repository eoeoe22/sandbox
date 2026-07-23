import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { AMBIENT_TEMP } from '../config';
import type { SimContext } from '../engine/SimContext';

// Fan (선풍기) — an electric appliance that turns power into a directional gust of
// wind. Like the Conveyor, which way it blows is chosen at placement time by the
// direction you *drag* the brush (컨베이어처럼 배치 방향으로 바람 방향 결정 —
// 상하좌우 4방향), recorded in the low 2 bits of each cell's `aux` byte.
//
// Powering it copies the one-way "outside → inside" electric sink the Woofer
// documents (see woofer.ts, "Reusable pattern"): the Fan is deliberately NOT
// `conductive`, so a Spark can never travel *into* or *across* it (it would turn
// a fan wall into a free wire). Instead every pulse source — a Battery in direct
// contact (battery.ts injectPulses) or a Spark relayed down a wire (spark.ts arc
// phase) — special-cases FAN.id and calls `energizeFanBody`, which floods the
// whole connected fan body (4-connected, like the Turbine/Woofer body walk) and
// stamps a *powered countdown* onto every cell at once. So current reaching any
// one face powers the entire connected structure (내부에서는 연결된 부분 전역
// 전도), and it only ever *consumes* power, never conducts it onward.
//
// The powered countdown is what keeps the gust from strobing. A Battery pulses
// only periodically (every PULSE_PERIOD ticks — see battery.ts), so if the wind
// lived for a single tick it would flicker on and off between pulses. Instead
// each pulse refreshes the countdown to POWERED_TICKS, chosen comfortably longer
// than the gap between pulses (바람이 깜빡이지 않게 지속시간을 넉넉하게), so the
// fan stays "on" continuously across the quiet ticks and only spins down a beat
// or two after power is actually cut.
//
// While the countdown is live the fan blows: each tick it projects a beam up to
// WIND_LENGTH cells ahead (길이 45픽셀 정도), shoving loose matter (powder/liquid)
// one cell downwind and stamping the empty cells of the beam into the grid's
// transient *wind field* (Grid.wind, via ctx.setWind). That field is NOT a cell/
// particle: the CA never sees it as an occupant, so it's strictly one-directional
// — it pushes matter (through the fan's own swaps) and free objects (object layer,
// applyWindPush) and drives the renderer's animated wind streaks, but nothing ever
// blocks, displaces, or "passes through" it. Simulation clears the whole field at
// the start of each step, so it vanishes the instant the fan stops (Fan이 유지하지
// 않으면 즉시 사라짐) with no per-cell lifetime bookkeeping of its own.

/** aux direction codes (low 2 bits of a Fan cell's aux). */
export const FAN_UP = 0;
export const FAN_DOWN = 1;
export const FAN_LEFT = 2;
export const FAN_RIGHT = 3;
/** Low-bit mask separating the direction from the packed powered countdown. */
const DIR_MASK = 0b11;

/** Unit blow vector for each direction code. */
const DIRV: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // up
  [0, 1], // down
  [-1, 0], // left
  [1, 0], // right
];

/** Ticks a single power pulse keeps the fan blowing. Set well above the Battery's
 *  PULSE_PERIOD (12) so the wind never lapses in the gaps between pulses — the
 *  fan spins down only a beat or two after power is genuinely cut. Fits the 6-bit
 *  countdown field (aux >> 2, ≤ 63). */
const POWERED_TICKS = 24;

/** How many cells ahead the gust reaches (≈ 45px at 1 cell/px — 길이 45픽셀). */
const WIND_LENGTH = 45;

/** Fraction of a cell's above-ambient heat the airflow carries off each tick it
 *  sits in the beam (근거리 대류 냉각). Kept small so cooling is a slow, gradual
 *  settle toward 상온 (20°C = AMBIENT_TEMP) — a fan calms a hot spot over a few
 *  seconds, it doesn't quench it (천천히 냉각). Exponential toward ambient: fast
 *  while very hot, tapering as it nears room temperature, and it never overshoots
 *  below ambient. */
const WIND_COOL_RATE = 0.03;

/** Backstop on how far one flood walks the connected fan body in a single pass —
 *  mirrors the Turbine/Woofer MAX_BODY so a giant fan wall can't make one pulse
 *  unbounded (a larger body is covered across several capped floods a tick, each
 *  memoized in SimContext.fanFlooded). */
const MAX_BODY = 256;

/** A cell the wind shoves one step downwind: loose matter — powder, liquid, or a
 *  gas. Gases are pushed here too (기체를 제대로 밀어냄): left to their own update
 *  they only rise/diffuse, so a fan blew *through* a cloud without moving it; now
 *  the beam carries the cloud along its blow direction like any other loose matter.
 *  Solids are deliberately NOT shoved: a fixed structure (a wall, a machine, a
 *  wired circuit) stays put and instead *blocks* the beam, so a fan can never walk
 *  its own battery or mount off the board (편의성 — 고정 구조물은 안 밀림). Solid
 *  *objects* (a drum, a ball) still get blown — those are handled in the object
 *  layer (engine/objects.ts applyWindPush), not here. */
function isWindPushable(id: number): boolean {
  if (id === EMPTY) return false;
  const p = getMaterial(id).phase;
  return p === Phase.Powder || p === Phase.Liquid || p === Phase.Gas;
}

/** True if the wind flows *through* this cell (empty, or any loose matter it can
 *  push — powder, liquid, gas). Anything else (a Wall, a machine, an
 *  indestructible block, any fixed solid) stops the beam. */
function isWindPassable(id: number): boolean {
  if (id === EMPTY) return true;
  return isWindPushable(id);
}

/** Convective cooling from the airflow: nudge one cell's temperature toward 상온
 *  (AMBIENT_TEMP) by WIND_COOL_RATE of the gap, but never below ambient (the wind
 *  is room-temperature air, it can't chill matter past it). A no-op on anything
 *  already at or below room temperature — the fan only ever *cools* what's hot,
 *  never warms what's cold. */
function coolInWind(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  if (t <= AMBIENT_TEMP) return;
  sim.setTemp(x, y, t - (t - AMBIENT_TEMP) * WIND_COOL_RATE);
}

/** Blow one gust from a single powered fan cell in direction `dir`: shove the
 *  loose matter in the beam one cell downwind and stamp the wind field over the
 *  empty cells of the beam (Grid.wind — a transient, one-way effect layer, never a
 *  particle; see ctx.setWind and the file header). */
function blow(fx: number, fy: number, dir: number, sim: SimContext): void {
  const [dx, dy] = DIRV[dir];

  // 1) How far the beam reaches before an immovable cell blocks it. Remember the
  //    blocking cell too — the surface the gust hits is bathed in the airflow and
  //    cooled along with the beam below.
  let reach = 0;
  let blockedX = -1;
  let blockedY = -1;
  for (let d = 1; d <= WIND_LENGTH; d++) {
    const cx = fx + dx * d;
    const cy = fy + dy * d;
    if (!sim.inBounds(cx, cy)) break;
    if (!isWindPassable(sim.get(cx, cy))) {
      blockedX = cx;
      blockedY = cy;
      break;
    }
    reach = d;
  }

  // 2) Shove pushable matter (powder/liquid/gas) one cell downwind, processed
  //    far→near so a whole column shifts forward without cells colliding (the
  //    front cell vacates first, then each cell behind steps into the gap). One
  //    step per tick, and a `hasMoved` guard, keep it from teleporting a grain
  //    the length of the beam in a single scan (컨베이어와 같은 규율).
  for (let d = reach; d >= 1; d--) {
    const cx = fx + dx * d;
    const cy = fy + dy * d;
    const id = sim.get(cx, cy);
    if (id === EMPTY || !isWindPushable(id) || sim.hasMoved(cx, cy)) continue;
    const tx = cx + dx;
    const ty = cy + dy;
    if (!sim.inBounds(tx, ty) || sim.get(tx, ty) !== EMPTY) continue; // blocked ahead
    sim.swap(cx, cy, tx, ty);
  }

  // 3) Sweep the beam: stamp the wind field over the empty (air) cells, and
  //    convectively cool any matter cell that's hotter than 상온 (coolInWind —
  //    바람 영향 범위 내 물질이 상온보다 뜨거우면 천천히 냉각). The wind field is a
  //    transient, non-cell layer (Grid.wind): the object layer reads it to shove
  //    free bodies downwind and the renderer draws the animated streaks from it,
  //    but the CA never treats it as an occupant — so it only ever *acts on*
  //    matter, never the reverse (단방향). Matter cells in the beam are left as
  //    themselves (visibly blown), not overwritten. Simulation clears the whole
  //    field each step, so no per-cell lifetime is needed here. Runs after the
  //    shove so pushed matter is cooled at whichever cell it now occupies.
  for (let d = 1; d <= reach; d++) {
    const cx = fx + dx * d;
    const cy = fy + dy * d;
    if (sim.get(cx, cy) === EMPTY) sim.setWind(cx, cy, dir);
    else coolInWind(cx, cy, sim);
  }
  // The solid surface that stopped the beam catches the airflow too.
  if (blockedX >= 0) coolInWind(blockedX, blockedY, sim);
}

function updateFan(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const timer = aux >> 2;
  if (timer <= 0) return; // idle until a pulse energizes the body
  blow(x, y, aux & DIR_MASK, sim);
  // Spin the countdown down one tick, preserving the direction bits.
  sim.setAux(x, y, ((timer - 1) << 2) | (aux & DIR_MASK));
}

/**
 * Deliver a power pulse to the connected fan body containing (sx,sy): flood it
 * through fan cells (4-connected) and refresh every cell's powered countdown to
 * POWERED_TICKS, keeping each cell's own direction bits. The one-way sink — a
 * pulse only ever *arrives* here, never leaves (see the header note) — so this
 * is inherently "outside → inside": power reaching any face energizes the whole
 * structure. Memoized per tick via SimContext.fanFlooded so a body touched from
 * several faces/sources in one tick still floods exactly once. Called from the
 * pulse sources (battery.ts, spark.ts), the same way the Woofer's body pulse is.
 */
export function energizeFanBody(sim: SimContext, sx: number, sy: number): void {
  if (sim.tick !== sim.fanFloodTick) {
    sim.fanFloodTick = sim.tick;
    sim.fanFlooded.clear();
  }
  const w = sim.width;
  const startIdx = sy * w + sx;
  if (sim.fanFlooded.has(startIdx)) return;

  const seen = new Set<number>([startIdx]);
  const stack: number[] = [sx, sy];
  let count = 0;
  while (stack.length > 0 && count < MAX_BODY) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    count++;
    sim.fanFlooded.add(y * w + x);
    sim.setAux(x, y, (POWERED_TICKS << 2) | (sim.getAux(x, y) & DIR_MASK));
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== FAN.id) continue;
      const k = ny * w + nx;
      if (seen.has(k) || sim.fanFlooded.has(k)) continue;
      seen.add(k);
      stack.push(nx, ny);
    }
  }
}

export const FAN = register({
  id: 112,
  name: 'Fan',
  phase: Phase.Solid,
  // A dark machine housing with a bright light-blue rotor chevron pointing the
  // way it blows (drawn from the aux direction; brightens while powered — see
  // CanvasRenderer's windArrow path).
  color: rgb(70, 80, 95),
  lattice: rgb(150, 200, 240),
  windArrow: true,
  density: 1000,
  category: '전기',
  // Doesn't burn or corrode away underfoot, like the other electric machines.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  update: updateFan,
});
