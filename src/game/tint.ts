import { Phase, type Material } from './engine/types';

/**
 * Per-particle color variation — the shared rules that the renderer (which shows
 * the variation) and the Simulation (which updates it over time) both read, so
 * the two never disagree about which materials vary or by how much.
 *
 * Each cell carries a `tint` byte (see Grid.tint). The renderer maps it to a
 * signed brightness offset in `[-amp, +amp]` around the material's base color,
 * so a mass of sand or water is a field of slightly different shades instead of
 * one flat block. How the tint changes over time depends on the phase:
 *   - Powder: re-rolled only on the ticks a grain actually moves, so a settled
 *     pile is a stable grain and a falling stream shimmers.
 *   - Liquid: drifts slowly every tick (even at rest), so a still pool has a
 *     gentle, living shimmer.
 * Glow materials (Lava, molten metals) opt out — they're already shaded by
 * temperature, so a tint on top would fight the heat ramp.
 */

/** Default brightness spread for powders that don't set their own `colorVary`. */
export const POWDER_VARY = 18;
/** Default brightness spread for liquids that don't set their own `colorVary`. */
export const LIQUID_VARY = 22;

/**
 * Liquid tint drift, an Ornstein–Uhlenbeck-style step applied per liquid cell
 * each tick: the centered tint decays toward neutral (128) and then takes a
 * small random kick. The pull-to-center keeps the shimmer from wandering off to
 * a permanent extreme, so a still pool keeps breathing gently around its base
 * color instead of freezing into one fixed speckle pattern.
 */
export const LIQUID_DRIFT_DECAY = 0.88;
export const LIQUID_DRIFT_KICK = 30;

/** Neutral tint (no brightness offset). Freshly placed cells are seeded around
 *  the full range, but this is the value that maps to "base color, unchanged". */
export const TINT_NEUTRAL = 128;

/** Temporal update mode for a material's per-particle tint (see Simulation). */
export const VARY_NONE = 0;
export const VARY_ON_MOVE = 1; // powder: re-roll on move
export const VARY_DRIFT = 2; // liquid: drift slowly over time

/**
 * Brightness spread for a material in 0..255 channel units, or 0 for a flat
 * material with no per-particle variation. Explicit `colorVary` wins; otherwise
 * powders and liquids get a phase default and everything else stays flat. Glow
 * materials never vary — the temperature ramp owns their color.
 */
export function varyAmplitude(m: Material): number {
  if (m.glow) return 0;
  if (m.colorVary !== undefined) return m.colorVary;
  if (m.phase === Phase.Powder) return POWDER_VARY;
  if (m.phase === Phase.Liquid) return LIQUID_VARY;
  return 0;
}

/** How this material's tint is updated over time (only powders/liquids do). */
export function varyMode(m: Material): number {
  if (varyAmplitude(m) <= 0) return VARY_NONE;
  if (m.phase === Phase.Powder) return VARY_ON_MOVE;
  if (m.phase === Phase.Liquid) return VARY_DRIFT;
  return VARY_NONE;
}
