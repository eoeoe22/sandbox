import { getMaterial } from './registry';
import type { SimContext } from '../engine/SimContext';

// Shared 상전이 pass — the one temperature threshold at which a cell stops being
// its material and becomes another one. Sand fuses to Molten Glass at 1250°,
// Molten Iron sets to Iron at 1150°, Dry Ice fumes to CO₂ at -40°, Lava chills to
// Stone at 700°: two dozen materials, one shape.
//
// Each of them used to spell that shape out itself — a `getTemp` compare, an
// in-place `set`, and the same three-line comment about why the `set` is in place
// — which meant the numbers that make the world's phase diagram were two dozen
// module-local `const`s, unreadable by anything but the function directly under
// them. They live on the material now (`Material.phaseChange`), so the palette, a
// codex page, or a test sweeping the registry can ask a material where it melts
// without running the simulation.
//
// This is called from each material's own `update` rather than driven by the
// engine the way `Material.life` and `Material.radiation` are, and that is
// deliberate: a few materials have to get a word in before their threshold is
// consulted. Lava touching water must become Obsidian rather than Stone even
// when it is already cold enough to set (see lava.ts), and Iron ticks its
// post-spark refractory down before it is allowed to melt away. Driving this
// from the engine would put the threshold first everywhere and quietly change
// both. An explicit call keeps every material's existing ordering exactly, at the
// cost of one line in each `update` — and a material that declares a transition
// but forgets the line is caught by test/phasechange.ts, which sweeps the
// registry and actually heats each one.

/**
 * Apply the cell's declared 상전이, if it has one and its temperature has reached
 * the threshold. Returns true if the cell became another material — the caller
 * must then stop, since the cell is no longer the material it was updating.
 */
export function tryPhaseChange(x: number, y: number, sim: SimContext): boolean {
  const change = getMaterial(sim.get(x, y)).phaseChange;
  if (change === undefined) return false;
  const t = sim.getTemp(x, y);
  const at = change.at();
  if (change.when === 'atOrAbove' ? t < at : t > at) return false;
  // In-place `set` rather than `spawn`, so the cell keeps its (now high, or now
  // low) temperature. That is what stops the transition from flapping: fresh
  // Molten Glass has to read as molten instead of instantly re-freezing on its
  // own next turn, and fresh Stone has to read as cold rock and go on drawing
  // heat out of the lava beneath it. Every pair's melt and set points are spaced
  // apart for the same reason (see e.g. moltenglass.ts) — the hysteresis and this
  // line are two halves of one rule.
  sim.set(x, y, change.into());
  return true;
}
