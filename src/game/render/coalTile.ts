// The coal bed's tile — angular lumps with lit faces, shaded faces and the deep
// cracks between them.
//
// Shared by the renderer (CanvasRenderer's `coalPattern` branch) and the palette
// icon generator (materialSvg's replay of that branch), for tntTile.ts's reason:
// this is a picture rather than a rule, and a picture copied into two files
// diverges by one character invisibly.
//
// Coal was one of the twelve materials whose chip was hand-drawn *because* the
// canvas drew it as one flat colour (docs/MATERIAL-ICONS.md §4.1 갈래 나): a lump
// of coal is not one tone, and until now the only place that showed was the
// palette. This tile is the drawing brought down to world scale — the same four
// tones in the same roles, on lumps sized for a grid rather than for an 18 px
// swatch.
import { scaled } from './color';

/**
 * Tile edge, in cells. Half the 24-cell chip, so a lump keeps the share of the
 * tile it has in the drawing (the chip's biggest lump is ~12 cells across on 24;
 * here it is ~6 on 12).
 *
 * Coal is placed in seams and heaps rather than as machine blocks, so the period
 * wants to be small enough that a lump appears in an ordinary lump: at 12 a heap
 * six cells across already shows one whole chunk and part of its neighbour.
 */
export const COAL_N = 12;

/**
 * One period, as ASCII. Authored as characters rather than generated so that what
 * ships is what someone read, and so `test/materialicons.ts` can golden it (same
 * argument as tntTile's TILE and materialSvg's GAS_CLOUD).
 *
 * | char | drawn as |
 * |---|---|
 * | `.` | the material's own colour — the crack between lumps, and the shadow they sit in |
 * | `+` | `Material.lattice` — a lump's lit face, turned up and to the left |
 * | `-` | the base scaled by COAL_MID — the same lump's face turned away from the light |
 * | `#` | the base scaled by COAL_DEEP — the pocket where two lumps meet |
 *
 * Three lumps, deliberately unequal and deliberately not centred: coal breaks
 * conchoidally into pieces of whatever size, and a tile with one lump in the
 * middle of it tiles into a polka dot. Every lump is lit on the same side, which
 * is what makes them read as solids catching one light rather than as blotches.
 *
 * The base colour is the majority of the tile (62 of 144 cells, more than any
 * single lump tone), which the icon generator relies on: it hoists the commonest
 * colour into the background rect, and the harness requires that colour to be the
 * material's own.
 */
const TILE = [
  '.+++++......',
  '+++++--.....',
  '++++---.....',
  '.+++---#....',
  '.++----#....',
  '..-----.....',
  '.....+++++..',
  '.++..+++++--',
  '.+++.++++---',
  '.++-..+++---',
  '..--..-----#',
  '.....---....',
];

/** Exported for `test/materialicons.ts` only — a row narrower than COAL_N is
 *  indexed past its end and falls through to the base colour, which here reads as
 *  a slightly smaller lump rather than as a fault. Pinned in the harness rather
 *  than thrown at module load because this module ships to the browser (see
 *  tntTile.ts). */
export const COAL_TILE_ROWS: readonly string[] = TILE;

/** A lump's shaded face, as a fraction of the material's colour. Above 1 because
 *  Coal's registered colour is very nearly black (`#1a181e`): the *base* is the
 *  crack, and every lump face has to sit above it or the tile is one dark smear.
 *  1.6 lands on `#29262f`, within a unit of the drawn chip's `#292731`. */
export const COAL_MID = 1.6;
/** The pocket between two lumps, below the base for the same reason: it is the one
 *  place light does not reach at all. 0.5 gives `#0d0c0f` against the chip's
 *  `#0d0d12` — a near-black pair, well inside a visible step. */
export const COAL_DEEP = 0.5;

/**
 * Resolve `TILE` against one material's two colours, giving the finished tile as
 * packed pixels. Called once per material, never per cell — the render loop's
 * whole cost for this pattern is one array index (same shape as buildTntTile).
 */
export function buildCoalTile(base: number, lat: number): Uint32Array {
  const mid = scaled(base, COAL_MID);
  const deep = scaled(base, COAL_DEEP);
  const buf = new Uint32Array(COAL_N * COAL_N);
  for (let y = 0; y < COAL_N; y++) {
    const row = TILE[y];
    for (let x = 0; x < COAL_N; x++) {
      const ch = row[x];
      buf[y * COAL_N + x] = ch === '+' ? lat : ch === '-' ? mid : ch === '#' ? deep : base;
    }
  }
  return buf;
}
