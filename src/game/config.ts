// Global tunables for the simulation. Kept in one place so cell size, tick
// rate, and the dynamic-grid limits are easy to change as the game grows.

/**
 * Rendered size of one cell, in CSS pixels. This is what "fixed cell size"
 * means: a grain reads the same physical size on every screen. The grid
 * resolution is derived from the sandbox rectangle divided by this value, so a
 * larger sandbox holds proportionally more cells (see layout.ts).
 *
 * 2.667px (4px / 1.5) keeps grains crisp and fine, at 1.5× the resolution of
 * the original 4px cell — a fit-to-device sandbox is roughly 720×405 on
 * 1080p, ~146×293 on a 390×780 phone. Smaller = finer/more space.
 */
export const CELL_PX = 4 / 1.5;

/**
 * Upper bound on total cells. The simulation runs on the main thread at
 * TICK_HZ, so an unbounded 4K sandbox would blow the frame budget. When the
 * derived grid would exceed this, the effective cell size is scaled up
 * uniformly (coarser cells, same aspect) to stay under budget.
 *
 * Raised from the original 292.5k (which covered only ~1080p uncapped) to 600k:
 * the old bound coarsened the cells — visibly "zooming in" the sandbox — on any
 * viewport past 1080p, including a 2560×1440 QHD monitor (~518k) and a
 * 2960×1440 tablet whose browser reports devicePixelRatio ≈ 1 (~556k CSS cells).
 * 600k renders all of those at the true fine cell size; only genuinely huge
 * surfaces (4K/5K fullscreen at low dpr, >600k cells) still coarsen to protect
 * the tick. If a device does drop frames at this resolution, the 해상도 slider
 * (CELL_SCALES) coarsens the grid back down without touching this cap.
 */
export const MAX_CELLS = 600_000;

/** Smallest grid dimension, so a tiny drag still leaves a usable sandbox. */
export const MIN_GRID_SIDE = 16;

/** Reference grid the app opens with before the viewport is measured (~16:9). */
export const GRID_W = 360;
export const GRID_H = 203;

/** Fixed simulation update rate (Hz). Rendering runs at display refresh rate.
 *  This is "full speed" — the ×2 option; the default runs at half this (see
 *  SIM_SPEEDS / SIM_SPEED_DEFAULT below and the step interval in Game.ts). */
export const TICK_HZ = 60;

/**
 * User-selectable simulation-speed multipliers, in the order the toolbar shows
 * them. The base rate TICK_HZ is treated as *full* speed (the ×2 step); the
 * default (×1) deliberately runs the whole simulation at half that, giving a
 * calmer pace. The effective step interval is `2000 / (TICK_HZ * mult)` ms, so
 * ×1 → TICK_HZ/2 Hz and ×2 → TICK_HZ Hz. The range now extends both ways:
 * ×0.25/×0.5 slow the world down for watching a reaction unfold, and ×4 runs it
 * at double the original full rate (the loop substeps up to MAX_STEPS_PER_FRAME
 * to keep up on a 60 Hz display). ×1 stays the calm default it always was.
 */
export const SIM_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];
export const SIM_SPEED_DEFAULT: SimSpeed = 1;

/** Simulation ticks per second at the default ×1 sim speed (`2000/(TICK_HZ*1)`
 *  ms per step, inverted) — the single source of truth for "×1 baseline"
 *  cadence, shared by anything that calibrates a real-time rate against it
 *  (dynamite's fuse duration in objects.ts, the 가열/냉각 brush's per-tick rate
 *  in PointerPainter.heatRatePerTick). Keeping one exported constant here means
 *  a future change to the step-interval formula can't leave one of them stale. */
export const SIM_HZ_AT_1X = TICK_HZ / 2;

/**
 * Gravity direction — which way "down" points for every falling/rising material.
 * Movement in SimContext is expressed relative to this vector, so flipping it
 * turns the whole sandbox upside-down (or sideways) without touching a single
 * material rule. Neighbor *reactions* (fire igniting, acid corroding) stay
 * screen-relative — only bulk motion follows gravity, which is the fun part.
 */
export type GravityDir = 'down' | 'up' | 'left' | 'right';
export const GRAVITY_DIRS: readonly GravityDir[] = ['down', 'up', 'left', 'right'];
export const GRAVITY_DIR_DEFAULT: GravityDir = 'down';

/**
 * Gravity strength, 0..1. It scales how often gravity-driven moves are attempted
 * each tick (a per-move probability): `1` is normal full gravity, fractional
 * values give a floaty slow-motion settle (moon gravity), and `0` is weightless
 * — painted material just hangs in the air. Distinct from sim speed: strength
 * only slows *motion*, while reactions and heat keep running at full rate, so
 * "low gravity + normal speed" lets fire race through suspended fuel that never
 * falls. Snapped to GRAVITY_STRENGTH_STEP by the UI slider.
 */
export const GRAVITY_STRENGTH_DEFAULT = 1;
export const GRAVITY_STRENGTH_MIN = 0;
export const GRAVITY_STRENGTH_MAX = 1;
export const GRAVITY_STRENGTH_STEP = 0.1;

/**
 * Cell-size (resolution) multipliers, relative to the base CELL_PX. A larger
 * value means bigger cells → a coarser grid with fewer cells (lighter on the
 * CPU); a smaller value means finer cells → more detail. `1` is the default
 * fixed cell size. The MAX_CELLS budget still caps the finest settings, so a
 * huge screen at ×0.5 is coarsened back down rather than melting the tick.
 * Ordered coarse→fine so a UI slider reads left(low-res)→right(high-res).
 */
export const CELL_SCALES = [2, 1.5, 1, 0.75, 0.5] as const;
export type CellScale = (typeof CELL_SCALES)[number];
export const CELL_SCALE_DEFAULT: CellScale = 1;

/**
 * Grid-overlay line spacing, in cells. `0` is off (no lines). A non-zero value
 * draws a faint reference grid every N cells over the sandbox, so structures can
 * be lined up and the cell scale is legible. Offered as discrete steps the UI
 * exposes as a "coarse ↔ fine" selector.
 */
export const GRID_DIVISIONS = [0, 8, 16, 32, 64] as const;
export type GridDivision = (typeof GRID_DIVISIONS)[number];
export const GRID_DIVISION_DEFAULT: GridDivision = 0;

/** How many recently-used materials the quick-access bar remembers (favorites
 *  are stored separately and unbounded in practice). */
export const RECENT_MATERIALS_MAX = 8;

/** Default brush settings, shared by the store's atom seeds and the
 *  "restore defaults" action so the two can never drift apart. */
export const BRUSH_SIZE_DEFAULT = 3;

/**
 * Bottom dead zone — CSS px of play area reserved at the very bottom of the
 * viewport, below the canvas (and below the mobile control bar). It exists to
 * dodge browser chrome that overlaps the bottom of the visible area on some
 * devices: on Android tablet Chrome the desktop layout's `100vh` canvas is the
 * *large* layout viewport, so its bottom spills behind the address/navigation
 * bar and the lowest slice of the sandbox is cut off (PC has no such bar, so it
 * renders fine). Reserving this many pixels lifts the canvas clear of that
 * chrome. `0` (the default) keeps every existing device pixel-identical; the UI
 * slider lets a user on an affected device dial in just enough clearance. The
 * canvas height subtracts it (see global.css) and the grid re-derives from the
 * shrunken canvas, so nothing is hidden — the reserved band is simply empty.
 */
export const BOTTOM_DEADZONE_DEFAULT = 0;
export const BOTTOM_DEADZONE_MIN = 0;
export const BOTTOM_DEADZONE_MAX = 240;
export const BOTTOM_DEADZONE_STEP = 8;

/**
 * Heat conduction (direct conduction only — no convection or radiation).
 *
 * Every cell carries a temperature on an arbitrary unitless scale where
 * `AMBIENT_TEMP` is the room baseline every cell starts at. Each tick, cells
 * exchange heat with their 4 orthogonal neighbors in proportion to both cells'
 * conductivities — that, and material cells physically moving, are the only
 * ways heat travels. `EMPTY` (air) has zero conductivity, so a blob with no
 * conductive cold sink touching it never loses heat (lava alone stays molten);
 * it only cools when something like water bridges the heat out.
 */
export const AMBIENT_TEMP = 20;

/**
 * Base per-neighbor heat-exchange fraction, scaled by the two cells'
 * conductivities (0..1). Kept at 0.2 so that even four maximally-conductive
 * neighbors exchange < 1.0 of the gap per tick, which keeps the explicit
 * finite-difference diffusion numerically stable (no runaway oscillation).
 * The overall conduction *speed* is tripled not by raising this rate (which
 * would break that stability bound — four cond-1 neighbors at 0.6 would
 * overshoot), but by running the whole diffusion pass HEAT_DIFFUSION_SUBSTEPS
 * times per tick (see below), so each substep stays inside the stable regime.
 */
export const HEAT_DIFFUSION_RATE = 0.2;

/**
 * How much of the temperature difference is exchanged per substep across a 1-cell
 * gap of perfect insulator (e.g., air). This models short-range radiant heat,
 * allowing intense heat to jump a tiny gap and melt solids just above or beside
 * it, preventing unnatural sharp cutoffs when materials shrink or settle.
 */
export const HEAT_RADIANT_RATE = 0.05;

/**
 * How many conduction substeps run per simulation tick. Heat moves ≈ this many
 * times faster globally without touching HEAT_DIFFUSION_RATE, so numerical
 * stability is preserved (each substep is an independent stable diffusion step)
 * while the world reaches thermal equilibrium far quicker — a cold sink pulls
 * heat out, and a hot mass spreads it, three times as fast. 1 = the original
 * single-pass speed.
 */
export const HEAT_DIFFUSION_SUBSTEPS = 3;

/** Conductivity (0..1) for a material that doesn't declare `thermal.conductivity`. */
export const DEFAULT_CONDUCTIVITY = 0.3;

/**
 * Use the Rust/WASM heat-diffusion kernel instead of the JS one when it's
 * available (see engine/heatWasm.ts, wasm/README.md). The WASM path is
 * bit-identical to the JS reference (golden test), loads asynchronously, and
 * auto-falls back to JS if it never loads or isn't supported — so flipping this
 * off, or the module failing to load, only changes speed, never behavior. First
 * "region A" numeric kernel moved off JS (docs/WASM-ENGINE-PORTING.md Phase 2).
 */
export const USE_WASM_HEAT = true;

/**
 * Skip empty regions in the CA material scan via active-tile tracking
 * (engine/dirtyTiles.ts). Phase 0 measured the scan at 80%+ of a populated tick,
 * much of it spent walking inert empty cells; this skips tiles holding only such
 * cells. Bit-identical to the full scan (an empty, un-overlapped cell does no
 * work in updateCell), so toggling it only changes speed, never behavior — the
 * full-scan path stays as the fallback. See docs/PERFORMANCE.md.
 */
export const USE_ACTIVE_TILES = true;

/** Brush radius bounds, in cells (shared by the store, painter, and UI slider/wheel). */
export const BRUSH_MIN = 0;
export const BRUSH_MAX = 12;

/** Max simulation steps per animation frame (prevents spiral-of-death after a stall). */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * Steady-state cadence for auto-saving the world to localStorage (see
 * state/persistence.ts). Saves also fire when the tab is hidden or closed;
 * this interval just bounds how much progress a crash can lose. Encoding is a
 * single pass over the grid (~ms at the cell budget), so every few seconds is
 * imperceptible.
 */
export const WORLD_AUTOSAVE_MS = 3000;

/** In Particle brush mode, fraction of non-solid cells within the brush area that get filled. */
export const PARTICLE_FILL_RATE = 0.55;

/**
 * Special (non-painting) brush tools — see the store's `$tool` and
 * PointerPainter. Instead of placing material, they act on the cells already
 * under the brush: heat/cool nudge each cell's temperature, mix shuffles the
 * non-solid particles.
 */
/** Upper clamp for the heat brush, comfortably above every material's own
 *  temperature (Lava ~1500, Fire ~1000) so superheating still has headroom. */
export const HEAT_BRUSH_MAX = 2000;
/** Lower clamp for the cool brush — a bit below ambient (20), enough to make a
 *  cold sink that pulls heat out of neighbors without a runaway to absolute cold. */
export const HEAT_BRUSH_MIN = -50;

/**
 * How the 가열/냉각 brush's sensitivity dial (`$heatRateMode`) is interpreted.
 * 'absolute' raises/lowers temperature by a fixed number of degrees; 'relative'
 * scales by a percentage of the current temperature instead (so a hotter cell
 * heats/cools faster in absolute terms — compounding growth rather than a flat
 * add). Both are specified as a rate *at sim speed ×1, sustained for 1 second*
 * (see PointerPainter.heatRatePerTick/heatRateOneShot for how that's turned
 * into an actual per-tick or one-shot delta).
 */
export type HeatRateMode = 'absolute' | 'relative';
export const HEAT_RATE_MODE_DEFAULT: HeatRateMode = 'absolute';

/** Absolute-mode heat/cool rate: degrees per second at sim speed ×1. Default
 *  (360) reproduces the original fixed-delta brush feel (12°/stamp × 30
 *  stamps/sec at ×1). Bounds sit on the UI slider's step (10) grid, like the
 *  relative-mode bounds below. */
export const HEAT_ABS_RATE_DEFAULT = 360;
export const HEAT_ABS_RATE_MIN = 10;
export const HEAT_ABS_RATE_MAX = 2000;
export const HEAT_ABS_RATE_STEP = 10;

/** Relative-mode heat/cool rate: percent of the current temperature's
 *  *magnitude* per second at sim speed ×1 (see PointerPainter/brushTools —
 *  direction always follows heat vs cool, never the sign of the current
 *  temperature, so a below-ambient cell still heats up and not down). Bounds
 *  are chosen so the UI slider's step (5) divides evenly into the range and
 *  the default sits on that grid (0, 5, 10, … 300) — HEAT_REL_RATE_STEP. */
export const HEAT_REL_RATE_DEFAULT = 50;
export const HEAT_REL_RATE_MIN = 0;
export const HEAT_REL_RATE_MAX = 300;
export const HEAT_REL_RATE_STEP = 5;

/**
 * Sentinel for the "auto" overwrite rule. When `$overwriteLevel` is this value,
 * the brush derives its effective level from the *selected material's* phase:
 * wall → 전체, solid → 고체까지 (wall 제외), powder → 가루까지, liquid → 액체+기체,
 * gas → 기체만. See `effectiveOverwriteLevel` (PointerPainter). Slotted below
 * `OVERWRITE_LEVEL_MIN` so it reads as "one notch looser than level 0" in the UI
 * while still being representable in a single signed number.
 */
export const OVERWRITE_AUTO = -1;

/**
 * Progressive brush overwrite levels, from most conservative to most permissive.
 * Each level also allows everything the previous levels allow (Empty cells are
 * always paintable regardless of level). The UI prepends an '자동' option (index
 * `OVERWRITE_AUTO` = -1) that derives the level from the selected material; the
 * numeric levels below start at 0.
 */
export const OVERWRITE_LEVELS = [
  '덮어쓰기 없음',
  '기체만',
  '기체+액체',
  '기체+가루+액체',
  '기체+가루+액체+고체',
  '전체 (Wall 포함)',
] as const;
export const OVERWRITE_LEVEL_MIN = 0;
export const OVERWRITE_LEVEL_MAX = OVERWRITE_LEVELS.length - 1;

/**
 * Density-sorted displacement tunables (SimContext.tryMove).
 *
 * When a denser cell sinks through a lighter fluid (or a bubble rises through
 * a denser one), the move first passes a drag gate with probability
 * `min(1, BASE + |density gap| * SCALE)` — a wider gap displaces more readily,
 * a narrow one resists, so sinking through a fluid is visibly slower than free
 * fall. Set DISPLACE_DRAG_BASE to 1 to disable drag entirely (always passes,
 * no RNG cost). Feel at the defaults: Sand(5)→Water(3) sinks at p=0.5/tick;
 * a gas bubble(1) rises through Water(3) at p=0.5 (on top of the gas stall).
 */
export const DISPLACE_DRAG_BASE = 0.3;
export const DISPLACE_DRAG_SCALE = 0.1;

/**
 * Master switch for the push-aside step: before a displacement swap, the
 * displaced fluid tries to flow into an empty cell beside itself or beside the
 * intruder, so it wells up *around* a sinking particle instead of teleporting
 * to the far side of it. false = legacy instant position swap.
 */
export const DISPLACE_SIDE_PUSH = true;

/**
 * 겹침 (overlap) tunables — the second per-cell fluid slot (see Grid.overlay /
 * SimContext). ABSORB: chance that a dry powder grain sinking into a liquid
 * swallows the liquid into its overlap slot instead of shoving it aside — the
 * "some overlap, some don't" split that keeps sand poured into water from
 * raising the level by the sand's full volume. SOAK: per-tick chance that a
 * liquid with nowhere left to flow seeps into the powder bed below it, so a
 * standing pool sinks into sand gradually rather than getting sucked in
 * instantly. 0 disables either mechanism.
 */
export const OVERLAP_ABSORB_CHANCE = 0.5;
export const OVERLAP_SOAK_CHANCE = 0.35;

/**
 * 액체 겹침 계수 (liquid-overlap coefficient) for a Powder that doesn't set its
 * own `liquidOverlap` (Material) — the fraction of grains that may host a 겹침
 * overlap liquid, the rest blocking it (see SimContext.canOverlapAt). Below 1
 * so a powder bed is partly permeable: poured into water the blocked grains
 * displace it (the level rises) and drag on it a little, while the hosting
 * grains still drain water on down through the bed. 1 would restore the old
 * "every grain soaks, water passes straight through" behavior; 0 makes the bed
 * an impermeable solid to liquids. 0.6 leaves a clear majority draining while a
 * visible minority blocks.
 */
export const POWDER_LIQUID_OVERLAP_DEFAULT = 0.6;

/**
 * Smoke output level for reactions (combustion/explosion/etc.), a three-step
 * control replacing the old on/off toggle. `high` is the original "smoke on"
 * level (reactions emit exactly as much Smoke as they always did); `off`
 * suppresses reaction Smoke entirely; `medium` (the default) keeps only a
 * `SMOKE_MEDIUM_KEEP` fraction of it, so the world stays legible without being
 * choked with haze. The seam that thins Smoke lives in SimContext (set/spawn),
 * so this one knob governs every Smoke-emitting reaction at once. Manual Smoke
 * painting bypasses that seam, so it's unaffected.
 */
export type SmokeLevel = 'high' | 'medium' | 'off';
/** Selectable smoke levels, in the order the toolbar shows them. */
export const SMOKE_LEVELS: readonly SmokeLevel[] = ['high', 'medium', 'off'];
export const SMOKE_LEVEL_DEFAULT: SmokeLevel = 'medium';
/** Fraction of reaction Smoke retained at the `medium` level (high = 1, off = 0). */
export const SMOKE_MEDIUM_KEEP = 0.35;
/**
 * Per-burnout chance ordinary Fire leaves a wisp of Smoke (before the smoke-level
 * seam thins it). Shared with Blue Flame: at the `high` smoke level Blue Flame —
 * normally a clean torch — leaves Smoke at Fire's `medium`-level net rate
 * (FIRE_SMOKE_CHANCE × SMOKE_MEDIUM_KEEP), and none at `medium`/`off`.
 */
export const FIRE_SMOKE_CHANCE = 0.3;

/**
 * Blend brush (혼합) — paints a stochastic mixture of up to `BLEND_MAX_SLOTS`
 * materials, each weighted by a ratio the user sets. Ratios are whole multiples
 * of `BLEND_RATIO_STEP` percent and sum to 100 (see the store's `$blendBrush`
 * and PointerPainter.paintBlend). The editor snaps every drag to this step.
 */
export const BLEND_MAX_SLOTS = 3;
export const BLEND_RATIO_STEP = 5;
