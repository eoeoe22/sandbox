// Palette icons for materials — the counterpart of objectSvg.ts.
//
// An object's palette chip has always been its real in-world sprite, which is why
// the object row reads at a glance. A material's chip, by contrast, was a flat
// rectangle of `Material.color`: the same 18×18 block for sand, for mesh, for a
// conveyor belt, for lava. Everything the renderer actually draws — the per-grain
// speckle, the woven lattice, the battery staircase, the chevrons, the heat ramp
// — was thrown away before it reached the UI.
//
// So this module does not invent art. It replays `CanvasRenderer.render()`'s
// branch chain over a small square patch and hands the result to the same
// run-merging SVG writer the object chips use. The branch order here mirrors the
// renderer's exactly, and the shading arithmetic is literally the same functions
// (render/color.ts) — if a pattern is ever retuned in the renderer, the icon
// follows without anyone remembering to update it.
//
// Two things the icon cannot copy, and what it does instead:
//
//   • The tint fields. `Grid.tint` (per-grain) and `Grid.bgTint` (positional) are
//     world state; the palette has no world. The icon synthesizes a byte from a
//     pure hash of (id, x, y) and pushes it through the identical
//     `((src - 128) * amp) >> 7` arithmetic, so the texture is statistically the
//     canvas's rather than pixel-identical to any particular cell — and it is
//     deterministic, so a material looks the same in its category flyout, in the
//     favourites row and in search results (no `Math.random()` here, ever).
//
//   • Per-cell state that only exists in play: a machine's powered countdown, a
//     glow material's live temperature, a Seed's germination progress. The icon
//     shows the state you get when you *paint* the material (unpowered, and the
//     direction PointerPainter stamps by default), except where showing a range
//     is the whole point — see the glow and Seed notes below.
//
// Deliberately not replayed: `Material.freeze` frost. The palette shows every
// material in its warm state; a chip that turned into a block of ice depending on
// nothing the user did would be noise.
import { EMPTY, Phase, type Material } from '../engine/types';
import { getMaterial } from '../materials/registry';
import { varyAmplitude, varyMode, VARY_PARTICLE, TINT_NEUTRAL } from '../tint';
import { tinted, buildGlow, shade } from './color';
import { spritePaths, pixelSvg } from './spriteSvg';

/**
 * Patch edge, in cells. 9 is chosen so the icon lands on whole device pixels at
 * the size it is actually drawn: the palette swatch is 18 CSS px, so a cell is
 * exactly 2 px at DPR 1 and 4 px at DPR 2, and `shape-rendering="crispEdges"`
 * has nothing to round away. (12 would drop every fourth row at DPR 1; 8 breaks
 * at DPR 2.) It is also enough cells to carry every pattern the renderer draws:
 * 4½ lattice periods, ~2 battery tiles, 2 conveyor chevrons, a solar cell plus
 * its seams, and 81 grains of speckle.
 */
const N = 9;

/** The patch edge, for harnesses that rasterize a generated icon back to cells. */
export const MATERIAL_ICON_CELLS = N;

/** The renderer's tile constants, mirrored (see CanvasRenderer). */
const TRI_SPAN = 8;
const TRI_STEP = 5;
const SOLAR_CELL_W = 4;
const SOLAR_CELL_H = 6;

/** How far a glow icon's ramp reaches down toward the cool end. A glow material
 *  is drawn from its live temperature, so there is no single honest colour for
 *  it — showing only `Material.color` claims it is always at max heat, and
 *  showing the whole ramp buries the hot colour people recognize it by. The icon
 *  spans the top 55% of the ramp: unmistakably the material's hot colour, with
 *  enough fall-off to say "this one glows". */
const GLOW_ICON_FLOOR = 0.45;

/** Jitter applied to the glow ramp position per cell, as a fraction of the
 *  ramp's range. A real pool of lava is mottled — neighbouring cells sit at
 *  different temperatures — so a clean gradient would read as a UI gradient
 *  rather than as molten material. */
const GLOW_ICON_MOTTLE = 0.09;

/** Fraction of a gas icon's cells painted at the bottom row (the top row is
 *  fully covered). A gas is a flat colour per cell in-world, but you never see a
 *  solid slab of one — you see scattered cells with the board showing between
 *  them. A filled rectangle would read as a solid; this dissolve is what a gas
 *  actually looks like in play. */
const GAS_FLOOR_COVERAGE = 0.4;

/**
 * Pure 32-bit mix of (id, x, y) → a byte in 0..255. Stands in for the random
 * tint bytes the world seeds, so an icon is reproducible: the same material
 * always yields the same speckle, in every place its chip is drawn.
 */
function hash8(id: number, x: number, y: number): number {
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
 * suggests, and an icon that used the flat uniform hash would be twice as noisy
 * as the thing it depicts. Summing three hashes approximates a normal (σ ≈ 127.5
 * for the sum), and 36.5 / 127.5 is the factor that lands it on the real one.
 */
const BG_SIGMA_SCALE = 36.5 / 127.5;
const BG_SUM_MEAN = 3 * 127.5;

/** The synthetic stand-in for whichever tint field this material samples:
 *  per-grain white noise for a powder/solid, the narrower settled background
 *  field for a liquid (see BG_SIGMA_SCALE). */
function tintSrc(m: Material, x: number, y: number): number {
  if (varyMode(m) === VARY_PARTICLE) return hash8(m.id, x, y);
  const sum = hash8(m.id, x, y) + hash8(m.id, x + 71, y + 29) + hash8(m.id, x + 13, y + 97);
  const v = Math.round(TINT_NEUTRAL + (sum - BG_SUM_MEAN) * BG_SIGMA_SCALE);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** The renderer's brightness grain, applied exactly as it is in-world. */
function grain(m: Material, c: number, x: number, y: number): number {
  const amp = varyAmplitude(m);
  if (amp === 0) return c;
  return tinted(c, ((tintSrc(m, x, y) - TINT_NEUTRAL) * amp) >> 7);
}

/** Linear blend of two packed colours, `t` of `other` (icon-only — used for the
 *  gas dissolve, which has no in-world counterpart to share code with). */
function blend(a: number, b: number, t: number): number {
  const it = 1 - t;
  const r = (((a & 0xff) * it + (b & 0xff) * t) | 0) & 0xff;
  const g = ((((a >> 8) & 0xff) * it + ((b >> 8) & 0xff) * t) | 0) & 0xff;
  const bl = ((((a >> 16) & 0xff) * it + ((b >> 16) & 0xff) * t) | 0) & 0xff;
  return (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0;
}

/**
 * Fill an N×N patch with the colour the renderer would give each cell.
 *
 * The `if`/`else if` order below is the renderer's order, not a rewrite of it:
 * several materials set more than one hint (a Fan is `lattice` *and*
 * `windArrow`, Diamond is `lattice` *and* `checker2x2`, Solar Panel is `lattice`
 * *and* `solarPattern`) and only the first matching branch draws. `Material.lattice`
 * on those is just supplying the second tone. Reordering these would quietly
 * change what half the electric category looks like.
 */
function patchFor(m: Material): Uint32Array {
  const buf = new Uint32Array(N * N);
  const base = m.color;
  const lat = m.lattice ?? base;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let c: number;

      if (m.auxPalette) {
        // Seed is the only palette-exposed material here. Its aux is germination
        // progress (brown → green), and a fresh one is 0 — but a flat brown chip
        // says "pebble", not "this grows". So the icon runs the ramp up the tile,
        // squared so the lower two-thirds stay the dormant brown you actually
        // place and only the crown greens up: a seed with a sprout on it.
        const p = (N - 1 - y) / (N - 1);
        const idx = Math.round(p * p * (m.auxPalette.length - 1));
        c = grain(m, m.auxPalette[idx % m.auxPalette.length], x, y);
      } else if (m.tintPalette) {
        // Fireworks: each grain draws the palette entry its own tint byte names,
        // so a pile is a speckle of genuinely different colours. The icon indexes
        // with the same synthetic byte it shades with, exactly as the renderer
        // indexes and shades with the one `tint` byte.
        c = grain(m, m.tintPalette[hash8(m.id, x, y) % m.tintPalette.length], x, y);
      } else if (m.arrow) {
        // The three directional patterns below are drawn in the orientation the
        // painter stamps on a fresh cell, so a chip shows what a click places:
        // CONVEYOR_RIGHT for a belt, FAN_RIGHT for a Fan/Laser/Shaped Charge (see
        // PointerPainter.paintCells' `initAux`). The powered countdown in aux's
        // high bits is 0 on a fresh cell, so none of the renderer's "brighten
        // while running" branches fire here either.
        //
        // Conveyor: period-4 tent, un-mirrored (a fresh belt runs right).
        const fold = y & 2 ? 3 - (y & 3) : y & 3;
        c = (x & 3) === fold ? lat : base;
      } else if (m.windArrow) {
        // Fan / Laser, stamped FAN_RIGHT: chevron along x, folded over y. The
        // powered countdown is 0 on a fresh cell, so no brightening.
        const fold = y & 2 ? 3 - (y & 3) : y & 3;
        c = (x & 3) === fold ? lat : base;
      } else if (m.triArrow) {
        // Shaped Charge, stamped FAN_RIGHT: arrowheads pointing right. Lanes run
        // across y, depth along x; lanes 1..6 fill 1,2,3,3,2,1 toward the tip and
        // the outer lanes are the gutter that keeps neighbours from merging.
        const l = (y % TRI_SPAN) - 1;
        const t = x % TRI_STEP;
        c = l >= 0 && l < 6 && t <= (l < 3 ? l : 5 - l) ? lat : base;
      } else if (m.coilPattern) {
        // Electromagnet: two lit rows of every four — copper windings on a dark core.
        const band = y & 3;
        c = band === 1 || band === 2 ? lat : base;
      } else if (m.stripePattern) {
        // Pump: one lit column of every three — open risers.
        c = x % 3 === 1 ? lat : base;
      } else if (m.solarPattern) {
        // Solar Panel: photovoltaic cells separated by thin seams.
        c = x % SOLAR_CELL_W === SOLAR_CELL_W - 1 || y % SOLAR_CELL_H === SOLAR_CELL_H - 1 ? lat : base;
      } else if (m.checker2x2) {
        // Diamond: 2×2 positional checkerboard with a low-range grain on top.
        c = grain(m, ((x >> 1) ^ (y >> 1)) & 1 ? lat : base, x, y);
      } else if (m.lattice) {
        // Mesh / Wire / Woofer: a woven two-tone grid.
        c = (x ^ y) & 1 ? lat : base;
      } else if (m.batteryPattern) {
        // Lithium / LFP Battery: a 2-step diagonal staircase on a 4×5 tile, in
        // flat black — the renderer's literal 0xff000000, not a shade of the base.
        const px = x % 4;
        const py = y % 5;
        c = (px === 1 && (py === 1 || py === 2)) || (px === 2 && (py === 2 || py === 3))
          ? 0xff000000
          : base;
      } else if (m.glow) {
        // Lava, the moltens, the uraniums: colour comes from live temperature, so
        // the icon shows the ramp rather than pretending one point on it is the
        // material. Hot at the top (heat rises), mottled per cell so it reads as
        // molten rather than as a UI gradient, and floored partway up so the hot
        // end still dominates. The grain rides on top for the two glow materials
        // that also vary (Thermite, Nuke Waste), exactly as it does in-world.
        const span = m.glow.max - m.glow.min;
        const up = (N - 1 - y) / (N - 1);
        const jitter = (hash8(m.id, x, y) / 255 - 0.5) * 2 * GLOW_ICON_MOTTLE;
        let f = GLOW_ICON_FLOOR + up * (1 - GLOW_ICON_FLOOR) + jitter;
        if (f < 0) f = 0;
        else if (f > 1) f = 1;
        c = grain(m, shade(buildGlow(m.glow, base), m.glow.min + f * span), x, y);
      } else if (m.phase === Phase.Gas && varyAmplitude(m) === 0) {
        // A gas cell is one flat colour in-world, but a gas never occupies solid
        // ground: what you see is scattered cells with the board between them. A
        // filled rectangle would read as a solid block of the same colour, so the
        // icon dissolves downward into the board's own background — the shape of
        // a cloud rather than a brick.
        const down = y / (N - 1);
        const coverage = 1 - down * (1 - GAS_FLOOR_COVERAGE);
        const lit = hash8(m.id, x, y) < coverage * 255;
        c = lit ? base : blend(base, getMaterial(EMPTY).color, 0.82);
      } else {
        // Everything else: the base colour, with the per-particle brightness
        // grain if the material has one (powders, liquids, the tinted solids).
        // Flat solids and the two mirror-flat liquids (Mercury, Liquid Gallium,
        // both `colorVary: 0` on purpose) land here as a single colour — which is
        // exactly what the canvas draws for them.
        c = grain(m, base, x, y);
      }

      buf[y * N + x] = c;
    }
  }
  return buf;
}

/**
 * Emit the patch as SVG, painting its most common colour once as a full-tile
 * rect and leaving those cells transparent so `spritePaths` skips them. A flat
 * material costs a single rect; a battery, a coil or a solar panel costs that
 * rect plus only its pattern cells. Speckle has no dominant colour worth
 * hoisting, so it pays for all 81 cells — which is why the rest goes out as
 * per-colour paths rather than per-run rects (see spritePaths).
 */
function patchSvg(buf: Uint32Array): string {
  const counts = new Map<number, number>();
  for (const c of buf) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bg = buf[0];
  let best = 0;
  for (const [c, n] of counts) {
    if (n > best) {
      best = n;
      bg = c;
    }
  }
  const sparse = new Uint32Array(buf.length);
  for (let i = 0; i < buf.length; i++) sparse[i] = buf[i] === bg ? 0 : buf[i];
  // The background rect is written by hand rather than through spriteRects
  // because it spans the whole tile as one shape, not N one-row runs.
  const r = bg & 0xff;
  const g = (bg >> 8) & 0xff;
  const b = (bg >> 16) & 0xff;
  const bgHex = '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  return pixelSvg(
    N,
    N,
    `<rect x="0" y="0" width="${N}" height="${N}" fill="${bgHex}"/>` + spritePaths(sparse, N, N),
    'mat-svg',
  );
}

/** id → generated markup. Memoized at module scope, not inside a component: the
 *  palette's category and search lists are `$derived.by`, so they re-run on every
 *  locale switch and every keystroke — building 126 icons per keystroke would be
 *  a real cost, building them once is free. */
const CACHE = new Map<number, string>();

/**
 * SVG markup for a material's palette swatch — inject with Svelte `{@html}`.
 * The string is built from the material registry and this module's own
 * arithmetic (no user input), and contains only `<rect>`s.
 */
export function materialSvgFor(m: Material): string {
  let svg = CACHE.get(m.id);
  if (svg === undefined) {
    svg = patchSvg(patchFor(m));
    CACHE.set(m.id, svg);
  }
  return svg;
}
