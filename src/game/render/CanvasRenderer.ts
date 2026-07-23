import type { Renderer } from './Renderer';
import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import { getMaterial } from '../materials/registry';
import { EMPTY, Phase, type BorderMode } from '../engine/types';
import { varyAmplitude, varyMode, VARY_PARTICLE, TINT_NEUTRAL } from '../tint';
import { rgb } from './color';
import { drumSpriteFor, DRUM_SPRITE_W, DRUM_SPRITE_H } from './drumSprite';
import { DYN_SPRITE, DYN_SPRITE_W, DYN_SPRITE_H, FUSE_CORD_COLOR } from './dynamiteSprite';
import type { DrumFill } from '../engine/objects';

/** Rubber-ball body color, packed 0xAABBGGRR for direct pixel-grid writes. The
 *  ball is rasterized into the same low-res buffer as the cells, so it reads as
 *  pixel art in the exact grain size — no vector circle, no anti-aliasing. */
const BALL_COLOR = rgb(0xd8, 0x46, 0x52); // rubber red
/** Thin dark rim drawn around the rubber ball's edge so the disc reads as a
 *  distinct object against similarly-colored terrain (e.g. Lava). */
const BALL_BORDER_COLOR = rgb(0x1a, 0x10, 0x12); // near-black rubber outline

/** Free objects (balls, drums) are rasterized into a separate overlay buffer at
 *  this many sub-pixels per grid cell, so they read at higher resolution than the
 *  chunky cell grain — the drum sprite in particular gets its full native detail.
 *  Still nearest-neighbor / no anti-aliasing, so it stays crisp pixel art, just
 *  finer. */
const OBJECT_SCALE = 2;

// ── Fan wind streaks (선풍기 바람 이펙트) ──────────────────────────────────────
// The wind field (Grid.wind) is drawn as animated low-res *streaks* over the empty
// air of a fan's beam — little gust glyphs (the classic "말리는 바람" wind icon: a
// line that hooks into a squared counter-clockwise spiral at its leading edge), not
// a solid fill and not a particle. Each streak runs its own *lifecycle*, exactly
// like the standalone example's per-line keyframes: it first draws in as a straight
// trailing line, then the head curls into the hook (서서히 말리는 — it is NOT born
// pre-curled), holds a beat, and finally retracts/fades from the tail. The lit
// portion is thresholded along the glyph's arclength (reveal grows tail→hook while
// drawing, retract eats tail→hook while fading), so the curl visibly forms over
// time instead of popping in complete.
//
// Streaks no longer sit on a rigid grid: each streak slot is picked pseudo-randomly
// (windHash01) so heads spawn at scattered positions across *and* along the beam
// (WIND_JITTER cross-spread, per-line phase offset) and each runs its lifecycle out
// of phase with its neighbours. So at any instant the beam shows a natural mix of
// young straight streaks and older curled ones rather than a marching lockstep row.
// Where the beam is too narrow to fit the hook the streak degrades cleanly to just
// its line, so the effect always reads as wind acting *on* the scene, not covering
// it — mirroring the example while staying inside the pixel grid.
// Three light-blue shades (bae6fd / 7dd3fc / 38bdf8), one per centreline, matching
// the example's stacked wind lines.
const WIND_STREAK_COLORS = [rgb(186, 230, 253), rgb(125, 211, 252), rgb(56, 189, 248)];
const WIND_LINE_SPACING = 8; // base spacing of streak centrelines across the beam
const WIND_JITTER = 4; // cross-spread of a streak's random spawn (± cells)
const WIND_PERIOD = 20; // streak repeat length along the beam (cells)
const WIND_ANIM_SPEED = 0.35; // cells the streaks advance per rendered frame
const WIND_LIFE = 40; // phase-steps in one streak lifecycle (draw → hold → fade)
const WIND_DRAW = 0.55; // fraction of the life spent drawing the line + curling in
const WIND_HOLD = 0.15; // fraction held fully drawn before the fade begins
// Curl-streak geometry, in cells, measured back from the leading head (dA ≥ 0 is
// distance behind the head along the blow; dc is the perpendicular offset from the
// centreline, the hook curling toward −dc). Mirrors the example glyph's squared
// spiral: a long trailing line, a vertical rise at the head, a short return along
// the top, then a little inward hook.
const WIND_BODY = 12; // lit length of the trailing line
const WIND_HOOK = 4; // how far the top of the hook runs back from the head
const WIND_HOOK_IN = 2; // where the inner return starts (back from head)
const WIND_CURL_H = 2; // outer height of the hook — kept tight for a narrow curl
const WIND_CURL_IN = 1; // inner return height
// How far the curl may overhang the beam edge before it would be clipped. The hook
// reaches WIND_CURL_H cells across the centreline, so an empty cell up to this far
// outside the field can still legitimately host a hook — the overhang pass renders
// it instead of cutting the curl at the beam boundary.
const WIND_HALO = WIND_CURL_H;
// Total arclength of the glyph path, tail → head → around the hook. The lifecycle
// reveals/retracts this length so the curl draws in progressively.
const WIND_TOTAL = WIND_BODY + 2 * WIND_CURL_H + 2 * WIND_HOOK - WIND_CURL_IN - WIND_HOOK_IN;

/** Fractional part, kept in [0, 1). */
function windFrac(v: number): number {
  return v - Math.floor(v);
}

// ── Woofer shockwave wavefront (우퍼 충격파 이펙트) ───────────────────────────
// Where the Fan paints continuous streaks, the Woofer thumps a *pulse*: each
// firing body hands the renderer its own cells (Grid.shockwaves) and the renderer
// grows a single wavefront *out of the cabinet's actual outline*, then fades it at
// the rim — a background layer just like the wind. Drawn as low-res pixel art on
// purpose: one flat cyan shade (single layer) on a chunky SHOCK_BLOCK×SHOCK_BLOCK
// lattice, the front stepping outward a block at a time, and the spawn/rim
// dissolve is a 4×4 ordered (Bayer) dither per block rather than an alpha ramp.
//
// It stays honest to the physics: the front is a distance field *seeded on the
// body cells and blocked by solids* (see buildShockField), so it leaves the body's
// real surface — not a circle from its centre — spreads exactly the pulse's reach,
// and a wall stops it instead of letting it shine through, matching the POWER-0
// pulse every solid blocks. Opaque matter (powder / solid / gas) occludes the
// background wave; only liquid is special-cased — a lit pool cell is stippled
// (checkerboard) toward the board behind it, so 액체는 반투명 처리 — 백그라운드가
// 비쳐 보임 (Woofer 충격파만).
const SHOCK_SHADE = rgb(0x38, 0xbd, 0xf8); // single flat cyan layer
const SHOCK_BLOCK = 2; // low-res: wave drawn on a SHOCK_BLOCK²-cell lattice (chunky pixels)
const SHOCK_SPEED = 0.6; // cells the wavefront advances per rendered frame
const SHOCK_THICK = 2; // wavefront thickness in cells (~one low-res block)
const SHOCK_FADE = 3; // cells over which the front dithers in (spawn) / out (rim)
const SHOCK_LIQUID_WASH = 0.5; // cyan mixed into a pool's see-through (stippled) pixel
const SHOCK_INF = 1e9; // "unreachable" marker in the distance field
// 8-neighbour steps + costs for the geodesic distance transform (√2 on diagonals
// so the front stays round-ish while still routing around walls).
const SHOCK_DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
const SHOCK_DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
const SHOCK_C8 = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
// 4×4 ordered-dither threshold matrix (values 0..15), the classic pixel-art fade —
// a block draws only when its (blockX&3,blockY&3) threshold is below the fade level.
const SHOCK_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Cheap deterministic hash of two integers → [0, 1). Gives every streak slot its
 *  own stable random spawn offset and lifecycle phase without any per-cell state. */
function windHash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Arclength (0 at the tail … WIND_TOTAL around the hook) of the cell at shape-local
 *  (dA behind the head, dc across from the centreline), or −1 if the cell is off the
 *  glyph. The lifecycle lights a cell only while its arclength sits between the
 *  current reveal (draw-in) and retract (fade) thresholds — so the squared
 *  counter-clockwise hook forms gradually rather than all at once.
 *  NOTE: dA and dc must be integers — the two hook connector strokes gate on exact
 *  equality (dA === 0, dA === WIND_HOOK), so a fractional dA would silently drop
 *  them and gap the hook. Callers keep dA integral (see the render loop). */
function windGlyphArc(dA: number, dc: number): number {
  if (dc === 0) return dA <= WIND_BODY ? WIND_BODY - dA : -1; // trailing line (tail→head)
  if (dA === 0) return dc >= -WIND_CURL_H && dc < 0 ? WIND_BODY - dc : -1; // rise at the head
  if (dc === -WIND_CURL_H) return dA >= 0 && dA <= WIND_HOOK ? WIND_BODY + WIND_CURL_H + dA : -1; // top
  if (dA === WIND_HOOK)
    return dc >= -WIND_CURL_H && dc <= -WIND_CURL_IN
      ? WIND_BODY + WIND_CURL_H + WIND_HOOK + (dc + WIND_CURL_H) // inner drop
      : -1;
  if (dc === -WIND_CURL_IN)
    return dA >= WIND_HOOK_IN && dA <= WIND_HOOK
      ? WIND_BODY + 2 * WIND_CURL_H + WIND_HOOK - WIND_CURL_IN + (WIND_HOOK - dA) // inner return
      : -1;
  return -1;
}

/** Blow direction (0..3) to borrow for an empty cell that sits just *outside* the
 *  wind field, so a curl hook overhanging the beam edge still renders instead of
 *  being clipped. Scans the four orthogonal rays out to WIND_HALO cells and returns
 *  the nearest wind cell's direction, or −1 if none is within reach. The streak's
 *  spine check still gates the actual paint, so this only ever *extends* a real
 *  hook past the boundary — it can't spawn a streak in open air. */
function windHaloDir(windArr: Uint8Array, x: number, y: number, w: number, h: number): number {
  for (let k = 1; k <= WIND_HALO; k++) {
    if (y - k >= 0) {
      const v = windArr[(y - k) * w + x];
      if (v !== 0) return v - 1;
    }
    if (y + k < h) {
      const v = windArr[(y + k) * w + x];
      if (v !== 0) return v - 1;
    }
    if (x - k >= 0) {
      const v = windArr[y * w + (x - k)];
      if (v !== 0) return v - 1;
    }
    if (x + k < w) {
      const v = windArr[y * w + (x + k)];
      if (v !== 0) return v - 1;
    }
  }
  return -1;
}

/**
 * Canvas 2D renderer. Writes one packed Uint32 color per cell into an offscreen
 * ImageData at grid resolution, then scales it up to the sandbox rectangle with
 * smoothing off (crisp pixels). The rectangle comes from the shared
 * SandboxLayout, so the grid, its outline, and pointer hit-testing all agree on
 * where the sandbox is — even as its size and aspect ratio change at runtime.
 *
 * The offscreen buffer is rebuilt whenever the grid's dimensions change (the
 * sandbox was resized). Fast enough for a wide range of grid sizes and
 * swappable for a WebGL renderer via the Renderer interface.
 */
/** Heat-overlay ramp bounds and resolution. Cells at/below HEAT_MIN read fully
 *  cold, at/above HEAT_MAX fully white-hot; everything between is interpolated
 *  through HEAT_STOPS into a HEAT_LUT_SIZE-entry lookup table. */
const HEAT_MIN = -50;
const HEAT_MAX = 1500;
const HEAT_LUT_SIZE = 256;
/** Thermal-camera colour stops: [temperature°, r, g, b], cold → hot. */
const HEAT_STOPS: readonly [number, number, number, number][] = [
  [-50, 20, 40, 130],
  [20, 30, 64, 96],
  [120, 70, 44, 96],
  [320, 150, 40, 44],
  [620, 232, 72, 24],
  [1000, 255, 168, 36],
  [1500, 255, 244, 210],
];

/** Precomputed temperature→color ramp for a glowing material (see Material.glow). */
interface GlowRamp {
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

export class CanvasRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private image!: ImageData;
  private buf32!: Uint32Array;
  /** Higher-resolution (OBJECT_SCALE×) overlay for the free-object layer, drawn
   *  over the scaled-up grid image so objects render finer than the cells. Sized
   *  to OBJECT_SCALE× the grid in allocForGrid; transparent where no object. */
  private objOff: HTMLCanvasElement;
  private objCtx: CanvasRenderingContext2D;
  private objImage!: ImageData;
  private objBuf32!: Uint32Array;
  private palette: Uint32Array;
  /** id → temperature ramp, or null for materials drawn with a flat color. */
  private glow: (GlowRamp | null)[];
  /** id → brightness spread (0 = flat, no tint). See game/tint.ts. */
  private vary: Uint8Array;
  /** id → which tint field to sample (VARY_PARTICLE = per-grain, else background). */
  private varyMode: Uint8Array;
  /** id → 1 if the cell is drawn as the material named by its `aux` byte instead
   *  of its own color (Debris renders as the material it carries). */
  private renderAsAux: Uint8Array;
  /** id → freezing point; a cell of a `freeze` material at/below this temperature
   *  is drawn frosted (see Material.freeze). -Infinity for materials that never
   *  freeze, so the per-cell `temp <= freezeTemp` test never matches them. */
  private freezeTemp: Float32Array;
  /** id → precomputed frosted colour used when a freeze material is frozen. */
  private frost: Uint32Array;
  /** id → 1 if the material draws a positional lattice checkerboard (Mesh). */
  private hasLattice: Uint8Array;
  /** id → the packed lattice colour woven through the base (valid where hasLattice). */
  private lattice: Uint32Array;
  /** id → 1 if the material draws a directional chevron from its aux byte
   *  (Conveyor), in the `lattice` colour over the base (see Material.arrow). */
  private arrow: Uint8Array;
  /** id → 1 if the material draws a 4-directional chevron from its aux byte, with
   *  the low 2 bits the blow direction and the rest a powered countdown that
   *  brightens the chevron (Fan — see Material.windArrow). */
  private windArrow: Uint8Array;
  /** Advancing animation phase for the Fan's wind streaks — bumped once per
   *  rendered frame so the dashes flow along the blow direction (see the wind
   *  field draw in render()). Purely cosmetic; not tied to the sim tick. */
  private windPhase = 0;
  /** True if the previous frame drew any wind cell. Gates the (slightly pricier)
   *  overhang/halo pass — where a curl hook renders on empty air just outside the
   *  beam — so a scene with no active fan never pays for it. One-frame latency is
   *  imperceptible (a beam persists across frames while its fan runs). */
  private windWasActive = false;
  /** Bounding box of the previous frame's wind cells (maxX < minX ⇒ empty). The
   *  overhang pass only scans empty cells within WIND_HALO of this box, so a single
   *  fan doesn't make the whole grid pay the halo scan — only the neighbourhood of
   *  actual beams. Lagged one frame like windWasActive; beams move at most a cell or
   *  two per frame, well inside the WIND_HALO padding. */
  private windMinX = 0;
  private windMaxX = -1;
  private windMinY = 0;
  private windMaxY = -1;
  /** id → 1 for a Liquid, so the Woofer shockwave pass can render a pool cell
   *  semi-transparent (stippled toward the board behind) while other matter
   *  occludes the wave (see the shockwave draw in render()). */
  private isLiquid: Uint8Array;
  /** id → 1 for a Solid, which blocks the Woofer shockwave's distance field the
   *  way a POWER-0 pulse is stopped by any solid it can't break — the wavefront
   *  routes around / halts at a wall instead of shining through it (see
   *  buildShockField). */
  private isSolid: Uint8Array;
  /** Live Woofer shockwaves, each a precomputed geodesic distance-from-body field
   *  the wavefront sweeps outward through: `dist` the field over its bbox (SHOCK_INF
   *  where unreachable), `x0,y0` the bbox's fine-grid origin, `bw,bh` its dims,
   *  `maxR` the terminal radius (= reach), `age` frames since spawn. Built from
   *  Grid.shockwaves on drain and dropped once the front clears the rim. Purely
   *  cosmetic renderer state, animated per rendered frame like windPhase. */
  private shocks: {
    dist: Float64Array;
    x0: number;
    y0: number;
    bw: number;
    bh: number;
    maxR: number;
    age: number;
  }[] = [];
  /** id → 1 if the material's `temp` holds packed non-thermal state, not a real
   *  degree reading (see Material.packedTemp) — the heat overlay draws such a cell
   *  as background rather than colouring garbage packed values as white-hot. */
  private packed: Uint8Array;
  /** id → fixed apparent temperature for the heat overlay (see Material.overlayTemp),
   *  or NaN when unset — a packed-temp cell then falls back to background. */
  private overlayTemp: Float32Array;
  /** Current edge mode — only affects how the boundary outline is drawn. */
  private borderMode: BorderMode = 'wall';
  /** When true, occupied cells are drawn by temperature (thermal camera) instead
   *  of their material colour (see setHeatOverlay / HEAT_LUT). */
  private heatOverlay = false;
  /** Reference-grid line spacing in cells; 0 = no overlay (see setGridDivision). */
  private gridDivision = 0;
  /** Packed temperature→colour lookup for the heat overlay, spanning
   *  [HEAT_MIN, HEAT_MAX]° in HEAT_LUT_SIZE steps (built once in the ctor). */
  private heatLut: Uint32Array;

  constructor(
    private canvas: HTMLCanvasElement,
    grid: Grid,
    private layout: SandboxLayout,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.off = document.createElement('canvas');
    const offCtx = this.off.getContext('2d');
    if (!offCtx) throw new Error('Offscreen 2D context unavailable');
    this.offCtx = offCtx;

    this.objOff = document.createElement('canvas');
    const objCtx = this.objOff.getContext('2d');
    if (!objCtx) throw new Error('Object overlay 2D context unavailable');
    this.objCtx = objCtx;

    this.allocForGrid(grid);
    this.heatLut = CanvasRenderer.buildHeatLut();

    // Precompute id → color. Materials are registered before the renderer is
    // constructed, so this stays in sync for the milestone's fixed set.
    this.palette = new Uint32Array(256);
    this.glow = new Array(256).fill(null);
    this.vary = new Uint8Array(256);
    this.varyMode = new Uint8Array(256);
    this.renderAsAux = new Uint8Array(256);
    this.freezeTemp = new Float32Array(256).fill(-Infinity);
    this.frost = new Uint32Array(256);
    this.hasLattice = new Uint8Array(256);
    this.lattice = new Uint32Array(256);
    this.arrow = new Uint8Array(256);
    this.windArrow = new Uint8Array(256);
    this.isLiquid = new Uint8Array(256);
    this.isSolid = new Uint8Array(256);
    this.packed = new Uint8Array(256);
    this.overlayTemp = new Float32Array(256).fill(NaN);
    for (let i = 0; i < 256; i++) {
      const m = getMaterial(i);
      this.palette[i] = m ? m.color : 0;
      if (m?.glow) this.glow[i] = CanvasRenderer.buildGlow(m.glow, m.color);
      if (m) {
        this.vary[i] = varyAmplitude(m);
        this.varyMode[i] = varyMode(m);
        if (m.renderAsAux) this.renderAsAux[i] = 1;
        if (m.packedTemp) this.packed[i] = 1;
        if (m.overlayTemp !== undefined) this.overlayTemp[i] = m.overlayTemp;
        if (m.lattice !== undefined) {
          this.hasLattice[i] = 1;
          this.lattice[i] = m.lattice;
        }
        if (m.arrow) this.arrow[i] = 1;
        if (m.windArrow) this.windArrow[i] = 1;
        if (m.phase === Phase.Liquid) this.isLiquid[i] = 1;
        if (m.phase === Phase.Solid) this.isSolid[i] = 1;
        if (m.freeze) {
          this.freezeTemp[i] = m.freeze.temp;
          this.frost[i] = CanvasRenderer.frosted(m.color);
        }
      }
    }
  }

  /** Blend a packed colour toward an icy white-blue, for rendering a frozen
   *  liquid (see Material.freeze) as a frosted block distinct from its liquid
   *  self. Keeps a little of the base hue so frozen oil still reads dark-frosty
   *  and frozen mercury pale-frosty. */
  private static frosted(base: number): number {
    const fr = 210;
    const fg = 232;
    const fb = 248;
    const mix = (c: number, f: number): number => ((c * 45 + f * 55) / 100) | 0;
    const r = mix(base & 0xff, fr);
    const g = mix((base >> 8) & 0xff, fg);
    const b = mix((base >> 16) & 0xff, fb);
    return ((base & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
  }

  /** Blend a cell's rendered color toward its 겹침 overlap fluid's base color
   *  (5/8 host, 3/8 fluid), so wet sand and a screen with water or steam passing
   *  through read as such at a glance while the host's own look (lattice weave,
   *  grain) still shows through. */
  private static wetted(host: number, fluid: number): number {
    const r = (((host & 0xff) * 5 + (fluid & 0xff) * 3) >> 3) & 0xff;
    const g = ((((host >> 8) & 0xff) * 5 + ((fluid >> 8) & 0xff) * 3) >> 3) & 0xff;
    const b = ((((host >> 16) & 0xff) * 5 + ((fluid >> 16) & 0xff) * 3) >> 3) & 0xff;
    return ((host & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
  }

  /** Linearly blend packed 0xAABBGGRR `host` toward `other` by `t` (0..1),
   *  keeping host's alpha. The per-channel mix behind the Woofer shockwave's
   *  crest (host → cyan) and its translucent liquid (host → background). */
  private static mix(host: number, other: number, t: number): number {
    const it = 1 - t;
    const r = (((host & 0xff) * it + (other & 0xff) * t) | 0) & 0xff;
    const g = ((((host >> 8) & 0xff) * it + ((other >> 8) & 0xff) * t) | 0) & 0xff;
    const b = ((((host >> 16) & 0xff) * it + ((other >> 16) & 0xff) * t) | 0) & 0xff;
    return ((host & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
  }

  /** Shift a packed 0xAABBGGRR color's brightness by `d` (per channel, clamped),
   *  preserving alpha. Used to render each particle's individual tint. */
  private static tinted(base: number, d: number): number {
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

  /** Split the cool and base (hot) colors into channels so the render loop can
   *  lerp between them per cell without unpacking on every pixel. */
  private static buildGlow(
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
  private static shade(g: GlowRamp, t: number): number {
    let f = (t - g.min) * g.invRange;
    if (f < 0) f = 0;
    else if (f > 1) f = 1;
    const r = (g.cr + g.dr * f) & 0xff;
    const gr = (g.cg + g.dg * f) & 0xff;
    const b = (g.cb + g.db * f) & 0xff;
    return (0xff000000 | (b << 16) | (gr << 8) | r) >>> 0;
  }

  /** Build the temperature→colour lookup for the heat overlay by linearly
   *  interpolating HEAT_STOPS across HEAT_LUT_SIZE entries spanning
   *  [HEAT_MIN, HEAT_MAX]. Packed 0xAABBGGRR, fully opaque. */
  private static buildHeatLut(): Uint32Array {
    const lut = new Uint32Array(HEAT_LUT_SIZE);
    for (let i = 0; i < HEAT_LUT_SIZE; i++) {
      const t = HEAT_MIN + (i / (HEAT_LUT_SIZE - 1)) * (HEAT_MAX - HEAT_MIN);
      // Find the bracketing stop pair.
      let s = 0;
      while (s < HEAT_STOPS.length - 2 && t > HEAT_STOPS[s + 1][0]) s++;
      const [t0, r0, g0, b0] = HEAT_STOPS[s];
      const [t1, r1, g1, b1] = HEAT_STOPS[s + 1];
      const f = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      const r = (r0 + (r1 - r0) * f) & 0xff;
      const g = (g0 + (g1 - g0) * f) & 0xff;
      const b = (b0 + (b1 - b0) * f) & 0xff;
      lut[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    }
    return lut;
  }

  /** Map a temperature to its packed heat-overlay colour via the LUT. */
  private heatColor(t: number): number {
    let idx = ((t - HEAT_MIN) / (HEAT_MAX - HEAT_MIN)) * (HEAT_LUT_SIZE - 1);
    if (idx < 0) idx = 0;
    else if (idx > HEAT_LUT_SIZE - 1) idx = HEAT_LUT_SIZE - 1;
    return this.heatLut[idx | 0];
  }

  /** (Re)size the offscreen buffer to match the grid resolution. */
  private allocForGrid(grid: Grid): void {
    this.off.width = grid.width;
    this.off.height = grid.height;
    this.image = this.offCtx.createImageData(grid.width, grid.height);
    this.buf32 = new Uint32Array(this.image.data.buffer);
    // The object overlay is OBJECT_SCALE× the grid resolution.
    const ow = grid.width * OBJECT_SCALE;
    const oh = grid.height * OBJECT_SCALE;
    this.objOff.width = ow;
    this.objOff.height = oh;
    this.objImage = this.objCtx.createImageData(ow, oh);
    this.objBuf32 = new Uint32Array(this.objImage.data.buffer);
    // Drop any in-flight Woofer shockwaves — their distance fields hold absolute
    // coordinates for the old dimensions, which would paint into the wrong cells.
    this.shocks.length = 0;
  }

  render(grid: Grid): void {
    if (this.off.width !== grid.width || this.off.height !== grid.height) {
      this.allocForGrid(grid);
    }

    const cells = grid.cells;
    const temp = grid.temp;
    const tintArr = grid.tint;
    const bgArr = grid.bgTint;
    const auxArr = grid.aux;
    const buf = this.buf32;
    const pal = this.palette;
    const glow = this.glow;
    const vary = this.vary;
    const mode = this.varyMode;
    const asAux = this.renderAsAux;
    const freezeTemp = this.freezeTemp;
    const frost = this.frost;
    const hasLat = this.hasLattice;
    const latCol = this.lattice;
    const arrow = this.arrow;
    const windArrow = this.windArrow;
    const packed = this.packed;
    const overlayTemp = this.overlayTemp;
    const ovArr = grid.overlay;
    const windArr = grid.wind;
    const w = grid.width;
    const heat = this.heatOverlay;
    // Advance the wind animation once per frame; floor to an int for clean per-cell
    // dash stepping (the field itself is 0 when there are no fans, so this is idle).
    this.windPhase += WIND_ANIM_SPEED;
    const windPhase = this.windPhase | 0;
    const gh = grid.height;
    // Only run the overhang pass when a fan was blowing last frame (windWasActive),
    // and then only for cells within WIND_HALO of last frame's wind bounding box
    // (hx/hy min-max) — so one small fan doesn't make the whole grid pay the scan.
    const windHalo = this.windWasActive;
    const hxMin = this.windMinX - WIND_HALO;
    const hxMax = this.windMaxX + WIND_HALO;
    const hyMin = this.windMinY - WIND_HALO;
    const hyMax = this.windMaxY + WIND_HALO;
    let sawWind = false;
    let bxMin = w;
    let bxMax = -1;
    let byMin = gh;
    let byMax = -1;
    for (let i = 0; i < cells.length; i++) {
      // Heat overlay: recolor occupied cells by temperature (a live thermal
      // camera); empty cells keep the ambient background so shapes read against
      // it. Bypasses all the material-color machinery below. A packedTemp cell (a
      // flying Ember/Debris/Blast fragment) keeps the background too: its `temp`
      // holds packed flight/life state, not a real reading, so colouring it would
      // flash it spuriously garbage-hot (see Material.packedTemp) — UNLESS the
      // material opts into a fixed apparent reading via `overlayTemp` (Heat Ray),
      // which paints it at that reading instead so it still reads on the camera.
      if (heat) {
        const hid = cells[i];
        if (hid === EMPTY) {
          buf[i] = pal[EMPTY];
        } else if (packed[hid]) {
          const ot = overlayTemp[hid];
          buf[i] = ot === ot ? this.heatColor(ot) : pal[EMPTY]; // ot===ot: not NaN
        } else {
          buf[i] = this.heatColor(temp[i]);
        }
        continue;
      }
      let id = cells[i];
      // A carrier cell (Debris) draws as the material named in its aux byte, so a
      // flung grain wears its own material's color instead of the carrier's.
      if (asAux[id]) {
        const carried = auxArr[i];
        if (carried !== 0) id = carried;
      }
      let c: number;
      // A directional-arrow material (Conveyor) draws a chevron pointing the way
      // its aux byte says it runs, so the belt's travel direction is visible. The
      // chevron is a period-4 tent: over four rows the lit column steps 0,1,1,0
      // (a '>' whose tip is the middle rows) — mirrored for a left-running belt.
      if (arrow[id]) {
        const x = i % w;
        const y = (i / w) | 0;
        const fold = y & 2 ? 3 - (y & 3) : y & 3; // y%4 → 0,1,1,0
        const phase = x & 3; // x % 4
        const on = auxArr[i] === 2 ? phase === 3 - fold : phase === fold;
        c = on ? latCol[id] : pal[id];
      } else if (windArrow[id]) {
        // A Fan draws a 4-directional chevron pointing the way it blows: the low 2
        // bits of aux are the direction (0 up / 1 down / 2 left / 3 right) and the
        // rest a powered countdown, so a running fan's chevron lights up brighter.
        // Same period-4 tent as the Conveyor '>' (0,1,1,0 over four steps), folded
        // over y for a horizontal blow and over x for a vertical one, and mirrored
        // for the up/left senses.
        const x = i % w;
        const y = (i / w) | 0;
        const a = auxArr[i];
        const dir = a & 0b11;
        let on: boolean;
        if (dir >= 2) {
          // left (2) / right (3): chevron runs along x, folded over y.
          const fold = y & 2 ? 3 - (y & 3) : y & 3;
          const phase = x & 3;
          on = dir === 3 ? phase === fold : phase === 3 - fold;
        } else {
          // up (0) / down (1): chevron runs along y, folded over x.
          const fold = x & 2 ? 3 - (x & 3) : x & 3;
          const phase = y & 3;
          on = dir === 1 ? phase === fold : phase === 3 - fold;
        }
        // aux >> 2 is the powered countdown — brighten the lit chevron while it's
        // running so a powered fan reads as active at a glance.
        c = on ? (a >> 2 ? CanvasRenderer.tinted(latCol[id], 45) : latCol[id]) : pal[id];
      } else if (hasLat[id]) {
        // A lattice material (Mesh) is a two-tone positional checkerboard, so a
        // screen reads as a woven grid rather than a flat slab. Computed from the
        // cell's x/y so the weave is tied to space, not to the particle.
        const x = i % w;
        const y = (i / w) | 0;
        c = (x ^ y) & 1 ? latCol[id] : pal[id];
      } else if (glow[id]) {
        c = CanvasRenderer.shade(glow[id]!, temp[i]);
        const amp = vary[id];
        if (amp !== 0) {
          const src = mode[id] === VARY_PARTICLE ? tintArr[i] : bgArr[i];
          const d = ((src - TINT_NEUTRAL) * amp) >> 7;
          c = CanvasRenderer.tinted(c, d);
        }
      } else if (temp[i] <= freezeTemp[id]) {
        // A frozen liquid (see Material.freeze) is drawn frosted. freezeTemp is
        // -Infinity for non-freeze materials, so this never fires for them.
        c = frost[id];
      } else {
        const amp = vary[id];
        if (amp === 0) {
          c = pal[id];
        } else {
          // Powders read their own fixed per-grain tint; liquids sample the
          // positional background field at this cell (see game/tint.ts).
          const src = mode[id] === VARY_PARTICLE ? tintArr[i] : bgArr[i];
          // Map the tint byte to a signed brightness offset in [-amp, +amp]:
          // (tint - 128) / 128 * amp, done in integer math (>> 7 divides by 128).
          const d = ((src - TINT_NEUTRAL) * amp) >> 7;
          c = CanvasRenderer.tinted(pal[id], d);
        }
      }
      // Fan wind streaks: an animated low-res effect painted over the empty air of
      // a gust (Grid.wind — a transient one-way field, never a cell). Only bare air
      // carries it (matter in the beam shows through as itself, visibly blown), and
      // it's skipped in the thermal camera. Each streak is a gust glyph that draws
      // in, curls, and fades over its own lifecycle from a random spawn slot (see
      // windGlyphArc, windHash01 and the WIND_* constants).
      const wv = windArr[i];
      if (wv !== 0) {
        // Track this frame's wind extent for next frame's overhang box (see above).
        sawWind = true;
        const wy = (i / w) | 0;
        const wx = i - wy * w;
        if (wx < bxMin) bxMin = wx;
        if (wx > bxMax) bxMax = wx;
        if (wy < byMin) byMin = wy;
        if (wy > byMax) byMax = wy;
      }
      // Enter for any empty air: cells inside the beam (wv≠0) carry a streak, and
      // — when a fan was active last frame — empty cells just outside the beam can
      // host a curl hook that overhangs the edge, borrowing the beam's direction so
      // the overhang renders instead of being clipped (windHaloDir).
      if (id === EMPTY && !heat && (wv !== 0 || windHalo)) {
        const x = i % w;
        const y = (i / w) | 0;
        // In-beam cells know their own direction; an empty cell only bothers with the
        // halo scan when it lies within the padded box of last frame's wind.
        let dir = -1;
        if (wv !== 0) {
          dir = wv - 1; // 0 up, 1 down, 2 left, 3 right
        } else if (x >= hxMin && x <= hxMax && y >= hyMin && y <= hyMax) {
          dir = windHaloDir(windArr, x, y, w, gh);
        }
        if (dir < 0) {
          // Empty air out of any hook's reach — nothing to draw here.
          const ovg = ovArr[i];
          buf[i] = ovg !== 0 ? CanvasRenderer.wetted(c, pal[ovg]) : c;
          continue;
        }
        let along: number;
        let across: number;
        let sign: number;
        if (dir >= 2) {
          along = x; // horizontal blow: streaks run along x
          across = y;
          sign = dir === 3 ? 1 : -1; // right / left
        } else {
          along = y; // vertical blow: streaks run along y
          across = x;
          sign = dir === 1 ? 1 : -1; // down / up
        }
        const u = sign * along; // along-coordinate increasing downwind
        // windGlyphArc is authored in the rightward-blow frame, where the hook curls
        // toward −dc (counter-clockwise). Reflecting the along-axis for the other
        // three senses would flip that handedness for left/down blows, so mirror the
        // across-axis too (curlSign) whenever the along-axis is reflected on exactly
        // one screen axis — keeping every fan's streak curling the same way as the
        // reference glyph. curlSign is +1 for up/right (dir 0,3), −1 for down/left (1,2).
        const curlSign = ((dir >> 1) ^ (dir & 1)) ? -1 : 1;
        const baseLine = Math.round(across / WIND_LINE_SPACING);
        // Streaks spawn at jittered positions, so this cell may belong to a streak
        // seeded on the neighbouring base lines too — test all three and take the
        // first that lights. Bound check: a streak's owning centreline can sit at
        // most WIND_CURL_H + WIND_JITTER/2 (= 2 + 2 = 4) cells from `across`, and the
        // nearest WIND_LINE_SPACING (8) multiple is within 4, so ±1 always covers it.
        let litColor = -1;
        for (let dL = -1; dL <= 1 && litColor < 0; dL++) {
          const line = baseLine + dL;
          // Per-line along phase offset so the lines don't share head positions. Kept
          // integral (round) so the resulting dA stays an integer — windGlyphArc's
          // hook strokes gate on exact-integer dA.
          const phaseOff = Math.round(windHash01(line, 0x9e37) * WIND_PERIOD);
          // Identify the streak slot (index kf) this cell falls in along the beam.
          const rel = windPhase + phaseOff - u;
          const kf = Math.floor(rel / WIND_PERIOD);
          // Per-streak along offset within the slot: shifts the head so successive
          // heads aren't a rigid WIND_PERIOD comb but spawn at scattered along
          // positions. Bounded to [0, WIND_PERIOD − WIND_BODY − 1] so each streak's
          // glyph stays inside its own slot (no bleed into the neighbour slot).
          const alongJit = Math.round(windHash01(kf, line ^ 0x51ed) * (WIND_PERIOD - WIND_BODY - 1));
          const dA = rel - kf * WIND_PERIOD - alongJit;
          if (dA < 0) continue; // cell is ahead of this streak's (jittered) head
          // This streak's random cross jitter (spawn position) and lifecycle phase.
          const jitter = Math.round((windHash01(line, kf) - 0.5) * WIND_JITTER);
          const centre = line * WIND_LINE_SPACING + jitter;
          const dc = across - centre;
          const s = windGlyphArc(dA, dc * curlSign);
          if (s < 0) continue; // cell isn't on this streak's glyph
          // Lifecycle: reveal grows tail→hook while drawing in (서서히 말리는), holds
          // full, then retract eats the tail forward while fading. Desynced per slot.
          const p = windFrac(windPhase / WIND_LIFE + windHash01(kf, line * 2 + 1));
          let reveal: number;
          let retract = 0;
          if (p < WIND_DRAW) {
            reveal = (p / WIND_DRAW) * WIND_TOTAL;
          } else if (p < WIND_DRAW + WIND_HOLD) {
            reveal = WIND_TOTAL;
          } else {
            reveal = WIND_TOTAL;
            retract = ((p - WIND_DRAW - WIND_HOLD) / (1 - WIND_DRAW - WIND_HOLD)) * WIND_TOTAL;
          }
          if (s < retract || s > reveal) continue; // not yet drawn, or already faded
          // A hook cell (dc≠0) lights only when its streak's spine (the centreline
          // cell at this along position) is inside the beam. That single test does
          // double duty: it lets the hook overhang the beam edge — this very cell may
          // be outside the field (a halo cell) yet still light because its in-beam
          // spine backs it — while still refusing a stray fragment whose spine never
          // entered the beam. The spine cell being a wind cell is what makes it real.
          // The trailing line (dc===0) only draws on real in-beam cells (wv≠0), so it
          // never leaks past the beam's along-ends; the halo pass extends the curl
          // (dc≠0) only. A hook cell requires its streak's spine (the centreline cell
          // at this along position) to be a wind cell *blowing this same direction*
          // (=== dir+1) — matching the direction keeps a halo cell from borrowing a
          // neighbouring, differently-oriented beam's spine and painting a hook with
          // the wrong handedness where two beams run close together. In a genuine
          // beam-overlap zone (setWind is last-writer-wins, so overlapping cells hold
          // just one direction) a hook whose spine was overwritten by a crossing beam
          // drops to just its line — expected graceful degradation, not a bug.
          let ok = dc === 0 && wv !== 0;
          if (dc !== 0) {
            const cx = dir >= 2 ? along : centre;
            const cy = dir >= 2 ? centre : along;
            if (cx >= 0 && cx < w && cy >= 0 && cy < gh) {
              ok = windArr[cy * w + cx] === dir + 1;
            }
          }
          if (ok) litColor = WIND_STREAK_COLORS[((line % 3) + 3) % 3];
        }
        if (litColor >= 0) c = litColor;
      }
      // 겹침 (overlap): a cell sharing space with a fluid — wet sand, water or
      // steam mid-passage through a Mesh/Turbine — is tinted toward the fluid's
      // color, so a soaked bed reads visibly wetter than a dry one.
      const ov = ovArr[i];
      buf[i] = ov !== 0 ? CanvasRenderer.wetted(c, pal[ov]) : c;
    }
    this.windWasActive = sawWind;
    this.windMinX = bxMin;
    this.windMaxX = bxMax;
    this.windMinY = byMin;
    this.windMaxY = byMax;
    // Woofer shockwaves: an expanding pixel wavefront drawn over the finished cell
    // image (behind matter, through translucent liquid) before it's blitted.
    this.drawShockwaves(grid, heat);
    this.offCtx.putImageData(this.image, 0, 0);

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = cw / Math.max(1, this.canvas.clientWidth);
    const rect = this.layout.deviceRect(scale);

    // Clear to transparent (reveals the page background outside the sandbox),
    // then draw the grid crisp and outline the play area.
    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.off, rect.x, rect.y, rect.width, rect.height);
    // Free-object overlay: rasterized at OBJECT_SCALE× the grid into its own
    // buffer, then drawn over the scaled-up grid into the same rect (smoothing
    // off) so objects render at higher resolution than the cells while staying
    // crisp pixel art. In the heat overlay each body's own silhouette is kept but
    // recolored solid by its temperature (SimBody.temp — see rasterizeObjects),
    // so a hot drum or ball still reads on the thermal camera instead of vanishing
    // into it. Skipped only when there are no objects, so it costs nothing in the
    // common case.
    if (grid.objects.length > 0) {
      this.rasterizeObjects(grid, heat);
      this.objCtx.putImageData(this.objImage, 0, 0);
      this.ctx.drawImage(this.objOff, rect.x, rect.y, rect.width, rect.height);
    }
    if (this.gridDivision > 0) {
      this.drawGrid(rect.x, rect.y, rect.width, rect.height, grid.width, grid.height, scale);
    }
    this.drawBoundary(rect.x, rect.y, rect.width, rect.height, scale);
  }

  /**
   * Draw and advance the live Woofer shockwaves (see Grid.shockwaves). Newly queued
   * pulses are drained and turned into a geodesic distance-from-body field once
   * (buildShockField), then every frame the wavefront advances one frame's worth
   * (SHOCK_SPEED) and is painted as low-res pixel art into the finished cell image:
   * a single flat cyan shade (SHOCK_SHADE) on a chunky SHOCK_BLOCK²-cell lattice,
   * with the spawn/rim dissolve done by a per-block ordered (Bayer) dither.
   *
   * Honest to the physics of a POWER-0 pulse: because the field is seeded on the
   * body's own cells and blocked by solids, the front leaves the cabinet's real
   * outline (not a circle from its centre), spreads exactly the pulse's reach, and
   * a wall stops it instead of letting it shine through. It's a *background* effect,
   * so opaque matter (powder / solid / gas) occludes it (its cell is left
   * untouched); only liquid is special — a lit pool cell is stippled (checkerboard)
   * toward the board behind it, so the wave and background show through the water —
   * 액체는 반투명 (Woofer 충격파만). Waves whose front has cleared the rim are dropped.
   * Purely cosmetic; the cell buffer (grid.cells) is never touched. In the thermal
   * camera they still age and expire but paint nothing, so the queue can't pile up.
   */
  private drawShockwaves(grid: Grid, heat: boolean): void {
    const q = grid.shockwaves;
    if (q.length > 0) {
      for (const s of q) {
        const field = this.buildShockField(grid, s.bx, s.by, s.reach);
        if (field) this.shocks.push(field);
      }
      q.length = 0;
    }
    if (this.shocks.length === 0) return;
    const buf = this.buf32;
    const cells = grid.cells;
    const liquid = this.isLiquid;
    const w = grid.width;
    const bg = this.palette[EMPTY]; // board background — what a stippled liquid reveals
    const B = SHOCK_BLOCK;
    const survivors: typeof this.shocks = [];
    for (const s of this.shocks) {
      // Front radius (geodesic cells from the body surface): steps outward each frame.
      const r = s.age * SHOCK_SPEED;
      s.age++;
      const inner = r - SHOCK_THICK; // trailing edge of the one-block-thick front
      if (inner > s.maxR) continue; // whole front has cleared the rim — retire
      survivors.push(s);
      if (heat) continue; // thermal camera: keep it aging/expiring, but draw nothing
      // Fade level (0..1) the dither thresholds against: rises over the first cells
      // of travel (spawn) and falls as the front's inner edge nears the rim.
      let fade = 1;
      if (r < SHOCK_FADE) fade = r / SHOCK_FADE;
      const tail = s.maxR - inner;
      if (tail < SHOCK_FADE) fade = Math.min(fade, tail / SHOCK_FADE);
      if (fade <= 0) continue;
      const fadeLvl = fade * 16;
      const dist = s.dist;
      const x0 = s.x0;
      const y0 = s.y0;
      const bw = s.bw;
      const gx1 = x0 + bw; // exclusive fine bounds of the field's bbox
      const gy1 = y0 + s.bh;
      // Walk the field in absolute-grid-aligned SHOCK_BLOCK² tiles so the chunky
      // pixels stay put frame to frame instead of shimmering with the bbox.
      const bxStart = x0 - (x0 % B);
      const byStart = y0 - (y0 % B);
      for (let byb = byStart; byb < gy1; byb += B) {
        const bj = (byb / B) & 3;
        const fy0 = byb < y0 ? y0 : byb;
        const fy1 = byb + B < gy1 ? byb + B : gy1;
        for (let bxb = bxStart; bxb < gx1; bxb += B) {
          // Per-block Bayer dither — the whole tile shares one threshold (chunky).
          if (SHOCK_BAYER[bj * 4 + ((bxb / B) & 3)] >= fadeLvl) continue;
          const fx0 = bxb < x0 ? x0 : bxb;
          const fx1 = bxb + B < gx1 ? bxb + B : gx1;
          // Representative distance = the block's leading (nearest) field cell.
          let d = SHOCK_INF;
          for (let yy = fy0; yy < fy1; yy++) {
            const rowL = (yy - y0) * bw - x0;
            for (let xx = fx0; xx < fx1; xx++) {
              const dv = dist[rowL + xx];
              if (dv < d) d = dv;
            }
          }
          if (d >= SHOCK_INF || d <= inner || d > r) continue; // block not on the front
          for (let yy = fy0; yy < fy1; yy++) {
            const grow = yy * w;
            for (let xx = fx0; xx < fx1; xx++) {
              const gi = grow + xx;
              const id = cells[gi];
              if (id === EMPTY) {
                buf[gi] = SHOCK_SHADE; // hard pixel — crisp cyan front over the dark board
              } else if (liquid[id] && ((xx + yy) & 1) === 0) {
                // Liquid: stipple half the front cells to board+cyan, leaving the rest
                // as water — a 50% checkerboard reads as a see-through ripple.
                buf[gi] = CanvasRenderer.mix(bg, SHOCK_SHADE, SHOCK_LIQUID_WASH);
              }
            }
          }
        }
      }
    }
    this.shocks = survivors;
  }

  /** Build a Woofer shockwave's geodesic distance field: a multi-source Dijkstra
   *  seeded at 0 on every body cell (bx,by) that spreads outward — orthogonal step
   *  cost 1, diagonal √2 — through anything but a *solid*, so the front routes
   *  around / halts at walls exactly like the POWER-0 pulse (완전한 비파괴성) every
   *  solid blocks. Bounded to `reach` cells, over a bbox padded by the reach; a cell
   *  the front can't reach within `reach` stays SHOCK_INF. Returns the drawable
   *  entry, or null if the body was empty. Run once per firing, not per frame. */
  private buildShockField(
    grid: Grid,
    bx: number[],
    by: number[],
    reach: number,
  ): (typeof this.shocks)[number] | null {
    const n = bx.length;
    if (n === 0) return null;
    const w = grid.width;
    const h = grid.height;
    const cells = grid.cells;
    const solid = this.isSolid;
    let minX = bx[0];
    let maxX = bx[0];
    let minY = by[0];
    let maxY = by[0];
    for (let i = 1; i < n; i++) {
      if (bx[i] < minX) minX = bx[i];
      if (bx[i] > maxX) maxX = bx[i];
      if (by[i] < minY) minY = by[i];
      if (by[i] > maxY) maxY = by[i];
    }
    const margin = Math.ceil(reach) + 1;
    const x0 = Math.max(0, minX - margin);
    const y0 = Math.max(0, minY - margin);
    const x1 = Math.min(w - 1, maxX + margin);
    const y1 = Math.min(h - 1, maxY + margin);
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    // Float64 (not Float32): the heap keys are float64 sums, so a Float32 field
    // would round diagonal distances (√2 steps) just enough that the `d > dist[li]`
    // stale-check spuriously drops valid pops — leaving the wavefront patchy.
    const dist = new Float64Array(bw * bh).fill(SHOCK_INF);
    // Binary min-heap over local field indices (parallel key/value arrays).
    const heapD: number[] = [];
    const heapI: number[] = [];
    const push = (d: number, idx: number): void => {
      let c = heapD.length;
      heapD.push(d);
      heapI.push(idx);
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heapD[p] <= heapD[c]) break;
        [heapD[p], heapD[c]] = [heapD[c], heapD[p]];
        [heapI[p], heapI[c]] = [heapI[c], heapI[p]];
        c = p;
      }
    };
    for (let i = 0; i < n; i++) {
      const li = (by[i] - y0) * bw + (bx[i] - x0);
      if (dist[li] !== 0) {
        dist[li] = 0;
        push(0, li);
      }
    }
    while (heapD.length > 0) {
      const d = heapD[0];
      const li = heapI[0];
      // Pop min: move last to root, sift down.
      const lastD = heapD.pop()!;
      const lastI = heapI.pop()!;
      if (heapD.length > 0) {
        heapD[0] = lastD;
        heapI[0] = lastI;
        let p = 0;
        const len = heapD.length;
        for (;;) {
          const l = 2 * p + 1;
          const rr = l + 1;
          let m = p;
          if (l < len && heapD[l] < heapD[m]) m = l;
          if (rr < len && heapD[rr] < heapD[m]) m = rr;
          if (m === p) break;
          [heapD[p], heapD[m]] = [heapD[m], heapD[p]];
          [heapI[p], heapI[m]] = [heapI[m], heapI[p]];
          p = m;
        }
      }
      if (d > dist[li]) continue; // stale heap entry
      const lx = li % bw;
      const ly = (li / bw) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = lx + SHOCK_DX8[k];
        const ny = ly + SHOCK_DY8[k];
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        // A solid neighbour blocks the front (and skips other body cells for free).
        if (solid[cells[(ny + y0) * w + (nx + x0)]]) continue;
        const nd = d + SHOCK_C8[k];
        if (nd > reach) continue; // past the pulse's reach — don't grow further
        const ni = ny * bw + nx;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          push(nd, ni);
        }
      }
    }
    return { dist, x0, y0, bw, bh, maxR: reach, age: 0 };
  }

  /**
   * Rasterize the free rigid objects (see Grid.objects / engine/objects.ts) into
   * the OBJECT_SCALE× overlay buffer (this.objBuf32), which is then drawn over the
   * scaled grid. The buffer is cleared to transparent first so only object pixels
   * show. Sampling is nearest-neighbor at sub-pixel centers (no anti-aliasing), so
   * objects stay crisp pixel art — just finer than the cell grain. Writes only the
   * render image; the simulation's cell buffer is never touched.
   *
   * `heat` mirrors the cell layer's thermal-camera mode: when on, every body is
   * still rasterized in its own silhouette (ball disc / drum or dynamite sprite
   * shape) but recolored flat by `heatColor(o.temp)` instead of its normal sprite
   * colors, exactly like an occupied cell is recolored by `temp[i]` — so a body's
   * own heat reservoir (SimObject/SimCapsule/SimDynamite.temp) reads on the
   * overlay the same way a cell's does.
   */
  private rasterizeObjects(grid: Grid, heat: boolean): void {
    const buf = this.objBuf32;
    buf.fill(0); // transparent overlay — only object pixels are written below
    const s = OBJECT_SCALE;
    const w = grid.width * s;
    const h = grid.height * s;
    for (const o of grid.objects) {
      const heatColor = heat ? this.heatColor(o.temp) : null;
      if (o.kind === 'ball') this.rasterizeBall(buf, w, h, s, o, heatColor);
      else if (o.kind === 'dynamite') this.rasterizeDynamite(buf, w, h, s, o, heatColor);
      else this.rasterizeDrum(buf, w, h, s, o, heatColor);
    }
  }

  /** Rasterize one rubber ball into the overlay: fill each sub-pixel whose center
   *  (in grid coordinates) falls inside the disc. `w`/`h` are the overlay's
   *  sub-pixel dimensions, `s` the sub-pixels per cell. `heatColor`, when given
   *  (heat overlay on), replaces both the fill and border with one flat color —
   *  the disc reads as a solid thermal blob rather than a rubber ball. */
  private rasterizeBall(
    buf: Uint32Array,
    w: number,
    h: number,
    s: number,
    o: { x: number; y: number; r: number },
    heatColor: number | null = null,
  ): void {
    const r = o.r;
    const r2 = r * r;
    // Thin outline: sub-pixels whose center falls in the outer ring [rin, r] are
    // drawn dark instead of red. Width is ≥1 sub-pixel so it never vanishes, and
    // scales gently with radius so bigger balls keep a proportionate rim.
    const border = Math.max(1 / s, r * 0.12);
    const rin = r - border;
    const rin2 = rin > 0 ? rin * rin : 0;
    const fillColor = heatColor ?? BALL_COLOR;
    const borderColor = heatColor ?? BALL_BORDER_COLOR;
    let x0 = Math.floor((o.x - r) * s);
    let x1 = Math.ceil((o.x + r) * s);
    let y0 = Math.floor((o.y - r) * s);
    let y1 = Math.ceil((o.y + r) * s);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > w) x1 = w;
    if (y1 > h) y1 = h;
    for (let sy = y0; sy < y1; sy++) {
      const dy = (sy + 0.5) / s - o.y; // sub-pixel center, in grid coords
      const row = sy * w;
      for (let sx = x0; sx < x1; sx++) {
        const dx = (sx + 0.5) / s - o.x;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) buf[row + sx] = d2 >= rin2 ? borderColor : fillColor;
      }
    }
  }

  /**
   * Rasterize one drum into the overlay: rotate the pixel-art sprite by the
   * capsule's `angle` and sample it per sub-pixel. For each sub-pixel in the
   * drum's bounding box we take its center's vector from the drum center (in grid
   * coords), un-rotate it into the sprite's upright frame, map to a sprite pixel,
   * and write that pixel's color (skipping transparent ones). Nearest-neighbor, no
   * anti-aliasing. The sprite's 24×32 box maps onto the physics capsule's box
   * (2·radius wide × 2·(halfLength+radius) tall), so display and collision agree;
   * at OBJECT_SCALE = 2 the 12×16-cell drum samples the sprite near its native
   * 24×32 resolution. `heatColor`, when given (heat overlay on), replaces every
   * opaque sprite pixel with that one flat color, keeping the drum's silhouette
   * (and rotation) but recoloring it by temperature instead of its fill tint.
   */
  private rasterizeDrum(
    buf: Uint32Array,
    w: number,
    h: number,
    s: number,
    o: {
      x: number;
      y: number;
      angle: number;
      halfLength: number;
      radius: number;
      fill: DrumFill;
    },
    heatColor: number | null = null,
  ): void {
    const sprite = drumSpriteFor(o.fill); // body tint varies by fill; shape shared
    const halfW = o.radius; // half the drum's short (width) extent, in cells
    const halfL = o.halfLength + o.radius; // half its long (length) extent, in cells
    // Bounding box that contains the drum at any rotation (a circle of the long
    // half-extent), clamped to the overlay.
    const reach = halfL;
    let x0 = Math.floor((o.x - reach) * s);
    let x1 = Math.ceil((o.x + reach) * s);
    let y0 = Math.floor((o.y - reach) * s);
    let y1 = Math.ceil((o.y + reach) * s);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > w) x1 = w;
    if (y1 > h) y1 = h;
    const cos = Math.cos(o.angle);
    const sin = Math.sin(o.angle);
    // Sprite-pixels per grid cell along each local axis (display box → sprite box).
    const sxScale = DRUM_SPRITE_W / (2 * halfW);
    const syScale = DRUM_SPRITE_H / (2 * halfL);
    for (let sy = y0; sy < y1; sy++) {
      const wy = (sy + 0.5) / s - o.y; // sub-pixel center, in grid coords
      const row = sy * w;
      for (let sx = x0; sx < x1; sx++) {
        const wx = (sx + 0.5) / s - o.x;
        // Un-rotate into the drum's local frame: local-x across width (unit
        // (cos,−sin)), local-y along length (unit (sin,cos)).
        const lx = wx * cos - wy * sin;
        const ly = wx * sin + wy * cos;
        // Local coords → sprite pixel (sprite center at its box center).
        const spx = DRUM_SPRITE_W * 0.5 + lx * sxScale;
        const spy = DRUM_SPRITE_H * 0.5 + ly * syScale;
        if (spx < 0 || spx >= DRUM_SPRITE_W || spy < 0 || spy >= DRUM_SPRITE_H) continue;
        const color = sprite[(spy | 0) * DRUM_SPRITE_W + (spx | 0)];
        if (color !== 0) buf[row + sx] = heatColor ?? color; // 0 = transparent sprite pixel
      }
    }
  }

  /**
   * Rasterize one dynamite stick: the red body sprite rotated by the capsule's
   * angle (exactly like the drum), then — procedurally, past the top cap along the
   * stick's long axis so it tracks the fuse end as the stick tumbles — a short dark
   * fuse-cord nub. The *flame* is NOT drawn here: the lit fuse emits real Fire
   * particles into the grid (see objects.ts), which the cell layer renders.
   * Nearest-neighbor, no anti-aliasing. `heatColor`, when given (heat overlay
   * on), replaces the body sprite and the fuse-cord nub with one flat color, so
   * the stick reads as a solid thermal blob (still shaped/rotated correctly)
   * instead of its normal red-body-plus-dark-fuse look.
   */
  private rasterizeDynamite(
    buf: Uint32Array,
    w: number,
    h: number,
    s: number,
    o: {
      x: number;
      y: number;
      angle: number;
      halfLength: number;
      radius: number;
    },
    heatColor: number | null = null,
  ): void {
    const halfW = o.radius; // half the stick's short (width) extent, in cells
    const halfL = o.halfLength + o.radius; // half its long (length) extent, in cells
    // Body: rotate-sample the stick sprite within the rotation-invariant bbox.
    let x0 = Math.floor((o.x - halfL) * s);
    let x1 = Math.ceil((o.x + halfL) * s);
    let y0 = Math.floor((o.y - halfL) * s);
    let y1 = Math.ceil((o.y + halfL) * s);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > w) x1 = w;
    if (y1 > h) y1 = h;
    const cos = Math.cos(o.angle);
    const sin = Math.sin(o.angle);
    const sxScale = DYN_SPRITE_W / (2 * halfW);
    const syScale = DYN_SPRITE_H / (2 * halfL);
    for (let sy = y0; sy < y1; sy++) {
      const wy = (sy + 0.5) / s - o.y;
      const row = sy * w;
      for (let sx = x0; sx < x1; sx++) {
        const wx = (sx + 0.5) / s - o.x;
        const lx = wx * cos - wy * sin;
        const ly = wx * sin + wy * cos;
        const spx = DYN_SPRITE_W * 0.5 + lx * sxScale;
        const spy = DYN_SPRITE_H * 0.5 + ly * syScale;
        if (spx < 0 || spx >= DYN_SPRITE_W || spy < 0 || spy >= DYN_SPRITE_H) continue;
        const color = DYN_SPRITE[(spy | 0) * DYN_SPRITE_W + (spx | 0)];
        if (color !== 0) buf[row + sx] = heatColor ?? color;
      }
    }
    // A short dark fuse-cord nub past the top cap, along the stick's (rotated) long
    // axis. angle 0 ⇒ axis (0,1) and the fuse points up (−axis); it rotates with
    // the stick. The flame is real Fire particles the engine spawns at the tip.
    const ax = Math.sin(o.angle);
    const ay = Math.cos(o.angle);
    const capX = o.x - ax * halfL;
    const capY = o.y - ay * halfL;
    this.fillDisc(buf, w, h, s, capX - ax * 0.7, capY - ay * 0.7, 0.55, heatColor ?? FUSE_CORD_COLOR);
  }

  /** Fill overlay sub-pixels whose center (in grid coords) lies within `r` cells of
   *  (cx,cy) with `color`. The disc primitive behind the dynamite's fuse flame. */
  private fillDisc(
    buf: Uint32Array,
    w: number,
    h: number,
    s: number,
    cx: number,
    cy: number,
    r: number,
    color: number,
  ): void {
    const r2 = r * r;
    let x0 = Math.floor((cx - r) * s);
    let x1 = Math.ceil((cx + r) * s);
    let y0 = Math.floor((cy - r) * s);
    let y1 = Math.ceil((cy + r) * s);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > w) x1 = w;
    if (y1 > h) y1 = h;
    for (let sy = y0; sy < y1; sy++) {
      const dy = (sy + 0.5) / s - cy;
      const row = sy * w;
      for (let sx = x0; sx < x1; sx++) {
        const dx = (sx + 0.5) / s - cx;
        if (dx * dx + dy * dy <= r2) buf[row + sx] = color;
      }
    }
  }

  /** Draw a faint reference grid every `gridDivision` cells over the sandbox
   *  rectangle. Line positions are snapped to whole cell boundaries and skip the
   *  outer edges (the boundary outline already draws those). */
  private drawGrid(
    x: number,
    y: number,
    w: number,
    h: number,
    cols: number,
    rows: number,
    scale: number,
  ): void {
    const step = this.gridDivision;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(150, 160, 180, 0.16)';
    ctx.lineWidth = Math.max(1, Math.round(scale));
    ctx.beginPath();
    // Vertical lines at every `step`-th column boundary (interior only).
    for (let c = step; c < cols; c += step) {
      // Round to the device pixel so the thin line stays crisp.
      const px = Math.round(x + (c / cols) * w) + 0.5;
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + h);
    }
    // Horizontal lines at every `step`-th row boundary (interior only).
    for (let r = step; r < rows; r += step) {
      const py = Math.round(y + (r / rows) * h) + 0.5;
      ctx.moveTo(x, py);
      ctx.lineTo(x + w, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Pick which edge mode to signal in the boundary outline. */
  setBorderMode(mode: BorderMode): void {
    this.borderMode = mode;
  }

  /** Toggle the temperature heat-map overlay (occupied cells drawn by temp). */
  setHeatOverlay(on: boolean): void {
    this.heatOverlay = on;
  }

  /** Set the reference-grid line spacing in cells (0 = off). */
  setGridDivision(cells: number): void {
    this.gridDivision = cells;
  }

  /** Outline the real sandbox space so its edges are visible against the page.
   *  A solid glowing frame reads as a closed wall; in 'void' mode the frame is
   *  drawn dimmer and dashed to signal that the edges are open. */
  private drawBoundary(
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
  ): void {
    const lw = Math.max(1, Math.round(1.5 * scale));
    const ctx = this.ctx;
    const isVoid = this.borderMode === 'void';
    ctx.save();
    ctx.lineWidth = lw;
    if (isVoid) {
      // Open edges: a faint dashed outline, no glow — the box is "not there".
      ctx.strokeStyle = 'rgba(150, 160, 180, 0.45)';
      ctx.setLineDash([6 * scale, 5 * scale]);
    } else {
      ctx.strokeStyle = 'rgba(110, 168, 254, 0.65)';
      ctx.shadowColor = 'rgba(110, 168, 254, 0.35)';
      ctx.shadowBlur = 6 * scale;
    }
    // Inset by half the line width so the full stroke stays inside the rect.
    const o = lw / 2;
    ctx.strokeRect(x + o, y + o, w - lw, h - lw);
    ctx.restore();
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
}
