import type { Renderer } from './Renderer';
import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import { getMaterial } from '../materials/registry';
import { EMPTY, Phase, type BorderMode } from '../engine/types';
import { varyAmplitude, varyCellAmplitude, varyMode, VARY_PARTICLE, TINT_NEUTRAL } from '../tint';
import {
  rgb, tinted, frosted, buildGlow, shade, washed,
  type GlowRamp, type ColorWash,
} from './color';
import { drumSpriteFor, drumPieceSpriteFor, DRUM_SPRITE_W, DRUM_SPRITE_H } from './drumSprite';
import { DYN_SPRITE, DYN_SPRITE_W, DYN_SPRITE_H, FUSE_CORD_COLOR } from './dynamiteSprite';
import {
  FLASHBANG_SPRITE,
  FLASHBANG_SPRITE_W,
  FLASHBANG_SPRITE_H,
} from './flashbangSprite';
import { WOOD_BOX_SPRITES } from './woodenBoxSprite';
import { MOLOTOV_SPRITES, MOLOTOV_SPRITE_W, MOLOTOV_SPRITE_H } from './molotovSprite';
import { TNT_N, buildTntTile } from './tntTile';
import { ROTOR_N, buildRotorTile, rotorAccumulate, rotorBlockIndex, rotorFrame } from './rotorTile';
import { poreAt } from './poreField';
import {
  WOOFER_P,
  WOOFER_CAP_R2,
  WOOFER_CONE_R2,
  WOOFER_R2,
  WOOFER_REST,
  wooferExcursion,
  wooferTileIndex,
} from './wooferDriver';
import type { SimCapsule, SimWoodBox } from '../engine/objects';
import { bodyReach, molotovBottle } from '../engine/objects';

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

/** Type size (CSS px, scaled to device pixels at draw time) of the 돋보기 object
 *  temperature label. Small enough to sit beside a 4-cell can without covering
 *  it, large enough to read at the default zoom. */
const OBJECT_TEMP_FONT_PX = 10;
/** Gap (CSS px) between a body's right edge and its label. */
const OBJECT_TEMP_GAP = 2;

// ── 오브젝트 온도 오버레이 ────────────────────────────────────────────────────
// A body carries its own heat reservoir (SimBody.temp — see engine/objects.ts), and
// until now nothing about it was visible unless you turned the thermal camera on:
// a drum sitting in lava looked exactly like a drum sitting on grass right up to
// the tick it melted, and a can you had painstakingly frozen looked untouched. So
// every body now wears its temperature as a WASH over its own art — icy blue as it
// chills, red running to orange as it heats — rather than as a recolour. The wash
// keeps the sprite readable (you can still tell a drum from a crate from a bottle
// at a glance, which a flat thermal recolour deliberately does not), and it is the
// only feedback the object layer has for something the engine has always tracked.
//
// The ramps are asymmetric on purpose. Heat runs from a threshold well above room
// temperature (nothing should glow because it was left by a candle) up to the
// hottest a body survives, and gets STRONG — a red-hot barrel should look red-hot.
// Cold starts at freezing, reaches full at a depth that takes real work (liquid
// nitrogen, a held 냉각 브러시), and stays SLIGHT: 얼음색을 약간, a frost on the
// surface, not a repaint. That the flashbang's countdown slows in exactly this
// range (FLASHBANG_CHILL_TEMP) is not a coincidence — the frost IS the tell that
// its timer is dragging.
const HOT_TINT_MIN = 200; // ° at which the body starts to look warmed
const HOT_TINT_MAX = 1200; // ° at which it is as hot-looking as it gets
const HOT_TINT_STRENGTH = 0.8;
/** The wash colour at HOT_TINT_MIN (dull red) and at HOT_TINT_MAX (bright orange).
 *  Interpolating between the two is what makes the ramp read as heating rather
 *  than as one red getting louder. */
const HOT_TINT_LOW = { r: 0xc8, g: 0x2a, b: 0x18 };
const HOT_TINT_HIGH = { r: 0xff, g: 0xa8, b: 0x3c };
const COLD_TINT_MAX = 0; // ° at which frost starts to show (water's freezing point)
const COLD_TINT_MIN = -60; // ° at which it is as frosted as it gets
const COLD_TINT_STRENGTH = 0.55;
/** Frost colour — the pale blue-white `frosted()` washes a frozen liquid with, so a
 *  chilled body and the ice it is lying in agree on what cold looks like. */
const COLD_TINT = { r: 0xa8, g: 0xd8, b: 0xf4 };

/**
 * The temperature wash for a body at `temp`, or null when it is at an ordinary
 * temperature and should be drawn as its plain self — which is the common case, so
 * the whole overlay costs one comparison per body until something actually happens
 * to it.
 */
function thermalTint(temp: number): ColorWash | null {
  if (temp > HOT_TINT_MIN) {
    let f = (temp - HOT_TINT_MIN) / (HOT_TINT_MAX - HOT_TINT_MIN);
    if (f > 1) f = 1;
    return {
      r: HOT_TINT_LOW.r + (HOT_TINT_HIGH.r - HOT_TINT_LOW.r) * f,
      g: HOT_TINT_LOW.g + (HOT_TINT_HIGH.g - HOT_TINT_LOW.g) * f,
      b: HOT_TINT_LOW.b + (HOT_TINT_HIGH.b - HOT_TINT_LOW.b) * f,
      // Ramped from 0, not applied flat: a body crossing the threshold warms into
      // the tint instead of snapping into it.
      f: HOT_TINT_STRENGTH * f,
    };
  }
  if (temp < COLD_TINT_MAX) {
    let f = (COLD_TINT_MAX - temp) / (COLD_TINT_MAX - COLD_TINT_MIN);
    if (f > 1) f = 1;
    return { r: COLD_TINT.r, g: COLD_TINT.g, b: COLD_TINT.b, f: COLD_TINT_STRENGTH * f };
  }
  return null;
}

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

// Tiling of the `triArrow` liner triangles (Shaped Charge — see the render loop).
// The triangle itself is 6 cells across the jet axis and 3 deep along it; each
// period is 2 cells larger on both counts, so the extra cells become the gutter
// that keeps neighbouring arrowheads from touching side-to-side or nose-to-tail.
const TRI_SPAN = 8; // cells across the axis per triangle (6 drawn + 2 side gutter)
const TRI_STEP = 5; // cells along the axis per triangle (3 drawn + 2 front gutter)

// Tiling of the `solarPattern` photovoltaic cell grid (Solar Panel — see the
// render loop). Each period is one cell of the panel plus the seam after it, so a
// drawn cell is 3 wide × 5 tall with a 1-cell seam on its right and bottom edges.
//
// The reference art's cells are 4×7 (aspect 0.571); these are the next size down
// that still reads as the same tall portrait cell (0.600) — the seam is a whole
// grid cell wide and can't shrink with them, so the pattern can only step through
// integer sizes, and 3×5 is the closest one below 4×7 (2×3 would be 0.667 and
// mostly seam). Smaller matters because the pattern is drawn in *world* cells,
// not screen pixels: at 4×7 a panel had to be ~20 cells across before the grid
// was legible at all, and anything hand-drawn just looked like flat blue with a
// stray line through it. At 3×5 a panel four cells wide already shows its
// structure (비율 유지하며 격자 무늬 사이즈 줄이기).
const SOLAR_CELL_W = 4; // columns per panel cell (3 drawn + 1 seam)
const SOLAR_CELL_H = 6; // rows per panel cell (5 drawn + 1 seam)

// Tiling of the `brickPattern` running-bond masonry (Wall — see the render loop).
// One period is a brick plus the mortar on its right and bottom edges, so a brick
// reads 5 wide × 3 tall with a 1-cell joint on two of its sides.
//
// This is the hand-drawn Wall icon's pattern brought down to world scale — the three
// structural features (running bond, mortar joints, a lit top edge) rather than its
// measurements. The icon's own bricks are near-square (11 × 11 with a 2-cell joint)
// only because two 2:1 bricks will not fit side by side across a 24-cell tile; the
// world grid has no such limit, so the period is free to be brick-shaped, and 5 × 3
// reads as masonry where 4 × 4 would read as tile.
//
// Kept small for the same reason SOLAR_CELL_W stepped down from its reference art:
// the pattern is drawn in *world* cells, not screen pixels, so a period that shows
// its structure on a wall a handful of cells wide is worth more than a larger, more
// faithful brick. At 6×4 a 12-cell wall already shows two bricks and the offset
// course under them.
const BRICK_W = 6; // columns per brick (5 drawn + 1 head joint)
const BRICK_H = 4; // rows per brick (3 drawn + 1 mortar bed)
// Half-brick offset applied to odd courses — what makes it masonry and not a grid.
const BRICK_OFFSET = BRICK_W >> 1;
// How far the top row of each brick is lifted above the base colour. 40 is the
// exact step from Wall's own colour to the highlight in its icon (#787c82 →
// #a0a4aa), so the canvas and the palette chip are lit the same way.
const BRICK_LIT = 40;

// Tiling of the `wooferPattern` speaker-driver grid (Woofer — see the render loop).
// The geometry — the period, the three bands' squared radii at each step of a thump,
// and the tile index the excursion is keyed by — lives in ./wooferDriver, shared with
// the palette icon generator: it is a table now that the diaphragm moves, and a table
// is not something to mirror by hand. Only the two dark *tones* stay here, because
// they are colour rather than shape.
//
// The two dark tones, as brightness offsets from the material's own colour. The cone
// is the `lattice` colour and therefore exact; these two are offsets because a
// material carries only one second colour, and the chip's ramp is very slightly
// blue-biased (its rim is #16161c where base − 20 gives #16161e), so they land within
// 3 units on the blue channel rather than dead on. On a near-black that is below a
// visible step; if a future pattern needs all four exact it needs a colour list, not
// a bigger offset.
const WOOFER_RIM = -20;
const WOOFER_CAP = -29;

// The two bitmap patterns — `tntPattern` (TNT) and `rotorPattern` (Turbine, Fan) —
// have no constants to state here. They are pictures rather than rules, so the ASCII,
// the tone alphabet and the reasoning all live in ./tntTile and ./rotorTile, shared
// with the palette icon generator instead of being restated on each side. Each module
// exports its tile edge in cells and a `build…` that resolves the ASCII against one
// material's colours.

/** Fractional part, kept in [0, 1). */
function windFrac(v: number): number {
  return v - Math.floor(v);
}

// ── Woofer shockwave wavefront (우퍼 충격파 이펙트) ───────────────────────────
// Where the Fan paints continuous streaks, the Woofer thumps a *pulse*: each
// firing body hands the renderer its own cells (Grid.shockwaves) and the renderer
// grows a single wavefront *out of the cabinet's actual outline*, then fades it at
// the rim — a background layer just like the wind. Drawn as pixel art on purpose:
// one flat cyan shade (single layer), a *thin* front only SHOCK_THICK cell(s) wide
// on a SHOCK_BLOCK×SHOCK_BLOCK lattice (1 = a crisp 1-particle-thick line), and the
// spawn/rim dissolve is a 4×4 ordered (Bayer) dither rather than an alpha ramp.
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
const SHOCK_BLOCK = 1; // wave drawn on a SHOCK_BLOCK²-cell lattice (1 = native particle pixels)
const SHOCK_SPEED = 1.2; // cells the wavefront advances per rendered frame — brisk enough that
// each pulse reads as a moving ring (not a packed disc). A rapid emitter no longer piles wavefronts
// up because the pulse source itself now beats on the battery cadence (see turbine.ts), not because
// the ring is raced across the screen
const SHOCK_THICK = 1.2; // wavefront thickness in cells — kept equal to SHOCK_SPEED so the front
// tiles every distance exactly once (SPEED > THICK would punch radial gaps/holes)
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

// ── Electromagnet field rings (전자석 자기력선 이펙트) ────────────────────────
// A powered magnet body (Grid.magnetFields, re-stamped every powered tick) is
// wrapped in *static* contour rings — 등고선 of the same geodesic distance field
// the Woofer's wavefront uses (buildShockField: seeded on the body's own outline,
// blocked by solids) — so the rings hug the body's real shape, a wall visibly
// shadows the field, and their outer edge sits exactly at the pull's true reach.
// Unlike the wind streaks and the shockwave the rings don't animate: the field
// is a steady grip, so the effect is a steady picture — rings pop in when power
// arrives and vanish when it lapses, nothing more. One flat colour (단색) rather
// than the reference effect's blue ramp, with the outer rings thinned by a
// static positional dither so the field reads as fading out with distance while
// staying crisp single-shade pixel art. Drawn on empty air only — matter inside
// the field shows through as itself, visibly being tugged.
const MAGNET_SHADE = rgb(159, 168, 255); // single flat periwinkle — 단색
const MAGNET_RING_GAP = 3; // geodesic cells between successive contour rings
// Sim ticks between distance-field rebuilds while a magnet stays powered. The
// rings only change when the *solids* around the body change (matter the field
// passes through never shapes them), and solids change on user timescales, not
// per tick — so a steadily powered magnet must not re-run Dijkstra every tick
// the way a naive tick-keyed cache would (the sweep allocates its field and
// heap fresh each build). At 8 ticks a wall drawn into the field re-shadows the
// rings within ~a quarter second, well under noticing, while the rebuild cost
// drops to noise. Membership changes still rebuild immediately (power-on/off
// must add/drop that body's rings the same tick — see the fingerprint in
// drawMagnetFields); only the surrounding solids ride this period.
const MAGNET_REBUILD_TICKS = 8;
// The rings *breathe*: the whole contour set slides out and back by a fraction of
// a cell on a fixed wall-clock cycle, so a powered magnet reads as live rather
// than as a decal — without turning into the outward-racing wavefront the Woofer
// uses (the field is a steady grip, not an event). Amplitude is deliberately under
// one ring gap: at ±0.6 cell the bands visibly drift in and out while every ring
// stays where it belongs.
//
// It is baked, not computed per frame: `rebuildMagnetRings` extracts the contour
// pixels once per phase and the draw path just picks the phase, so animating costs
// one array index per frame rather than a fresh distance-field scan. Wall-clock
// driven (not tick driven) so the breathing keeps its 0.5s period at any sim speed
// and keeps going while the sandbox is paused.
const MAGNET_ANIM_PERIOD_MS = 500;
const MAGNET_ANIM_PHASES = 8;
const MAGNET_ANIM_AMP = 0.6; // cells the bands slide out and back

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
  /** id → the fixed colour set a cell picks from by its `aux` value, or null for
   *  the ordinary single-colour material (Firework Burst — see
   *  Material.auxPalette). */
  private auxPalette: (Uint32Array | null)[];
  /** id → the fixed colour set each PARTICLE picks from by its own `tint` byte,
   *  or null for the ordinary single-colour material (Fireworks — see
   *  Material.tintPalette). */
  private tintPalette: (Uint32Array | null)[];
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
  /** id → 1 if the material draws a 2x2 positional checkerboard (Diamond). */
  private checker2x2: Uint8Array;
  /** id → 1 if the material draws the tiled pixel-art battery pattern (Batteries). */
  private batteryPattern: Uint8Array;
  /** id → 1 if the material draws a directional chevron from its aux byte
   *  (Conveyor), in the `lattice` colour over the base (see Material.arrow). */
  private arrow: Uint8Array;
  /** id → the packed colour of the display-only pixel this material trails behind
   *  itself (Fish and its corpse — see Material.tailPixel), or 0 for the materials
   *  that trail nothing, which is all but those two. */
  private tailPixel: Uint32Array;
  /** Indices of this frame's `tailPixel` cells, collected by the cell loop and
   *  drained by drawTailPixels once the pass is done — the tail lands on a
   *  neighbouring cell, which may not have been painted yet when the fish is
   *  reached. Reused across frames (length reset, never reallocated). */
  private tailCells: number[] = [];
  /** id → 1 if the material draws a 4-directional chevron from its aux byte, with
   *  the low 2 bits the facing and the rest a powered countdown that brightens the
   *  chevron (Laser — see Material.windArrow. The Fan drew this until it took the
   *  rotor wheel; the flag is named for it). */
  private windArrow: Uint8Array;
  /** id → 1 if the material draws solid 4-directional triangles from its aux byte
   *  — filled arrowheads pointing the low-2-bit direction, the Shaped Charge's
   *  liner cone (see Material.triArrow). */
  private triArrow: Uint8Array;
  /** id → 1 if the material draws horizontal coil windings that brighten while its
   *  aux byte is non-zero (Electromagnet — see Material.coilPattern). */
  private coilPattern: Uint8Array;
  /** id → 1 if the material draws vertical channel stripes that brighten while its
   *  aux byte is non-zero (Pump — see Material.stripePattern). */
  private stripePattern: Uint8Array;
  /** id → 1 if the material draws the photovoltaic cell grid — base-coloured cells
   *  separated by `lattice`-coloured seams (Solar Panel — see
   *  Material.solarPattern). */
  private solarPattern: Uint8Array;
  /** id → 1 if the material draws running-bond masonry — `lattice`-coloured mortar
   *  joints with the top row of each brick lit (Wall — see Material.brickPattern). */
  private brickPattern: Uint8Array;
  /** id → the lit colour of a `brickPattern` material's brick top, precomputed from
   *  its base colour so the render loop never shades per pixel. */
  private brickLit: Uint32Array;
  /** id → 1 if the material draws a grid of speaker drivers — a rim, a `lattice`
   *  cone and a dark cap on the base baffle (Woofer — see Material.wooferPattern). */
  private wooferPattern: Uint8Array;
  /** Diaphragm excursion of each WOOFER_P × WOOFER_P driver tile — one entry per drawn
   *  driver, not per cell (see wooferDriver.ts): 0 at rest, up to WOOFER_THUMP_STEPS-1
   *  fully out.
   *
   *  Rebuilt from scratch at the top of every pass out of the live shockwaves
   *  (`this.shocks`), each of which knows which driver tiles its own firing came from.
   *  So it needs no double buffer the way the rotor frames do: the excursion is known
   *  before the first cell is drawn rather than being collected from the cells as they
   *  go past, and a driver is a still picture until something fires it.
   *
   *  Overlapping firings take the MAX, for the same reason a wheel does — a driver
   *  thumped twice in a frame should show the bigger thump, not the second one. */
  private wooferThump: Uint8Array;
  /** Tile-grid width `wooferThump` was sized for; -1 = never (see rotorBlocksW for why
   *  the width and not just the total is the key). */
  private wooferTilesW = -1;
  /** id → the rim / dust-cap colours of a `wooferPattern` material, precomputed from
   *  its base colour for the same reason `brickLit` is. */
  private wooferRim: Uint32Array;
  private wooferCap: Uint32Array;
  /** id → 1 if the material draws a bundle of labelled dynamite (TNT — see
   *  Material.tntPattern). */
  private tntPattern: Uint8Array;
  /** id → that material's finished TNT_N × TNT_N tile, its two colours resolved into
   *  the shared bitmap once at construction (see tntTile.ts). Null for every id that
   *  doesn't set `tntPattern`; the render loop only reads it inside that branch.
   *
   *  A table rather than the precomputed scalars `brickLit`/`wooferRim` are: this
   *  pattern isn't a rule the loop can evaluate, so there is nothing to precompute
   *  *into* except the picture itself. 256 cells per material, one material today. */
  private tntTile: (Uint32Array | null)[];
  /** id → 1 if the material draws a bladed rotor wheel (Turbine, Fan — see
   *  Material.rotorPattern), and id → that material's finished ROTOR_N × ROTOR_N
   *  tiles. Same shape and the same argument as `tntTile`: the pattern is a picture,
   *  so the only thing to precompute is the picture with this material's colours in
   *  it (see rotorTile.ts).
   *
   *  TWO tiles, because the wheel turns: `rotorTile` is the wheel at rest and
   *  `rotorTileSpun` is the same wheel half a blade pitch on. Which frame a wheel
   *  draws comes from the machine's own aux counter (`rotorFrame`), so the animation
   *  costs one shift and one array pick and needs no renderer clock. `rotorSpinShift`
   *  is the per-material shift that isolates that counter from the rest of aux. */
  private rotorPattern: Uint8Array;
  private rotorTile: (Uint32Array | null)[];
  private rotorTileSpun: (Uint32Array | null)[];
  private rotorSpinShift: Uint8Array;
  /** id → 1 if the material draws an open-cell foam — `lattice`-coloured voids of a
   *  randomised size and position pitting the base colour (Aerogel — see
   *  Material.poresPattern). Nothing to precompute alongside it the way `brickLit`
   *  sits beside `brickPattern`: both tones are the material's own, and the field
   *  itself is a hash rather than a table (see poreField.ts). */
  private poresPattern: Uint8Array;
  /** The spin counter of each ROTOR_N × ROTOR_N *tile* — one entry per drawn wheel,
   *  not per cell — plus the accumulator the current pass is filling.
   *
   *  **A wheel is one rigid picture, so its phase has to be one value.** A tile is a
   *  *drawing* unit, positional (`x % ROTOR_N`), so nothing keeps it from spanning
   *  cells that legitimately hold different counters: two separate machine bodies
   *  running out of phase, a body beside bare air, or cells freshly painted onto a
   *  running body, which sit at 0 until the next pulse re-phases them. Drawn per
   *  cell, any of those tears one wheel into halves moving at different speeds.
   *  Aggregating over the tile makes the unit of animation the drawn wheel, which is
   *  the thing that physically turns. (The case this was written for was stronger:
   *  the Turbine used to advance only the counters of cells steam was passing
   *  through, so every running block was strung out across the cycle and the wheel
   *  spun along the steam's path and stood still on the rest of itself — 수증기가
   *  통과하는 부분만 변화하는 게 어색함. Its beat is re-phased body-wide on each pulse
   *  now, so one block agrees with itself and the cases above are what remain.)
   *
   *  The aggregate is the MAX of its cells' counters, not an OR of their frames.
   *  With cells strung out across the cycle an OR is 1 as soon as any single cell
   *  is on the spun frame, which for a scattered tile is nearly always — the wheel
   *  would have stuck on frame 1 instead of tearing. The max is the leading cell's
   *  count, which advances one per tick for as long as any part of the wheel is
   *  running, and the laggards simply don't show.
   *
   *  It is collected during the pass and used by the *next* one (hence two arrays),
   *  because a wheel's last row is reached long after its first and there is no
   *  reading the whole tile before drawing any of it without a second pass over the
   *  grid. One rendered frame of lag on an animation that holds each frame for two
   *  sim ticks (~67 ms) is not visible; a wheel whose top half is a frame ahead of
   *  its bottom half is exactly what this fixes. Sized to the grid on first use and
   *  re-sized when it changes — keyed on the tile grid's *width* as well as its total
   *  size, because `rotorBlocksW` is what turns a cell into a tile index and a resize
   *  can change it while leaving the product alone (a corner drag that gains a column
   *  of tiles and loses a row), which would leave one pass reading last pass's phases
   *  through a shifted mapping. */
  private rotorBlockFrame: Uint8Array;
  private rotorBlockNext: Uint8Array;
  private rotorBlocksW = -1;
  /** id → the edge, in cells, of the square block that shares one tint sample — 0
   *  for the ordinary per-cell grain, 2 for Obsidian's flakes (see
   *  Material.tintBlock). Stored as the bit mask the render loop applies to x and y
   *  (`& ~1` for a 2-cell block), so the hot path needs no division. */
  /** id → the finer per-cell brightness spread a blocked material adds on top of its
   *  block shade — 0 for everything but Coal and Obsidian (see Material.tintCellVary). */
  private varyCell: Uint8Array;
  private tintBlockMask: Int32Array;
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
   *  cosmetic renderer state, animated per rendered frame like windPhase.
   *
   *  `tiles` is the driver tiles this firing's own *Woofer* cells sit in (empty for a
   *  brush fired over anything else, and for the Electromagnet's rings, which borrow
   *  the same field builder) — what lets the cabinet's diaphragms swell in step with
   *  the wave they launched. Collected once on drain rather than looked up per frame,
   *  and deduplicated, so a wall-sized cabinet costs its handful of tiles. */
  private shocks: {
    dist: Float64Array;
    x0: number;
    y0: number;
    bw: number;
    bh: number;
    maxR: number;
    age: number;
    tiles: number[];
  }[] = [];
  /** Live Electromagnet field rings, baked down to the flat indices of their
   *  candidate pixels (band boundaries with the static dither already applied
   *  — see rebuildMagnetRings). The per-frame draw just walks this list and
   *  paints every index still holding empty air, so a frame costs O(ring
   *  pixels), not O(field bbox × bodies) — the distance fields themselves are
   *  discarded right after extraction. Rebuilt when the powered-body cell
   *  membership changes (magnetRingsSig) or every MAGNET_REBUILD_TICKS of sim
   *  time; cached across both frames and ticks because the rings are shaped
   *  only by the bodies and the solids around them, which change on user
   *  timescales — without the cache a steadily powered magnet would re-run
   *  Dijkstra (and reallocate its field) every tick forever. */
  private magnetPixels: number[][] = Array.from({ length: MAGNET_ANIM_PHASES }, () => []);
  /** Grid.tick the magnetPixels cache was built at (-1 = never). */
  private magnetRingsTick = -1;
  /** Fingerprint of the powered-body cell membership the cache was built from
   *  (see drawMagnetFields). 0 = built from no bodies / never built. */
  private magnetRingsSig = 0;
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
  /** When true, every free object is labelled with its own temperature (see
   *  drawObjectTemps). Mirrors the 돋보기 overlay toggle, which reads out the cells
   *  under the cursor — objects aren't cells, so this is how they get read out. */
  private inspect = false;
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
    this.auxPalette = new Array(256).fill(null);
    this.tintPalette = new Array(256).fill(null);
    this.freezeTemp = new Float32Array(256).fill(-Infinity);
    this.frost = new Uint32Array(256);
    this.hasLattice = new Uint8Array(256);
    this.lattice = new Uint32Array(256);
    this.checker2x2 = new Uint8Array(256);
    this.batteryPattern = new Uint8Array(256);
    this.arrow = new Uint8Array(256);
    this.tailPixel = new Uint32Array(256);
    this.windArrow = new Uint8Array(256);
    this.triArrow = new Uint8Array(256);
    this.coilPattern = new Uint8Array(256);
    this.stripePattern = new Uint8Array(256);
    this.solarPattern = new Uint8Array(256);
    this.brickPattern = new Uint8Array(256);
    this.brickLit = new Uint32Array(256);
    this.wooferPattern = new Uint8Array(256);
    this.wooferRim = new Uint32Array(256);
    this.wooferCap = new Uint32Array(256);
    // Sized on the first render like the rotor frames; empty until then, which the
    // render loop reads as "every driver is at rest".
    this.wooferThump = new Uint8Array(0);
    this.tntPattern = new Uint8Array(256);
    this.tntTile = new Array(256).fill(null);
    this.rotorPattern = new Uint8Array(256);
    this.rotorTile = new Array(256).fill(null);
    this.rotorTileSpun = new Array(256).fill(null);
    this.rotorSpinShift = new Uint8Array(256);
    this.poresPattern = new Uint8Array(256);
    // Sized on the first render (the grid's dimensions aren't known here); empty
    // until then, which the render loop reads as "every wheel is at rest".
    this.rotorBlockFrame = new Uint8Array(0);
    this.rotorBlockNext = new Uint8Array(0);
    // -1 is every bit set, i.e. "sample this cell" — the identity mask, so the render
    // loop can skip the whole block-anchor computation with one compare.
    this.varyCell = new Uint8Array(256);
    this.tintBlockMask = new Int32Array(256).fill(-1);
    this.isLiquid = new Uint8Array(256);
    this.isSolid = new Uint8Array(256);
    this.packed = new Uint8Array(256);
    this.overlayTemp = new Float32Array(256).fill(NaN);
    for (let i = 0; i < 256; i++) {
      const m = getMaterial(i);
      this.palette[i] = m ? m.color : 0;
      if (m?.glow) this.glow[i] = buildGlow(m.glow, m.color);
      if (m) {
        this.vary[i] = varyAmplitude(m);
        this.varyCell[i] = varyCellAmplitude(m);
        this.varyMode[i] = varyMode(m);
        if (m.renderAsAux) this.renderAsAux[i] = 1;
        if (m.auxPalette) this.auxPalette[i] = Uint32Array.from(m.auxPalette);
        if (m.tintPalette) this.tintPalette[i] = Uint32Array.from(m.tintPalette);
        if (m.packedTemp) this.packed[i] = 1;
        if (m.overlayTemp !== undefined) this.overlayTemp[i] = m.overlayTemp;
        if (m.lattice !== undefined) {
          if (!m.checker2x2) this.hasLattice[i] = 1;
          this.lattice[i] = m.lattice;
        }
        if (m.checker2x2) this.checker2x2[i] = 1;
        if (m.batteryPattern) this.batteryPattern[i] = 1;
        if (m.arrow) this.arrow[i] = 1;
        if (m.tailPixel !== undefined) this.tailPixel[i] = m.tailPixel;
        if (m.windArrow) this.windArrow[i] = 1;
        if (m.triArrow) this.triArrow[i] = 1;
        if (m.coilPattern) this.coilPattern[i] = 1;
        if (m.stripePattern) this.stripePattern[i] = 1;
        if (m.solarPattern) this.solarPattern[i] = 1;
        if (m.brickPattern) {
          this.brickPattern[i] = 1;
          this.brickLit[i] = tinted(m.color, BRICK_LIT);
        }
        if (m.wooferPattern) {
          this.wooferPattern[i] = 1;
          this.wooferRim[i] = tinted(m.color, WOOFER_RIM);
          this.wooferCap[i] = tinted(m.color, WOOFER_CAP);
        }
        if (m.tntPattern) {
          this.tntPattern[i] = 1;
          this.tntTile[i] = buildTntTile(m.color, m.lattice ?? m.color);
        }
        if (m.rotorPattern) {
          this.rotorPattern[i] = 1;
          const lat = m.lattice ?? m.color;
          this.rotorTile[i] = buildRotorTile(m.rotorPattern, m.color, lat);
          this.rotorTileSpun[i] = buildRotorTile(m.rotorPattern, m.color, lat, true);
          this.rotorSpinShift[i] = m.rotorSpinShift ?? 0;
        }
        if (m.poresPattern) this.poresPattern[i] = 1;
        // A block edge of B clears the low log2(B) bits of x and y, which is only a
        // block for a power of two — `~(3 - 1)` clears bit 1 and leaves bit 0, giving
        // a lattice nobody asked for rather than a 3×3 flake.
        //
        // That invariant is pinned in `test/materialicons.ts`, NOT thrown on here. This
        // constructor runs from `startGame()` with nothing catching it, so a throw would
        // leave the page loaded and the sandbox dead — no game loop, no painter, no
        // on-screen error — over a mis-typed render hint. Same trade as GAS_CLOUD's row
        // width (see materialSvg.ts): the blast radius of the guard is far worse than
        // the wrong-looking grain it guards against, and the registry is a static fact a
        // test can check without ever building a renderer.
        if (m.tintBlock !== undefined && m.tintBlock > 1) this.tintBlockMask[i] = ~(m.tintBlock - 1);
        if (m.phase === Phase.Liquid) this.isLiquid[i] = 1;
        if (m.phase === Phase.Solid) this.isSolid[i] = 1;
        if (m.freeze) {
          this.freezeTemp[i] = m.freeze.temp;
          this.frost[i] = frosted(m.color);
        }
      }
    }
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
    // Same hazard for the cached Electromagnet field rings; rebuilt next frame
    // from whatever Grid.magnetFields then holds.
    for (const phase of this.magnetPixels) phase.length = 0;
    this.magnetRingsTick = -1;
    this.magnetRingsSig = 0;
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
    const varyCell = this.varyCell;
    const mode = this.varyMode;
    const asAux = this.renderAsAux;
    const auxPal = this.auxPalette;
    const tintPal = this.tintPalette;
    const freezeTemp = this.freezeTemp;
    const frost = this.frost;
    const hasLat = this.hasLattice;
    const latCol = this.lattice;
    const chk2x2 = this.checker2x2;
    const batPat = this.batteryPattern;
    const arrow = this.arrow;
    // Drained by drawTailPixels below; emptied here rather than reallocated so a
    // tank full of fish doesn't churn a fresh array every frame.
    const tailCells = this.tailCells;
    tailCells.length = 0;
    // Scroll offset for a powered Conveyor's tread, in cells (see the `arrow`
    // branch below). Driven by the sim tick rather than by rendered frames — the
    // belt carries its load exactly one cell per tick, so this makes the pattern
    // and the cargo move at the same speed instead of at whatever rate the display
    // happens to refresh at (unlike the purely decorative wind streaks, which take
    // `windPhase`).
    const beltPhase = grid.tick;
    const windArrow = this.windArrow;
    const triArrow = this.triArrow;
    const coilPattern = this.coilPattern;
    const stripePattern = this.stripePattern;
    const solarPattern = this.solarPattern;
    const brickPattern = this.brickPattern;
    const brickLit = this.brickLit;
    const wooferPattern = this.wooferPattern;
    const wooferRim = this.wooferRim;
    const wooferCap = this.wooferCap;
    const tntPattern = this.tntPattern;
    const tntTile = this.tntTile;
    const rotorPattern = this.rotorPattern;
    const poresPattern = this.poresPattern;
    const rotorTile = this.rotorTile;
    const rotorTileSpun = this.rotorTileSpun;
    const rotorSpinShift = this.rotorSpinShift;
    const tintBlockMask = this.tintBlockMask;
    // Per-wheel animation frames: last pass's aggregate is what gets drawn, this
    // pass's is being collected (see rotorBlockFrame). Re-allocated only when the
    // grid is resized; a few hundred bytes for a full board, so it is not worth
    // gating on "does this world contain a rotor at all".
    const rotorBlocksW = Math.ceil(grid.width / ROTOR_N);
    const rotorBlockCount = rotorBlocksW * Math.ceil(grid.height / ROTOR_N);
    if (this.rotorBlocksW !== rotorBlocksW || this.rotorBlockFrame.length !== rotorBlockCount) {
      this.rotorBlocksW = rotorBlocksW;
      this.rotorBlockFrame = new Uint8Array(rotorBlockCount);
      this.rotorBlockNext = new Uint8Array(rotorBlockCount);
    }
    const rotorFrames = this.rotorBlockFrame;
    const rotorNext = this.rotorBlockNext;
    rotorNext.fill(0);
    // Per-driver diaphragm excursion, rebuilt from the live shockwaves before a single
    // cell is drawn (see wooferThump). Same sizing rule as the wheels', and the same
    // argument for not gating it on "is there a Woofer in this world": the buffer is a
    // few hundred bytes and the loop below is over the *waves*, of which an idle world
    // has none.
    const wooferTilesW = Math.ceil(grid.width / WOOFER_P);
    const wooferTileCount = wooferTilesW * Math.ceil(grid.height / WOOFER_P);
    if (this.wooferTilesW !== wooferTilesW || this.wooferThump.length !== wooferTileCount) {
      this.wooferTilesW = wooferTilesW;
      this.wooferThump = new Uint8Array(wooferTileCount);
    }
    const wooferThump = this.wooferThump;
    wooferThump.fill(0);
    for (const s of this.shocks) {
      // `age * SHOCK_SPEED` is exactly the front radius drawShockwaves will paint at
      // the end of *this* pass (it advances the age after drawing), so the swell and
      // the ring it launched are read off the same clock in the same frame.
      //
      // This loop reads waves that are ALREADY live, and the frame a Woofer fires on
      // drains its wave into `this.shocks` later, at the end of the pass — which looks
      // like the swell is a frame behind the ring, and is not. A wave's first pass is
      // its age-0 one, and an age-0 front has radius 0, which the spawn dither gates
      // out entirely (`fade = r / SHOCK_FADE` = 0 ⇒ `continue`, painting nothing). So
      // the ring's first *drawn* frame and the diaphragm's first swollen frame are the
      // same one — the wave's age-1 pass, the first pass this loop can see it on. The
      // coupling is real though: a SHOCK_FADE of 0 would paint that age-0 ring, and
      // then the swell WOULD trail it by a frame.
      const e = wooferExcursion(s.age * SHOCK_SPEED, s.maxR);
      if (e === WOOFER_REST) continue;
      for (const t of s.tiles) if (e > wooferThump[t]) wooferThump[t] = e;
    }
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
      // material opts into a fixed apparent reading via `overlayTemp` (Nuclear Ray),
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
      // 꼬리: note the cell now (the loop already has its id in hand) and paint it
      // after the pass — the tail lands one cell to the side, which may still be
      // unpainted at this point. See drawTailPixels.
      if (this.tailPixel[id] !== 0) tailCells.push(i);
      // A carrier cell (Debris) draws as the material named in its aux byte, so a
      // flung grain wears its own material's color instead of the carrier's.
      let carried = false;
      if (asAux[id]) {
        const carriedId = auxArr[i];
        if (carriedId !== 0) {
          id = carriedId;
          carried = true;
        }
      }
      let c: number;
      // Which cell's tint byte this cell shades from. Normally its own — but a
      // `tintBlock` material samples the anchor of the square block it sits in, so a
      // whole 2×2 of cells shares one shade and the grain reads as flakes instead of
      // per-cell static (Obsidian). The mask is -1 for every other material, so the
      // compare below is the entire cost they pay: no division, no branch taken.
      //
      // The anchor cell may hold a different material at a block boundary, but
      // `Grid.tint` is a full plane of bytes with a value everywhere, so that only
      // ever picks a different shade of THIS material — never a wrong colour.
      let ti = i;
      const blockMask = tintBlockMask[id];
      if (blockMask !== -1) {
        const by = (i / w) | 0;
        ti = (by & blockMask) * w + ((i - by * w) & blockMask);
      }
      // The brightness grain, computed once here rather than five times below.
      //
      // Every branch that shades — the two palette branches, the checkerboard, the
      // glow ramp and the plain default — used to repeat this same expression, and
      // repeating it is what made the second, finer level (below) a five-place edit
      // instead of a one-place one. `grained` is the "does this material vary at all"
      // gate the branches used to spell as `amp !== 0`.
      //
      // TWO levels, and only Coal and Obsidian use the second. The first shades from
      // the (possibly block-anchored) sample by `colorVary` — for a blocked material
      // that is one shade for the whole 2×2 flake. The second shades again from the
      // cell's OWN sample by the much narrower `tintCellVary`, which puts grit back
      // inside a flake that would otherwise be a flat painted square. The offsets add,
      // so the total swing stays `colorVary + tintCellVary` either way, and a material
      // with no `tintCellVary` pays one load and one compare (see Material.tintCellVary).
      const amp = vary[id];
      const cellAmp = varyCell[id];
      const grained = amp !== 0 || cellAmp !== 0;
      let grainD = 0;
      if (grained) {
        const particle = mode[id] === VARY_PARTICLE;
        if (amp !== 0) grainD = (((particle ? tintArr[ti] : bgArr[ti]) - TINT_NEUTRAL) * amp) >> 7;
        if (cellAmp !== 0) grainD += (((particle ? tintArr[i] : bgArr[i]) - TINT_NEUTRAL) * cellAmp) >> 7;
      }
      // `renderAsAux` and `auxPalette` are two mutually exclusive readings of the
      // SAME aux word — "this is the material id I'm carrying" vs. "this is my own
      // colour index" — so a carrier cell must never be handed to the palette
      // branch below: it would index the palette with a material id and paint a
      // real-looking but wrong colour. On a carrier the remapped id only chooses
      // the *branch*; the aux word still belongs to the carrier.
      const pal8 = carried ? null : auxPal[id];
      // A multi-coloured material (Firework Burst) draws the entry of its fixed
      // palette that the cell's own aux value names, so one material paints a
      // whole volley of differently-coloured flowers (see Material.auxPalette).
      // The modulo means a stale/garbage aux still lands on a real colour rather
      // than reading past the array.
      const tintPal3 = tintPal[id];
      if (pal8) {
        c = pal8[auxArr[i] % pal8.length];
        if (grained) {
          // The ordinary brightness grain rides on top of the palette colour, the
          // same way it does over the tintPalette branch below — otherwise a
          // powder that uses `auxPalette` to show a *state* (a germinating Seed's
          // progress) would lose the speckle every other powder has and read as
          // one flat block. Firework Burst, the other auxPalette material, is a
          // Gas with no variation (amp 0), so this is a no-op for it.
          c = tinted(c, grainD);
        }
      } else if (tintPal3) {
        // A multi-coloured *particle* material (Fireworks): each grain draws the
        // palette entry its own stable tint byte names, so a pile is a speckle of
        // genuinely different colours instead of one hue at different brightnesses
        // (see Material.tintPalette). The ordinary brightness grain rides on top of
        // the chosen colour, exactly as it does over the checkerboard branch below.
        // Indexing by `% n` rather than banding the byte keeps the colour
        // uncorrelated with the `liquidOverlap` split read off the same byte.
        c = tintPal3[tintArr[ti] % tintPal3.length];
        if (grained) {
          // The COLOUR is per-particle by definition, so it always reads tintArr.
          // The brightness offset on top is the ordinary one, so it takes the
          // material's own vary source like every sibling branch — otherwise a
          // future liquid-phase tintPalette material would shade itself from a
          // plane it doesn't use.
          c = tinted(c, grainD);
        }
      } else if (arrow[id]) {
        // A directional-arrow material (Conveyor) draws a chevron pointing the way
        // its aux byte says it runs, so the belt's travel direction is visible. The
        // chevron is a period-4 tent: over four rows the lit column steps 0,1,1,0
        // (a '>' whose tip is the middle rows) — mirrored for a left-running belt.
        // The direction lives in the low 2 bits; the rest is the powered countdown
        // (see conveyor.ts), which is why the aux is masked rather than compared.
        //
        // **The tread scrolls while the belt is powered** (단순히 무늬가 방향으로
        // 한칸씩 전진): the sampled column is offset by the sim tick, so the whole
        // pattern steps exactly one cell per tick along the travel direction — the
        // same speed the belt actually carries its load, which is what makes the
        // animation read as the surface moving rather than as a blinking texture.
        // An unpowered belt draws the static tent it always did.
        //
        // The clock is `beltPhase` (the sim tick), not each cell's own countdown,
        // because the countdown is NOT uniform across a body: cells the scan
        // reached before the pulse landed are a tick behind the ones it reached
        // after, which would tear a visible seam across a long belt run at whatever
        // cell the scan happened to be at. One clock for every belt in the world
        // has no seam to tear, and two belts still scroll opposite ways because the
        // offset is applied along each cell's own direction.
        const x = i % w;
        const y = (i / w) | 0;
        const a = auxArr[i];
        const fold = y & 2 ? 3 - (y & 3) : y & 3; // y%4 → 0,1,1,0
        const run = a >> 2 ? beltPhase : 0; // frozen unless powered
        const on =
          (a & 0b11) === 2
            ? ((x + run) & 3) === 3 - fold // left-running: pattern steps -x
            : ((x - run) & 3) === fold; //  right-running: pattern steps +x
        c = on ? latCol[id] : pal[id];
      } else if (windArrow[id]) {
        // A Laser draws a 4-directional chevron pointing the way it fires: the low
        // 2 bits of aux are the direction (0 up / 1 down / 2 left / 3 right) and the
        // rest a powered countdown, so a running one lights up brighter. The Fan
        // drew the same chevron from the same bits until it took the rotor wheel
        // (see the rotorPattern branch), which is why the comments here and the flag
        // itself are named for a fan.
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
        c = on ? (a >> 2 ? tinted(latCol[id], 45) : latCol[id]) : pal[id];
      } else if (triArrow[id]) {
        // A Shaped Charge draws solid arrowhead triangles pointing its jet
        // direction (aux low 2 bits, same codes as the Laser's chevron) — the
        // liner cone made visible. Each triangle is 6 cells ACROSS the jet axis
        // by 3 deep ALONG it, filling 1,2,3,3,2,1 cells so every side steps in
        // exactly one cell per lane (a real triangle rather than a stubby
        // wedge). The tile is bigger than the triangle on both counts —
        // TRI_SPAN = 6+2 across, TRI_STEP = 3+2 along — so neighbours never
        // touch: a painted block reads as separated arrowheads with clear
        // gutters between rows and columns, not one filled slab.
        const x = i % w;
        const y = (i / w) | 0;
        const dir = auxArr[i] & 0b11;
        // Lane across the axis: lanes 1..6 form the triangle (fill 1,2,3,3,2,1
        // toward the tip), lanes 0 and 7 are the side gutter.
        const lane = (dir >= 2 ? y : x) % TRI_SPAN;
        const l = lane - 1;
        // Position along the axis, measured from the triangle's flat base so
        // the tip points the jet way: dir 1 (down) / 3 (right) grow with the
        // coordinate, 0 (up) / 2 (left) grow against it. Positions past the
        // deepest lane (3..4) are the front/back gutter.
        const along = (dir >= 2 ? x : y) % TRI_STEP;
        const t = dir === 1 || dir === 3 ? along : TRI_STEP - 1 - along;
        const on = l >= 0 && l < 6 && t <= (l < 3 ? l : 5 - l);
        c = on ? latCol[id] : pal[id];
      } else if (coilPattern[id]) {
        // An Electromagnet draws copper windings around a dark core: two lit rows
        // out of every four (a period-4 stripe in the `lattice` colour), so a bar
        // of it reads as a wound coil rather than another flat machine block. It
        // has no direction to point at, so unlike the Laser's chevron the pattern is
        // positional only. Its whole aux byte is the powered countdown (see
        // materials/electromagnet.ts), so a non-zero aux brightens the windings
        // exactly the way a running laser's chevron brightens — that's the only cue
        // that the field is up.
        const y = (i / w) | 0;
        const band = y & 3;
        const a = auxArr[i];
        c = band === 1 || band === 2 ? (a ? tinted(latCol[id], 45) : latCol[id]) : pal[id];
      } else if (stripePattern[id]) {
        // A Pump draws vertical channel stripes — one lit column of every three,
        // in the `lattice` colour — so a block of it reads as open risers matter
        // travels up rather than a solid machine face (세로줄). The 90°-rotated
        // counterpart of the Electromagnet's windings, and like them positional
        // only: the pump has no direction, so its whole aux byte is the powered
        // countdown (see materials/pump.ts) and a non-zero aux brightens the
        // stripes — the cue that it's lifting rather than just sieving.
        const x = i % w;
        const a = auxArr[i];
        c = x % 3 === 1 ? (a ? tinted(latCol[id], 45) : latCol[id]) : pal[id];
      } else if (solarPattern[id]) {
        // A Solar Panel draws its photovoltaic cell grid: rectangular cells of the
        // base colour separated by thin `lattice`-coloured seams — a seam on every
        // 4th column and every 6th row, so each cell reads 3 wide × 5 tall (the
        // reference art's proportions, scaled down — see SOLAR_CELL_W). Positional
        // (tied to x/y, not to the particle) like
        // the Mesh weave, so however you drag the brush the seams line up into one
        // continuous array rather than restarting per stroke.
        //
        // The *cells* brighten while the array is active — a panel in the light is
        // generating, one in the dark does nothing (materials/solarpanel.ts) — which
        // is the same "it's running" cue the Pump's stripes and the Electromagnet's
        // windings give, just on the cell faces rather than the lattice. A panel
        // packs two counters into its aux, and only the low byte is the active
        // countdown, so this masks rather than testing the whole word (the seams are
        // left alone: brightening both washes the grid out).
        const x = i % w;
        const y = (i / w) | 0;
        c = x % SOLAR_CELL_W === SOLAR_CELL_W - 1 || y % SOLAR_CELL_H === SOLAR_CELL_H - 1
          ? latCol[id]
          : auxArr[i] & 0xff
            ? tinted(pal[id], 45)
            : pal[id];
      } else if (brickPattern[id]) {
        // A Wall draws running-bond masonry: a `lattice`-coloured mortar bed on the
        // last row of every course and a head joint on the last column of every
        // brick, with alternate courses offset half a brick so the joints stagger.
        // The top row of each brick is lit BRICK_LIT above the base, which is what
        // turns a flat two-tone grid into blocks with light on their top edges — the
        // same three tones, in the same places, as the hand-drawn Wall chip.
        // Positional like the Mesh weave and the panel's seams, so dragging the
        // brush extends one continuous wall instead of restarting the courses.
        const x = i % w;
        const y = (i / w) | 0;
        const row = y % BRICK_H;
        const course = (y / BRICK_H) | 0;
        // Odd courses shift the head joints half a brick to the right.
        const col = (x + (course & 1 ? BRICK_OFFSET : 0)) % BRICK_W;
        c = row === BRICK_H - 1 || col === BRICK_W - 1
          ? latCol[id]
          : row === 0
            ? brickLit[id]
            : pal[id];
      } else if (wooferPattern[id]) {
        // A Woofer draws its speaker drivers: one round driver per WOOFER_P tile —
        // rim, `lattice`-coloured cone, dark dust cap — on the base colour's baffle,
        // the same four tones in the same radial order as the hand-drawn chip.
        // Positional like the Mesh weave, so a cabinet dragged out with the brush is
        // one continuous array of drivers rather than a fresh one per stroke.
        //
        // **And it thumps.** The Woofer stamps no cell state at all — it fires and is
        // done, so there is nothing in aux to read the way the Pump's stripes or the
        // rotor wheels do. What it does leave is the shockwave it launched, so the
        // driver's excursion is read off that instead (see wooferThump /
        // wooferExcursion): the whole driver swells the instant the front leaves the
        // cabinet and settles back as the front reaches its rim. The band radii are the
        // only thing that changes — same three compares, indexed instead of constant —
        // so an idle cabinet costs exactly what it did before, and draws exactly what
        // the palette chip does.
        const x = i % w;
        const y = (i / w) | 0;
        // Doubled offsets from the tile centre keep the radius test integral.
        const ax = 2 * (x % WOOFER_P) - (WOOFER_P - 1);
        const ay = 2 * (y % WOOFER_P) - (WOOFER_P - 1);
        const d2 = ax * ax + ay * ay;
        // One excursion per drawn driver, not per cell: two cabinets sharing a tile
        // swell together rather than tearing a driver in half (see wooferTileIndex).
        const e = wooferThump[wooferTileIndex(x, y, wooferTilesW)];
        c = d2 <= WOOFER_CAP_R2[e]
          ? wooferCap[id]
          : d2 <= WOOFER_CONE_R2[e]
            ? latCol[id]
            : d2 <= WOOFER_R2[e]
              ? wooferRim[id]
              : pal[id];
      } else if (tntPattern[id]) {
        // TNT draws a bundle of dynamite behind a printed paper label: four lit-and-
        // shaded stick columns above and below a wrapped band carrying the word (see
        // tntTile.ts). Unlike every other pattern here this one is a bitmap rather than
        // a rule — the letters are art — so the branch is a single lookup into the tile
        // this material's colours were resolved into at construction.
        //
        // Positional like the Wall's courses, so a dragged charge is one continuous
        // bundle rather than a per-cell tile, and squarely aligned rather than offset:
        // staggering would break the sticks and misalign the label.
        const y = (i / w) | 0;
        const x = i - y * w;
        c = tntTile[id]![(y % TNT_N) * TNT_N + (x % TNT_N)];
      } else if (rotorPattern[id]) {
        // A Turbine (8 blades) or a Fan (4) draws its rotor wheel: blades lit on the
        // leading edge and shaded on the trailing one, keyed to a dark hub, one wheel
        // per ROTOR_N tile (see rotorTile.ts). A bitmap rather than a rule for the same
        // reason TNT's bundle is — the sweep that makes a wheel read as *turning* has no
        // short closed form at twelve cells.
        //
        // **And it turns.** The wheel alternates between the tile at rest and the tile
        // half a blade pitch on, driven by the machine's own aux counter — a Fan's
        // powered countdown, a Turbine's beat counter — so it spins exactly while the
        // machine works and freezes when it stops (see rotorFrame). That is what
        // replaced the Fan's old chevron brightening as the "this one is running" cue;
        // what the chevron also did and this cannot is point, which the wind streaks
        // now carry alone.
        //
        // The frame is read and written *per wheel*, not per cell: this cell's own
        // counter goes into the tile's accumulator for the next pass, and what it
        // draws is the tile's aggregate from the last one (see rotorBlockFrame). A
        // tile is positional, so it can span cells that legitimately disagree — two
        // bodies out of phase, cells just painted onto a running one — and per-cell
        // frames tear such a wheel into halves moving at different speeds; per-tile,
        // the whole wheel turns together the way a rigid wheel does.
        //
        // Positional like the Wall's courses, so a machine dragged out with the brush
        // is one array of wheels rather than a fresh tile per cell — and the wheel and
        // the animation unit are then the same square, which is the whole point.
        const y2 = (i / w) | 0;
        const x2 = i - y2 * w;
        const bi = rotorBlockIndex(x2, y2, rotorBlocksW);
        rotorAccumulate(rotorNext, bi, auxArr[i], rotorSpinShift[id]);
        const rt = rotorFrame(rotorFrames[bi]) ? rotorTileSpun[id]! : rotorTile[id]!;
        c = rt[(y2 % ROTOR_N) * ROTOR_N + (x2 % ROTOR_N)];
      } else if (poresPattern[id]) {
        // Aerogel draws a fine foam: `lattice`-coloured pores on a checkerboard
        // lattice, all one size, each nudged by at most one cell off its period's
        // corner (see poreField.ts, which the palette chip generator shares). Positional like the Wall's courses, so a dragged block is one
        // continuous piece of foam and a pore stays where it was.
        //
        // One hash per cell and no state: a pore cannot leave the period it is
        // anchored in, so the period this cell falls in is the only thing that can
        // put a pore on it. The earlier field let pores spill and merge, which cost
        // 2.25 hashes a cell and — the reason it is gone — read as styrofoam.
        const x = i % w;
        const y = (i / w) | 0;
        c = poreAt(x, y) ? latCol[id] : pal[id];
      } else if (chk2x2[id]) {
        // 2x2 positional checkerboard (Diamond), with low dynamic range tint variation.
        const x = i % w;
        const y = (i / w) | 0;
        c = ((x >> 1) ^ (y >> 1)) & 1 ? latCol[id] : pal[id];
        if (grained) c = tinted(c, grainD);
      } else if (hasLat[id]) {
        // A lattice material (Mesh) is a two-tone positional checkerboard, so a
        // screen reads as a woven grid rather than a flat slab. Computed from the
        // cell's x/y so the weave is tied to space, not to the particle.
        const x = i % w;
        const y = (i / w) | 0;
        c = (x ^ y) & 1 ? latCol[id] : pal[id];
      } else if (batPat[id]) {
        // Diagonal 2-step staircase on a 4x5 tile (Lithium Battery, LFP Battery):
        // two black cells drop one column to the right, leaving a 1px border of the
        // battery's base color around them.
        const x = i % w;
        const y = (i / w) | 0;
        const px = x % 4;
        const py = y % 5;
        const isPattern =
          (px === 1 && (py === 1 || py === 2)) ||
          (px === 2 && (py === 2 || py === 3));
        c = isPattern ? 0xff000000 : pal[id];
      } else if (glow[id]) {
        c = shade(glow[id]!, temp[i]);
        if (grained) c = tinted(c, grainD);
      } else if (temp[i] <= freezeTemp[id]) {
        // A frozen liquid (see Material.freeze) is drawn frosted. freezeTemp is
        // -Infinity for non-freeze materials, so this never fires for them.
        c = frost[id];
      } else {
        // Powders read their own fixed per-grain tint; liquids sample the positional
        // background field (see game/tint.ts). Both were mapped to a signed brightness
        // offset above; a flat material has none and draws its bare colour.
        c = grained ? tinted(pal[id], grainD) : pal[id];
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
    // Hand this pass's per-wheel frames to the next one. A swap rather than a copy:
    // the array just drawn from becomes the accumulator and is cleared at the top of
    // the next pass (see rotorBlockFrame).
    this.rotorBlockFrame = rotorNext;
    this.rotorBlockNext = rotorFrames;
    this.windWasActive = sawWind;
    this.windMinX = bxMin;
    this.windMaxX = bxMax;
    this.windMinY = byMin;
    this.windMaxY = byMax;
    // 물고기 꼬리: one grey pixel behind each fish (and each corpse), drawn over
    // the finished cells
    // (see drawTailPixels). Nothing is collected in the thermal camera, so this
    // costs a single empty-array check there.
    this.drawTailPixels(grid);
    // Electromagnet field rings: static contour lines around each powered magnet,
    // drawn over the finished cell image on empty air only (see drawMagnetFields).
    this.drawMagnetFields(grid, heat);
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
      // 돋보기: the wash tells you a body is hot, this tells you how hot. Drawn as
      // real text on the display canvas rather than into the pixel-art overlay —
      // the overlay is nearest-neighbor upscaled, which would turn any glyph small
      // enough to fit into mush.
      if (this.inspect) {
        this.drawObjectTemps(grid, rect.x, rect.y, rect.width, rect.height, scale);
      }
    }
    if (this.gridDivision > 0) {
      this.drawGrid(rect.x, rect.y, rect.width, rect.height, grid.width, grid.height, scale);
    }
    this.drawBoundary(rect.x, rect.y, rect.width, rect.height, scale);
  }

  /**
   * 꼬리 픽셀 — the display-only pixel a `tailPixel` material trails behind itself
   * (the Fish's grey tail; see Material.tailPixel). It is drawn, never simulated:
   * no cell holds it, nothing collides with it, and the fish that owns it is still
   * exactly one cell wide to every rule in the engine.
   *
   * Which side it goes on is bit 0 of the cell's `aux` — 1 faces right, so the tail
   * trails left. Vertical motion doesn't enter into it: a fish rising or diving
   * keeps the facing it last swam sideways with, which is the material's business
   * to maintain (materials/fish.ts) and not this pass's.
   *
   * Two guards, both about not lying with the pixel. It stays inside the fish's own
   * row (a raw ±1 on the index would wrap a tail at the left edge onto the far end
   * of the row above), and it only paints over empty air or liquid — over rock or
   * plant it would read as a bite taken out of the terrain rather than as a fish
   * behind it.
   */
  private drawTailPixels(grid: Grid): void {
    const list = this.tailCells;
    if (list.length === 0) return; // no fish, or the thermal camera (collects none)
    const buf = this.buf32;
    const cells = grid.cells;
    const aux = grid.aux;
    const w = grid.width;
    const liquid = this.isLiquid;
    const tail = this.tailPixel;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const y = (i / w) | 0;
      const x = i - y * w;
      // Behind = opposite the facing. Bit 0 set means it faces right.
      const tx = (aux[i] & 1) !== 0 ? x - 1 : x + 1;
      if (tx < 0 || tx >= w) continue;
      const ti = i - x + tx;
      const over = cells[ti];
      if (over !== EMPTY && liquid[over] === 0) continue;
      buf[ti] = tail[cells[i]];
    }
  }

  /**
   * Draw the live Electromagnet field rings (see Grid.magnetFields and the
   * MAGNET_* constants). The entries are clustered and turned into geodesic
   * distance fields whose contour lines become a baked pixel list (see
   * rebuildMagnetRings for the construction); this per-frame path only decides
   * *whether* to rebuild and then paints the list — every cached index still
   * holding empty air gets the one flat MAGNET_SHADE (단색), so matter in the
   * field shows through as itself. The entry list is read, not drained — the
   * sim re-stamps it every powered tick and clears it when power lapses — and
   * the rebuild fires only when the powered bodies' cell membership actually
   * changes (fingerprint below) or every MAGNET_REBUILD_TICKS of sim time
   * (see the constant for why not per tick): both a paused sim and a steadily
   * powered one keep their rings without re-running Dijkstra. Skipped entirely
   * in the thermal camera.
   */
  private drawMagnetFields(grid: Grid, heat: boolean): void {
    const q = grid.magnetFields;
    if (q.length === 0 && this.magnetRingsSig === 0) return;
    const w = grid.width;
    // Fingerprint the powered bodies' cell membership: a plain sum of per-cell
    // hashes, so it's independent of entry order and of where each body walk
    // started (the scan direction alternates every tick, so keying on entry
    // order or head cells would churn the cache each tick). Unlike a bare body
    // count this catches one magnet losing power the same tick another gains
    // it, and shape edits at constant count. Forced non-zero for a live set so
    // it can never collide with the "cache is empty" sentinel (0).
    let sig = 0;
    for (const f of q) {
      const fbx = f.bx;
      const fby = f.by;
      for (let i = 0; i < fbx.length; i++) {
        sig = (sig + Math.imul(fby[i] * w + fbx[i] + 1, 0x9e3779b1)) | 0;
      }
    }
    if (q.length > 0 && sig === 0) sig = 1;
    // Rebuild when the membership changed (power on/off must add/drop that
    // body's rings the same tick) or every MAGNET_REBUILD_TICKS of sim time
    // (solids drawn into the field re-shadow it on that cadence; see the
    // constant). A paused sim repaints from cache indefinitely; a tick that
    // moved *backwards* (a rewound sim clock) also rebuilds, since the
    // elapsed-ticks test can't be trusted across it.
    if (
      sig !== this.magnetRingsSig ||
      (q.length > 0 &&
        (grid.tick - this.magnetRingsTick >= MAGNET_REBUILD_TICKS ||
          grid.tick < this.magnetRingsTick))
    ) {
      this.rebuildMagnetRings(grid, q);
      this.magnetRingsSig = sig;
      this.magnetRingsTick = grid.tick;
    }
    if (heat) return; // thermal camera: keep the cache warm, draw nothing
    const buf = this.buf32;
    const cells = grid.cells;
    // Which baked phase this frame shows — a full cycle every MAGNET_ANIM_PERIOD_MS
    // of real time, so the breathing is independent of frame rate, sim speed and
    // pause state (see the MAGNET_ANIM_* notes).
    const phase =
      Math.floor((performance.now() / MAGNET_ANIM_PERIOD_MS) * MAGNET_ANIM_PHASES) %
      MAGNET_ANIM_PHASES;
    const pix = this.magnetPixels[phase];
    for (let i = 0; i < pix.length; i++) {
      const gi = pix[i];
      if (cells[gi] === EMPTY) buf[gi] = MAGNET_SHADE; // air-only paint
    }
  }

  /**
   * Rebuild the magnet ring pixel list from this tick's powered bodies. A body
   * bigger than the sim's per-sweep cap arrives as SEVERAL entries (one per
   * capped body walk — see MAX_BODY in materials/electromagnet.ts), so the
   * entries are first clustered: any whose reach-padded bounding boxes touch
   * merge into one seed set and get ONE distance field between them. Without
   * this a big painted magnet blob stacked a full overlapping ring set per
   * chunk — visibly doubled lines and a Dijkstra per chunk per rebuild (the
   * user-reported 중첩/렉). Merging also means two independent magnets whose
   * fields meet share one coherent contour set (rings wrap the pair, exactly
   * how the reference effect contours a multi-blob mask) instead of
   * cross-hatching each other.
   *
   * Each cluster then runs the shared geodesic field build (buildShockField —
   * seeded on the body cells, blocked by solids, bounded to the pull's reach)
   * and its rings are the field's contour lines: a cell lights when its
   * distance band has a strictly nearer 4-neighbour, i.e. it sits on the inner
   * boundary of its band — the reference 자기력선 construction, one ring every
   * MAGNET_RING_GAP cells. Outer rings are thinned by a static positional
   * dither (checkerboard, then 1-in-3) so the field fades with distance in
   * pure pixel art. Surviving pixels are appended to magnetPixels as flat
   * indices and the field is discarded — the per-frame draw only needs the
   * indices (occupancy is re-checked there, so matter drifting through the
   * field masks rings without a rebuild).
   */
  private rebuildMagnetRings(
    grid: Grid,
    q: { bx: number[]; by: number[]; reach: number }[],
  ): void {
    for (const phase of this.magnetPixels) phase.length = 0;
    if (q.length === 0) return;
    const w = grid.width;
    const gap = MAGNET_RING_GAP;
    // Greedy fixpoint clustering on the entries' bboxes. Entry counts are tiny
    // (one per ≤MAX_BODY chunk of powered magnet), so O(n²) passes are cheap.
    const clusters = q.map((f, qi) => {
      let minX = f.bx[0];
      let maxX = f.bx[0];
      let minY = f.by[0];
      let maxY = f.by[0];
      for (let i = 1; i < f.bx.length; i++) {
        if (f.bx[i] < minX) minX = f.bx[i];
        if (f.bx[i] > maxX) maxX = f.bx[i];
        if (f.by[i] < minY) minY = f.by[i];
        if (f.by[i] > maxY) maxY = f.by[i];
      }
      return { minX, minY, maxX, maxY, reach: f.reach, members: [qi] };
    });
    for (let changed = true; changed; ) {
      changed = false;
      for (let a = 0; a < clusters.length; a++) {
        for (let b = a + 1; b < clusters.length; b++) {
          const A = clusters[a];
          const B = clusters[b];
          // Fields extend `reach` past each box, so the ring sets can only
          // overlap when the boxes come within the two reaches of each other.
          const pad = A.reach + B.reach;
          if (
            B.minX - A.maxX > pad ||
            A.minX - B.maxX > pad ||
            B.minY - A.maxY > pad ||
            A.minY - B.maxY > pad
          ) {
            continue;
          }
          if (B.minX < A.minX) A.minX = B.minX;
          if (B.maxX > A.maxX) A.maxX = B.maxX;
          if (B.minY < A.minY) A.minY = B.minY;
          if (B.maxY > A.maxY) A.maxY = B.maxY;
          if (B.reach > A.reach) A.reach = B.reach;
          A.members.push(...B.members);
          clusters.splice(b, 1);
          changed = true;
          b--;
        }
      }
    }
    for (const cl of clusters) {
      const cbx: number[] = [];
      const cby: number[] = [];
      for (const qi of cl.members) {
        const f = q[qi];
        for (let i = 0; i < f.bx.length; i++) {
          cbx.push(f.bx[i]);
          cby.push(f.by[i]);
        }
      }
      const m = this.buildShockField(grid, cbx, cby, cl.reach);
      if (!m) continue;
      const K = Math.max(1, Math.floor(m.maxR / gap)); // ring count (bands 1..K)
      const dist = m.dist;
      const bw = m.bw;
      // Bake one contour set per animation phase: the bands are cut at
      // `b·gap + off` instead of `b·gap`, so the whole ring set slides out and back
      // as `off` sweeps a sine over the phases (see the MAGNET_ANIM_* notes). The
      // distance field is shared by all of them — only this extraction repeats, and
      // only when the rings are rebuilt at all.
      for (let phase = 0; phase < MAGNET_ANIM_PHASES; phase++) {
        const off = MAGNET_ANIM_AMP * Math.sin((2 * Math.PI * phase) / MAGNET_ANIM_PHASES);
        const out = this.magnetPixels[phase];
        for (let ly = 0; ly < m.bh; ly++) {
          const row = ly * bw;
          for (let lx = 0; lx < bw; lx++) {
            const d = dist[row + lx];
            if (d >= SHOCK_INF) continue; // unreachable — shadowed or past the rim
            const b = ((d - off) / gap) | 0;
            if (b < 1 || b > K) continue; // band 0 hugs the body; no ring there
            // Ring = the band's inner boundary: some 4-neighbour is in a nearer
            // band. floor((nd-off)/gap) < b ⟺ nd < b·gap + off, so no per-neighbour
            // floor — and an SHOCK_INF neighbour can never read as nearer.
            const t = b * gap + off;
            const on =
              (lx > 0 && dist[row + lx - 1] < t) ||
              (lx < bw - 1 && dist[row + lx + 1] < t) ||
              (ly > 0 && dist[row - bw + lx] < t) ||
              (ly < m.bh - 1 && dist[row + bw + lx] < t);
            if (!on) continue;
            const gx = m.x0 + lx;
            const gy = m.y0 + ly;
            // Static positional dither thins the outer rings (fade with distance).
            const fade = K > 1 ? (b - 1) / (K - 1) : 0;
            if (fade > 0.75) {
              if ((gx + gy) % 3) continue;
            } else if (fade > 0.45) {
              if ((gx + gy) & 1) continue;
            }
            out.push(gy * w + gx);
          }
        }
      }
    }
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
        if (!field) continue;
        this.collectWooferTiles(grid, s.bx, s.by, field.tiles);
        this.shocks.push(field);
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

  /**
   * Collect the driver tiles a firing's own Woofer cells sit in, deduplicated, into
   * `out` — what the diaphragm animation is keyed by (see wooferThump).
   *
   * Only cells that are *actually* a `wooferPattern` material count, so the 충격파
   * 브러시 fired over open ground animates nothing, and fired across a cabinet
   * animates exactly the cabinet: a driver swells because it thumped, never because a
   * wave washed over it. (That also means a Woofer standing in someone else's blast
   * stays still, which is right — it was shoved, it didn't fire.)
   *
   * Run once per firing, over the body the pulse already walked. The dedupe is what
   * keeps it honest for a wall-sized cabinet: a thousand cells collapse to the eight
   * or nine tiles they are drawn in.
   */
  private collectWooferTiles(grid: Grid, bx: number[], by: number[], out: number[]): void {
    const cells = grid.cells;
    const w = grid.width;
    const tilesW = Math.ceil(w / WOOFER_P);
    const seen = new Set<number>();
    for (let i = 0; i < bx.length; i++) {
      if (!this.wooferPattern[cells[by[i] * w + bx[i]]]) continue;
      const t = wooferTileIndex(bx[i], by[i], tilesW);
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
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
    // `tiles` is filled by the shockwave drain for a Woofer firing (see
    // drawShockwaves); the magnet rings borrow this builder and leave it empty.
    return { dist, x0, y0, bw, bh, maxR: reach, age: 0, tiles: [] };
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
   * still rasterized in its own silhouette (ball disc / wooden-box, drum, dynamite
   * or flashbang sprite shape) but recolored flat by `heatColor(o.temp)` instead
   * of its normal sprite colors, exactly like an occupied cell is recolored by
   * `temp[i]` — so a body's own heat reservoir (SimBody.temp) reads on the overlay
   * the same way a cell's does.
   *
   * With the thermal camera OFF the same reservoir still shows, but as a WASH over
   * the body's own art rather than instead of it (see thermalTint): frost as it
   * chills, red→orange as it heats. The two are mutually exclusive by construction —
   * a flat thermal recolour already *is* the temperature, so washing it again would
   * say the same thing twice and corrupt the LUT colour while doing it.
   */
  private rasterizeObjects(grid: Grid, heat: boolean): void {
    const buf = this.objBuf32;
    buf.fill(0); // transparent overlay — only object pixels are written below
    const s = OBJECT_SCALE;
    const w = grid.width * s;
    const h = grid.height * s;
    for (const o of grid.objects) {
      const heatColor = heat ? this.heatColor(o.temp) : null;
      const tint = heat ? null : thermalTint(o.temp);
      if (o.kind === 'ball') this.rasterizeBall(buf, w, h, s, o, heatColor, tint);
      else if (o.kind === 'woodbox') this.rasterizeWoodBox(buf, w, h, s, o, heatColor, tint);
      else if (o.kind === 'dynamite') this.rasterizeDynamite(buf, w, h, s, o, heatColor, tint);
      else if (o.kind === 'molotov')
        // Full bottle or spent shell — one silhouette, contents swapped (the flame
        // is real Fire particles at the neck, so it isn't drawn here).
        this.rasterizeSprite(
          buf, w, h, s, o, o.radius, o.halfLength + o.radius,
          MOLOTOV_SPRITES[molotovBottle(o)], MOLOTOV_SPRITE_W, MOLOTOV_SPRITE_H, heatColor, tint,
        );
      else if (o.kind === 'flashbang')
        // Nothing is drawn around it: the can has no fuse and emits nothing until
        // it flashes (see engine/objects.ts stepFlashbang).
        this.rasterizeSprite(
          buf, w, h, s, o, o.radius, o.halfLength + o.radius,
          FLASHBANG_SPRITE, FLASHBANG_SPRITE_W, FLASHBANG_SPRITE_H, heatColor, tint,
        );
      else this.rasterizeDrum(buf, w, h, s, o, heatColor, tint);
    }
  }

  /** Rasterize one rubber ball into the overlay: fill each sub-pixel whose center
   *  (in grid coordinates) falls inside the disc. `w`/`h` are the overlay's
   *  sub-pixel dimensions, `s` the sub-pixels per cell. `heatColor`, when given
   *  (heat overlay on), replaces both the fill and border with one flat color —
   *  the disc reads as a solid thermal blob rather than a rubber ball. `tint`, when
   *  given, is the 온도 오버레이 wash; the ball has only two colours, so it is
   *  applied to both of them once here rather than per sub-pixel. */
  private rasterizeBall(
    buf: Uint32Array,
    w: number,
    h: number,
    s: number,
    o: { x: number; y: number; r: number },
    heatColor: number | null = null,
    tint: ColorWash | null = null,
  ): void {
    const r = o.r;
    const r2 = r * r;
    // Thin outline: sub-pixels whose center falls in the outer ring [rin, r] are
    // drawn dark instead of red. Width is ≥1 sub-pixel so it never vanishes, and
    // scales gently with radius so bigger balls keep a proportionate rim.
    const border = Math.max(1 / s, r * 0.12);
    const rin = r - border;
    const rin2 = rin > 0 ? rin * rin : 0;
    const fillColor = heatColor ?? (tint ? washed(BALL_COLOR, tint) : BALL_COLOR);
    const borderColor =
      heatColor ?? (tint ? washed(BALL_BORDER_COLOR, tint) : BALL_BORDER_COLOR);
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
   * Rasterize one wooden box (the crate or one of its shards). Same rotating
   * sprite pass every capsule body uses — a wooden box IS a capsule body (a
   * degenerate one, `halfLength` 0), so it tumbles and its art tumbles with it.
   * The one thing it can't share is the half-extents: every other body derives
   * its display box from its collision capsule, while a box's sprite is a genuine
   * rectangle that differs per part, so it passes `halfW`/`halfH` explicitly.
   */
  private rasterizeWoodBox(
    buf: Uint32Array,
    w: number,
    h: number,
    s: number,
    o: SimWoodBox,
    heatColor: number | null = null,
    tint: ColorWash | null = null,
  ): void {
    const art = WOOD_BOX_SPRITES[o.part];
    this.rasterizeSprite(
      buf, w, h, s, o, o.halfW, o.halfH, art.pixels, art.w, art.h, heatColor, tint,
    );
  }

  /**
   * Rasterize one capsule body's pixel-art sprite into the overlay, rotated by the
   * body's `angle` and sampled per sub-pixel. For each sub-pixel in the body's
   * bounding box we take its center's vector from the body center (in grid
   * coords), un-rotate it into the sprite's upright frame, map to a sprite pixel,
   * and write that pixel's color (skipping transparent ones). Nearest-neighbor, no
   * anti-aliasing.
   *
   * `halfW`/`halfL` are the display box's half-extents in cells. Every capsule
   * body passes its own capsule box (2·radius wide × 2·(halfLength+radius) tall),
   * so display and collision agree — which is also why each of those sprites is
   * authored at that aspect; the wooden box, whose art is a true rectangle,
   * passes its own. At OBJECT_SCALE = 2 the sprites sample near native resolution.
   *
   * `heatColor`, when given (heat overlay on), replaces every opaque sprite pixel
   * with that one flat color, keeping the body's silhouette (and rotation) but
   * recoloring it by temperature instead of its own art. `tint`, when given, is the
   * 온도 오버레이 instead: every opaque pixel keeps its own colour and is blended
   * toward the wash, so the art survives underneath it. They are never both set
   * (see rasterizeObjects), and the branch is hoisted out of the inner loop — the
   * ordinary body pays one predictable test per pixel and no arithmetic.
   *
   * Every rotating body draws through this one routine — the drum (which picks its
   * sprite by fill), the dynamite (which then adds a procedural fuse nub), the
   * flashbang, the molotov and the wooden box — so a new one needs only its sprite,
   * not another copy of this loop.
   */
  private rasterizeSprite(
    buf: Uint32Array,
    w: number,
    h: number,
    s: number,
    o: { x: number; y: number; angle: number },
    halfW: number,
    halfL: number,
    sprite: Uint32Array,
    spriteW: number,
    spriteH: number,
    heatColor: number | null = null,
    tint: ColorWash | null = null,
  ): void {
    // Bounding box that contains the sprite RECTANGLE at any rotation: the circle
    // through its corners, hypot(halfW, halfL) — not halfL, which would clip the
    // corners of a diagonally-oriented body. Clamped to the overlay.
    const reach = Math.hypot(halfW, halfL);
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
    const sxScale = spriteW / (2 * halfW);
    const syScale = spriteH / (2 * halfL);
    for (let sy = y0; sy < y1; sy++) {
      const wy = (sy + 0.5) / s - o.y; // sub-pixel center, in grid coords
      const row = sy * w;
      for (let sx = x0; sx < x1; sx++) {
        const wx = (sx + 0.5) / s - o.x;
        // Un-rotate into the body's local frame: local-x across width (unit
        // (cos,−sin)), local-y along length (unit (sin,cos)).
        const lx = wx * cos - wy * sin;
        const ly = wx * sin + wy * cos;
        // Local coords → sprite pixel (sprite center at its box center).
        const spx = spriteW * 0.5 + lx * sxScale;
        const spy = spriteH * 0.5 + ly * syScale;
        if (spx < 0 || spx >= spriteW || spy < 0 || spy >= spriteH) continue;
        const color = sprite[(spy | 0) * spriteW + (spx | 0)];
        if (color === 0) continue; // 0 = transparent sprite pixel
        buf[row + sx] = heatColor ?? (tint ? washed(color, tint) : color);
      }
    }
  }

  /** Rasterize one drum — the whole barrel or one of the three shards it bursts
   *  into — through the shared capsule-sprite pass. The sprite its `fill` selects
   *  (the body tint varies by fill; the barrel's shape is shared), or that shard's
   *  own torn outline, tinted the same way. Both draw into the body's `halfW`/
   *  `halfH` display box: for the barrel that IS its capsule box, so nothing
   *  changed there; a shard's is its own art's rectangle. */
  private rasterizeDrum(
    buf: Uint32Array,
    w: number,
    h: number,
    s: number,
    o: SimCapsule,
    heatColor: number | null = null,
    tint: ColorWash | null = null,
  ): void {
    if (o.part !== 'drum') {
      const art = drumPieceSpriteFor(o.fill, o.part);
      this.rasterizeSprite(
        buf, w, h, s, o, o.halfW, o.halfH, art.pixels, art.w, art.h, heatColor, tint,
      );
      return;
    }
    this.rasterizeSprite(
      buf, w, h, s, o, o.halfW, o.halfH,
      drumSpriteFor(o.fill), DRUM_SPRITE_W, DRUM_SPRITE_H, heatColor, tint,
    );
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
   * instead of its normal red-body-plus-dark-fuse look. `tint` (the 온도 오버레이)
   * washes both instead, so a chilled stick frosts over cord and all.
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
    tint: ColorWash | null = null,
  ): void {
    const halfL = o.halfLength + o.radius; // half its long (length) extent, in cells
    // Body: the shared rotate-sample pass with the stick sprite.
    this.rasterizeSprite(
      buf, w, h, s, o, o.radius, halfL, DYN_SPRITE, DYN_SPRITE_W, DYN_SPRITE_H, heatColor, tint,
    );
    // A short dark fuse-cord nub past the top cap, along the stick's (rotated) long
    // axis. angle 0 ⇒ axis (0,1) and the fuse points up (−axis); it rotates with
    // the stick. The flame is real Fire particles the engine spawns at the tip.
    const ax = Math.sin(o.angle);
    const ay = Math.cos(o.angle);
    const capX = o.x - ax * halfL;
    const capY = o.y - ay * halfL;
    const cordColor =
      heatColor ?? (tint ? washed(FUSE_CORD_COLOR, tint) : FUSE_CORD_COLOR);
    this.fillDisc(buf, w, h, s, capX - ax * 0.7, capY - ay * 0.7, 0.55, cordColor);
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

  /**
   * 돋보기 오브젝트 온도: label every free body with its own reservoir temperature
   * (SimBody.temp), small, just off its top-right corner.
   *
   * This exists because the 돋보기 overlay surveys *cells* — it reports what is
   * under the cursor by reading the grid, and an object isn't on the grid, so the
   * one layer whose temperature you can now see (the 온도 오버레이 wash) was also
   * the one layer you couldn't get a number for. The wash answers "is this hot",
   * this answers "how hot", and neither needs the thermal camera on.
   *
   * Anchored to the body's covering circle (`bodyReach`) rather than its sprite
   * box so the label doesn't jitter as a capsule tumbles — the circle is the one
   * extent that doesn't change with orientation. The number is clamped back
   * inside the play area, so a drum shoved against the right wall labels itself
   * inward instead of writing over the page.
   */
  private drawObjectTemps(
    grid: Grid,
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
  ): void {
    const ctx = this.ctx;
    const cw = w / grid.width; // device px per cell
    const ch = h / grid.height;
    const size = Math.max(8, Math.round(OBJECT_TEMP_FONT_PX * scale));
    ctx.save();
    ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    // A dark halo under light text, so the number stays legible over lava, over
    // snow and over the body's own art alike.
    ctx.lineWidth = Math.max(2, Math.round(2 * scale));
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(6, 8, 12, 0.85)';
    ctx.fillStyle = 'rgba(236, 242, 252, 0.96)';
    for (const o of grid.objects) {
      const reach = bodyReach(o);
      const label = `${Math.round(o.temp)}°`;
      let lx = x + (o.x + reach) * cw + OBJECT_TEMP_GAP * scale;
      let ly = y + (o.y - reach) * ch;
      const tw = ctx.measureText(label).width;
      if (lx + tw > x + w) lx = x + w - tw; // shoved off the right edge
      if (lx < x) lx = x;
      if (ly - size < y) ly = y + size; // …or off the top
      ctx.strokeText(label, lx, ly);
      ctx.fillText(label, lx, ly);
    }
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

  /** Toggle the 돋보기 object readout (each body labelled with its temperature). */
  setInspect(on: boolean): void {
    this.inspect = on;
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
