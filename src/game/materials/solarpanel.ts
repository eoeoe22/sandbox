import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { floodDeviceBody } from '../engine/deviceBody';
import type { SimContext } from '../engine/SimContext';
import { pulseCell } from './spark';

// Solar Panel (태양광 패널) — a photovoltaic slab: light in, electricity out. Aim a
// Laser's Heat Ray at it and the beam does NOT cook it the way it cooks every
// other solid (heatray.ts dumps IMPACT_HEAT into whatever it strikes) — the panel
// converts the light instead of soaking it, and fires a pulse into every conductor
// touching it (열선 접촉 시 가열되지 않고 인접 도체에 Spark 방출).
//
// It's the light-side counterpart of the Battery: a *source*, not a sink. Its one
// hook is `lightPulse`, which heatray.ts fires on the struck cell in place of
// heating it, and which absorbs the beam (no reflection, no pass-through: the
// photons are spent).
//
// **Current flows one way through a panel: 내부 → 내부, 내부 → 외부, and never
// 외부 → 내부.** The array is its own busbar — light landing anywhere on it
// conducts through the whole connected slab instantly and emits from every edge
// of it (see solarPulse) — but nothing outside can push current *into* it. That
// asymmetry is not a special case bolted on; it falls out of what the panel
// declares. It is deliberately NOT `conductive`, so a spark on a neighbouring wire
// has no cell here to hop into (spark.ts only hands off to conductors) and an
// array can't double as free wiring; and it declares no `directPulse`, so the
// device path — the one-way "outside → inside" sink every appliance uses — has no
// hook to call either (a pulse touching a panel face simply does nothing). The
// internal conduction rides `floodDeviceBody`, the same shared body-walk those
// appliances use, just driven by light instead of by a wire.
//
// Emission goes through `pulseCell` (spark.ts) — the same single "what does a
// pulse do to this cell" rule a Battery terminal, a Turbine face and the 전기
// 브러시 all use. So a panel energizes a conductor (Wire, Iron, brine, …) into a
// travelling Spark and, on a machine bolted straight to its face, fires that
// device's own hook exactly as a battery in direct contact would. Adding the panel
// therefore needed no change in any device or conductor: both halves of it are
// shared engine seams — `floodDeviceBody` inward, `pulseCell` outward.
//
// Rate limiting is free and physical: a conductor is refractory for a few ticks
// after a pulse passes (spark.ts), so a beam parked on a panel doesn't machine-gun
// the wire — it drives it at the wire's own maximum cadence, which is exactly what
// "the panel is in full sun" should look like.

/**
 * A Heat Ray struck this panel cell: energize the whole array. The beam is
 * consumed by the caller (heatray.ts) and, crucially, deposits no heat — that skip
 * is what `lightPulse` means (see Material.lightPulse).
 *
 * 패널 내 전역 즉시 전기 전도 — one flood covers the entire 4-connected slab in the
 * tick the light lands, and every cell of it pulses its own neighbours. So where
 * you aim doesn't decide where the power comes out: hit any corner of an array and
 * the lead clipped to the opposite edge fires the same tick, which is what makes a
 * panel usable as a roof with the wiring run wherever it's convenient. (An array
 * used to be a bag of independent cells, each lighting only its own eight
 * neighbours, so a beam had to be walked across the whole face to power a wire on
 * the far side — legible as physics, tedious as a build.)
 *
 * Emission is per body cell but the *work* is bounded per tick, not per lit cell:
 * `sim.solarFlood` memoizes the walk, so a wide beam covering forty cells of one
 * array still costs a single O(N) pass, and later strikes in the same tick return
 * immediately. That memo is also what keeps output binary rather than additive —
 * a fully lit panel emits once per tick, exactly like one lit in a single spot,
 * matching how every conductor is refractory for a few ticks after a pulse anyway
 * (spark.ts). Full sun drives the wire at the wire's own maximum cadence.
 *
 * Only *outward* emission goes through `pulseCell` (spark.ts) — the shared "what
 * does a pulse do to this cell" rule a Battery terminal, a Turbine face and the
 * 전기 브러시 all use — so a panel energizes a conductor (Wire, Iron, brine, …)
 * into a travelling Spark and fires the hook of a machine bolted to its face,
 * exactly as a battery in contact would. Panel cells are skipped on the way out:
 * the body already conducted internally via the flood, and `pulseCell` would find
 * nothing to do on one anyway (that no-op is 외부 → 내부 차단, see the note above).
 */
function solarPulse(sim: SimContext, x: number, y: number): void {
  floodDeviceBody(sim, x, y, SOLAR_PANEL.id, sim.solarFlood, (bx, by) => {
    // Indexed rather than `for (const [dx, dy] of DIR8)`: this runs eight times
    // for every cell of the array, every tick the light is on (a powered Laser
    // emits each tick), and the iterator's per-step array destructuring is
    // measurable at that count — see the flood-cost note in engine/deviceBody.ts.
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

export const SOLAR_PANEL = register({
  id: 133,
  name: 'Solar Panel',
  phase: Phase.Solid,
  // Deep photovoltaic blue cells on a light-blue grid of seams — the panel
  // pattern is positional (see Material.solarPattern), so a painted array lines
  // up into one continuous panel however you draw it.
  color: rgb(0x1d, 0x4e, 0xd8),
  lattice: rgb(0x38, 0xbd, 0xf8),
  solarPattern: true,
  density: 1000,
  category: 'electric',
  // Doesn't corrode away underfoot, like the other electric machines.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  // 광전 효과: a Heat Ray striking a cell is converted, not absorbed as heat.
  lightPulse: solarPulse,
});
