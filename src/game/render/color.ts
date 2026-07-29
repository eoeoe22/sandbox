// Colors are stored as a single 32-bit integer laid out as 0xAABBGGRR — the
// little-endian byte order of a Uint32 view over ImageData's RGBA buffer. That
// lets the renderer write one number per pixel instead of four bytes.

/** Pack an r,g,b(,a) color into a 0xAABBGGRR Uint32 for direct ImageData writes. */
export function rgb(r: number, g: number, b: number, a = 255): number {
  return (((a << 24) >>> 0) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Convert a packed 0xAABBGGRR color into a CSS `rgb(...)` string (for UI swatches). */
export function toCss(packed: number): string {
  const r = packed & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = (packed >> 16) & 0xff;
  return `rgb(${r} ${g} ${b})`;
}

/** A packed 0xAABBGGRR color → `#rrggbb`. Alpha is dropped — this is for SVG
 *  `fill` attributes, where the sprite/patch pixels are all fully opaque (0 is
 *  the transparent sentinel, handled by the caller before it gets here). */
export function hex(packed: number): string {
  const r = packed & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = (packed >> 16) & 0xff;
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Shading primitives.
//
// These live here rather than on CanvasRenderer because two callers need them
// and must agree pixel-for-pixel: the in-world renderer, and the palette icon
// generator (render/materialSvg.ts) that replays the same branch chain to build
// each material's swatch. A palette chip that shades by its own arithmetic would
// silently drift from the canvas the first time either side was tweaked; sharing
// one implementation makes that drift structurally impossible.
// ---------------------------------------------------------------------------

/** Shift a packed 0xAABBGGRR color's brightness by `d` (per channel, clamped),
 *  preserving alpha. Used to render each particle's individual tint. */
export function tinted(base: number, d: number): number {
  let r = (base & 0xff) + d;
  let g = ((base >> 8) & 0xff) + d;
  let b = ((base >> 16) & 0xff) + d;
  if (r < 0) r = 0;
  else if (r > 255) r = 255;
  if (g < 0) g = 0;
  else if (g > 255) g = 255;
  if (b < 0) b = 0;
  else if (b > 255) b = 255;
  return ((base & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Blend a packed colour toward an icy white-blue, for rendering a frozen
 *  liquid (see Material.freeze) as a frosted block distinct from its liquid
 *  self. Keeps a little of the base hue so frozen oil still reads dark-frosty
 *  and frozen mercury pale-frosty. */
export function frosted(base: number): number {
  const fr = 210;
  const fg = 232;
  const fb = 248;
  const mix = (c: number, f: number): number => ((c * 45 + f * 55) / 100) | 0;
  const r = mix(base & 0xff, fr);
  const g = mix((base >> 8) & 0xff, fg);
  const b = mix((base >> 16) & 0xff, fb);
  return ((base & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
}

/** A glow material's temperature→colour ramp, pre-split into channels so the
 *  render loop can lerp per cell without unpacking on every pixel. */
export interface GlowRamp {
  min: number;
  invRange: number;
  // cool-end channels and the per-channel delta up to the hot (base) color.
  cr: number;
  cg: number;
  cb: number;
  dr: number;
  dg: number;
  db: number;
}

/** Split the cool and base (hot) colors into channels so the render loop can
 *  lerp between them per cell without unpacking on every pixel. */
export function buildGlow(
  glow: { min: number; max: number; cool: number },
  hot: number,
): GlowRamp {
  return {
    min: glow.min,
    invRange: 1 / Math.max(1, glow.max - glow.min),
    cr: glow.cool & 0xff,
    cg: (glow.cool >> 8) & 0xff,
    cb: (glow.cool >> 16) & 0xff,
    dr: (hot & 0xff) - (glow.cool & 0xff),
    dg: ((hot >> 8) & 0xff) - ((glow.cool >> 8) & 0xff),
    db: ((hot >> 16) & 0xff) - ((glow.cool >> 16) & 0xff),
  };
}

/** Interpolate a glow ramp at temperature `t` into a packed 0xAABBGGRR color. */
export function shade(g: GlowRamp, t: number): number {
  let f = (t - g.min) * g.invRange;
  if (f < 0) f = 0;
  else if (f > 1) f = 1;
  const r = (g.cr + g.dr * f) & 0xff;
  const gr = (g.cg + g.dg * f) & 0xff;
  const b = (g.cb + g.db * f) & 0xff;
  return (0xff000000 | (b << 16) | (gr << 8) | r) >>> 0;
}
