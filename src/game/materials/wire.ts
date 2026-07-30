import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_IRON, IRON_MELT_TEMP } from './molteniron';

// Wire (전선) — insulated cable: a conductor that carries a pulse the full length
// of a run at no loss (a metal core), but whose jacket keeps the current *inside*.
// A Spark travelling on Wire hands the pulse on only to another Wire cell; it
// never energizes a bare conductor beside it, so you can run a cable straight
// through a water tank, across an iron floor, or down a brine channel without
// electrifying any of it. What it does still deliver to is the thing at the end of
// the run — an electric appliance (`directPulse`: Fan, Laser, Pump, Electromagnet,
// Woofer) or an explosive charge — because those are one-way sinks that *consume*
// the pulse rather than passing it along (전선 → 장치에만 전달).
//
// That behavior is a one-line tag: `insulated` (see Material.insulated), read in
// spark.ts's hand-off. Everything else about Wire is ordinary — no bespoke
// propagation code, and no source has to know it exists.
//
// The gate is deliberately ONE-WAY. Current may flow *into* a wire from a bare
// conductor, a battery terminal or the 전기 브러시 — that's how a cable gets fed, and
// blocking it would leave Wire powerable only by a battery bolted directly to it.
// It just can't flow back out into one. So the invariant Wire actually promises is
// "nothing leaks out of the cable", which is the one that matters when you're
// laying wiring through a wet or metal-framed build.
//
// Before Wire, every circuit that had to cross water or touch a metal structure
// leaked into it: the pulse spread through the whole puddle/wall (electrolysing
// the water, energizing everything bolted to the frame) and usually died of
// distance before reaching the machine it was meant to run. Wire is the fix, and
// it's why it conducts at the engine's floor (loss 0, like the metals): a cable
// you route around an obstacle shouldn't be punished for the detour.
//
// Its only per-tick job — like Iron's — is ticking down the post-spark refractory
// stamped into `aux`, which is what keeps a pulse running one way down the cable
// instead of sloshing back and forth (see spark.ts).

function updateWire(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again.
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (sim.getTemp(x, y) >= IRON_MELT_TEMP) {
    // The jacket is no protection against a forge: at the core metal's melting
    // point the cable goes the way Iron does, running away as Molten Iron (and
    // taking the circuit with it). In-place `set` keeps the (now high)
    // temperature so the fresh melt doesn't instantly re-freeze.
    sim.set(x, y, MOLTEN_IRON.id);
  }
}

export const WIRE = register({
  id: 132,
  name: 'Wire',
  phase: Phase.Solid,
  // A dark rubber jacket with a copper core woven through it (a 1×1 positional
  // checkerboard, like Mesh), so a run of cable reads as braided wire rather than
  // as another flat machine block — and clearly apart from bare Iron.
  color: rgb(38, 42, 52),
  lattice: rgb(190, 118, 60),
  density: 1000,
  conductive: true,
  // 배선재: the cable this whole gate is named after — a generator that only feeds
  // wiring (the Turbine, see spark.ts's PulseGate) feeds this first of all.
  wiring: true,
  // 피복: a pulse on this cable never leaks into a neighbouring bare conductor —
  // see Material.insulated and the header note.
  insulated: true,
  category: 'electric',
  // The jacket is a poor heat path (nothing like bare Iron's 0.85), so a cable
  // doesn't turn into a heat bridge across a build the way a metal bar does.
  thermal: { conductivity: 0.12 },
  // Rubber-jacketed, so brine doesn't rust it the way it eats bare Iron; acid
  // still takes it (it isn't acidResistant), same as every other wiring material.
  update: updateWire,
});
