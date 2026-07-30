// Headless harness for the material palette icons (render/materialSvg.ts): the
// generated swatch that replaced the flat colour rectangle every material used
// to get. Run: `node test/run-materialicons.mjs`.
//
// What this pins, and why each one is here:
//
//   • Determinism. The very first thing the file does is make `Math.random`
//     throw, so any icon built with a random draw fails loudly instead of
//     quietly making a material look different in its category flyout than in
//     search results.
//   • Branch order. Most of the electric/exotic materials set more than one
//     visual hint (a Laser is `lattice` AND `windArrow`; Diamond is `lattice` AND
//     `checker2x2`; a Solar Panel is `lattice` AND `solarPattern`; a Fan and a
//     Turbine are `lattice` AND `rotorPattern`), and only the
//     first matching branch draws — `lattice` on those is just supplying the
//     second tone. The golden tiles below are what catches someone reordering
//     the chain and turning half the electric tab into checkerboards.
//   • The tile formulas themselves, as pictures rather than as a second copy of
//     the arithmetic: a golden that changes shows a reviewer exactly how the
//     icon changed.
//   • Markup safety. These strings go through Svelte `{@html}` and the same one
//     can be live several times in one document, so nothing document-scoped
//     (`id`, `<defs>`, `<style>`, `url(#…)`) may appear in them.
//   • The size budget. The palette's search view has no virtualization, so all
//     126 icons can be in the DOM at once.

// Written above the imports for emphasis, but note that is NOT what sequences it:
// ES modules evaluate their whole import graph before any of the importing
// module's own top-level statements, wherever those statements appear in the
// file. This override therefore runs *after* the registry is populated, and it
// is safe only because nothing in that graph builds an icon at module-evaluation
// time (materialSvgFor is lazy and memoized on first call). `check`ing that the
// trap is still armed at the first icon build, below, is what actually holds the
// guarantee — don't rely on the line position here.
const REAL_RANDOM = Math.random;
Math.random = () => {
  throw new Error('material icon generation must be deterministic (no Math.random)');
};

import { MATERIALS } from '../src/game/materials/index';
import {
  materialSvgFor,
  generatedSvgFor,
  hasHandIcon,
  handIconKeys,
  hasHazardMark,
  GAS_CLOUD_ROWS,
  HAZARD_TREFOIL_ROWS,
  HAZARD_CATEGORY,
} from '../src/game/render/materialSvg';
import { varyAmplitude, varyCellAmplitude, varyMode, VARY_PARTICLE } from '../src/game/tint';
import { EMPTY, Phase, type Material } from '../src/game/engine/types';
import { getMaterial } from '../src/game/materials/registry';
import { hex } from '../src/game/render/color';
import { TNT_N, TNT_TILE_ROWS } from '../src/game/render/tntTile';
import {
  ROTOR_N,
  ROTOR_TILE_ROWS,
  rotorAccumulate,
  rotorBlockIndex,
  rotorFrame,
  rotorSpin,
} from '../src/game/render/rotorTile';
import {
  WOOFER_P,
  WOOFER_CAP_R2,
  WOOFER_CONE_R2,
  WOOFER_R2,
  WOOFER_REST,
  WOOFER_THUMP_STEPS,
  wooferExcursion,
  wooferTileIndex,
} from '../src/game/render/wooferDriver';
import '../src/game/materials';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** Run a check whose subject may be malformed enough to throw while being read.
 *  Without this a single unparseable icon aborts the process at whichever check
 *  touches it first, and every check after that never runs — so a one-line
 *  regression reports as one failure instead of the dozen it actually caused.
 *
 *  Every check from section 2 on goes through this, because all of them reach
 *  the icon through `raster()`, which throws on markup it cannot account for.
 *  Anything the body already reported before it threw keeps its own result. */
function checkThrows(name: string, body: () => void): void {
  try {
    body();
  } catch (e) {
    check(name, false, (e as Error).message);
  }
}

// Nothing has built an icon yet — every generator call in this file comes after
// this point, so the trap above is provably in force for all of them.
check('the no-random trap is armed before the first icon is built', Math.random !== REAL_RANDOM);

const byName = (name: string): Material => {
  const m = (MATERIALS as readonly Material[]).find((x) => x.name === name);
  if (!m) throw new Error('no palette material ' + name);
  return m;
};

/** Rasterize an icon back to a grid of `#rrggbb`, which also proves the emitted
 *  markup is only the shapes it claims to be.
 *
 *  Handles both kinds the palette ships: a derived tile (one full-tile rect plus
 *  per-colour run paths) and a hand-drawn one (a full-tile rect plus plain
 *  rects). Keeping one rasterizer means every structural check below applies to
 *  both without knowing which it is looking at. */
function raster(svg: string): { grid: string[]; n: number } {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!vb || vb[1] !== vb[2]) throw new Error('icon viewBox is not square: ' + svg.slice(0, 120));
  const n = +vb[1];
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-f]{6})"\/>/g)];
  const bg = rects[0];
  if (!bg || +bg[1] !== 0 || +bg[2] !== 0 || +bg[3] !== n || +bg[4] !== n)
    throw new Error('icon does not open with a full-tile background rect: ' + svg.slice(0, 120));
  const grid: string[] = new Array(n * n).fill(bg[5]);
  for (const r of rects.slice(1)) {
    const [x, y, w, h] = [+r[1], +r[2], +r[3], +r[4]];
    if (x + w > n || y + h > n) throw new Error('rect leaves the tile: ' + r[0]);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j * n + i] = r[5];
  }
  // Per-cell, not a running total. The old check summed painted area and compared it
  // to the tile — which can only fire when the paths jointly cover the whole tile
  // twice, and a material icon is mostly background, so realistic overlap sailed
  // through it: two 3×3 boxes overlapping by 2×2 on a 9-cell tile sum to 18 against
  // 81 and the cell just silently takes whichever path was written last. Marking each
  // cell as it is painted catches the first double-write instead, wherever it is.
  //
  // Paths only. The background rect is deliberately painted over by everything above
  // it, and a hand-drawn tile's rects are allowed to overlap each other — the
  // acceptance script warns about that rather than rejecting it, because overlapping
  // rects still render correctly. `spritePaths` output, by contrast, is supposed to be
  // a partition, and that is what this holds it to.
  const inked = new Uint8Array(n * n);
  for (const pm of svg.matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]+)"\/>/g)) {
    // Boxes, not rows: spritePaths grows each horizontal run downward while the rows
    // beneath repeat it, so `v` is a height rather than the constant 1 it used to be
    // (that merge is what keeps the resampled hazard tiles inside the byte budget).
    for (const seg of pm[2].matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g)) {
      const x = +seg[1];
      const y = +seg[2];
      const run = +seg[3];
      const tall = +seg[4];
      if (+seg[5] !== run) throw new Error('malformed run in path data');
      if (x + run > n || y + tall > n) throw new Error('path box leaves the tile: ' + seg[0]);
      for (let j = y; j < y + tall; j++)
        for (let k = 0; k < run; k++) {
          const at = j * n + x + k;
          if (inked[at]) throw new Error(`paths overlap at (${x + k}, ${j}): ` + seg[0]);
          inked[at] = 1;
          grid[at] = pm[1];
        }
    }
    // Every segment in the data must be one the loop above accounted for; a shape the
    // regex silently skipped would read as background in every check below.
    const segs = (pm[2].match(/M/g) ?? []).length;
    const seen = [...pm[2].matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g)].length;
    if (segs !== seen) throw new Error('unreadable segment in path data: ' + pm[2].slice(0, 60));
  }
  // Every shape in the markup must be one this loop actually accounted for.
  const shapes = (svg.match(/<(rect|path|circle|polygon|ellipse|g)\b/g) ?? []).length;
  const accounted = rects.length + (svg.match(/<path /g) ?? []).length;
  if (shapes !== accounted) throw new Error('unexpected shape element in icon');
  return { grid, n };
}

/** A tile as ASCII: `.` = the tile's background rect, which for every pattern here
 *  is the material's own `color` since the pattern is always the minority of cells.
 *  The pattern's own tones take a glyph each, assigned by relative lightness — a
 *  lone one is `o`, and where there are two the lighter is `i` and the darker `o`.
 *  (Ranking among the pattern tones rather than against the base is what keeps a
 *  two-tone golden reading `o` whether its pattern is lighter than the base, as the
 *  panel's seams are, or darker, as the battery's staircase is.)
 *
 *  `want` is the number of distinct tones the whole tile must have. Almost every
 *  pattern is two-tone (base + `lattice`); Wall's masonry also lights the top of
 *  each brick, so it needs three, and TNT's labelled bundle needs seven. Asserting
 *  the count is part of the golden: a branch that lost or gained a tone would
 *  otherwise still render as plausible ASCII.
 *
 *  Ranking by lightness only stays stable while the tones are well separated, which
 *  they are — TNT's six run 236 / 206 / 175 / 151 / 53 / 26 in luminance. A pattern
 *  whose tones sat a unit or two apart would swap glyphs on an unrelated retune and
 *  fail here with a picture rather than a reason. */
const PATTERN_GLYPHS = ['i', 'o', 'O', 'x', 'X', '#'];

function ascii(m: Material, want = 2): string {
  // Reads the generator directly. Solar Panel's chip is hand-drawn art now, but
  // its `solarPattern` branch is still live and still what this golden pins.
  const svg = generatedSvgFor(m);
  const { grid: g, n } = raster(svg);
  const bg = new RegExp(`width="${n}" height="${n}" fill="(#[0-9a-f]{6})"`).exec(svg)![1];
  if (bg !== hex(m.color)) throw new Error(`${m.name}: pattern outweighs its base colour`);
  const tones = new Set(g);
  if (tones.size !== want) throw new Error(`${m.name} has ${tones.size} tones, expected ${want}`);
  const lum = (c: string) =>
    parseInt(c.slice(1, 3), 16) * 0.3 + parseInt(c.slice(3, 5), 16) * 0.59 + parseInt(c.slice(5, 7), 16) * 0.11;
  const ranked = [...tones].filter((c) => c !== bg).sort((a, b) => lum(b) - lum(a));
  // One tone: `o`. Two: lighter `i`, darker `o` — so the glyph carries which is which.
  const glyph = new Map(ranked.map((c, i) => [c, ranked.length === 1 ? 'o' : PATTERN_GLYPHS[i]]));
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = '';
    for (let x = 0; x < n; x++) {
      const c = g[y * n + x];
      row += c === bg ? '.' : (glyph.get(c) ?? '?');
    }
    rows.push(row);
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// 1. Every palette material produces structurally sane markup.
//    Runs before the goldens so a broken emitter reports as one structural
//    failure rather than as eight mangled pictures.
// ---------------------------------------------------------------------------

const all = MATERIALS as readonly Material[];
let worstBytes = 0;
let worstName = '';
let totalBytes = 0;
let badMarkup: string[] = [];
let notFullBleed: string[] = [];

for (const m of all) {
  const svg = materialSvgFor(m);
  totalBytes += svg.length;
  if (svg.length > worstBytes) {
    worstBytes = svg.length;
    worstName = m.name;
  }
  // Nothing document-scoped: these strings are injected with {@html} and the
  // same one can appear several times in one document at once.
  if (/\bid=|<defs|<style|url\(|<script|<image|<use\b/.test(svg)) badMarkup.push(m.name);
  // Full-bleed: the swatch is a filled tile, so a transparent hole would show the
  // chip's background through — and that background changes when the chip is
  // selected, which would make the icon shift colour on click. Asserted against
  // the emitted markup, not against raster()'s reconstruction: raster() seeds the
  // whole grid from the background rect before overlaying paths, so it fabricates
  // full coverage by construction and could never observe a gap.
  const vb = /viewBox="0 0 (\d+) \d+"/.exec(svg);
  const n = vb ? vb[1] : '?';
  if (!svg.includes(`<rect x="0" y="0" width="${n}" height="${n}" fill="#`)) notFullBleed.push(m.name);
  if (/fill="none"|fill-opacity|opacity=/.test(svg)) notFullBleed.push(`${m.name} (see-through fill)`);
  try {
    raster(svg);
  } catch (e) {
    badMarkup.push(`${m.name}: ${(e as Error).message}`);
  }
}

check('every palette material has an icon', all.length > 0 && all.every((m) => materialSvgFor(m).length > 0), `${all.length} materials`);
check('no document-scoped names in any icon', badMarkup.length === 0, badMarkup.join(', '));
check('every icon paints its whole tile opaquely', notFullBleed.length === 0, notFullBleed.join(', '));
check('largest icon stays under 4 KB', worstBytes < 4096, `${worstName} ${worstBytes}B`);
check('all icons together stay under 250 KB', totalBytes < 250_000, `${(totalBytes / 1024) | 0} KB for ${all.length}`);

// ---------------------------------------------------------------------------
// 2. Golden tiles — one per pattern family, in the renderer's branch order.
//
// Each of these materials also carries `lattice` (except the batteries), so a
// checkerboard appearing in any of them means the branch chain was reordered.
// ---------------------------------------------------------------------------

const GOLDEN: Record<string, string> = {
  // Conveyor: period-4 chevron tent, un-mirrored (a freshly painted belt runs
  // right — PointerPainter stamps CONVEYOR_RIGHT).
  Conveyor: [
    'o...o...o',
    '.o...o...',
    '.o...o...',
    'o...o...o',
    'o...o...o',
    '.o...o...',
    '.o...o...',
    'o...o...o',
    'o...o...o',
  ].join('\n'),
  // Fan: a four-blade rotor on its own 12-cell tile (render/rotorTile.ts), one of the
  // three bitmap patterns. `i` is a blade's lit leading edge (`lattice`), `o` its
  // shaded trailing edge, `O` the hub.
  //
  // The Fan used to draw the Conveyor's chevron here, folded over y — same picture as
  // the belt's by construction, because the renderer really did compute the same tent.
  // What the golden holds now is the thing that replaced it: a wheel with FOUR blades,
  // which is what tells a Fan from a Turbine on the board, and blades that are lit and
  // shaded the same way round all the way round the hub, which is what makes a wheel
  // read as turning rather than as a snowflake. A golden whose `i`/`o` pairs stop
  // alternating consistently means the tile was transposed or mirrored.
  Fan: [
    '............',
    '.....ioo....',
    '....iioo....',
    '....iio.....',
    '.oo..io.ii..',
    '.ooooOOiiii.',
    '.iiiiOOoooo.',
    '..ii.oi..oo.',
    '.....oii....',
    '....ooii....',
    '....ooi.....',
    '............',
  ].join('\n'),
  // Turbine: the same tile at eight blades — four on the axes, four on the diagonals.
  // A steam wheel is a dense disc of blades and a household fan is not, and that count
  // is the entire visual difference between the two machines: a golden that comes back
  // with the Fan's picture means both materials resolved to the same rotor.
  Turbine: [
    '............',
    '..o..io.....',
    '..io.io..io.',
    '...ioio.io..',
    '....iioio...',
    '.ooooOOiiii.',
    '.iiiiOOoooo.',
    '...oioii....',
    '..oi.oioi...',
    '.oi..oi.oi..',
    '.....oi..o..',
    '............',
  ].join('\n'),
  // Shaped Charge: solid arrowheads pointing right, 1/2/3/3/2/1 across six lanes
  // with a gutter lane either side so neighbours never merge into a slab.
  'Shaped Charge': [
    '.........',
    'o....o...',
    'oo...oo..',
    'ooo..ooo.',
    'ooo..ooo.',
    'oo...oo..',
    'o....o...',
    '.........',
    '.........',
  ].join('\n'),
  // Electromagnet: two lit rows of every four — copper windings on a dark core.
  Electromagnet: [
    '.........',
    'ooooooooo',
    'ooooooooo',
    '.........',
    '.........',
    'ooooooooo',
    'ooooooooo',
    '.........',
    '.........',
  ].join('\n'),
  // Pump: one lit column of every three — open risers.
  Pump: [
    '.o..o..o.',
    '.o..o..o.',
    '.o..o..o.',
    '.o..o..o.',
    '.o..o..o.',
    '.o..o..o.',
    '.o..o..o.',
    '.o..o..o.',
    '.o..o..o.',
  ].join('\n'),
  // Solar Panel: photovoltaic cells (3 wide × 5 tall) separated by thin seams.
  'Solar Panel': [
    '...o...o.',
    '...o...o.',
    '...o...o.',
    '...o...o.',
    '...o...o.',
    'ooooooooo',
    '...o...o.',
    '...o...o.',
    '...o...o.',
  ].join('\n'),
  // Wall: running-bond masonry — a mortar bed row (`o`) under every course, head
  // joints staggered half a brick between courses, and the top row of each brick lit
  // (`i`). The stagger is the whole point: joints that lined up would be a grid, not
  // a wall, so a golden that goes column-regular means BRICK_OFFSET was lost.
  Wall: [
    'iiiiioiii',
    '.....o...',
    '.....o...',
    'ooooooooo',
    'iioiiiiio',
    '..o.....o',
    '..o.....o',
    'ooooooooo',
    'iiiiioiii',
  ].join('\n'),
  // Woofer: one speaker driver per 12-cell tile — rim (`o`), cone (`i`), dust cap
  // (`O`) — on the baffle. The Woofer used to draw the plain lattice weave in a
  // copper tone, so this golden is also what catches it falling back there.
  //
  // Every measurement here is the hand-drawn chip's, halved: driver 8 across on 12
  // where the chip is 16 on 24, cap 4 across where the chip's is 8, rim one cell where
  // the chip's is two. The tile before this was a 7-across driver on 9 cells — the
  // same idea sized by eye, which came out fatter than the drawing with a cap barely a
  // third of the cone. A golden that goes back to nine rows means the two pictures
  // drifted apart again.
  //
  // Widths 4/6/8/8/8/8/6/4 are the point of the raster, not incidental: two graduated
  // steps into each pole. An earlier 6-across driver rasterized 4/6/6/6/6/4 — four of
  // six rows at full width — and read as a hexagon.
  Woofer: [
    '............',
    '............',
    '....oooo....',
    '...oiiiio...',
    '..oiiOOiio..',
    '..oiOOOOio..',
    '..oiOOOOio..',
    '..oiiOOiio..',
    '...oiiiio...',
    '....oooo....',
    '............',
    '............',
  ].join('\n'),
  // Mesh: the plain lattice weave, the branch all of the above sit in front of.
  Mesh: [
    '.o.o.o.o.',
    'o.o.o.o.o',
    '.o.o.o.o.',
    'o.o.o.o.o',
    '.o.o.o.o.',
    'o.o.o.o.o',
    '.o.o.o.o.',
    'o.o.o.o.o',
    '.o.o.o.o.',
  ].join('\n'),
  // Lithium Battery: a 2-step diagonal staircase on a 4×5 tile, in flat black.
  'Lithium Battery': [
    '.........',
    '.o...o...',
    '.oo..oo..',
    '..o...o..',
    '.........',
    '.........',
    '.o...o...',
    '.oo..oo..',
    '..o...o..',
  ].join('\n'),
};

/** Tones a golden's tile must have, where it isn't the usual base + `lattice`. */
const GOLDEN_TONES: Record<string, number> = { Wall: 3, Woofer: 4, TNT: 7, Fan: 4, Turbine: 4 };

for (const [name, want] of Object.entries(GOLDEN)) {
  const label = `${name} tile matches its golden`;
  checkThrows(label, () => {
    const got = ascii(byName(name), GOLDEN_TONES[name] ?? 2);
    check(label, got === want, got === want ? '' : '\n' + got);
  });
}

// The batteries' pattern colour is the renderer's literal flat black, not a
// shade of the base — a regression to `lattice` would be invisible in ASCII.
checkThrows('battery staircase is flat black', () => {
  const { grid: g } = raster(generatedSvgFor(byName('Lithium Battery')));
  check('battery staircase is flat black', g.includes('#000000'), [...new Set(g)].join(' '));
});

// TNT's tile is the one pattern held as a bitmap rather than as an expression, which
// moves the failure modes: a rule can only be wrong in its arithmetic, but a picture
// can be wrong by one character in a string nobody re-reads. The golden above covers
// the shape; these cover the ways the shape could be right and the tile still wrong.
{
  // A row shorter than TNT_N gets indexed past its end and `buildTntTile` falls through
  // to the base colour. Today the golden does catch that — every row of TILE ends in
  // `-`/`u`/`p`/`d`, so the fallthrough always changes a pixel and the exact string
  // compare sees it (measured: shortening the `uuuu…` row fails both this check and the
  // golden). What this pin adds is a *reason* instead of an ASCII diff, and cover for
  // the case the golden structurally cannot see: a future row ending in `.`, where the
  // truncated cell would fall through to the colour it was already going to be.
  //
  // That is the difference from GAS_CLOUD's identical-looking pin, where a short row is
  // genuinely invisible — there `.` *is* the fallthrough. Pinned here rather than thrown
  // on at module load either way: tntTile.ts ships to the browser (see its comment).
  check('the TNT tile is TNT_N rows of TNT_N',
    TNT_TILE_ROWS.length === TNT_N && TNT_TILE_ROWS.every((r) => r.length === TNT_N),
    `${TNT_TILE_ROWS.length} rows, widths ${[...new Set(TNT_TILE_ROWS.map((r) => r.length))].join('/')}`);

  // The tile's seven colours, as literal hexes against the reference art. The golden
  // above cannot do this: `ascii()` names its glyphs by *luminance rank*, so any
  // TNT_LIT that leaves the lit tone brightest of the six goldens byte-identically —
  // TNT_LIT 40 draws #ff5252 instead of the art's #ff6b6b and passed everything. That
  // measurement is why this check exists.
  //
  // Set equality, not `includes`: a stray eighth tone is as wrong as a missing one, and
  // it is what pins the label as *printed* — paper and ink are literals rather than
  // offsets from the base, so a regression to `lattice` or to a `tinted()` step drops
  // #f0ece1 / #1a1a1a from this set.
  checkThrows("the TNT tile is the reference art's palette", () => {
    const { grid: g, n } = raster(generatedSvgFor(byName('TNT')));
    const got = [...new Set(g)].sort().join(' ');
    // base / lit +65 / lattice shade / label top·paper·bottom / ink.
    const want = ['#1a1a1a', '#8d0f0f', '#b5aea0', '#d3cec4', '#db2a2a', '#f0ece1', '#ff6b6b'].join(' ');
    check("the TNT tile is the reference art's palette", n === TNT_N && got === want, `${n} cells: ${got}`);
  });

  // The word stays on its label. Ink that reached a stick row would read as damage to
  // the dynamite rather than as printing, and it is the kind of slip a one-character
  // edit to the wrong row makes.
  {
    const inked = TNT_TILE_ROWS.map((r, y) => (r.includes('#') ? y : -1)).filter((y) => y >= 0);
    const paper = TNT_TILE_ROWS.map((r, y) => (/^[pud]+$/.test(r.replace(/#/g, 'p')) ? y : -1))
      .filter((y) => y >= 0);
    check('the TNT lettering stays inside the label',
      inked.length > 0 && inked.every((y) => paper.includes(y)),
      `ink on rows ${inked.join(',')}; label on rows ${paper.join(',')}`);
  }

  // A patch edge other than 9 is opt-in, and the opt-in is exactly the three patterns
  // built around one centred object: TNT's labelled bundle (16), and the rotor and
  // woofer tiles (12). For those a 9-cell window would be a *crop* of the object
  // rather than a sample of the material — two sliced glyphs, a rotor missing two
  // blades, three quarters of a driver — which is the whole reason they carry their
  // own edge. Everything else must still come out at 9 (or at 18, for the gases and
  // the hazard chips that already had their own).
  checkThrows('only the object-shaped tiles derive at their own edge', () => {
    const own = (m: Material): number | null =>
      m.tntPattern ? TNT_N : m.rotorPattern ? ROTOR_N : m.wooferPattern ? 12 : null;
    const odd = all
      .map((m) => [m.name, raster(generatedSvgFor(m)).n, own(m)] as const)
      .filter(([, n, want]) => (want === null ? n !== 9 && n !== 18 : n !== want));
    check('only the object-shaped tiles derive at their own edge', odd.length === 0,
      odd.map(([name, n, want]) => `${name} ${n} (want ${want ?? '9/18'})`).join(', '));
  });
}

// The rotor bitmaps, held to what tntTile.ts's rows are held to: a row narrower than
// its tile is indexed past its end and falls through to the base colour. On these tiles
// that fallthrough reads as a chipped blade — which is exactly the kind of thing a
// golden diff shows you without telling you why. Pinned in the harness rather than
// thrown at module load because the module ships to the browser (see tntTile.ts).
check('every rotor tile is ROTOR_N rows of ROTOR_N',
  Object.values(ROTOR_TILE_ROWS).every((rows) => rows.length === ROTOR_N && rows.every((r) => r.length === ROTOR_N)),
  Object.entries(ROTOR_TILE_ROWS).map(([b, rows]) => `${b}: ${rows.length} rows`).join(', '));

// The wheels turn: each rotor ships TWO frames, and the second is the first half a
// blade pitch on. What has to hold is that they are genuinely different pictures with
// the same weight — a spun frame identical to its rest frame is a still (which is what
// a literal 45° turn of the EIGHT-blade wheel would have produced, since 45° is its
// whole pitch), and one with a different amount of ink would read as the wheel
// changing size rather than turning.
checkThrows('each rotor has two distinct frames of equal weight', () => {
  for (const blades of ['4', '8']) {
    const rest = ROTOR_TILE_ROWS[blades].join('');
    const spun = ROTOR_TILE_ROWS[`${blades}-spun`].join('');
    const ink = (t: string): number => t.length - (t.match(/\./g) ?? []).length;
    check(`the ${blades}-blade wheel actually moves between frames`, rest !== spun);
    check(`…and both frames carry the same ink`, ink(rest) === ink(spun), `${ink(rest)} vs ${ink(spun)}`);
  }
});

// The frame comes from the machine's own aux counter, so the two things worth pinning
// are the ends of that: a fresh cell (aux 0 — which is also what the palette chip
// shows) is at rest, and a counter that is advancing does flip. The Fan's shift skips
// its direction bits, so its four directions must all read as at rest when unpowered —
// a fan that spun differently depending on which way it faced would be the bug.
checkThrows('a rotor is at rest on a fresh cell and turns as its counter runs', () => {
  const fan = byName('Fan');
  const turbine = byName('Turbine');
  const spin = (m: Material, aux: number): number => rotorSpin(aux, m.rotorSpinShift ?? 0);
  check('a freshly painted rotor is at rest',
    rotorFrame(spin(fan, 0)) === 0 && rotorFrame(spin(turbine, 0)) === 0);
  check('…for every direction a Fan can be stamped in',
    [0, 1, 2, 3].every((dir) => rotorFrame(spin(fan, dir)) === 0), 'unpowered fan, dirs 0-3');
  // A running counter must produce both frames rather than sticking on one.
  const seen = (m: Material, hi: number): Set<number> => {
    const out = new Set<number>();
    for (let v = 0; v <= hi; v++) out.add(rotorFrame(spin(m, v)));
    return out;
  };
  check('a running Turbine shows both frames', seen(turbine, 11).size === 2);
  check('a running Fan shows both frames', seen(fan, 24 << 2).size === 2);
});

// **One wheel, one phase.** The renderer draws a whole ROTOR_N tile from the MAX of its
// cells' spin counters rather than from each cell's own, and everything below runs the
// renderer's *actual* aggregation to check it: `rotorBlockIndex` and `rotorAccumulate`
// are the two functions CanvasRenderer's rotor branch calls per cell, walked here over
// a patch of cells exactly the way the render loop walks the grid. (They were pulled
// out of the loop body for this: a test that re-implements the aggregation passes just
// as happily when the renderer regresses to per-cell frames.)
//
// The case this exists for is the Turbine: it advances the counter only on cells steam
// is actually passing through and leaves the rest at 0, so a tile mid-operation holds a
// spread of counters, not one value.
checkThrows('a wheel animates as one tile, off its leading cell', () => {
  const turbine = byName('Turbine');
  const sh = turbine.rotorSpinShift ?? 0;
  const TILES_W = 2; // a patch two wheels wide, one wheel tall
  const W = ROTOR_N * TILES_W;
  /** Run the renderer's per-cell aggregation over the patch; one entry per wheel. */
  const wheels = (auxAt: (x: number, y: number) => number): Uint8Array => {
    const acc = new Uint8Array(TILES_W);
    for (let y = 0; y < ROTOR_N; y++) {
      for (let x = 0; x < W; x++) {
        rotorAccumulate(acc, rotorBlockIndex(x, y, TILES_W), auxAt(x, y), sh);
      }
    }
    return acc;
  };

  // A cabinet of steam-fed turbine mid-pulse: counters strung out over the cycle on the
  // left wheel (soaked cells leading, grazed cells lagging, dry cells at 0), and a
  // second wheel beside it that no steam has ever reached.
  const spread = (x: number, y: number): number => (x < ROTOR_N ? (x * 7 + y * 3) % 6 : 0);
  const perCell = new Set<number>();
  for (let y = 0; y < ROTOR_N; y++) {
    for (let x = 0; x < ROTOR_N; x++) perCell.add(rotorFrame(rotorSpin(spread(x, y), sh)));
  }
  check('per-cell frames really do disagree across one wheel', perCell.size === 2,
    'counters 0-5 scattered over the tile');
  const spun = wheels(spread);
  check('…but the tile aggregates to one counter — its leader', spun[0] === 5, `max ${spun[0]}`);
  // The two obvious aggregates are not interchangeable, and this is the tile that shows
  // it: an OR of the frames is 1 the moment any single cell reaches the spun frame,
  // which for a tile holding a cell at every count is always — so the wheel would have
  // swapped tearing for being frozen on frame 1.
  const or = perCell.has(1) ? 1 : 0;
  check('…and an OR of the frames would have said the opposite',
    or === 1 && rotorFrame(spun[0]) === 0, `or=${or}, max=${spun[0]} → frame ${rotorFrame(spun[0])}`);
  check('the wheel next to it is untouched by the aggregation', spun[1] === 0, `${spun[1]}`);
  // …and the reverse direction: a single hot cell raises its own wheel and only it.
  const oneHot = wheels((x, y) => (x === ROTOR_N && y === 0 ? 9 : 0));
  check('a lone spinning cell drives its own wheel and no other',
    oneHot[0] === 0 && oneHot[1] === 9, `${oneHot[0]}, ${oneHot[1]}`);

  // Run a full pulse cycle with laggards present: the wheel's frame must flip on the
  // same beat a lone cell would, i.e. every ROTOR_SPIN_SHIFT+1 ticks, never sticking.
  const seq: number[] = [];
  for (let t = 0; t < 12; t++) {
    // leader at t, one cell half as fast, the rest of the wheel dead — worst case.
    const w = wheels((x, y) => (y === 0 && x === 0 ? t : y === 0 && x === 1 ? t >> 1 : 0));
    seq.push(rotorFrame(w[0]));
  }
  check('the wheel flips every two ticks even with laggards on it',
    seq.join('') === '001100110011', seq.join(''));

  // And the counter the Turbine holds across a steam gap is what makes the wheel stop:
  // a stalled tile keeps its leader's count, so it freezes on the frame it died on
  // rather than snapping back to rest because most of its cells read 0. Frame 1 is the
  // discriminating answer here — a per-cell majority, or any aggregate that let the
  // zeros vote, would read 0, which is also what the all-dead wheel below reads.
  const stalled = wheels((x, y) => (y === 0 && x === 0 ? 6 : y === 0 && x === 1 ? 3 : 0));
  check('a stalled wheel freezes on its leader\'s frame, not on rest',
    rotorFrame(stalled[0]) === 1, `counter ${stalled[0]} → frame ${rotorFrame(stalled[0])}`);
  check('…while a wheel that never ran is at rest', rotorFrame(wheels(() => 0)[0]) === 0);
});

// **One driver, one thump.** The Woofer's driver swells while the cabinet fires and
// settles back as the shockwave it launched reaches its rim (see wooferDriver.ts). The
// Woofer stamps no cell state at all, so unlike the rotors there is no counter to read
// — the excursion is read off the wave's own position, which is what makes the two
// exactly synchronous rather than merely both animated.
//
// The geometry is a table of squared radii per step, so what has to hold is that every
// step is still a legible speaker: four tones, in order, inside its own tile.
checkThrows('a Woofer driver swells as one tile, in step with its own shockwave', () => {
  /** Cells of each band at one excursion step, replaying the renderer's own test. */
  const bands = (step: number): { cap: number; cone: number; rim: number; wide: number } => {
    let cap = 0;
    let cone = 0;
    let rim = 0;
    let wide = 0;
    for (let y = 0; y < WOOFER_P; y++) {
      let row = 0;
      for (let x = 0; x < WOOFER_P; x++) {
        const ax = 2 * x - (WOOFER_P - 1);
        const ay = 2 * y - (WOOFER_P - 1);
        const d2 = ax * ax + ay * ay;
        if (d2 <= WOOFER_CAP_R2[step]) cap++;
        else if (d2 <= WOOFER_CONE_R2[step]) cone++;
        else if (d2 <= WOOFER_R2[step]) rim++;
        else continue;
        row++;
      }
      if (row > wide) wide = row;
    }
    return { cap, cone, rim, wide };
  };

  // The resting step is the picture the palette chip draws, and the golden above is
  // that picture — so the rest entry of the table has to reproduce it tone for tone.
  // This is the join between the animation and the chip: widen the rest step by one
  // ring and the icon silently changes shape.
  const tally = (ch: string): number => GOLDEN.Woofer.split(ch).length - 1;
  const rest = bands(WOOFER_REST);
  check('the resting driver is exactly the golden chip',
    rest.cap === tally('O') && rest.cone === tally('i') && rest.rim === tally('o'),
    `cap ${rest.cap}/${tally('O')}, cone ${rest.cone}/${tally('i')}, rim ${rest.rim}/${tally('o')}`);

  // Every step has to stay a speaker: all three bands present, in order, so the driver
  // never collapses into a flat disc or loses its outline mid-thump.
  for (let s = 0; s < WOOFER_THUMP_STEPS; s++) {
    const b = bands(s);
    check(`step ${s} keeps all three bands`, b.cap > 0 && b.cone > 0 && b.rim > 0,
      `cap ${b.cap}, cone ${b.cone}, rim ${b.rim}`);
    check(`…in radial order`,
      WOOFER_CAP_R2[s] < WOOFER_CONE_R2[s] && WOOFER_CONE_R2[s] < WOOFER_R2[s]);
  }
  // And it has to actually *grow* — the whole point of the animation. Cell counts
  // rather than radii, because between two consecutive rings of a 12-cell tile a
  // bigger radius can draw the identical picture.
  const area = (s: number): number => bands(s).cap + bands(s).cone + bands(s).rim;
  const areas = Array.from({ length: WOOFER_THUMP_STEPS }, (_, s) => area(s));
  check('each step draws a strictly bigger driver',
    areas.every((a, s) => s === 0 || a > areas[s - 1]), areas.join(' → '));
  check('…and the dust cap grows with it',
    WOOFER_CAP_R2.every((r, s) => s === 0 || r > WOOFER_CAP_R2[s - 1]), WOOFER_CAP_R2.join(' → '));

  // Fully out, a driver must still leave baffle around itself: neighbouring drivers are
  // WOOFER_P apart, so a driver that reached its tile's edge would fuse a cabinet into
  // one blob of cones. Checked as "the tile's outer ring stays baffle at every step".
  const top = WOOFER_THUMP_STEPS - 1;
  let edge = 0;
  for (let y = 0; y < WOOFER_P; y++) {
    for (let x = 0; x < WOOFER_P; x++) {
      if (x !== 0 && y !== 0 && x !== WOOFER_P - 1 && y !== WOOFER_P - 1) continue;
      const ax = 2 * x - (WOOFER_P - 1);
      const ay = 2 * y - (WOOFER_P - 1);
      if (ax * ax + ay * ay <= WOOFER_R2[top]) edge++;
    }
  }
  check('a fully-out driver still leaves baffle between cabinets', edge === 0,
    `${edge} edge cells painted, widest row ${bands(top).wide} of ${WOOFER_P}`);

  // The synchronisation itself: full excursion at the instant the front leaves the
  // cabinet, back at rest as it reaches the rim, and monotone in between — a cone that
  // went back out partway through would read as two thumps for one wave. Expressed
  // against the front's *fraction* of the reach, which is exactly what the function
  // takes, so it holds at any wave speed or reach.
  const REACH = 8; // the shipped SHOCK_VIS_REACH; the shape must not depend on it
  check('the cone is fully out as the front leaves the body',
    wooferExcursion(0, REACH) === top, `${wooferExcursion(0, REACH)} of ${top}`);
  check('and back at rest as the front reaches the rim',
    wooferExcursion(REACH, REACH) === WOOFER_REST
    && wooferExcursion(REACH * 2, REACH) === WOOFER_REST);
  const walk = Array.from({ length: 33 }, (_, k) => wooferExcursion((k * REACH) / 32, REACH));
  check('…settling monotonically, never swelling twice for one wave',
    walk.every((e, k) => k === 0 || e <= walk[k - 1]), walk.join(''));
  check('…through every step on the way down', new Set(walk).size === WOOFER_THUMP_STEPS,
    `${new Set(walk).size} of ${WOOFER_THUMP_STEPS} steps used`);
  check('a wave with no reach at all leaves the driver alone',
    wooferExcursion(0, 0) === WOOFER_REST);

  // One excursion per drawn driver, not per cell — the Woofer's version of the wheel's
  // tile. Two cabinets that share a tile swell together; a driver never tears in half.
  const TILES_W = 2;
  let sameTile = true;
  for (let y = 0; y < WOOFER_P; y++) {
    for (let x = 0; x < WOOFER_P; x++) if (wooferTileIndex(x, y, TILES_W) !== 0) sameTile = false;
  }
  check('every cell of one driver shares one excursion', sameTile);
  check('…and the driver beside it has its own',
    wooferTileIndex(WOOFER_P, 0, TILES_W) === 1 && wooferTileIndex(0, WOOFER_P, TILES_W) === 2);
});

// The two rotors are one tile module with a blade count, so the failure worth naming is
// them collapsing onto each other — a Fan drawing the Turbine's eight blades is not a
// wrong picture, it is the wrong *machine*, and it would sail through both goldens if
// they were generated from the same rows.
checkThrows('the Fan and the Turbine draw different wheels', () => {
  const fan = byName('Fan');
  const turbine = byName('Turbine');
  check('the Fan draws four blades and the Turbine eight',
    fan.rotorPattern === 4 && turbine.rotorPattern === 8,
    `${fan.rotorPattern} / ${turbine.rotorPattern}`);
  check('…and the two tiles really are different pictures',
    ROTOR_TILE_ROWS[4].join('') !== ROTOR_TILE_ROWS[8].join(''));
});

// Both rotors are exactly symmetric under a 90° turn about the hub, which is what a
// wheel is — and, unlike "does it look like a rotor", it is checkable. A row copied to
// the wrong place or a blade drawn one cell long breaks it, and the golden alone would
// only show that something moved.
checkThrows('a rotor tile is unchanged by a quarter turn', () => {
  for (const [blades, rows] of Object.entries(ROTOR_TILE_ROWS)) {
    const at = (x: number, y: number): string => rows[y][x];
    let bad = '';
    for (let y = 0; y < ROTOR_N && !bad; y++)
      for (let x = 0; x < ROTOR_N; x++)
        // (x, y) → (N-1-y, x) is the quarter turn; the tone must ride round with it.
        if (at(ROTOR_N - 1 - y, x) !== at(x, y)) { bad = `${blades}-blade at (${x}, ${y})`; break; }
    check(`the ${blades}-blade rotor is symmetric under a quarter turn`, bad === '', bad);
  }
});

// ---------------------------------------------------------------------------
// 3. Flat stays flat; textured stays textured.
// ---------------------------------------------------------------------------

/** Distinct colours in a material's icon. */
const tones = (m: Material): number => new Set(raster(generatedSvgFor(m)).grid).size;

// Wall and Coal used to be in this list; both draw a pattern now and have their own
// goldens above. Stone was here too and left the other way — it grew a grain rather
// than a pattern (see below).
for (const name of ['Iron', 'Mercury', 'Liquid Gallium']) {
  const label = `${name} is drawn flat`;
  checkThrows(label, () => {
    const t = tones(byName(name));
    check(label, t === 1, `${t} tones`);
  });
}
checkThrows('a flat material costs one shape', () => {
  check('a flat material costs one shape', generatedSvgFor(byName('Iron')).match(/<(rect|path)/g)!.length === 1);
});

// Stone carries a grain now, and the point of it is that it is a *quiet* one: it is
// placed by the screenful, so an amplitude that reads as pleasant texture on one cell
// reads as noise across a cavern wall. Both ends need holding — a grain that fell to 0
// is the flat plaster this replaced, and one that climbed to the powders' default would
// be the noise it exists to avoid. Sand is the reference for "too much" because it is
// the material the default was set for.
checkThrows('Stone carries a quiet grain, not a loud one', () => {
  const stone = byName('Stone');
  const amp = varyAmplitude(stone);
  check('Stone carries a grain at all', amp > 0 && tones(stone) > 4, `amp ${amp}, ${tones(stone)} tones`);
  check('…and a narrower one than a powder',
    amp < varyAmplitude(byName('Sand')), `${amp} vs Sand ${varyAmplitude(byName('Sand'))}`);
  const cs = [...new Set(raster(generatedSvgFor(stone)).grid)].map((c) => parseInt(c.slice(1, 3), 16));
  check('…and spanning no more than its own amplitude either way',
    Math.max(...cs) - Math.min(...cs) <= 2 * amp, `${Math.max(...cs) - Math.min(...cs)} steps at ±${amp}`);
});

// Wood is here because it used to be in the flat list with a drawing on top of it.
// Timber is not one colour, so it carries a `colorVary` now and the generator has a
// grain to reflect — which is the whole reason its hand icon could be withdrawn.
for (const name of ['Sand', 'Water', 'Crude Oil', 'Diamond', 'Wood']) {
  const label = `${name} is speckled`;
  checkThrows(label, () => {
    const t = tones(byName(name));
    check(label, t > 8, `${t} tones`);
  });
}

// The three withdrawn drawings, pinned by name. Each was withdrawn because the
// derived tile is the honest one: Wood has a grain of its own now, and the two
// mirror-flat liquids are `colorVary: 0` on purpose — a chip with reflection lines
// ruled onto it claimed a texture the canvas never draws. Re-filing a `.svg` under
// any of these keys would pass every other check in this file.
checkThrows('the withdrawn drawings stay withdrawn', () => {
  const back = ['Wood', 'Mercury', 'Liquid Gallium'].filter((n) => hasHandIcon(byName(n)));
  check('the withdrawn drawings stay withdrawn', back.length === 0, back.join(', '));
});

// `tintBlock` becomes the bit mask `~(b - 1)` on both sides, which is only a block
// edge for a power of two: `~(3 - 1)` clears bit 1 and leaves bit 0, so a "3×3" flake
// would render as a lattice instead. This lives here rather than as a throw in the
// CanvasRenderer constructor for the same reason GAS_CLOUD's row width does — that
// constructor runs from `startGame()` uncaught, so throwing would blank the sandbox
// with no on-screen error over a mis-typed render hint. Nothing in the repo constructs
// a renderer, so this is the only place the invariant is actually checked.
checkThrows('every tintBlock is a power of two', () => {
  const bad = all
    .filter((m) => m.tintBlock !== undefined)
    .filter((m) => !(Number.isInteger(m.tintBlock) && m.tintBlock! >= 1 && (m.tintBlock! & (m.tintBlock! - 1)) === 0));
  check('every tintBlock is a power of two', bad.length === 0,
    bad.map((m) => `${m.name} ${m.tintBlock}`).join(', '));
});

// The 2×2 tint block, as a measurable property rather than as a picture: Obsidian's
// grain is blocked, so cell (0,0) and cell (1,1) of its tile must be the same shade
// while a per-cell grain of the same amplitude (Sand's) differs somewhere in that
// block. One flag feeds both the canvas and this tile (Material.tintBlock).
checkThrows('the blocked materials grain in 2×2 flakes, Sand cell by cell', () => {
  // The blocked grain used to be flat inside a block — one sample, one colour — so the
  // check was "is every 2×2 one colour". It is two-level now (`tintCellVary`), so a
  // flake has grit in it and that test would fail on the very thing it is meant to
  // confirm. What still separates a blocked material from an unblocked one is the
  // *size of the step*: inside a flake the spread can only be the fine amplitude,
  // while between flakes it is the wide one. Both halves matter — a material that lost
  // its block would blow the first, and one that lost its fine level would draw flat
  // squares and blow the second.
  const spans = (name: string): { within: number; across: number; fine: number } => {
    const m = byName(name);
    const { grid: g, n } = raster(generatedSvgFor(m));
    const red = (i: number): number => parseInt(g[i].slice(1, 3), 16);
    let within = 0;
    const anchors: number[] = [];
    // `n` is odd, so the last row and column are a 1-cell fringe — deliberately skipped.
    for (let y = 0; y + 1 < n; y += 2)
      for (let x = 0; x + 1 < n; x += 2) {
        const q = [red(y * n + x), red(y * n + x + 1), red((y + 1) * n + x), red((y + 1) * n + x + 1)];
        within = Math.max(within, Math.max(...q) - Math.min(...q));
        anchors.push(q[0]);
      }
    return { within, across: Math.max(...anchors) - Math.min(...anchors), fine: 2 * varyCellAmplitude(m) };
  };
  for (const name of ['Obsidian', 'Coal']) {
    const { within, across, fine } = spans(name);
    check(`${name} varies only by its fine level inside a flake`, within <= fine, `${within} steps, fine level ±${fine / 2}`);
    check(`…and by much more between flakes`, across > fine, `${across} across vs ${within} within`);
  }
  // The control: an unblocked grain of the same kind has no flakes, so neighbouring
  // cells differ by the full amplitude just as distant ones do.
  const sand = spans('Sand');
  check('…while an unblocked grain does not flake at all', sand.within > 2 * varyCellAmplitude(byName('Obsidian')),
    `Sand varies ${sand.within} steps inside a 2×2`);
});

// The grain never exceeds the material's own amplitude — the icon runs the
// renderer's `((src - 128) * amp) >> 7`, so an icon brighter than that would mean
// the arithmetic diverged.
{
  let violations: string[] = [];
  for (const m of all) {
    const amp = varyAmplitude(m) + varyCellAmplitude(m);
    // Skip every branch that puts a second colour on the tile: those cells are a
    // different base, so measuring their deviation from `m.color` is meaningless.
    // `amp === 0` covers the remaining hint branches (arrow/windArrow/triArrow/
    // coil/stripe/solar/battery) because every material carrying one of those is
    // a flat Solid today — if one ever pairs a hint with a `colorVary`, this
    // check will start reporting it rather than silently skipping it.
    // `amp` is the sum of both grain levels, because that is what the renderer's single
    // hoisted offset can reach — a two-level material bounded by its coarse level alone
    // would report a false violation for every cell where both levels pulled the same way.
    if (amp === 0 || m.glow || m.auxPalette || m.tintPalette || m.checker2x2 || m.lattice) continue;
    const base = m.color;
    const br = base & 0xff;
    // Per material rather than around the sweep: one unreadable icon must not
    // hide the amplitudes of the ninety-odd that come after it.
    try {
      for (const c of new Set(raster(generatedSvgFor(m)).grid)) {
        const d = parseInt(c.slice(1, 3), 16) - br;
        // The channel clamps at 0/255, so only an *unclamped* overshoot is a bug.
        if (Math.abs(d) > amp && br + d > 0 && br + d < 255) violations.push(`${m.name} ${d} vs ±${amp}`);
      }
    } catch (e) {
      violations.push(`${m.name}: ${(e as Error).message}`);
    }
  }
  check('grain never exceeds the material amplitude', violations.length === 0, violations.slice(0, 4).join(', '));
}

// A liquid's shimmer is visibly narrower than a powder's, because the background
// field it samples is an OU process that settles to about half the spread of the
// uniform bytes a powder grain carries (see BG_SIGMA_SCALE). Water's amplitude
// (22) is *higher* than Sand's (18), so a naive icon would get this backwards.
checkThrows('a liquid shimmers less than a powder', () => {
  const spread = (m: Material): number => {
    const cs = [...new Set(raster(generatedSvgFor(m)).grid)].map((c) => parseInt(c.slice(1, 3), 16));
    return Math.max(...cs) - Math.min(...cs);
  };
  const sand = spread(byName('Sand'));
  const water = spread(byName('Water'));
  check('a liquid shimmers less than a powder', water < sand, `water ${water} vs sand ${sand}`);
  check('…even though its amplitude is higher',
    varyAmplitude(byName('Water')) > varyAmplitude(byName('Sand')),
    `${varyAmplitude(byName('Water'))} vs ${varyAmplitude(byName('Sand'))}`);
  check('sand reads its own grain, water the background field',
    varyMode(byName('Sand')) === VARY_PARTICLE && varyMode(byName('Water')) !== VARY_PARTICLE);
});

// Obsidian is volcanic *glass*, and its base is near-black — a channel sits around
// 36–68, so the same amplitude that reads as a subtle grain on a mid-tone material
// reads there as coarse noise. It therefore carries the narrowest grain of any
// tinted solid, below even Diamond's deliberately low range. One amplitude feeds
// both the canvas and this icon (`varyAmplitude`), so the check covers both.
checkThrows('the two-level grain is wide between flakes and narrow inside one', () => {
  // This used to say "Obsidian carries the narrowest grain of any tinted solid", pinning
  // `colorVary` under Diamond's 10. That was the right idea aimed at the wrong number:
  // the thing that must stay subtle is the grain *within* a face, and the step between
  // faces is supposed to be bold — the material is faceted glass, not a smooth block.
  // Now that the two are separate numbers, each is held to its own end.
  for (const name of ['Obsidian', 'Coal']) {
    const m = byName(name);
    const wide = varyAmplitude(m);
    const fine = varyCellAmplitude(m);
    check(`${name}'s within-face grain stays under Diamond's low range`,
      fine > 0 && fine < varyAmplitude(byName('Diamond')),
      `${fine} vs Diamond ${varyAmplitude(byName('Diamond'))}`);
    check(`…and its face-to-face step is the bold one`, wide > fine * 2, `${wide} vs ${fine}`);
    const cs = [...new Set(raster(generatedSvgFor(m)).grid)].map((c) => parseInt(c.slice(1, 3), 16));
    const spread = Math.max(...cs) - Math.min(...cs);
    check(`…with the tile spanning no more than both levels allow`, spread <= 2 * (wide + fine),
      `${spread} steps against ±${wide + fine}`);
  }
});

// Obsidian is *black* glass, and its colour has been darkened toward that. What stops
// it going further is the eraser's own colour: a shell has to read against open air, so
// its DARKEST grain — the base taken down by the full amplitude — has to stay clear of
// the board. Measured in luminance rather than per channel because the cast is violet:
// the green channel is the low one by design, and holding each channel to the same
// margin would make the hue itself the thing that failed.
checkThrows('Obsidian stays legible against the empty board', () => {
  const obs = byName('Obsidian');
  const board = getMaterial(EMPTY).color;
  // BOTH levels, because both pull the same way at the dark end and it is that corner
  // the shell is judged on. Widening the grain to 14 + 4 without moving the colour put
  // this at −2.9 — the deepest flakes of an obsidian shell were darker than open air,
  // reading as holes punched through it. Every step of amplitude added here costs a
  // step of darkness, which is the whole reason the grain narrowed when the colour
  // went down: at 14 + 4 the darkest flake could not clear the bar below at any colour
  // that still read as black.
  //
  // **The bar is a ratio, not a fixed number of steps, and that matters.** Both sides
  // of this comparison are near-black, where the eye judges by relative difference
  // (Weber) rather than by absolute distance: 9 steps above the board is a ~55%
  // brightening and reads immediately, while the same 9 steps between two mid-greys
  // would be nearly invisible. 1.5× is the threshold used here — comfortably above the
  // few-percent detection floor, and low enough to leave a black material somewhere to
  // stand. An earlier version of this check spelled the same idea as a flat `margin >=
  // 8` and, when the grain widened, the number was quietly cut to 3 to keep it green;
  // stating it as a ratio is what makes moving it a visible argument rather than a
  // knob. Nothing in the current material sits near the line: the margin is printed on
  // failure so a future colour edit shows its own headroom.
  const amp = varyAmplitude(obs) + varyCellAmplitude(obs);
  const ch = (c: number, i: number): number => (c >> (8 * i)) & 0xff;
  const lum = (c: number, d = 0): number =>
    (ch(c, 0) + d) * 0.3 + (ch(c, 1) + d) * 0.59 + (ch(c, 2) + d) * 0.11;
  const darkest = lum(obs.color, -amp);
  const floor = lum(board);
  check('Obsidian stays legible against the empty board', darkest >= floor * 1.5,
    `darkest grain ${darkest.toFixed(1)} vs board ${floor.toFixed(1)} `
    + `(${(darkest / floor).toFixed(2)}×, needs 1.50×) at total amplitude ${amp}`);
  // …and it is still darker than the grey rock it is the glassy cousin of, which is the
  // direction the colour has been moving.
  check('…and darker than Stone', lum(obs.color) < lum(byName('Stone').color),
    `${lum(obs.color).toFixed(0)} vs ${lum(byName('Stone').color).toFixed(0)}`);
});

// ---------------------------------------------------------------------------
// 4. Glow materials show the ramp, gases dissolve.
// ---------------------------------------------------------------------------

for (const name of ['Lava', 'Molten Iron', 'Slag']) {
  const label = `${name} shows a heat ramp, hot at the top`;
  checkThrows(label, () => {
    const m = byName(name);
    const { grid: g, n } = raster(generatedSvgFor(m));
    const lum = (c: string) =>
      parseInt(c.slice(1, 3), 16) * 0.3 + parseInt(c.slice(3, 5), 16) * 0.59 + parseInt(c.slice(5, 7), 16) * 0.11;
    const topRow = g.slice(0, n).reduce((a, c) => a + lum(c), 0) / n;
    const botRow = g.slice(n * (n - 1)).reduce((a, c) => a + lum(c), 0) / n;
    check(label, topRow > botRow + 8, `${topRow | 0} vs ${botRow | 0}`);
    check(`…and never cools past its ramp floor`, tones(m) > 4, `${tones(m)} tones`);
  });
}

// A flat gas is drawn as a solid-filled cloud silhouette on the board's own
// background, on a finer 18-cell grid than everything else. The first attempt
// scattered cells instead and read as damage rather than as a shape, so the
// golden here is the whole point of the branch — see GAS_CLOUD.
//
// The picture is also the only place the *proportions* are pinned: the body
// spans half the tile's height with board above and below, which is what makes a
// gas chip read as vapour floating rather than as a differently-shaped brick.
// The margin check below says that in words, since a golden diff alone would not
// explain why a fatter cloud is a regression.
const GAS_GOLDEN = [
  '..................',
  '..................',
  '..................',
  '..................',
  '.......ooooo......',
  '.....ooooooooo....',
  '....ooooooooooo...',
  '...ooooooooooooo..',
  '..oooooooooooooo..',
  '.oooooooooooooooo.',
  '.oooooooooooooooo.',
  '.oooooooooooooooo.',
  '...oooooooooooo...',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
].join('\n');

for (const name of ['Steam', 'Smoke', 'Chlorine']) {
  const label = `${name} is a solid-filled cloud`;
  checkThrows(label, () => {
    const m = byName(name);
    const svg = generatedSvgFor(m);
    const { grid: g, n } = raster(svg);
    check(`${name} uses the finer gas grid`, n === 18, `${n} cells`);
    // The cloud is the material's own colour; everything outside it is the board.
    const board = [...new Set(g)].find((c) => c !== hex(m.color));
    const rows: string[] = [];
    for (let y = 0; y < n; y++) {
      let row = '';
      for (let x = 0; x < n; x++) row += g[y * n + x] === board ? '.' : 'o';
      rows.push(row);
    }
    const got = rows.join('\n');
    check(label, got === GAS_GOLDEN, got === GAS_GOLDEN ? '' : '\n' + got);
    check(`…filled with no holes in it`, new Set(g).size === 2, `${new Set(g).size} colours`);
    check(`…and is a Gas with no grain of its own`, m.phase === Phase.Gas && varyAmplitude(m) === 0);
  });
}

// The cloud's width is derived from its row count, so a row of any other length
// is indexed past its end and silently reads as background. A short row of `#`
// would change the golden above; a short all-`.` row would not, which is why the
// literal is measured directly here rather than only through what it draws.
check('every GAS_CLOUD row is as wide as the cloud is tall',
  GAS_CLOUD_ROWS.every((r) => r.length === GAS_CLOUD_ROWS.length),
  `${GAS_CLOUD_ROWS.length} rows, widths ${[...new Set(GAS_CLOUD_ROWS.map((r) => r.length))].join('/')}`);

// The puff floats: it is a body of vapour with board around it, not a tile-filling
// blob whose ink weight equals the square it exists to be distinguished from. The
// original silhouette filled 17 of 18 rows and lost that distinction, so the
// margin is pinned as a rule and not only as a picture — a redraw that swells back
// to the edges fails here with the reason attached.
{
  const rows = GAS_CLOUD_ROWS;
  const n = rows.length;
  const inked = rows.filter((r) => r.includes('#'));
  const clear = (r: string) => !r.includes('#');
  check('the gas cloud floats — board above and below it',
    clear(rows[0]) && clear(rows[n - 1]) && inked.length <= n / 2,
    `${inked.length} of ${n} rows inked`);
  // Sideways it very nearly fills the tile: the drawing's waist is 22 of 24 units,
  // so a cloud that shrank away from the left and right edges too would be a small
  // lozenge rather than a wide puff.
  check('…but is nearly full width at the waist',
    Math.max(...inked.map((r) => r.replace(/^\.+|\.+$/g, '').length)) >= n - 2,
    `widest row ${Math.max(...inked.map((r) => r.replace(/^\.+|\.+$/g, '').length))} of ${n}`);
}

// The board showing around the puff is the eraser's colour — the same thing that
// is actually behind a gas cell in play, not an invented dark.
checkThrows('the gas surround is the board background', () => {
  check('the gas surround is the board background',
    new Set(raster(generatedSvgFor(byName('Steam'))).grid).has(hex(getMaterial(EMPTY).color)));
});

// A gas that DOES carry a grain (none ship today, but the branch guards for it)
// must fall through to the speckle rather than the cloud, and Blast — a Gas with
// a `glow` ramp — must still take the glow branch.
checkThrows('the gas cloud only claims flat gases', () => {
  check('the gas cloud only claims flat gases',
    all.every((m) => !(m.phase === Phase.Gas && varyAmplitude(m) > 0) || tones(m) > 2));
});
checkThrows('a glowing gas still takes the glow branch', () => {
  check('a glowing gas still takes the glow branch', raster(generatedSvgFor(byName('Blast'))).n === 9);
});

// ---------------------------------------------------------------------------
// 5. The hand-drawn override layer.
//
// Twenty-five materials ship a checked-in drawing instead of a derived tile, and
// they are there for two opposite reasons. Thirteen have an identity that is an
// idea rather than a colour or a texture — no pattern the renderer draws could
// stand for "deletes whatever it touches". The other twelve are the reverse: they
// are honestly one flat colour in-world, so the generator has nothing to reflect
// and the drawing is the only place their surface can show grain, facets or a
// sheen at all.
//
// Three drawings have been *withdrawn*, which is the direction worth naming: Wood
// got a `colorVary` instead, so the generator now has a grain to reflect and the
// drawing had nothing left to add; Mercury and Liquid Gallium are deliberately
// mirror-flat liquids (`colorVary: 0`), and a chip with reflection lines on it was
// claiming a texture the canvas does not draw. A hand icon is worth its override
// only where the derived tile is honestly wrong.
//
// Either way what matters here is that the layer stays a thin cap: it replaces the
// chip and nothing else, the derived tile underneath is still built and still
// correct, and a drawing whose filename matches no material never silently
// disappears.
// ---------------------------------------------------------------------------

checkThrows('hand-drawn icons replace the chip', () => {
  const hand = all.filter(hasHandIcon);
  check('some materials ship hand-drawn art', hand.length > 0, `${hand.length} of ${all.length}`);

  // Every key must name a real palette material. A typo'd filename would build
  // into the module, pass every other check, and simply never be drawn.
  const names = new Set(all.map((m) => m.name.toLowerCase().replace(/\s+/g, '-')));
  const orphans = handIconKeys().filter((k) => !names.has(k));
  check('every hand icon names a real palette material', orphans.length === 0, orphans.join(', '));

  const wrong = hand.filter((m) => raster(materialSvgFor(m)).n !== 24);
  check('hand icons are drawn on the 24-cell tile', wrong.length === 0, wrong.map((m) => m.name).join(', '));

  // The override really is what the palette gets — not the derived tile.
  const notOverridden = hand.filter((m) => materialSvgFor(m) === generatedSvgFor(m));
  check('the override actually wins over the derived tile', notOverridden.length === 0,
    notOverridden.map((m) => m.name).join(', '));

  // …and it wins for nobody else. The hazard-marked chips are the other layer that
  // legitimately differs from the derived tile (section 6); everything else must be
  // the derived tile verbatim.
  const stolen = all.filter(
    (m) => !hasHandIcon(m) && !hasHazardMark(m) && materialSvgFor(m) !== generatedSvgFor(m),
  );
  check('materials without art still get the derived tile', stolen.length === 0,
    stolen.map((m) => m.name).join(', '));
});

// Solar Panel is the case that motivated splitting the two functions: its chip is
// hand art now, but `solarPattern` is still a live renderer branch, so the golden
// above must keep testing it. This is what would break if someone "simplified"
// generatedSvgFor away.
checkThrows('a hand-drawn material still derives its tile underneath', () => {
  const sp = byName('Solar Panel');
  check('Solar Panel ships hand art', hasHandIcon(sp));
  check('…and its solarPattern tile is still derived', raster(generatedSvgFor(sp)).n === 9);
});

// Hand art is authored against the material's registered colour, so a chip that
// no longer resembles its material would be a mis-filed drawing.
checkThrows('hand art is built on its material\'s own colour', () => {
  const off: string[] = [];
  for (const m of all.filter(hasHandIcon)) {
    const bg = /<rect x="0" y="0" width="24" height="24" fill="(#[0-9a-f]{6})"\/>/.exec(materialSvgFor(m));
    if (bg?.[1] !== hex(m.color)) off.push(`${m.name} ${bg?.[1]} vs ${hex(m.color)}`);
  }
  check('every hand icon opens on its material colour', off.length === 0, off.join(', '));
});

// ---------------------------------------------------------------------------
// 6. The radioactive hazard mark.
//
// The other override layer, and the opposite kind of thing from hand art: not a
// drawing of a material but a *label* on one, applied by category rather than per
// material. The five radioactive materials are two solid metals, a powder and two
// melts — nothing they have in common is visible, and the thing that matters about
// them (it irradiates through walls) is not a texture at all.
//
// So what needs pinning is that the label is only ever a label: it goes on the chip
// and never on the canvas, it lands on exactly the radioactive category and nothing
// else, the material's own tile is still legible around it, and it does not quietly
// cost more than the byte budget allows.
// ---------------------------------------------------------------------------

checkThrows('the hazard mark lands on exactly the radioactive category', () => {
  const marked = all.filter(hasHazardMark);
  check('the hazard mark lands on exactly the radioactive category',
    marked.length > 0 && marked.every((m) => m.category === HAZARD_CATEGORY)
      && all.every((m) => (m.category === HAZARD_CATEGORY) === hasHazardMark(m)),
    `${marked.length} marked: ${marked.map((m) => m.name).join(', ')}`);

  // Hand art wins over the mark (they are authored at different tile sizes and cannot
  // be composed), so a drawing filed for a radioactive material would silently remove
  // its hazard label. That is a decision, not a bug — but it must be a deliberate one.
  const shadowed = marked.filter(hasHandIcon);
  check('…and no radioactive material ships hand art that would hide it',
    shadowed.length === 0, shadowed.map((m) => m.name).join(', '));

  // The mark is a chip-only overlay: nothing in the world draws it, so the derived
  // tile — which is what the canvas branch chain produces — must not contain the ink.
  const leaked = marked.filter((m) => raster(generatedSvgFor(m)).grid.includes('#000000'));
  check('…and never reaches the derived tile the canvas draws', leaked.length === 0,
    leaked.map((m) => m.name).join(', '));
});

// The trefoil itself, as a picture. Read off U235's shipped chip rather than from the
// literal, so this covers the resample and the stamping as well as the art: the ink is
// the one flat black in the tile, and everything else is the material's own ramp.
const HAZARD_GOLDEN = HAZARD_TREFOIL_ROWS.join('\n');

for (const name of ['U235', 'Nuke Waste', 'Molten U238']) {
  const label = `${name} wears the hazard trefoil`;
  checkThrows(label, () => {
    const m = byName(name);
    const { grid: g, n } = raster(materialSvgFor(m));
    check(`${name} draws its chip on the ${18}-cell hazard tile`, n === 18, `${n} cells`);
    const rows: string[] = [];
    for (let y = 0; y < n; y++) {
      let row = '';
      for (let x = 0; x < n; x++) row += g[y * n + x] === '#000000' ? '#' : '.';
      rows.push(row);
    }
    const got = rows.join('\n');
    check(label, got === HAZARD_GOLDEN, got === HAZARD_GOLDEN ? '' : '\n' + got);
    // The material still has to be readable around the mark: the ink covers under a
    // quarter of the tile, and what is left is its own ramp rather than one flat block.
    const ink = g.filter((c) => c === '#000000').length;
    check(`…over no more than a quarter of the tile`, ink * 4 <= n * n, `${ink} of ${n * n} cells`);
    check(`…with the material's own tile still showing through`,
      new Set(g).size > 3, `${new Set(g).size} colours`);
  });
}

// Same argument as GAS_CLOUD_ROWS: the art is indexed by row, so a row that is not
// as wide as the tile reads as ink-free past its end, and an all-`.` short row would
// not show up in the golden above.
check('every HAZARD_TREFOIL row is as wide as the tile is tall',
  HAZARD_TREFOIL_ROWS.every((r) => r.length === HAZARD_TREFOIL_ROWS.length),
  `${HAZARD_TREFOIL_ROWS.length} rows, widths ${[...new Set(HAZARD_TREFOIL_ROWS.map((r) => r.length))].join('/')}`);

// The resample is what keeps a hazard chip affordable: it draws the SAME 9-cell patch
// at 18 cells rather than replaying the branch chain there, so a grain cell stays 2
// CSS px in the palette's 18 px swatch instead of shrinking to 1, and — with
// spritePaths merging each run downward — costs about what the 9-cell tile did. Four
// times the cells for a few percent more markup is the whole trick; if a change ever
// undoes the vertical merge, this is the check that reports it as a budget failure
// rather than as a mysteriously large icon.
checkThrows('a hazard chip costs about what its 9-cell tile does', () => {
  const worst = all.filter(hasHazardMark).map((m) => ({
    name: m.name,
    ratio: materialSvgFor(m).length / generatedSvgFor(m).length,
  })).sort((a, b) => b.ratio - a.ratio)[0];
  check('a hazard chip costs about what its 9-cell tile does', worst.ratio < 1.25,
    `${worst.name} ×${worst.ratio.toFixed(2)}`);
});

// ---------------------------------------------------------------------------
// 7. The two palette-array materials show their palette, not one colour.
// ---------------------------------------------------------------------------

checkThrows('Fireworks speckles all three palette colours', () => {
  const fw = byName('Fireworks');
  const hues = new Set(
    raster(generatedSvgFor(fw)).grid.map((c) => {
      // Collapse brightness so only the underlying palette entry remains.
      const r = parseInt(c.slice(1, 3), 16);
      const g = parseInt(c.slice(3, 5), 16);
      const b = parseInt(c.slice(5, 7), 16);
      const mx = Math.max(r, g, b) || 1;
      return `${Math.round((r / mx) * 8)},${Math.round((g / mx) * 8)},${Math.round((b / mx) * 8)}`;
    }),
  );
  check('Fireworks speckles all three palette colours', hues.size >= 3, `${hues.size} hues`);
});

checkThrows('Seed sprouts green at the top, dormant brown at the base', () => {
  const seed = byName('Seed');
  const { grid: g, n } = raster(generatedSvgFor(seed));
  const green = (c: string) => parseInt(c.slice(3, 5), 16) - parseInt(c.slice(1, 3), 16);
  const top = g.slice(0, n).reduce((a, c) => a + green(c), 0) / n;
  const bot = g.slice(n * (n - 1)).reduce((a, c) => a + green(c), 0) / n;
  check('Seed sprouts green at the top, dormant brown at the base', top > bot + 10, `${top | 0} vs ${bot | 0}`);
});

Math.random = REAL_RANDOM;
console.log(failures === 0 ? '\nAll material icon checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
