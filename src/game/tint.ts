import { Phase, type Material } from './engine/types';

/**
 * Per-particle color variation — the shared rules that the renderer (which shows
 * the variation) and the Simulation (which drifts the background field) both
 * read, so the two never disagree about which materials vary or by how much.
 *
 * Two different textures, picked by phase:
 *   - Powder (VARY_PARTICLE): each grain carries its own `tint` byte (Grid.tint),
 *     seeded once when the grain is created and then fixed — it travels with the
 *     grain as it moves but never re-rolls, so a pile is a stable field of grains.
 *   - Liquid (VARY_BACKGROUND): the grain has no tint of its own; instead the
 *     renderer samples a positional background field (Grid.bgTint) at the cell's
 *     location. As liquid flows across space it picks up whatever shade the
 *     background holds there, and the background itself drifts slowly over time —
 *     so a pool shimmers with a texture tied to space, not to the particles.
 * Glow materials (Lava, molten metals) opt out — they're already shaded by
 * temperature, so a tint on top would fight the heat ramp.
 *
 * The tint byte maps to a signed per-channel brightness offset in `[-amp, +amp]`
 * around the material's base color (see the renderer).
 */

/** Default brightness spread for powders that don't set their own `colorVary`. */
export const POWDER_VARY = 18;
/** Default brightness spread for liquids that don't set their own `colorVary`. */
export const LIQUID_VARY = 22;

/**
 * Background-field drift, an Ornstein–Uhlenbeck-style step applied to the
 * positional `bgTint` field: the centered value decays toward neutral (128) then
 * takes a small random kick. The pull-to-center keeps the shimmer from wandering
 * off to a permanent extreme. Only a fraction of the field is nudged each tick
 * (see BG_DRIFT_STRIDE) so the whole thing breathes slowly and cheaply.
 */
export const BG_DRIFT_DECAY = 0.88;
export const BG_DRIFT_KICK = 30;
/** Each tick only 1/STRIDE of the background field is nudged, cycling through
 *  the full field every STRIDE ticks — keeps the drift slow and the per-tick
 *  cost a fraction of the grid. */
export const BG_DRIFT_STRIDE = 8;

/** Neutral tint (no brightness offset). Seeds span the full range, but this is
 *  the value that maps to "base color, unchanged". */
export const TINT_NEUTRAL = 128;

/** Which tint field a material samples (see above). */
export const VARY_NONE = 0;
export const VARY_PARTICLE = 1; // powder: fixed per-particle tint (Grid.tint)
export const VARY_BACKGROUND = 2; // liquid: positional background field (Grid.bgTint)

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

/** Which tint field this material samples: per-particle (powder), positional
 *  background (liquid), or none. */
export function varyMode(m: Material): number {
  if (varyAmplitude(m) <= 0) return VARY_NONE;
  if (m.phase === Phase.Powder) return VARY_PARTICLE;
  if (m.phase === Phase.Liquid) return VARY_BACKGROUND;
  return VARY_NONE;
}
