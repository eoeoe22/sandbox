import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
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
// While the countdown is live the fan blows: each tick it projects a beam of
// Wind up to WIND_LENGTH cells ahead (길이 45픽셀 정도), shoving loose matter
// (powder/liquid) and free objects that way and painting the airy trail the beam
// leaves (see WIND below). The Wind itself is purely temporary — the fan repaints
// it every tick, and it self-expires almost immediately once the fan stops
// maintaining it (Fan이 유지하지 않으면 즉시 사라짐).

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

/** How many ticks a Wind cell survives once the fan stops feeding it. The fan
 *  refreshes every trail cell to this value each tick while it blows (and marks it
 *  moved so it doesn't tick down that tick), so the whole beam stays *fully lit and
 *  steady* — no random per-cell dropout, which is what made an earlier `life`-based
 *  trail strobe. Once power is cut the cells all count down together and clear
 *  within a few ticks (Fan이 유지하지 않으면 곧바로 사라짐). Packed like the fan's
 *  own countdown (aux >> 2, direction in the low 2 bits); small, fits 6 bits. */
const WIND_TTL = 3;

/** Backstop on how far one flood walks the connected fan body in a single pass —
 *  mirrors the Turbine/Woofer MAX_BODY so a giant fan wall can't make one pulse
 *  unbounded (a larger body is covered across several capped floods a tick, each
 *  memoized in SimContext.fanFlooded). */
const MAX_BODY = 256;

/** A cell the wind pushes: loose matter only — powder or liquid. Solids are
 *  deliberately NOT pushed: a fixed structure (a wall, a machine, a wired circuit)
 *  stays put and instead *blocks* the beam, so a fan can never walk its own battery
 *  or mount off the board (편의성 — 고정 구조물은 안 밀림). Solid *objects* (a drum,
 *  a ball) still get blown — those are handled in the object layer (engine/objects.ts
 *  applyWindPush), not here. Gases drift on their own; the Wind trail (a gas) is
 *  matched by id before this is ever consulted. */
function isWindPushable(id: number): boolean {
  if (id === EMPTY) return false;
  const p = getMaterial(id).phase;
  return p === Phase.Powder || p === Phase.Liquid;
}

/** True if the wind flows *through* this cell (empty, its own Wind trail, any
 *  gas, or something it can push). Anything else (a Wall, a machine, an
 *  indestructible block) stops the beam. */
function isWindPassable(id: number): boolean {
  if (id === EMPTY || id === WIND.id) return true;
  if (getMaterial(id).phase === Phase.Gas) return true;
  return isWindPushable(id);
}

/** Blow one gust from a single powered fan cell in direction `dir`: shove the
 *  loose matter in the beam one cell downwind and paint the Wind trail. */
function blow(fx: number, fy: number, dir: number, sim: SimContext): void {
  const [dx, dy] = DIRV[dir];

  // 1) How far the beam reaches before an immovable cell blocks it.
  let reach = 0;
  for (let d = 1; d <= WIND_LENGTH; d++) {
    const cx = fx + dx * d;
    const cy = fy + dy * d;
    if (!sim.inBounds(cx, cy)) break;
    if (!isWindPassable(sim.get(cx, cy))) break;
    reach = d;
  }

  // 2) Shove pushable matter one cell downwind, processed far→near so a whole
  //    column shifts forward without cells colliding (the front cell vacates
  //    first, then each cell behind steps into the gap). One step per tick, and
  //    a `hasMoved` guard, keep it from teleporting a grain the length of the
  //    beam in a single scan (컨베이어와 같은 규율).
  for (let d = reach; d >= 1; d--) {
    const cx = fx + dx * d;
    const cy = fy + dy * d;
    const id = sim.get(cx, cy);
    if (id === EMPTY || id === WIND.id || !isWindPushable(id) || sim.hasMoved(cx, cy)) continue;
    const tx = cx + dx;
    const ty = cy + dy;
    if (!sim.inBounds(tx, ty)) continue;
    const tid = sim.get(tx, ty);
    if (tid === WIND.id) sim.set(tx, ty, EMPTY); // clear the stale trail so the swap lands in empty
    else if (tid !== EMPTY) continue; // blocked ahead — leave this cell put
    sim.swap(cx, cy, tx, ty);
  }

  // 3) Paint / refresh the Wind trail across the whole beam (the matter cells show
  //    through as themselves, visibly being blown). EVERY empty beam cell holds a
  //    Wind cell refreshed to full life this tick, and every existing Wind cell is
  //    topped back up and marked moved so it can't tick down — so the trail is a
  //    solid, steady field while the fan blows (no flicker) and only fades once the
  //    fan stops feeding it. Each cell's aux packs its life countdown (high bits)
  //    and the blow direction (low 2 bits) — the direction is what the object layer
  //    reads to push a body in the stream (see engine/objects.ts applyWindPush).
  const packed = (WIND_TTL << 2) | dir;
  for (let d = 1; d <= reach; d++) {
    const cx = fx + dx * d;
    const cy = fy + dy * d;
    const id = sim.get(cx, cy);
    if (id === EMPTY) {
      sim.spawn(cx, cy, WIND.id); // marks moved, so it won't tick down this tick
      sim.setAux(cx, cy, packed);
    } else if (id === WIND.id) {
      sim.setAux(cx, cy, packed); // top the trail back up so it stays lit and steady
      sim.markMoved(cx, cy); // and skip its own countdown this tick
    }
  }
}

// A Wind cell just counts its life down; while a fan keeps feeding the beam it's
// refreshed to full and marked moved every tick (see blow step 3), so this only
// ever runs once the fan stops — the trail then clears within WIND_TTL ticks
// instead of lingering. No motion (the gas default would smear the beam).
function updateWind(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const ttl = aux >> 2;
  if (ttl <= 1) {
    sim.set(x, y, EMPTY);
    return;
  }
  sim.setAux(x, y, ((ttl - 1) << 2) | (aux & DIR_MASK));
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

export const WIND = register({
  id: 113,
  name: 'Wind',
  // A gas so objects and fluids pass straight through it and it never acts as a
  // surface; it carries the blow direction in its aux (low 2 bits) for the object
  // layer. Not in the palette — it's a transient effect the Fan paints, never a
  // material you place (hand-placed it would just expire).
  phase: Phase.Gas,
  color: rgb(186, 230, 253),
  // Flat, unshaded light-blue — a moving/varying tint on a full-field gust would
  // read as noise, so keep every trail cell the exact same colour for a calm,
  // steady stream (the anti-flicker rendering, paired with the steady repaint).
  colorVary: 0,
  density: 0.1,
  category: '전기',
  // Purely temporary: the fan tops its life back up every tick while it blows, so
  // once it stops the trail counts down and clears within WIND_TTL ticks (Fan이
  // 유지하지 않으면 곧바로 사라짐). The countdown lives in aux (high bits); the
  // update is what drains it (and it never drifts — no gas-default motion).
  update: updateWind,
});
