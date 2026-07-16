import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { detonate } from './blast';

// Woofer (우퍼) — an electric appliance, not a charge: wire a Spark into it
// (Battery/LFP Battery/Turbine) and every pulse that reaches it thumps out a
// shockwave, like a speaker cone shoving air. It reuses the blast subsystem's
// own destructive-power/durability axis (see blast.ts, introduced for
// Gunpowder's weak "shove, don't crater" concussion) pinned to POWER 0 — a
// blast too weak to beat even the flimsiest solid's durability, so every
// solid within reach blocks/shadows it completely untouched (완전한 비파괴성)
// while every loose grain of powder or puddle of liquid is flung outward as
// Debris (mass-conserving — it arcs out and rains back).
//
// Deliberately NOT `explosive`: that keeps it out of detonate()'s connected-
// mass survey (so neighboring Woofers each fire their own independent pulse
// instead of merging into one bigger blast) and, crucially, keeps the Woofer
// cell itself from ever being treated as the "detonating charge" that
// defaultCell always flashes away regardless of power. At POWER 0 the
// Woofer's own solid body also fails the "power beats durability" check, so
// it's left completely untouched — the speaker survives its own shockwave and
// can thump again on the next pulse, unlike a one-shot charge.
//
// Triggering is wired directly into spark.ts's own arc phase (see
// wooferPulse, called from updateSpark exactly like nichromeJouleHeat) rather
// than a self-check in Woofer's own per-tick update: a Spark only exists for
// the one tick it's handed off, and self-scanning from the *target* cell's
// update is scan-order dependent (whether the Spark cell reverts to its
// conductor before or after the Woofer's own turn runs that same tick, which
// flips with the engine's alternating horizontal scan direction). Driving the
// pulse from the Spark's own update — the same fix C4's `electricDetonate`
// applies to the fire hand-off problem — makes it deterministic regardless of
// scan order.
const REACH = 12; // × the global 2/3 blast-scale ⇒ ~8-cell non-destructive shove
const POWER = 0; // can't break anything, however tough — see blast.ts durability

/** Fire one non-destructive shockwave pulse from a Woofer cell energized by an
 *  adjacent Spark (called by spark.ts's arc phase). */
export function wooferPulse(sim: SimContext, x: number, y: number): void {
  
  detonate(sim, x, y, 0, { power: POWER, reach: REACH });
}

export const WOOFER = register({
  id: 109,
  name: 'Woofer',
  phase: Phase.Solid,
  // Dark speaker-cone body; the lattice weave (copper grille tone) reads as a
  // speaker grille over the cone.
  color: rgb(40, 42, 48),
  lattice: rgb(150, 108, 66),
  density: 1000,
  category: '전기',
  thermal: { conductivity: 0.3 },
});
