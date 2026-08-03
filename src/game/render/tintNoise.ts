// Synthetic tint grain — the renderer's per-cell brightness texture, reproduced
// where there is no world to read it from.
//
// In play the grain comes from cell state: `Grid.tint` (a byte seeded once per
// grain and carried with it) and `Grid.bgTint` (a positional field that drifts).
// Two callers draw materials with no grid behind them and so cannot read either —
// the palette icon generator (materialSvg.ts) and the start screen's title tiles
// (titleTile.ts). Both synthesize the byte from a pure hash of (id, x, y) and push
// it through the renderer's own `((src - 128) * amp) >> 7` arithmetic, so the
// texture is statistically the canvas's rather than pixel-identical to any
// particular cell — and it is deterministic, so a material looks the same in its
// category flyout, in the favourites row and in search results, and the title tile
// is byte-stable from one build to the next (no `Math.random()` here, ever).
//
// The shading itself is not reimplemented: `tinted` is the same function the render
// loop calls, and the amplitudes come from `game/tint.ts`, the single source both
// the renderer and the Simulation read.
import type { Material } from '../engine/types';
import { varyAmplitude, varyCellAmplitude, varyMode, VARY_PARTICLE, TINT_NEUTRAL } from '../tint';
import { tinted } from './color';

/**
 * Pure 32-bit mix of (id, x, y) → a byte in 0..255. Stands in for the random
 * tint bytes the world seeds, so the drawing is reproducible: the same material
 * always yields the same speckle, everywhere it is drawn.
 */
export function hash8(id: number, x: number, y: number): number {
  let h = (id | 0) + Math.imul(x | 0, 0x27d4eb2d) + Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d);
  // The top byte is the best-mixed one after this many rounds.
  return (h >>> 24) & 0xff;
}

/**
 * Scale that turns a sum of three hash bytes into the `bgTint` field's *settled*
 * spread. The background field is seeded uniform over 0..255 (σ ≈ 73.6), but the
 * Ornstein–Uhlenbeck drift in Simulation immediately pulls it in: with
 * BG_DRIFT_DECAY 0.88 and a ±BG_DRIFT_KICK (30) kick, its stationary variance is
 * 300 / (1 − 0.88²) ≈ 1330, i.e. σ ≈ 36.5 around neutral — about half the seed's.
 * So a liquid pool in play shimmers noticeably *less* than its raw byte range
 * suggests, and a drawing that used the flat uniform hash would be twice as noisy
 * as the thing it depicts. Summing three hashes approximates a normal (σ ≈ 127.5
 * for the sum), and 36.5 / 127.5 is the factor that lands it on the real one.
 */
const BG_SIGMA_SCALE = 36.5 / 127.5;
const BG_SUM_MEAN = 3 * 127.5;

/** The synthetic stand-in for whichever tint field this material samples:
 *  per-grain white noise for a powder/solid, the narrower settled background
 *  field for a liquid (see BG_SIGMA_SCALE). */
export function tintSrc(m: Material, x: number, y: number): number {
  if (varyMode(m) === VARY_PARTICLE) return hash8(m.id, x, y);
  const sum = hash8(m.id, x, y) + hash8(m.id, x + 71, y + 29) + hash8(m.id, x + 13, y + 97);
  const v = Math.round(TINT_NEUTRAL + (sum - BG_SUM_MEAN) * BG_SIGMA_SCALE);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Mirror of the renderer's tint-block anchor mask (see Material.tintBlock): a
 * blocked material shades a whole square of cells from one sample, so a drawing
 * clears the same low bits of x and y before hashing and comes out flaked the same
 * way the canvas is.
 *
 * The palette patch edge (`N`) is odd, so its last row and column are a 1-cell
 * fringe rather than a whole block. That is the same thing the world does wherever
 * a body's edge lands off the block lattice, and at the amplitudes this is used for
 * (Obsidian's 6) it is far below a visible step — but a future material with a wide
 * blocked grain would show it, and the fix then is a patch edge that is a multiple
 * of the block.
 */
export function tintAnchor(m: Material): number {
  const b = m.tintBlock ?? 1;
  return b > 1 ? ~(b - 1) : -1;
}

/** The renderer's brightness grain, applied exactly as it is in-world — both levels
 *  of it. The coarse one shades from the (possibly block-anchored) sample by
 *  `colorVary`; the fine one shades again from the cell's own sample by
 *  `tintCellVary`, which is what keeps a 2×2 flake from reading as a flat painted
 *  square (Coal, Obsidian — see Material.tintCellVary). The two offsets add, exactly
 *  as they do in the render loop. */
export function grain(m: Material, c: number, x: number, y: number): number {
  const amp = varyAmplitude(m);
  const cellAmp = varyCellAmplitude(m);
  if (amp === 0 && cellAmp === 0) return c;
  const mask = tintAnchor(m);
  let d = 0;
  if (amp !== 0) d = ((tintSrc(m, x & mask, y & mask) - TINT_NEUTRAL) * amp) >> 7;
  if (cellAmp !== 0) d += ((tintSrc(m, x, y) - TINT_NEUTRAL) * cellAmp) >> 7;
  return tinted(c, d);
}
