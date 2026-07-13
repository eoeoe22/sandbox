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
 * uniformly (coarser cells, same aspect) to stay under budget. Sized so a
 * full 1080p viewport (~292k cells at the 1.5×-resolution cell size) renders
 * at the true cell size uncapped; only larger screens (QHD/4K fullscreen) get
 * coarsened to protect the tick.
 */
export const MAX_CELLS = 292_500;

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
/** Temperature change applied per stamp by the heat (+) / cool (−) brush. Held
 *  presses re-stamp every frame (see PointerPainter.update), so this accumulates
 *  — sized so a brief hold noticeably warms/cools without instantly saturating. */
export const HEAT_BRUSH_DELTA = 12;
/** Upper clamp for the heat brush, comfortably above every material's own
 *  temperature (Lava ~1500, Fire ~1000) so superheating still has headroom. */
export const HEAT_BRUSH_MAX = 2000;
/** Lower clamp for the cool brush — a bit below ambient (20), enough to make a
 *  cold sink that pulls heat out of neighbors without a runaway to absolute cold. */
export const HEAT_BRUSH_MIN = -50;

/**
 * Progressive brush overwrite levels, from most conservative to most permissive.
 * Each level also allows everything the previous levels allow (Empty cells are
 * always paintable regardless of level).
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

// ---------------------------------------------------------------------------
// 오브젝트 레이어 (독립 오브젝트 — src/game/objects/)
// ---------------------------------------------------------------------------
// 셀 그리드와 분리된 원/캡슐 오브젝트의 물리 상수. 전부 "재미 우선" 튜닝 노브로,
// 단위는 셀/틱 계열 (기본 틱 30Hz 기준으로 감을 잡았다).

/** 동시에 존재할 수 있는 오브젝트 수 상한. 적분/충돌에 O(n²) 쌍 검사가 있으니
 *  퍼포먼스 가드이자 세이브 봉투 크기의 상한이기도 하다. */
export const OBJECT_MAX = 40;

/** 오브젝트 중력 가속(셀/틱²). 셀 CA의 확률적 낙하와 달리 연속 적분이라 별도
 *  상수를 쓴다 — 부력 계수(1 − 주변밀도/자기밀도)와 gravityStrength가 곱해진다. */
export const OBJECT_GRAVITY = 0.05;

/** 속도 상한(셀/틱). 서브스텝(OBJECT_SUBSTEP)과 함께 터널링을 막는 1차 방어선.
 *  2.0 = 서브스텝 4개(OBJECT_SUBSTEP_MAX × OBJECT_SUBSTEP)가 정확히 감당하는
 *  최대치 — 이보다 올리려면 서브스텝 예산도 함께 올려야 한다. */
export const OBJECT_MAX_SPEED = 2.0;

/** 서브스텝 하나가 감당하는 최대 이동량(셀). 한 틱을 속도/이 값 만큼 쪼개
 *  적분+충돌하므로 1셀 두께 벽을 뚫고 지나가지 못한다. */
export const OBJECT_SUBSTEP = 0.5;

/** 한 틱에 허용하는 서브스텝 수 상한 (속도 상한과 함께 비용을 캡). */
export const OBJECT_SUBSTEP_MAX = 4;

/** 빈 칸(공기)이 부력 샘플에서 갖는 가상 밀도. 물질 밀도 스케일(물=3)과 같은
 *  축 — 이보다 가벼운 오브젝트(헬륨 풍선)는 공기 중에서도 떠오른다. */
export const OBJECT_AIR_DENSITY = 0.4;

/** 액체 속 부력 증폭 계수 (잠긴 비율로 스케일; 공기 중 1). 평형점(중립 부력
 *  밀도)은 그대로 두고 복원력만 키운다 — 물(3)과 밀도 차가 몇 %인 드럼통이
 *  현실 시간으로 몇십 초씩 굼뜨게 떠오르는 대신, 눈에 보이는 속도로 떠오르고
 *  가라앉고 출렁이게 하는 "재미 우선" 노브다. */
export const OBJECT_BUOY_GAIN = 4;

/** 항상 걸리는 기본 공기 저항(틱당 속도 감쇠 비율). 상승/낙하에 종단속도를
 *  만들어 풍선이 무한 가속하지 않게 한다. 종단속도 ≈ 중력가속/이 값이 속도
 *  상한(OBJECT_MAX_SPEED)을 웃돌도록 낮게 — 긴 낙하가 시시해지지 않게 한다. */
export const OBJECT_AIR_DRAG = 0.008;

/** 고체 충돌 반사에서 접선 속도 성분이 유지되는 비율 (구름/미끄러짐 마찰). */
export const OBJECT_FRICTION = 0.9;

/** 고체와 충돌한 틱에 이 속도 미만으로 느려졌으면 정지 처리 — 바닥 미세 떨림
 *  제거. (충돌 틱에만 적용하므로 물에 뜬 오브젝트의 부력 흔들림은 그대로.) */
export const OBJECT_REST_EPSILON = 0.04;

/** 발자국 액체 변위(제한적 양방향)에서 빈 칸을 찾아 걷는 최대 거리(셀). */
export const OBJECT_DISPLACE_SEARCH_R = 4;

/** 이 속도 이상으로 액체에 진입하면 스플래시 — 변위된 액체 셀 일부가 수면 위로
 *  재배치된다 (새 스폰이 아니라 재배치라 질량이 보존된다). */
export const OBJECT_SPLASH_SPEED = 0.5;

/** 한 번의 입수 스플래시가 수면 위로 던지는 액체 셀 수 상한. */
export const OBJECT_SPLASH_MAX_DROPLETS = 6;
