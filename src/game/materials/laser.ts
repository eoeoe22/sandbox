import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { emitHeatRay } from './heatray';

// Laser (레이저) — an electric emitter that turns power into a beam of Heat Rays
// (see heatray.ts). Which way it fires is chosen at placement time by the
// direction you *drag* the brush (Fan/Conveyor 방식 — 상하좌우 4방향), recorded in
// the low 2 bits of each cell's `aux` byte (it shares the Fan's placement path
// and direction codes; see PointerPainter).
//
// Powering it copies the Fan's one-way "outside → inside" electric sink exactly
// (see fan.ts): the Laser is deliberately NOT `conductive`, so a Spark can never
// travel into or across it. Instead it declares the electric-appliance hook
// (`Material.directPulse` = `energizeLaserBody`), and every pulse source — a
// Battery/LFP Battery/Turbine in contact or a Spark relayed down a wire —
// dispatches it through the shared `reactToPulse` (spark.ts). Current reaching any
// face floods the whole connected laser body (4-connected) and stamps a *powered
// countdown* onto every cell at once, so the emitter fires while the countdown
// lives and spins down a beat after power is cut.
//
// The countdown is what keeps the beam from strobing. The engine's electricity is
// pulsed — a Battery injects a Spark only every PULSE_PERIOD ticks, so a beam that
// lived a single tick would flicker between pulses. Each pulse instead refreshes
// the countdown to POWERED_TICKS (chosen well above the pulse gap), so the beam
// stays lit continuously across the quiet ticks (Fan과 동일한 유지 방식).
//
// While the countdown is live the Laser fires one Heat Ray per tick from its
// muzzle — the cell directly ahead in its firing direction — provided that cell is
// clear. The stream of fast beam cells reads as a continuous laser (Heat Ray does
// the rest: heating what it hits, passing through glass, reflecting off Mercury,
// scattering in gas, refracting/absorbing in liquid — see heatray.ts).

/** aux direction codes (low 2 bits) — identical to the Fan's so the shared
 *  drag-to-place path (PointerPainter.fanDir) stamps a Laser the same way. */
export const LASER_UP = 0;
export const LASER_DOWN = 1;
export const LASER_LEFT = 2;
export const LASER_RIGHT = 3;
/** Low-bit mask separating the direction from the packed powered countdown. */
const DIR_MASK = 0b11;

/** Unit fire vector for each direction code. */
const DIRV: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // up
  [0, 1], // down
  [-1, 0], // left
  [1, 0], // right
];

/** Ticks a single power pulse keeps the Laser firing. Set well above the
 *  Battery's PULSE_PERIOD (12) so the beam never lapses between pulses — it spins
 *  down only a beat or two after power is genuinely cut. Fits the 6-bit countdown
 *  field (aux >> 2, ≤ 63). Matches the Fan. */
const POWERED_TICKS = 24;

/** Backstop on how far one flood walks the connected laser body in a single pass —
 *  mirrors the Fan/Turbine/Woofer MAX_BODY so a giant emitter array can't make one
 *  pulse unbounded (a larger body is covered across several capped floods a tick,
 *  each memoized in SimContext.laserFlooded). */
const MAX_BODY = 256;

function updateLaser(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const timer = aux >> 2;
  if (timer <= 0) return; // idle until a pulse energizes the body
  const [dx, dy] = DIRV[aux & DIR_MASK];
  // Fire a beam from the muzzle (the cell straight ahead) when it's clear, so the
  // emitter doesn't overwrite whatever is pressed against its face.
  const mx = x + dx;
  const my = y + dy;
  if (sim.inBounds(mx, my) && sim.isEmpty(mx, my)) emitHeatRay(sim, mx, my, dx, dy);
  // Spin the countdown down one tick, preserving the direction bits.
  sim.setAux(x, y, ((timer - 1) << 2) | (aux & DIR_MASK));
}

/**
 * Deliver a power pulse to the connected laser body containing (sx,sy): flood it
 * through laser cells (4-connected) and refresh every cell's powered countdown to
 * POWERED_TICKS, keeping each cell's own direction bits. A one-way sink — a pulse
 * only ever *arrives* here (see the header) — so power reaching any face energizes
 * the whole structure. Memoized per tick via SimContext.laserFlooded so a body
 * touched from several faces/sources in one tick still floods exactly once. Called
 * from the pulse sources (battery.ts, spark.ts) via the shared reactToPulse, the
 * same way the Fan's body pulse is.
 */
export function energizeLaserBody(sim: SimContext, sx: number, sy: number): void {
  if (sim.tick !== sim.laserFloodTick) {
    sim.laserFloodTick = sim.tick;
    sim.laserFlooded.clear();
  }
  const w = sim.width;
  const startIdx = sy * w + sx;
  if (sim.laserFlooded.has(startIdx)) return;

  const seen = new Set<number>([startIdx]);
  const stack: number[] = [sx, sy];
  let count = 0;
  while (stack.length > 0 && count < MAX_BODY) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    count++;
    sim.laserFlooded.add(cy * w + cx);
    sim.setAux(cx, cy, (POWERED_TICKS << 2) | (sim.getAux(cx, cy) & DIR_MASK));
    for (const [dx, dy] of DIR4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== LASER.id) continue;
      const k = ny * w + nx;
      if (seen.has(k) || sim.laserFlooded.has(k)) continue;
      seen.add(k);
      stack.push(nx, ny);
    }
  }
}

export const LASER = register({
  id: 121,
  name: 'Laser',
  phase: Phase.Solid,
  // A dark machine housing with a bright red emitter chevron pointing the way it
  // fires (drawn from the aux direction; brightens while powered — the same
  // windArrow path the Fan uses).
  color: rgb(60, 55, 70),
  lattice: rgb(255, 90, 120),
  windArrow: true,
  density: 1000,
  category: '전기',
  // Doesn't burn or corrode away underfoot, like the other electric machines.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  // One-way "outside → inside" electric sink (see the header): any pulse source
  // touching a face — Battery/LFP Battery/Turbine direct, or a relayed Spark —
  // floods the connected body and refreshes its fire countdown. Declared once here
  // so every source powers it through the shared dispatch (spark.ts reactToPulse),
  // with no per-source id special-casing.
  directPulse: energizeLaserBody,
  update: updateLaser,
});
