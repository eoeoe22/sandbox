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
//   • Branch order. Nine of the electric/exotic materials set more than one
//     visual hint (a Fan is `lattice` AND `windArrow`; Diamond is `lattice` AND
//     `checker2x2`; a Solar Panel is `lattice` AND `solarPattern`), and only the
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

// Must come before anything that could build an icon.
const REAL_RANDOM = Math.random;
Math.random = () => {
  throw new Error('material icon generation must be deterministic (no Math.random)');
};

import { MATERIALS } from '../src/game/materials/index';
import { materialSvgFor, MATERIAL_ICON_CELLS as N } from '../src/game/render/materialSvg';
import { varyAmplitude, varyMode, VARY_PARTICLE } from '../src/game/tint';
import { Phase, type Material } from '../src/game/engine/types';
import { hex } from '../src/game/render/color';
import '../src/game/materials';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const byName = (name: string): Material => {
  const m = (MATERIALS as readonly Material[]).find((x) => x.name === name);
  if (!m) throw new Error('no palette material ' + name);
  return m;
};

/** Rasterize a generated icon back to a grid of `#rrggbb`, which also proves the
 *  emitted markup is exactly the full-tile background rect plus per-colour run
 *  paths it claims to be. */
function raster(svg: string): string[] {
  const bg = new RegExp(`<rect x="0" y="0" width="${N}" height="${N}" fill="(#[0-9a-f]{6})"/>`).exec(svg);
  if (!bg) throw new Error('icon has no full-tile background rect: ' + svg.slice(0, 120));
  const grid: string[] = new Array(N * N).fill(bg[1]);
  let painted = 0;
  for (const pm of svg.matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]+)"\/>/g)) {
    for (const seg of pm[2].matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      const x = +seg[1];
      const y = +seg[2];
      const run = +seg[3];
      if (+seg[4] !== run) throw new Error('malformed run in path data');
      for (let k = 0; k < run; k++) grid[y * N + x + k] = pm[1];
      painted += run;
    }
  }
  // Everything else in the markup must be one of those two shapes.
  const shapes = (svg.match(/<(rect|path|circle|polygon|g)\b/g) ?? []).length;
  const accounted = 1 + (svg.match(/<path /g) ?? []).length;
  if (shapes !== accounted) throw new Error('unexpected shape element in icon');
  if (painted > N * N) throw new Error('paths overlap');
  return grid;
}

/** A two-tone tile as ASCII: `.` = the tile's background rect — which for every
 *  pattern here is the material's own `color`, since the pattern is always the
 *  minority of cells — and `o` = the pattern colour. */
function ascii(m: Material): string {
  const svg = materialSvgFor(m);
  const g = raster(svg);
  const bg = new RegExp(`width="${N}" height="${N}" fill="(#[0-9a-f]{6})"`).exec(svg)![1];
  if (bg !== hex(m.color)) throw new Error(`${m.name}: pattern outweighs its base colour`);
  const tones = new Set(g);
  if (tones.size !== 2) throw new Error(`${m.name} is not two-tone (${tones.size} colours)`);
  const rows: string[] = [];
  for (let y = 0; y < N; y++) {
    let row = '';
    for (let x = 0; x < N; x++) row += g[y * N + x] === bg ? '.' : 'o';
    rows.push(row);
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// 1. Golden tiles — one per pattern family, in the renderer's branch order.
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
  // Fan: the same tent, folded over y for the horizontal blow FAN_RIGHT stamps.
  // Identical picture to the Conveyor's by construction — that is the renderer's
  // behaviour, not a copy-paste slip.
  Fan: [
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

for (const [name, want] of Object.entries(GOLDEN)) {
  const got = ascii(byName(name));
  check(`${name} tile matches its golden`, got === want, got === want ? '' : '\n' + got);
}

// The batteries' pattern colour is the renderer's literal flat black, not a
// shade of the base — a regression to `lattice` would be invisible in ASCII.
{
  const g = raster(materialSvgFor(byName('Lithium Battery')));
  check('battery staircase is flat black', g.includes('#000000'), [...new Set(g)].join(' '));
}

// ---------------------------------------------------------------------------
// 2. Every palette material produces a sane icon.
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
  // Full-bleed: the swatch is a filled tile, so a transparent hole would show
  // the chip's background through — and the chip's background changes when it is
  // selected, which would make the icon shift on click.
  try {
    const g = raster(svg);
    if (g.some((c) => !/^#[0-9a-f]{6}$/.test(c))) notFullBleed.push(m.name);
  } catch (e) {
    badMarkup.push(`${m.name}: ${(e as Error).message}`);
  }
}

check('every palette material has an icon', all.length > 0 && all.every((m) => materialSvgFor(m).length > 0), `${all.length} materials`);
check('no document-scoped names in any icon', badMarkup.length === 0, badMarkup.join(', '));
check('every icon covers its whole tile', notFullBleed.length === 0, notFullBleed.join(', '));
check('largest icon stays under 4 KB', worstBytes < 4096, `${worstName} ${worstBytes}B`);
check('all icons together stay under 250 KB', totalBytes < 250_000, `${(totalBytes / 1024) | 0} KB for ${all.length}`);

// ---------------------------------------------------------------------------
// 3. Flat stays flat; textured stays textured.
// ---------------------------------------------------------------------------

/** Distinct colours in a material's icon. */
const tones = (m: Material): number => new Set(raster(materialSvgFor(m))).size;

for (const name of ['Stone', 'Iron', 'Wall', 'Mercury', 'Liquid Gallium']) {
  const m = byName(name);
  check(`${name} is drawn flat`, tones(m) === 1, `${tones(m)} tones`);
}
check('a flat material costs one shape', materialSvgFor(byName('Stone')).match(/<(rect|path)/g)!.length === 1);

for (const name of ['Sand', 'Water', 'Crude Oil', 'Diamond']) {
  const m = byName(name);
  check(`${name} is speckled`, tones(m) > 8, `${tones(m)} tones`);
}

// The grain never exceeds the material's own amplitude — the icon runs the
// renderer's `((src - 128) * amp) >> 7`, so an icon brighter than that would mean
// the arithmetic diverged.
{
  let violations: string[] = [];
  for (const m of all) {
    const amp = varyAmplitude(m);
    if (amp === 0 || m.glow || m.auxPalette || m.tintPalette || m.checker2x2 || m.lattice) continue;
    const base = m.color;
    const br = base & 0xff;
    for (const c of new Set(raster(materialSvgFor(m)))) {
      const d = parseInt(c.slice(1, 3), 16) - br;
      // The channel clamps at 0/255, so only an *unclamped* overshoot is a bug.
      if (Math.abs(d) > amp && br + d > 0 && br + d < 255) violations.push(`${m.name} ${d} vs ±${amp}`);
    }
  }
  check('grain never exceeds the material amplitude', violations.length === 0, violations.slice(0, 4).join(', '));
}

// A liquid's shimmer is visibly narrower than a powder's, because the background
// field it samples is an OU process that settles to about half the spread of the
// uniform bytes a powder grain carries (see BG_SIGMA_SCALE). Water's amplitude
// (22) is *higher* than Sand's (18), so a naive icon would get this backwards.
{
  const spread = (m: Material): number => {
    const cs = [...new Set(raster(materialSvgFor(m)))].map((c) => parseInt(c.slice(1, 3), 16));
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
}

// ---------------------------------------------------------------------------
// 4. Glow materials show the ramp, gases dissolve.
// ---------------------------------------------------------------------------

for (const name of ['Lava', 'Molten Metal', 'Slag']) {
  const m = byName(name);
  const g = raster(materialSvgFor(m));
  const lum = (c: string) =>
    parseInt(c.slice(1, 3), 16) * 0.3 + parseInt(c.slice(3, 5), 16) * 0.59 + parseInt(c.slice(5, 7), 16) * 0.11;
  const topRow = g.slice(0, N).reduce((a, c) => a + lum(c), 0) / N;
  const botRow = g.slice(N * (N - 1)).reduce((a, c) => a + lum(c), 0) / N;
  check(`${name} shows a heat ramp, hot at the top`, topRow > botRow + 8, `${topRow | 0} vs ${botRow | 0}`);
  check(`…and never cools past its ramp floor`, tones(m) > 4, `${tones(m)} tones`);
}

for (const name of ['Steam', 'Smoke', 'Chlorine']) {
  const m = byName(name);
  const g = raster(materialSvgFor(m));
  const base = `#${(m.color & 0xff).toString(16).padStart(2, '0')}`;
  const lit = (row: number) =>
    g.slice(row * N, row * N + N).filter((c) => c.startsWith(base)).length;
  check(`${name} dissolves downward like a cloud`, lit(0) > lit(N - 1), `${lit(0)} → ${lit(N - 1)} cells`);
  check(`…and is a Gas with no grain of its own`, m.phase === Phase.Gas && varyAmplitude(m) === 0);
}

// A gas that DOES carry a grain (none ship today, but the branch guards for it)
// must fall through to the speckle rather than the dissolve.
check('the gas dissolve only claims flat gases',
  all.every((m) => !(m.phase === Phase.Gas && varyAmplitude(m) > 0) || tones(m) > 2));

// ---------------------------------------------------------------------------
// 5. The two palette-array materials show their palette, not one colour.
// ---------------------------------------------------------------------------

{
  const fw = byName('Fireworks');
  const hues = new Set(
    raster(materialSvgFor(fw)).map((c) => {
      // Collapse brightness so only the underlying palette entry remains.
      const r = parseInt(c.slice(1, 3), 16);
      const g = parseInt(c.slice(3, 5), 16);
      const b = parseInt(c.slice(5, 7), 16);
      const mx = Math.max(r, g, b) || 1;
      return `${Math.round((r / mx) * 8)},${Math.round((g / mx) * 8)},${Math.round((b / mx) * 8)}`;
    }),
  );
  check('Fireworks speckles all three palette colours', hues.size >= 3, `${hues.size} hues`);

  const seed = byName('Seed');
  const g = raster(materialSvgFor(seed));
  const green = (c: string) => parseInt(c.slice(3, 5), 16) - parseInt(c.slice(1, 3), 16);
  const top = g.slice(0, N).reduce((a, c) => a + green(c), 0) / N;
  const bot = g.slice(N * (N - 1)).reduce((a, c) => a + green(c), 0) / N;
  check('Seed sprouts green at the top, dormant brown at the base', top > bot + 10, `${top | 0} vs ${bot | 0}`);
}

Math.random = REAL_RANDOM;
console.log(failures === 0 ? '\nAll material icon checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
