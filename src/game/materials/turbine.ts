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
// a fresh Spark is injected into every ready piece of wiring on its faces (see
// the wired-output note below) — exactly the pulse a Battery emits, on the very
// same cadence (PULSE_PERIOD, shared from battery.ts): while steam keeps flowing
// the turbine beats once every PULSE_PERIOD ticks, so anything downstream (a
// wire, a Fan, a Woofer) can't tell a turbine's supply from a battery's. The
// steam flow is what *gates* the beat — no steam, no pulse — rather than setting
// its rate. Boil water beneath a turbine and wire its output into a circuit and
// you've built a steam power plant: heat → steam → turbine → electricity.
// Condensed water drains back down through it (it passes liquids too), so a
// sealed boiler loop can keep the pulses coming.
//
// ## 활성 상태 + 리튬 배터리와 같은 주파수
//
// Steam does not *emit* a pulse; it makes the turbine **active**, and an active
// turbine beats on the batteries' own cadence. That's the Solar Panel's wiring
// exactly (see solarpanel.ts), and for the same reason:
//
//   • **Active countdown** (like the Fan/Laser/Pump/Electromagnet's POWERED_TICKS):
//     steam anywhere in the body refreshes the whole connected block's countdown.
//     Let the steam stop and the countdown runs out and the turbine goes
//     **inactive — and an inactive turbine does nothing at all** (no steam, no
//     pulse, exactly as before). The countdown outlives a beat interval on
//     purpose: a real puff of steam is *patchy*, gusting through a block on some
//     ticks and not others, and a wheel that's already spinning doesn't stop dead
//     in the gaps.
//   • **Beat** (like the Battery's and the panel's): while active, each cell counts
//     ticks and the body emits once every PULSE_PERIOD ticks, shared from
//     battery.ts. Emission floods the block and pulses every face.
//
// Before this the beat counter only advanced on the ticks a cell *itself* had
// steam inside it, which is where the frequency went wrong (배터리와 다른 주파수).
// A cadence gated tick-by-tick isn't a cadence — it's a duty cycle: in a real
// boiler, steam was in the block on ~60% of ticks but no single cell collected
// PULSE_PERIOD steam-ticks anywhere near that often (patchy steam, and every beat
// re-phased the whole block back to 0), so a measured turbine beat ~12 times in
// 600 ticks against a Lithium Battery's 50 — four times slower than the source it
// is documented to be indistinguishable from. Now the steam gates *whether* the
// turbine runs and PULSE_PERIOD alone sets *how fast*, so a steam plant drives a
// Fan, a Woofer or a wire exactly as hard as a battery does.
//
// The turbine conducts its own generated current *internally*: steam passing
// through the middle of a solid turbine block powers a wire attached only at
// the block's outer edge, because the pulse walks the whole connected turbine
// body and emits from every face. Crucially this conduction is ONE-WAY —
// inside → out. The turbine itself is not `conductive`, so an external spark can
// never travel *into* it or across it; it only ever *emits*. That keeps a
// turbine from acting as a free wire that back-feeds a circuit, while still
// solving "steam in the center can't reach the terminal on the edge".
//
// Its output is WIRED, not bare (전선처럼): a turbine face only ever feeds proper
// wiring — a cable or a metal (`Material.wiring`) — plus electric appliances and
// charges bolted straight onto it. Everything else is skipped: water, brine, acid,
// Slime, and Acid Slime too, which carries a pulse at zero loss but is goo rather
// than wire (that's why the gate reads a declared tag instead of the loss table).
// It's the `'wiring'` emission gate in spark.ts's `pulseCell`. The reason is that a
// turbine lives inside wet machinery *by design*: it stands over a boiler with
// steam blowing through it and condensate draining back down through its own
// pores. A bare face dumped every beat into that water, which spread a pulse
// through the whole pool, electrolysed it into hydrogen and oxygen — the boiler
// slowly ate itself — and bled the generated strength off into a puddle instead
// of down the cable. So the turbine's terminals behave like insulated wiring:
// power goes where you route it, not into whatever it happens to be standing in.

/** Ticks the turbine stays active (spun up) after the last tick steam was inside
 *  it. Set above PULSE_PERIOD (12) — the same relationship the sinks' POWERED_TICKS
 *  has to it, and the same 24 the Solar Panel uses — so steam that gusts rather
 *  than blows keeps the beat running instead of restarting the count. Cut the
 *  steam for good and the turbine falls silent this many ticks later, coasting to
 *  a stop the way a loaded wheel does. */
const POWERED_TICKS = 24;

// The turbine's `aux` carries both counters, a byte each in the 16-bit word (see
// Grid.aux): the active countdown low (0..POWERED_TICKS, 0 = inactive) and the beat
// counter high (0..PULSE_PERIOD-1) — the Solar Panel's layout, for the same reason
// it needs two fields. Steam arrives every tick it arrives at all, so "how long am
// I still spinning" and "how far into the beat am I" can't be the same number; the
// single-field version is exactly what made the cadence a duty cycle (see header).
//
// **A turbine that stops keeps its phase**, because an inactive cell's update returns
// before touching either field: the beat is frozen where it stood, not zeroed. So a
// block that goes fully dormant and is re-steamed minutes later can beat on the very
// tick the steam returns, and the tempting "tidy up" — reset the beat when the
// countdown hits 0 — is wrong twice over. It cannot make the turbine *fast*: only
// active ticks advance the beat, so any two consecutive beats are exactly
// PULSE_PERIOD active ticks apart and dormancy only ever inserts more wall-clock
// between them (checked over a sweep of duty cycles in test/electricity.ts — the
// tightest interval any of them produces is exactly PULSE_PERIOD). What it *would* do
// is make it slow: zeroing throws away up to PULSE_PERIOD-1 ticks of already-served
// wait on every restart, so a weak boiler puffing on and off would pay a fresh full
// interval each time — a smaller helping of the very duty cycle this material was
// rewritten to stop having.
const ACTIVE_MASK = 0xff;
const BEAT_SHIFT = 8;

function packTurbine(beat: number, active: number): number {
  return (beat << BEAT_SHIFT) | active;
}

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
 *  `directPulse`/explosive material needs no turbine edit.
 *
 *  The one thing the turbine asks of that shared rule is the `'wiring'` emission
 *  gate (see PulseGate): of the conductors, only cables and metals get a pulse,
 *  never the boiler water/brine/acid/goo the machine is standing in (see the
 *  header note). Devices and charges are unaffected. */
function energizeNeighbors(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    pulseCell(sim, nx, ny, 'wiring');
  }
}

/**
 * Steam is passing through this cell: make the whole connected block active. One
 * flood covers the 4-connected body in the tick the steam lands, so a puff that
 * only ever reaches the middle of a block still spins up the terminals bolted to
 * its outer edge — the same 내부 → 외부 conduction the emission flood does, just
 * carrying "the wheel is turning" instead of a pulse.
 *
 * The work is bounded per tick, not per steam-carrying cell: `sim.turbineFlood`
 * memoizes the walk, so a steam-soaked block costs a single O(N) pass and the rest
 * of its cells return immediately instead of re-flooding once per cell (O(N²) on
 * its primary use case). See SimContext.turbineFlood.
 *
 * This refreshes the countdown and **must not touch the beat counter**. Steam is
 * inside the block on most ticks it's running at all, so re-phasing the block on
 * each puff would keep it from ever reaching its beat and a fully steamed turbine
 * would emit nothing — the same trap `solarLight` documents.
 */
function activateBody(x: number, y: number, sim: SimContext): void {
  floodDeviceBody(sim, x, y, TURBINE.id, sim.turbineFlood, (bx, by) => {
    sim.setAux(bx, by, (sim.getAux(bx, by) & ~ACTIVE_MASK) | POWERED_TICKS);
  });
}

/** Deliver a generation pulse to every conductor attached to the connected
 *  turbine body containing (sx,sy): flood the whole body through turbine cells
 *  (4-connected, the shared `floodDeviceBody` every electric device's body walk
 *  uses) and energize each one's external wiring neighbors. The pulse only
 *  travels turbine→turbine and out to a conductor, never the other way, so it's
 *  inherently one-directional (inside → out). The walk is uncapped, the same way
 *  a device's activation is (see engine/deviceBody.ts): a steam-fed block powers
 *  every terminal on it, not just the ones near whichever cell fired first.
 *
 *  The flood also re-phases the body: every cell's beat counter is reset to this
 *  cell's, so a multi-cell turbine pulses *as one body* on a single beat rather
 *  than each cell drifting out of phase. Each cell keeps its own active countdown
 *  — that's the steam's business, not the beat's. */
function energizeBody(sx: number, sy: number, sim: SimContext): void {
  const bodyId = sim.get(sx, sy); // TURBINE.id (this cell is a turbine)
  floodDeviceBody(sim, sx, sy, bodyId, sim.turbineBeatFlood, (x, y) => {
    sim.setAux(x, y, sim.getAux(x, y) & ACTIVE_MASK); // beat → 0, countdown kept
    energizeNeighbors(x, y, sim);
  });
}

/**
 * Per-cell tick: steam in the 겹침 slot (steam mid-passage through the blades)
 * spins the whole block up, then this cell spends a tick of the active countdown
 * and, on rollover of the beat counter, drives one body-wide beat. An inactive
 * cell (countdown 0) returns immediately and does nothing — a turbine with no
 * steam is inert, not a slow source.
 *
 * The beat runs on plain ticks while the block is active, which is what makes the
 * cadence a battery's (see header). Each conductor's post-spark refractory is what
 * keeps the repeated pulses from stacking into a runaway.
 */
function updateTurbine(x: number, y: number, sim: SimContext): void {
  if (sim.getOverlay(x, y) === STEAM.id) activateBody(x, y, sim);

  const aux = sim.getAux(x, y);
  const active = aux & ACTIVE_MASK;
  if (active === 0) return; // 비활성 — 증기가 없으면 아무것도 하지 않는다

  // Already beat this tick? Then this cell was re-phased by that flood, and
  // incrementing its beat now would push the body's rhythm a tick earlier every
  // time it fires (a cadence quietly faster than the battery's). Spend the
  // countdown tick and leave the phase alone — the same guard solarpanel.ts uses.
  sim.turbineBeatFlood.begin(sim);
  if (sim.turbineBeatFlood.has(sim, x, y)) {
    sim.setAux(x, y, (aux & ~ACTIVE_MASK) | (active - 1));
    return;
  }

  const beat = aux >> BEAT_SHIFT;
  if (beat < PULSE_PERIOD - 1) {
    sim.setAux(x, y, packTurbine(beat + 1, active - 1));
    return;
  }
  sim.setAux(x, y, packTurbine(0, active - 1));
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
  // **The wheel turns while the turbine is running.** The second frame is the same
  // wheel 22.5° on — half a blade pitch, because a 45° turn of an eight-blade wheel
  // lands every blade where its neighbour was and the picture would not change at
  // all. The frame comes from the **beat counter** in the high byte of `aux` (hence
  // `rotorSpinShift: 8`), which advances one per tick for exactly as long as the
  // block is active and freezes where it stands the moment the block goes inactive —
  // so the wheel spins while steam is driving it, coasts through the gaps a gusting
  // puff leaves, and stops once the steam is gone for good.
  //
  // The *active countdown* in the low byte would have been the obvious counter to
  // animate from — it's what the Fan uses — and it is the wrong one here: steady
  // steam refreshes it to POWERED_TICKS every tick, so it would sit pinned at 24 and
  // a turbine at full power would draw as a wheel standing perfectly still.
  //
  // The renderer takes the *maximum* count across each drawn wheel and animates the
  // whole tile from it (see CanvasRenderer's rotorBlockFrame). That mattered more
  // when the counter was per cell and a block held a spread of them; the beat is
  // re-phased body-wide on every pulse, so a wheel's cells now agree by construction
  // and the max is simply that shared beat.
  lattice: rgb(192, 205, 220),
  rotorPattern: 8,
  rotorSpinShift: 8,
  density: 1000,
  category: 'electric',
  // Porous like the Mesh — fluids (and its working steam) pass through any
  // thickness via the 겹침 overlap layer.
  porous: true,
  thermal: { conductivity: 0.5 },
  update: updateTurbine,
});
