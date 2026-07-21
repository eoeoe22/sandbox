import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';

// Fan (팬) — an electric appliance that blows a directional wind while powered.
// Feed it current (a Battery pressed against it, or a pulse relayed in through
// ordinary conductors — see spark.ts / battery.ts) and every cell of the
// connected fan body blows a stream of air in the direction it was placed
// facing: loose matter (powder, liquid, gas) in the stream is pushed one cell
// per tick downwind, and free objects (balls, drums, dynamite) caught in it are
// carried along too (see applyFanWind in engine/objects.ts). The wind is a pure
// per-tick effect, not a material — nothing is ever written into the world for
// it — so the moment the fan loses power (or is erased) the wind is simply gone,
// with no residue to clean up (임시 상태: Fan이 유지하지 않으면 즉시 사라짐).
//
// Direction is set at placement, Conveyor-style: drag the brush while painting
// and each cell records the stroke's dominant direction (left/right/up/down) in
// its aux byte, shown by the renderer as a chevron pointing downwind (see
// Material.arrow4 / CanvasRenderer).
//
// Electricity follows Woofer's one-way "outside → inside" sink template (see
// woofer.ts's design note, points 1–2 copied verbatim): the Fan is NOT
// `conductive` — a pulse reaching any face is consumed on arrival (no Spark is
// ever rendered on the body, nothing conducts onward to other wires the body
// touches) and floods the whole 4-connected fan body at once, so current
// touching one corner spins every blade of the block (외부→내부 단방향, 내부
// 전역 전도). The flood is memoized per tick via SimContext.fanFlooded so a body
// pulsed from several sources in one tick still powers up exactly once.

/** aux low-3-bit values encoding a fan cell's wind direction (0/unset ⇒ right). */
export const FAN_RIGHT = 1;
export const FAN_LEFT = 2;
export const FAN_UP = 3;
export const FAN_DOWN = 4;

const DIR_BITS = 3;
const DIR_MASK = (1 << DIR_BITS) - 1;

/** Ticks a pulse keeps the fan spinning. A Battery beats every PULSE_PERIOD
 *  (12) ticks, so anything comfortably above that turns the discrete beats into
 *  a continuous wind; when power stops the fan winds down within a quarter
 *  second instead of dying between two beats of a live battery. Must fit the
 *  aux byte's high 5 bits (≤ 31). */
const POWER_LINGER = 16;

/** How far (in cells) one fan cell's wind stream reaches through open space. */
export const FAN_WIND_RANGE = 24;

/** Per-cell push probability tapers linearly with distance: ~1 at the blades,
 *  fading toward zero past the stream's reach — so matter near the fan is
 *  hurled and matter at the fringe just stirs. */
const PUSH_FALLOFF = FAN_WIND_RANGE + 6;

/** Backstop on how far one flood walks the connected fan body in a single pass
 *  (mirrors Woofer's/Turbine's own MAX_BODY) — a giant wall of fans can't make
 *  one pulse unbounded. */
const MAX_BODY = 256;

/** Unit vector for a fan cell's aux direction code. */
export function fanDirVector(dir: number): readonly [number, number] {
  switch (dir) {
    case FAN_LEFT:
      return [-1, 0];
    case FAN_UP:
      return [0, -1];
    case FAN_DOWN:
      return [0, 1];
    default:
      return [1, 0]; // FAN_RIGHT and 0/unset
  }
}

/**
 * Power up the connected fan body containing (sx,sy): flood it through fan
 * cells (4-connected, like Turbine's/Woofer's body walks) and stamp each cell's
 * power countdown to full, keeping its placed direction bits. Called from every
 * pulse source (battery.ts's injectPulses for direct contact, spark.ts's arc
 * phase for relayed current); memoized per tick via SimContext.fanFlooded so a
 * body touched from several directions/sources this tick floods exactly once.
 */
export function fanBodyPulse(sim: SimContext, sx: number, sy: number): void {
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
    sim.setAux(x, y, (POWER_LINGER << DIR_BITS) | (sim.getAux(x, y) & DIR_MASK));
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

/** True if `id` blocks the wind stream outright: solids (walls included) stop
 *  air dead. Loose matter (powder/liquid/gas) rides the stream instead. */
function blocksWind(id: number): boolean {
  return id !== EMPTY && getMaterial(id).phase === Phase.Solid;
}

/**
 * One powered fan cell's per-tick blow. The stream extends downwind from the
 * cell until the first solid (so the interior cells of a thick fan block are
 * self-blocked by their neighbors and only the exposed face actually blows).
 * Every loose cell in the stream is pushed one cell downwind into empty space,
 * scanned farthest-first so a contiguous slug of water advances as a body
 * instead of compressing against itself; the push chance tapers with distance
 * (see PUSH_FALLOFF). The stream is also queued as a wind zone
 * (SimContext.queueWind) — the single per-tick event record that both the
 * object layer (applyFanWind in engine/objects.ts) and the renderer's streak
 * effect (CanvasRenderer) consume, the same event-channel trick as
 * SimContext.wooferPulseX/Y.
 */
function blow(x: number, y: number, dx: number, dy: number, sim: SimContext): void {
  // Measure the open stream: how far downwind before a solid (or the border).
  let len = 0;
  for (let d = 1; d <= FAN_WIND_RANGE; d++) {
    const cx = x + dx * d;
    const cy = y + dy * d;
    if (!sim.inBounds(cx, cy) || blocksWind(sim.get(cx, cy))) break;
    len = d;
  }
  if (len === 0) return; // face pressed against a wall (or another fan cell)

  sim.queueWind(x, y, dx, dy, len);

  // Push loose matter downwind, farthest cell first so a run of cells all
  // advances one step this tick (the near cell moves into the spot the far one
  // just vacated) — the same relay discipline the Conveyor's stack carry uses.
  for (let d = len; d >= 1; d--) {
    const cx = x + dx * d;
    const cy = y + dy * d;
    const id = sim.get(cx, cy);
    if (id === EMPTY) continue;
    const phase = getMaterial(id).phase;
    if (phase !== Phase.Powder && phase !== Phase.Liquid && phase !== Phase.Gas) continue;
    if (sim.hasMoved(cx, cy) || sim.isFrozen(cx, cy)) continue;
    if (!sim.chance(1 - d / PUSH_FALLOFF)) continue;
    const tx = cx + dx;
    const ty = cy + dy;
    if (!sim.inBounds(tx, ty) || !sim.isEmpty(tx, ty)) continue;
    // swap carries the cell's temp/aux/tint and marks both cells moved, so a
    // blown grain doesn't also run its own gravity this tick — matter caught in
    // the stream flies flat until it leaves the wind, then falls normally.
    sim.swap(cx, cy, tx, ty);
  }
}

function updateFan(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const power = aux >> DIR_BITS;
  if (power === 0) return; // unpowered — a fan is inert without current
  sim.setAux(x, y, ((power - 1) << DIR_BITS) | (aux & DIR_MASK));
  const [dx, dy] = fanDirVector(aux & DIR_MASK);
  blow(x, y, dx, dy, sim);
}

export const FAN = register({
  id: 110,
  name: 'Fan',
  phase: Phase.Solid,
  // Dark housing; the light-blue chevron (drawn per-cell from the aux direction
  // — see Material.arrow4 / CanvasRenderer) points the way the wind blows.
  color: rgb(58, 66, 80),
  lattice: rgb(148, 196, 232),
  arrow4: true,
  density: 1000,
  category: '전기',
  // An appliance shouldn't dissolve out from under its own wiring.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  update: updateFan,
});
