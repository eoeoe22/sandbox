import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';
import { SPARK, packSpark, conductorClass, FULL_STRENGTH, reactToPulse } from './spark';
import { PULSE_PERIOD } from './battery';

// Turbine — a steam-driven generator. Like the Mesh it's a porous solid that
// fluids pass straight through via the 겹침 overlap layer (see Grid.overlay),
// and while a puff of *Steam* is blowing through the blades it makes power:
// a fresh Spark is injected into every ready conductive neighbor — exactly the
// pulse a Battery emits, on the very same cadence (PULSE_PERIOD, shared from
// battery.ts): while steam keeps flowing the turbine beats once every
// PULSE_PERIOD ticks, so anything downstream (a wire, a Fan, a Woofer) can't tell
// a turbine's supply from a battery's. The steam flow is what *gates* the beat —
// no steam, no pulse — rather than setting its rate. Boil water beneath a turbine
// and wire its output into a
// circuit and you've built a steam power plant: heat → steam → turbine →
// electricity. Condensed water drains back down through it (it passes liquids
// too), so a sealed boiler loop can keep the pulses coming.
//
// The turbine conducts its own generated current *internally*: steam passing
// through the middle of a solid turbine block powers a wire attached only at
// the block's outer edge, because the pulse walks the whole connected turbine
// body and emits from every face. Crucially this conduction is ONE-WAY —
// inside → out. The turbine itself is not `conductive`, so an external spark can
// never travel *into* it or across it; it only ever *emits*. That keeps a
// turbine from acting as a free wire that back-feeds a circuit, while still
// solving "steam in the center can't reach the terminal on the edge".

/** Backstop on how far one flood walks the connected turbine body in a single
 *  pass — a giant turbine can't make one relay unbounded. Turbines are small in
 *  practice; a body larger than this is covered across several floods in a tick
 *  (each capped), which stays bounded because cells energized this tick are
 *  memoized in SimContext.turbineFlooded and never re-walked. */
const MAX_BODY = 256;

/** Inject a full-strength Spark into every ready conductive neighbor of (x,y) —
 *  the same hand-off a Battery does, triggered here by steam in the body. A
 *  neighbor already energized (its aux still set, or already turned to Spark)
 *  is skipped, so repeated pulses within a tick don't stack. A non-conductor
 *  neighbor — an electric appliance (Fan/Woofer, a one-way "outside → inside"
 *  sink) or an explosive charge — is handed to the shared `reactToPulse`, the
 *  exact same dispatch Battery's injectPulses and spark.ts's arc phase use, so
 *  plugging any device or charge straight onto a turbine face (도체 없이 직접
 *  연결) reacts with no wire — and stays consistent with the batteries by
 *  construction (a new `directPulse`/explosive material needs no turbine edit). */
function energizeNeighbors(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (getMaterial(nid).conductive && sim.getAux(nx, ny) === 0) {
      const cls = conductorClass(nid);
      if (cls === 0) continue;
      const heat = sim.getTemp(nx, ny);
      sim.spawn(nx, ny, SPARK.id);
      sim.setTemp(nx, ny, heat); // carry the wire's heat across the spawned spark
      sim.setAux(nx, ny, packSpark(FULL_STRENGTH, cls));
    } else {
      reactToPulse(sim, nx, ny, nid); // appliance body reacts, or an explosive arcs
    }
  }
}

/** Deliver a generation pulse to every conductor attached to the connected
 *  turbine body containing (sx,sy): flood the body through turbine cells
 *  (4-connected) and energize each one's external conductive neighbors. The
 *  pulse only travels turbine→turbine and out to a conductor, never the other
 *  way, so it's inherently one-directional (inside → out). */
function energizeBody(sx: number, sy: number, sim: SimContext): void {
  const bodyId = sim.get(sx, sy); // TURBINE.id (this cell is a turbine)
  const w = sim.width;
  const flooded = sim.turbineFlooded; // cells energized this tick (per-tick memo)
  const seen = new Set<number>([sy * w + sx]); // local BFS frontier guard
  const stack: number[] = [sx, sy];
  let count = 0;
  while (stack.length > 0 && count < MAX_BODY) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    count++;
    flooded.add(y * w + x); // this body cell has now generated this tick
    sim.setAux(x, y, 0); // re-phase: reset every body cell's cadence counter to the firing cell's beat
    energizeNeighbors(x, y, sim);
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== bodyId) continue;
      const k = ny * w + nx;
      if (seen.has(k) || flooded.has(k)) continue; // skip already-walked/energized
      seen.add(k);
      stack.push(nx, ny);
    }
  }
}

function updateTurbine(x: number, y: number, sim: SimContext): void {
  // Steam in the 겹침 slot is steam mid-passage through the blades. While it's
  // inside, the whole connected turbine body delivers power to every conductor
  // on its outer faces; each conductor's post-spark refractory keeps the
  // repeated pulses from stacking into a runaway.
  if (sim.getOverlay(x, y) !== STEAM.id) return; // no steam passing through → no generation this tick
  // Flood each connected body at most once per tick: refresh the per-tick memo
  // when the tick advances, then skip if this cell was already covered by a
  // flood this tick (a steam-soaked block would otherwise re-flood itself once
  // per cell — O(N²)). See SimContext.turbineFlooded.
  if (sim.tick !== sim.turbineFloodTick) {
    sim.turbineFloodTick = sim.tick;
    sim.turbineFlooded.clear();
  }
  if (sim.turbineFlooded.has(y * sim.width + x)) return;
  // Match the batteries' pulse cadence (PULSE_PERIOD, shared from battery.ts):
  // generate only once every PULSE_PERIOD ticks of steam, not every tick. The
  // turbine cell counts steam-ticks in its own aux byte (0..PULSE_PERIOD-1) the
  // same way a Battery counts (see updateBattery); it holds the count across
  // brief steam gaps and only fires on rollover. Without this the turbine emitted
  // a pulse *every* tick — far faster than a battery — so a Woofer wired to it
  // saw its wavefronts pile up into a solid disc instead of reading as a discrete
  // expanding ring (배터리보다 잦은 주기 문제), and a Fan/wire got a much hotter
  // beat off a turbine than off a battery. The flood re-zeros the whole body's
  // counters (see energizeBody), so a multi-cell turbine pulses as one body on a
  // single beat rather than each cell drifting out of phase.
  const aux = sim.getAux(x, y);
  if (aux < PULSE_PERIOD - 1) {
    sim.setAux(x, y, aux + 1);
    return;
  }
  energizeBody(x, y, sim);
}

export const TURBINE = register({
  id: 84,
  name: 'Turbine',
  phase: Phase.Solid,
  color: rgb(150, 160, 172),
  density: 1000,
  category: '전기',
  // Porous like the Mesh — fluids (and its working steam) pass through any
  // thickness via the 겹침 overlap layer.
  porous: true,
  thermal: { conductivity: 0.5 },
  update: updateTurbine,
});
