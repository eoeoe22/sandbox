import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { floodDeviceBody } from '../engine/deviceBody';
import { STEAM } from './steam';
import { pulseCell } from './spark';
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

/** Inject a full-strength Spark into every ready conductive neighbor of (x,y) —
 *  the same hand-off a Battery does, triggered here by steam in the body. A
 *  neighbor already energized (its aux still set, or already turned to Spark)
 *  is skipped, so repeated pulses within a tick don't stack. A non-conductor
 *  neighbor — an electric appliance (Fan/Woofer, a one-way "outside → inside"
 *  sink) or an explosive charge — arcs/reacts instead, so plugging any device or
 *  charge straight onto a turbine face (도체 없이 직접 연결) reacts with no wire.
 *  Both cases go through the one shared per-cell rule every pulse source uses
 *  (spark.ts's `pulseCell`, also behind Battery's injectPulses and the 전기
 *  브러시), so the turbine stays consistent with them by construction — a new
 *  `directPulse`/explosive material needs no turbine edit. */
function energizeNeighbors(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    pulseCell(sim, nx, ny);
  }
}

/** Deliver a generation pulse to every conductor attached to the connected
 *  turbine body containing (sx,sy): flood the whole body through turbine cells
 *  (4-connected, the shared `floodDeviceBody` every electric device's body walk
 *  uses) and energize each one's external conductive neighbors. The pulse only
 *  travels turbine→turbine and out to a conductor, never the other way, so it's
 *  inherently one-directional (inside → out). The walk is uncapped, the same way
 *  a device's activation is (see engine/deviceBody.ts): a steam-fed block powers
 *  every terminal on it, not just the ones near whichever cell fired first. */
function energizeBody(sx: number, sy: number, sim: SimContext): void {
  const bodyId = sim.get(sx, sy); // TURBINE.id (this cell is a turbine)
  floodDeviceBody(sim, sx, sy, bodyId, sim.turbineFlood, (x, y) => {
    // Re-phase: reset every body cell's cadence counter to the firing cell's beat.
    sim.setAux(x, y, 0);
    energizeNeighbors(x, y, sim);
  });
}

function updateTurbine(x: number, y: number, sim: SimContext): void {
  // Steam in the 겹침 slot is steam mid-passage through the blades. While it's
  // inside, the whole connected turbine body delivers power to every conductor
  // on its outer faces; each conductor's post-spark refractory keeps the
  // repeated pulses from stacking into a runaway.
  if (sim.getOverlay(x, y) !== STEAM.id) return; // no steam passing through → no generation this tick
  // Flood each connected body at most once per tick: roll the per-tick memo over
  // when the tick advances, then skip if this cell was already covered by a flood
  // this tick (a steam-soaked block would otherwise re-flood itself once per cell
  // — O(N²)). See SimContext.turbineFlood.
  sim.turbineFlood.begin(sim);
  if (sim.turbineFlood.has(sim, x, y)) return;
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
  // An eight-blade wheel keyed to a dark hub (`rotorPattern`), the same picture as
  // the hand-drawn Turbine chip: `lattice` is a blade's lit leading edge, and the
  // trailing edge and the hub are this colour scaled down (see render/rotorTile.ts).
  // Eight blades is what separates it at a glance from the Fan, which draws four on
  // the same tile — a steam wheel is a dense disc of blades, a household fan is not.
  //
  // **The wheel turns while steam is passing through it.** The second frame is the
  // same wheel 22.5° on — half a blade pitch, because a 45° turn of an eight-blade
  // wheel lands every blade where its neighbour was and the picture would not change
  // at all. The frame comes straight from the steam-tick counter this material keeps
  // in `aux` (so no `rotorSpinShift`: the whole byte is the counter), which advances
  // only on ticks where steam actually flows and is held across a gap — so the wheel
  // stops the moment the steam does.
  //
  // **That counter is per cell, and a wheel is not.** `updateTurbine` returns before
  // touching aux on any cell steam is not currently inside, so mid-operation a block
  // holds a spread of counts: soaked cells leading, grazed cells lagging, dry cells
  // still at 0. Drawn per cell that came out as a wheel whose blades moved only where
  // the steam was and stood still everywhere else. The renderer therefore takes the
  // *maximum* count across each drawn wheel and animates the whole tile from it (see
  // CanvasRenderer's rotorBlockFrame), so the wheel turns as the rigid thing it is,
  // driven by whichever part of it the steam is hitting hardest.
  lattice: rgb(192, 205, 220),
  rotorPattern: 8,
  density: 1000,
  category: 'electric',
  // Porous like the Mesh — fluids (and its working steam) pass through any
  // thickness via the 겹침 overlap layer.
  porous: true,
  thermal: { conductivity: 0.5 },
  update: updateTurbine,
});
