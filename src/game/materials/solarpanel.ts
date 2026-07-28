import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { pulseCell } from './spark';

// Solar Panel (태양광 패널) — a photovoltaic slab: light in, electricity out. Aim a
// Laser's Heat Ray at it and the beam does NOT cook it the way it cooks every
// other solid (heatray.ts dumps IMPACT_HEAT into whatever it strikes) — the panel
// converts the light instead of soaking it, and fires a pulse into every conductor
// touching it (열선 접촉 시 가열되지 않고 인접 도체에 Spark 방출).
//
// It's the light-side counterpart of the Battery: a *source*, not a sink. So it's
// deliberately NOT `conductive` — a panel array must not double as free wiring —
// and it declares no `directPulse` either, because nothing powers a panel; the sun
// (a Heat Ray) does. Its one hook is `lightPulse`, which heatray.ts fires on the
// struck cell in place of heating it, and which absorbs the beam (no reflection,
// no pass-through: the photons are spent).
//
// Emission goes through `pulseCell` (spark.ts) — the same single "what does a
// pulse do to this cell" rule a Battery terminal, a Turbine face and the 전기
// 브러시 all use. So a panel energizes a conductor (Wire, Iron, brine, …) into a
// travelling Spark and, on a machine bolted straight to its face, fires that
// device's own hook exactly as a battery in direct contact would. Adding the panel
// therefore needed no change in any device or conductor: it just calls the shared
// rule.
//
// Rate limiting is free and physical: a conductor is refractory for a few ticks
// after a pulse passes (spark.ts), so a beam parked on a panel doesn't machine-gun
// the wire — it drives it at the wire's own maximum cadence, which is exactly what
// "the panel is in full sun" should look like.

/**
 * A Heat Ray struck this panel cell: pulse every neighbour. The beam is consumed
 * by the caller (heatray.ts) and, crucially, deposits no heat — that skip is what
 * `lightPulse` means (see Material.lightPulse).
 *
 * Per struck cell, not per body: there's no flood here and none is wanted. A panel
 * is a collector, so what it produces should scale with how much of it is actually
 * lit — a beam grazing one corner of a big array powers that corner's leads, and
 * lighting the whole face lights the whole face. (Contrast the appliances, whose
 * `directPulse` deliberately floods the entire connected body from one contact:
 * those are sinks answering "is it on?", which is a yes/no.)
 */
function solarPulse(sim: SimContext, x: number, y: number): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    pulseCell(sim, nx, ny);
  }
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
