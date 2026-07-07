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
