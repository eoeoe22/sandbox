import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { floodDeviceBody } from '../engine/deviceBody';
import type { SimContext } from '../engine/SimContext';
import { pulseCell } from './spark';
import { PULSE_PERIOD } from './battery';

// Solar Panel (태양광 패널) — a photovoltaic slab: light in, electricity out. Aim a
// Laser's Heat Ray at it and the beam does NOT cook it the way it cooks every
// other solid (heatray.ts dumps IMPACT_HEAT into whatever it strikes) — the panel
// converts the light instead of soaking it, and runs as a power source for as long
// as the light keeps arriving (열선 접촉 시 가열되지 않고 발전).
//
// It's the light-side counterpart of the Battery: a *source*, not a sink. Its one
// hook is `lightPulse`, which heatray.ts fires on the struck cell in place of
// heating it, and which absorbs the beam (no reflection, no pass-through: the
// photons are spent).
//
// ## 활성 상태 + 배터리와 같은 박자
//
// Light does not *emit* a pulse; it makes the panel **active**, and an active
// panel beats on the batteries' own cadence — the two halves of every other
// device's wiring, just pointed outward:
//
//   • **Active countdown** (like the Fan/Laser/Pump/Electromagnet's POWERED_TICKS):
//     a Heat Ray strike refreshes the whole connected array's countdown. Drop the
//     beam and the countdown runs out and the panel goes **inactive — and an
//     inactive panel does nothing at all** (its update returns on the first line).
//     The countdown outlives one beat interval on purpose, so a beam that flickers
//     — occluded for a tick, or a Laser between its own pulses — doesn't reset the
//     array's rhythm; it's the same reason a Fan keeps blowing between beats.
//   • **Beat** (like the Battery's and the Turbine's): while active, each cell
//     counts ticks and the body emits once every PULSE_PERIOD ticks, shared from
//     battery.ts. Emission floods the array and pulses every face.
//
// Before this, emission happened *in the light hook itself*, so a panel fired
// every single tick the beam was on — an order of magnitude faster than the
// battery/turbine cadence (지나치게 빠름). Rate limiting was left to the wire's own
// post-pulse refractory (3 ticks), which is a floor, not a cadence: a panel drove
// everything downstream ~4× hotter than a battery, and a Woofer wired to one
// smeared its wavefronts the same way the Turbine's used to before it was given a
// cadence. Now all three sources beat identically, so nothing downstream can tell
// them apart, and PULSE_PERIOD remains the single knob for all of them.
//
// **Current flows one way through a panel: 내부 → 내부, 내부 → 외부, and never
// 외부 → 내부.** The array is its own busbar — light landing anywhere on it makes
// the whole connected slab active, and the beat emits from every edge of it — but
// nothing outside can push current *into* it. That asymmetry is not a special case
// bolted on; it falls out of what the panel declares. It is deliberately NOT
// `conductive`, so a spark on a neighbouring wire has no cell here to hop into
// (spark.ts only hands off to conductors) and an array can't double as free wiring;
// and it declares no `directPulse`, so the device path — the one-way
// "outside → inside" sink every appliance uses — has no hook to call either (a
// pulse touching a panel face simply does nothing). Both floods ride
// `floodDeviceBody`, the same shared body-walk those appliances use.
//
// Emission goes through `pulseCell` (spark.ts) — the same single "what does a
// pulse do to this cell" rule a Battery terminal, a Turbine face and the 전기
// 브러시 all use. So a panel energizes a conductor (Wire, Iron, brine, …) into a
// travelling Spark and, on a machine bolted straight to its face, fires that
// device's own hook exactly as a battery in direct contact would. A panel is a
// *bare* terminal like a battery (gate `'any'`), not a wired one like the turbine:
// it has no working fluid of its own to protect, so a lead into a brine tank is a
// legitimate build rather than a machine electrifying its own guts.

/** Ticks the array stays active after the last Heat Ray strike. Set above
 *  PULSE_PERIOD (12) — the same relationship the sinks' POWERED_TICKS has to it —
 *  so a beam that stutters for a tick or two keeps the beat running instead of
 *  restarting the count. Drop the beam for good and the panel falls silent this
 *  many ticks later. */
const POWERED_TICKS = 24;

// The panel's `aux` carries both counters, a byte each in the 16-bit word (see
// Grid.aux): the active countdown low (0..POWERED_TICKS, 0 = inactive) and the beat
// counter high (0..PULSE_PERIOD-1). Two fields rather than one because the panel is
// the only device that has to hold a *rhythm* as well as a powered flag: light
// arrives every tick, so "how long am I still on" and "how far into the beat am I"
// can't be the same number.
const ACTIVE_MASK = 0xff;
const BEAT_SHIFT = 8;

function packPanel(beat: number, active: number): number {
  return (beat << BEAT_SHIFT) | active;
}

/**
 * A Heat Ray struck this panel cell: make the whole array active. The beam is
 * consumed by the caller (heatray.ts) and, crucially, deposits no heat — that skip
 * is what `lightPulse` means (see Material.lightPulse).
 *
 * 패널 내 전역 즉시 전도 — one flood covers the entire 4-connected slab in the tick
 * the light lands, so where you aim doesn't decide where the power comes out: hit
 * any corner of an array and the lead clipped to the opposite edge is fed by the
 * next beat, which is what makes a panel usable as a roof with the wiring run
 * wherever it's convenient. (An array used to be a bag of independent cells, each
 * lighting only its own eight neighbours, so a beam had to be walked across the
 * whole face to power a wire on the far side — legible as physics, tedious as a
 * build.)
 *
 * The work is bounded per tick, not per lit cell: `sim.solarFlood` memoizes the
 * walk, so a wide beam covering forty cells of one array still costs a single O(N)
 * pass and later strikes in the same tick return immediately.
 *
 * This hook refreshes the countdown and **must not touch the beat counter**. A
 * powered Laser emits a ray every tick, so it runs every tick a beam is parked
 * here; re-phasing the array on each strike would keep it from ever reaching its
 * beat, and a fully lit panel would emit nothing at all.
 */
function solarLight(sim: SimContext, x: number, y: number): void {
  floodDeviceBody(sim, x, y, SOLAR_PANEL.id, sim.solarFlood, (bx, by) => {
    sim.setAux(bx, by, (sim.getAux(bx, by) & ~ACTIVE_MASK) | POWERED_TICKS);
  });
}

/**
 * One beat of the array containing (sx,sy): flood the whole connected body
 * (4-connected, the shared `floodDeviceBody`) and pulse every cell's outside
 * neighbours. Panel cells are skipped on the way out — the body is covered by the
 * flood itself, and `pulseCell` would find nothing to do on one anyway (that no-op
 * is 외부 → 내부 차단, see the header).
 *
 * The flood also re-phases the body: every cell's beat counter is reset to this
 * cell's, so a multi-cell array beats *as one body* on a single rhythm rather than
 * each cell drifting out of phase (exactly what turbine.ts does with its own
 * cadence). Each cell keeps its own active countdown — that's the light's business,
 * not the beat's.
 *
 * Only *outward* emission goes through `pulseCell` (spark.ts) — the shared "what
 * does a pulse do to this cell" rule a Battery terminal, a Turbine face and the
 * 전기 브러시 all use — so a panel energizes a conductor into a travelling Spark
 * and fires the hook of a machine bolted to its face, exactly as a battery in
 * contact would.
 */
function solarBeat(sim: SimContext, sx: number, sy: number): void {
  floodDeviceBody(sim, sx, sy, SOLAR_PANEL.id, sim.solarBeatFlood, (bx, by) => {
    sim.setAux(bx, by, sim.getAux(bx, by) & ACTIVE_MASK); // beat → 0, countdown kept
    // Indexed rather than `for (const [dx, dy] of DIR8)`: this runs eight times for
    // every cell of the array on every beat, and the iterator's per-step array
    // destructuring is measurable at that count — see the flood-cost note in
    // engine/deviceBody.ts.
    for (let i = 0; i < DIR8.length; i++) {
      const d = DIR8[i];
      const nx = bx + d[0];
      const ny = by + d[1];
      if (!sim.inBounds(nx, ny)) continue;
      if (sim.get(nx, ny) === SOLAR_PANEL.id) continue; // inside; the flood has it
      pulseCell(sim, nx, ny);
    }
  });
}

/**
 * Per-cell tick: spend a tick of the active countdown and, on rollover of the beat
 * counter, drive one body-wide beat. An inactive cell (countdown 0) returns
 * immediately and does nothing — a panel in the dark is inert, not a slow source.
 */
function updateSolarPanel(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const active = aux & ACTIVE_MASK;
  if (active === 0) return; // 비활성 — 빛이 없으면 아무것도 하지 않는다

  // Already beat this tick? Then this cell was re-phased by that flood, and
  // incrementing its beat now would push the body's rhythm a tick earlier every
  // time it fires (a cadence quietly faster than the battery's). Spend the
  // countdown tick and leave the phase alone — the same guard turbine.ts uses.
  sim.solarBeatFlood.begin(sim);
  if (sim.solarBeatFlood.has(sim, x, y)) {
    sim.setAux(x, y, (aux & ~ACTIVE_MASK) | (active - 1));
    return;
  }

  const beat = aux >> BEAT_SHIFT;
  if (beat < PULSE_PERIOD - 1) {
    sim.setAux(x, y, packPanel(beat + 1, active - 1));
    return;
  }
  sim.setAux(x, y, packPanel(0, active - 1));
  solarBeat(sim, x, y);
}

export const SOLAR_PANEL = register({
  id: 133,
  name: 'Solar Panel',
  phase: Phase.Solid,
  // Deep photovoltaic blue cells on a light-blue grid of seams — the panel
  // pattern is positional (see Material.solarPattern), so a painted array lines
  // up into one continuous panel however you draw it. The cells brighten while the
  // array is active, the same cue the Pump's stripes and the Electromagnet's
  // windings give.
  color: rgb(0x1d, 0x4e, 0xd8),
  lattice: rgb(0x38, 0xbd, 0xf8),
  solarPattern: true,
  density: 1000,
  category: 'electric',
  // Doesn't corrode away underfoot, like the other electric machines.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  // 광전 효과: a Heat Ray striking a cell is converted, not absorbed as heat.
  lightPulse: solarLight,
  update: updateSolarPanel,
});
