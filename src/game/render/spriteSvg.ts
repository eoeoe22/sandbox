// Shared pixel-buffer → SVG helpers.
//
// Two callers turn a packed-color pixel buffer into inline SVG for the material
// selector: objectSvg.ts (the 독립 오브젝트 bodies, straight from the sprite data
// the renderer rasterizes) and materialSvg.ts (each material's palette icon,
// built by replaying the renderer's own branch chain over a small patch). Both
// want the same two things — run-merged `<rect>`s and a crisp, aspect-preserving
// wrapper — so the code lives here instead of being copied.
import { hex } from './color';

/**
 * Turn a sprite pixel buffer into SVG `<rect>`s, merging horizontal runs of the
 * same color into one rect each so the markup stays compact (a drum is a few
 * dozen rects, not ~700). Transparent pixels (0) are skipped. `ox`/`oy` offset
 * every rect, so callers can leave room in the viewBox for extra art drawn
 * around the sprite (the dynamite fuse).
 *
 * Skipping 0 is also what keeps a material icon small: the generator leaves
 * every cell that keeps the material's base color transparent and paints that
 * base as one full-tile rect underneath, so only the cells that actually deviate
 * cost a rect (see materialSvg.ts).
 */
export function spriteRects(
  buf: Uint32Array,
  w: number,
  h: number,
  ox = 0,
  oy = 0,
): string {
  let out = '';
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const c = buf[y * w + x];
      if (c === 0) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < w && buf[y * w + x + run] === c) run++;
      out += `<rect x="${x + ox}" y="${y + oy}" width="${run}" height="1" fill="${hex(c)}"/>`;
      x += run;
    }
  }
  return out;
}

/**
 * Like `spriteRects`, but emitting one `<path>` per distinct colour instead of one
 * `<rect>` per run, and merging each run *downward* as well as across.
 *
 * For sprite art per-run rects and per-colour paths are about even — a drum is
 * mostly long single-colour runs, and rects are far easier to read in a diff. For a
 * *dense, speckled* patch they are not: a material icon's grain is 81 cells of ~36
 * different brightnesses with almost no run to merge, and at that density per-run
 * rects cost roughly twice what per-colour paths do (the `x`/`y`/`width`/`height`/
 * `fill` attribute names are repeated 81 times instead of the colour being named
 * once and each cell costing a dozen characters of path data). With the whole
 * registry on screen at once — the palette's search view has no virtualization, so
 * 126 chips can be live together — that difference is the difference between ~340 KB
 * of markup and ~150 KB.
 *
 * The vertical merge is what makes a *resampled* patch affordable. The radioactive
 * chips draw the ordinary 9-cell tile at 18 cells so the hazard trefoil over them
 * has room to be a recognizable shape (see materialSvg's HAZARD_TREFOIL), and every
 * source cell becomes a 2×2 block there. Emitting those as two one-row runs each
 * doubled the segment count and pushed the speckled ones past the harness's 4 KB
 * per-icon budget; as one `h2v2` box they cost what the 9-cell tile did. Patterns
 * with plain vertical repetition (the Wall's courses, the Pump's risers, the panel's
 * seams) get the same discount for free.
 *
 * A run only extends down while the whole row beneath it matches cell for cell, so
 * the emitted boxes never overlap and every non-zero cell is painted exactly once —
 * which is what lets a caller add the areas up to check coverage.
 *
 * Iteration is insertion-ordered (`Map`), so the output is byte-stable for a given
 * buffer.
 */
export function spritePaths(buf: Uint32Array, w: number, h: number): string {
  const byColor = new Map<number, string>();
  // Cells already swallowed by a box started higher up.
  const taken = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const i = y * w + x;
      const c = buf[i];
      if (c === 0 || taken[i]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < w && buf[i + run] === c && !taken[i + run]) run++;
      // Grow downward while the row below repeats this run exactly.
      let tall = 1;
      for (let ny = y + 1; ny < h; ny++) {
        let same = true;
        for (let k = 0; k < run; k++) {
          const ni = ny * w + x + k;
          if (buf[ni] !== c || taken[ni]) {
            same = false;
            break;
          }
        }
        if (!same) break;
        tall++;
      }
      for (let ny = y + 1; ny < y + tall; ny++)
        for (let k = 0; k < run; k++) taken[ny * w + x + k] = 1;
      byColor.set(c, (byColor.get(c) ?? '') + `M${x} ${y}h${run}v${tall}h-${run}z`);
      x += run;
    }
  }
  let out = '';
  for (const [c, d] of byColor) out += `<path fill="${hex(c)}" d="${d}"/>`;
  return out;
}

/** Wrap inner SVG in a pixel-art `<svg>`: crisp edges (nearest-neighbor look,
 *  matching the in-world rasterizer) and `meet` so the shape scales to fit the
 *  chip's box while keeping its aspect ratio, centered. `cls` picks the class the
 *  consuming component's CSS sizes — `obj-svg` for an object body, `mat-svg` for
 *  a material tile.
 *
 *  No `id`, `<defs>`, `<style>` or `url(#…)` anywhere in here on purpose: these
 *  strings are injected with `{@html}` and the same one can appear several times
 *  in a single document (a material shows up in its category flyout, in the
 *  favourites row and in search results at once), so any document-scoped name
 *  would collide with its own copies. */
export function pixelSvg(vbW: number, vbH: number, inner: string, cls = 'obj-svg'): string {
  return (
    `<svg class="${cls}" viewBox="0 0 ${vbW} ${vbH}" ` +
    `preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`
  );
}
