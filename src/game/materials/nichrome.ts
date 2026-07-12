import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { MOLTEN_METAL } from './moltenmetal';
import { FIRE } from './fire';

// Nichrome (니크롬) — the resistive heating element that finally joins the
// electricity and heat subsystems together. Like Iron it's a conductive solid
// a Spark travels through (see spark.ts), but unlike Iron it *resists*: every
// pulse that passes through a nichrome cell deposits Joule heat into it, so a
// coil wired to a Battery steadily climbs in temperature and visibly glows
// from dull red toward bright orange (the `glow` ramp below). Wire a Battery
// to an Iron lead ending in a nichrome coil under a water tank and you've
// built an electric kettle; bury the coil in sawdust or run it through oil
// and it's an igniter — an electric stove with no open flame.
//
// Self-heating saturates at NICHROME_MAX_JOULE_TEMP, safely below its own
// melting point, so an element never destroys itself no matter how long the
// current runs — real heating wire's whole job. Only an *external* source
// hotter than that (Lava, Blue Flame, Thermite) can push it past
// NICHROME_MELT_TEMP, where it fails like any metal into Molten Metal.
//
// As befits the corrosion-resistant alloy, it's `acidResistant` — the one
// wiring material acid can't eat through (Iron dissolves), so a wire run
// through an acid bath keeps conducting.

/** Heat one spark deposits into a nichrome cell as it passes (see spark.ts). */
const NICHROME_JOULE_HEAT = 60;
/** Ceiling for resistive self-heating: a powered element levels off glowing
 *  hot — enough to boil water, melt salt (800°) and ignite any fuel, but below
 *  Stone's 1100° melt and its own 1450° failure point. */
export const NICHROME_MAX_JOULE_TEMP = 1050;
// A touch above Iron (1400°): the alloy holds together slightly longer, but
// Blue Flame / Thermite / Lava still destroy an element they engulf.
const NICHROME_MELT_TEMP = 1450;
// Glowing this hot it radiantly ignites `flammable` neighbors (same contact
// ignition Molten Metal uses) — the element sets fuel alight without a flame.
const RADIANT_IGNITE_TEMP = 300;
const IGNITE_CHANCE = 0.08;
// Radiative cooling: fraction of the excess over ambient shed per tick per
// DIR4 Empty (air) neighbor. Conduction alone can't remove heat here (air
// conducts nothing), so without this a powered coil's Joule heat would have
// nowhere to go but *backwards down its own leads* — creeping along the Iron
// into the Battery until it hit thermal runaway every time, and a switched-off
// coil would stay glowing forever. Radiating to open air gives the element a
// real equilibrium: a bare wire levels off around bright-glow temperatures
// (~5°/tick of Joule input balances at roughly 20 + 5/(2·rate) ≈ 730° for a
// horizontal run with air above and below), an unplugged one cools back to
// grey in a few seconds, and heat only mounts up in whatever the coil is
// *buried in* — which is the part that's supposed to get hot.
const RADIATE_RATE = 0.0035;

/**
 * Deposit one pulse's worth of Joule heat into a nichrome cell (called by
 * spark.ts as a pulse reverts back into the wire it passed through).
 *
 * Cold ends: real heating elements terminate in thick low-resistance sections
 * precisely so the terminals don't glow, and this models the same thing — a
 * cell heats only if at least two of its 8-neighbors are also nichrome (a
 * mid-pulse neighbor momentarily reads as `sparkId`, which counts). The cell
 * where the element meets its Iron lead — and the bare tip at the far end —
 * stays a cold terminal, so the hot zone sits in the element's belly instead
 * of flush against the lead, where it would pour heat straight down the wire
 * into the Battery (Iron conducts ~6× better than nichrome) and cook it into
 * thermal runaway in seconds. A run must be ≥3 cells to develop a hot middle.
 *
 * Heating only ever *raises* temperature toward the self-heating cap — an
 * element already hotter than the cap (externally heated) isn't cooled by
 * carrying current.
 */
export function nichromeJouleHeat(x: number, y: number, sim: SimContext, sparkId: number): void {
  let wired = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === NICHROME.id || nid === sparkId) wired++;
  }
  if (wired < 2) return;
  const t = sim.getTemp(x, y);
  if (t < NICHROME_MAX_JOULE_TEMP) {
    sim.setTemp(x, y, Math.min(t + NICHROME_JOULE_HEAT, NICHROME_MAX_JOULE_TEMP));
  }
}

function updateNichrome(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell can carry current again
  // (identical bookkeeping to Iron — see spark.ts on one-way pulse travel).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  const temp = sim.getTemp(x, y);
  if (temp >= NICHROME_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature, so the fresh Molten
    // Metal reads as molten instead of instantly re-freezing next tick.
    sim.set(x, y, MOLTEN_METAL.id);
    return;
  }

  if (temp >= RADIANT_IGNITE_TEMP) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      if (getMaterial(sim.get(nx, ny)).flammable && sim.chance(IGNITE_CHANCE)) {
        sim.spawn(nx, ny, FIRE.id);
      }
    }
  }

  // Shed heat to open air (see RADIATE_RATE) — the coil's only exhaust.
  if (temp > AMBIENT_TEMP) {
    let openSides = 0;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny) && sim.get(nx, ny) === EMPTY) openSides++;
    }
    if (openSides > 0) {
      sim.setTemp(x, y, temp - (temp - AMBIENT_TEMP) * RADIATE_RATE * openSides);
    }
  }
}

export const NICHROME = register({
  id: 81,
  name: 'Nichrome',
  phase: Phase.Solid,
  // Base color is the full-glow orange (the `glow` ramp's hot end, same
  // convention as Uranium/Thermite); at rest it renders as the cool grey below.
  color: rgb(255, 122, 40),
  density: 1000,
  conductive: true,
  acidResistant: true,
  category: '전기',
  // Real nichrome conducts heat poorly for a metal (~11 W/mK vs Iron's ~80) —
  // that's half of why it makes a good element: the Joule heat stays in the
  // coil and radiates/soaks into what the coil is buried in, instead of racing
  // down the Iron leads into the Battery. Still plenty to boil water it touches.
  thermal: { conductivity: 0.15 },
  // Cold it's a dull grey alloy; as resistive heating builds it ramps through
  // red toward bright orange, so a powered coil visibly glows.
  glow: { min: AMBIENT_TEMP, max: NICHROME_MAX_JOULE_TEMP, cool: rgb(112, 112, 108) },
  update: updateNichrome,
});
