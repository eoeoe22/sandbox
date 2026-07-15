import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import {
  $selectedMaterial,
  $brushSize,
  $brushShape,
  $brushMode,
  $overwriteLevel,
  $tool,
  $lastTool,
  $blendBrush,
  $inspect,
  $inspectData,
  $selectedObject,
  $heatMode,
  $heatRate,
  $heatPercent,
  $simSpeed,
  type Tool,
} from '../../state/store';
import {
  BRUSH_MIN,
  BRUSH_MAX,
  PARTICLE_FILL_RATE,
  HEAT_BRUSH_MAX,
  HEAT_BRUSH_MIN,
  AMBIENT_TEMP,
  OVERWRITE_AUTO,
  OVERWRITE_LEVEL_MAX,
  TICK_HZ,
} from '../config';
import { createFloatingOverlay } from './floatingOverlay';
import { getMaterial } from '../materials';
import { Phase } from '../engine/types';
import { heatCells, heatCellsPercent, mixCells, inspectCells } from '../engine/brushTools';
import type { InspectStats } from '../engine/brushTools';
import { CONVEYOR, CONVEYOR_LEFT, CONVEYOR_RIGHT } from '../materials/conveyor';
import {
  createRubberBall,
  createDrum,
  createDynamite,
  pickBody,
  distanceToBody,
  RUBBER_BALL_SPAWN_SCATTER,
} from '../engine/objects';
import type { SimBody, DrumFill } from '../engine/objects';

/**
 * Ordering of phases from "easiest to overwrite" to "hardest", used by the
 * brush overwrite gate. Wall is a tag on top of Phase.Solid rather than its
 * own phase, so it's checked separately and always sits at the top.
 */
const OVERWRITE_PHASE_ORDER = [Phase.Gas, Phase.Liquid, Phase.Powder, Phase.Solid];

/** Max release speed (cells/tick) when flinging a dragged object, so a fast flick
 *  can't launch it across the world in one tick. */
const DRAG_THROW_MAX = 8;

/** Mix (섞기) brush shove on a free object under it: a random jostle with a slight
 *  outward bias so the stir pushes bodies out of the stirred pocket (밀려나게).
 *  Applied per stamp, but only while the body is below MIX_MAX_SPEED, so held or
 *  repeated stamps jostle it lively without the velocity piling up unbounded. */
const MIX_PUSH_SPEED = 1.1;
const MIX_SPIN = 0.15;
const MIX_MAX_SPEED = 4;

/**
 * Whether the brush may paint over whatever currently occupies (x, y), given
 * the current overwrite level. Empty cells are always paintable. Level 0
 * means "never overwrite anything non-empty"; each level above that allows
 * one more phase, in `OVERWRITE_PHASE_ORDER`, with Wall gated behind the max
 * level regardless of its (Solid) phase.
 */
function canOverwrite(existingId: number, level: number): boolean {
  if (existingId === 0) return true;
  const existing = getMaterial(existingId);
  if (existing.isWall) return level >= OVERWRITE_PHASE_ORDER.length + 1;
  const rank = OVERWRITE_PHASE_ORDER.indexOf(existing.phase);
  if (rank === -1) return true; // Empty-phase materials, if any: always paintable
  return level >= rank + 1;
}

/**
 * Resolve the "자동" overwrite rule into a concrete numeric level based on the
 * *selected* material's phase, mirroring the user-facing spec:
 *   • Wall         → 전체 (level MAX, Wall 포함)
 *   • Solid        → 고체까지 (level 4, Wall 제외)
 *   • Powder       → 가루까지 (level 3)
 *   • Liquid       → 액체·기체  (level 2)
 *   • Gas          → 기체만    (level 1)
 * A non-auto level (`>= 0`) is passed through unchanged.
 */
function effectiveOverwriteLevel(level: number, selectedId: number): number {
  if (level !== OVERWRITE_AUTO) return level;
  const m = getMaterial(selectedId);
  if (m.isWall) return OVERWRITE_LEVEL_MAX;
  // OVERWRITE_PHASE_ORDER = [Gas, Liquid, Powder, Solid], so phase rank + 1 is
  // exactly the per-phase level (Gas → 1, Liquid → 2, Powder → 3, Solid → 4).
  const rank = OVERWRITE_PHASE_ORDER.indexOf(m.phase);
  return rank === -1 ? OVERWRITE_LEVEL_MAX : rank + 1;
}

/**
 * Translates pointer (mouse/touch/pen) input into grid painting. Reads the
 * selected material, brush size, and brush shape from the shared store,
 * interpolates a line between move events (so fast drags don't leave gaps),
 * and stamps a circular or square brush at each point.
 *
 * Beyond painting the selected material, the active `$tool` selects alternate
 * brushes: `erase` clears cells (the same path as a right-button drag), `blend`
 * stamps a per-cell stochastic mix of `$blendBrush`'s materials, and the
 * heat/cool/mix special brushes act on the cells already under the footprint
 * rather than placing new material.
 *
 * Also owns two pieces of pointer-adjacent UX: a brush-size cursor outline
 * that follows the pointer, and mouse-wheel resizing of the brush.
 */
/** Whether two inspect surveys are identical, so refreshInspect() can skip
 *  re-publishing (and re-rendering the panel) when nothing under the cursor
 *  changed. Compares the scalar tallies and each breakdown entry's id+count;
 *  entries are always sorted the same way (see inspectCells), so positional
 *  comparison is sound. */
function sameInspect(a: InspectStats | null, b: InspectStats): boolean {
  if (a === null) return false;
  if (
    a.occupied !== b.occupied ||
    a.overlapped !== b.overlapped ||
    a.footprint !== b.footprint ||
    a.avgTemp !== b.avgTemp ||
    a.entries.length !== b.entries.length
  ) {
    return false;
  }
  for (let i = 0; i < a.entries.length; i++) {
    if (a.entries[i].id !== b.entries[i].id || a.entries[i].count !== b.entries[i].count) {
      return false;
    }
  }
  return true;
}

export class PointerPainter {
  private down = false;
  /** Whether the active press is erasing: the secondary (right) button always
   *  erases, regardless of the selected material or active tool. Latched at
   *  pointerdown so it persists through moves and per-frame re-stamps. */
  private erasing = false;
  /** Horizontal direction of the current brush drag (+1 right / −1 left), so a
   *  Conveyor is placed running whichever way the stroke moved (좌우 정렬). Kept
   *  between events; a pure click (no drag) uses the last direction, defaulting
   *  right. */
  private beltDirX = 1;
  private px = 0;
  private py = 0;
  /** The object currently being dragged in 보기(view) mode, or null. While set,
   *  pointer moves reposition it instead of painting, and its own physics are
   *  suspended (body.held) so it tracks the cursor. */
  private dragBody: SimBody | null = null;
  /** Offset from the grabbed body's center to the grab point (grid cells), so the
   *  body doesn't snap its center to the cursor on grab. */
  private dragOffX = 0;
  private dragOffY = 0;
  /** Smoothed per-move delta of the grabbed body — its release velocity, so you
   *  can fling an object by flicking on release. */
  private dragVX = 0;
  private dragVY = 0;

  /** 영역 (rect) marquee state. `rectDragging` is true while the pointer is
   *  held down defining a rectangle; `rectPending` is true after release on
   *  non-touch pointers, while the selection waits for Enter to confirm.
   *  Touch pointers confirm immediately on release (no pending state). */
  private rectDragging = false;
  private rectPending = false;
  /** Whether the current marquee will erase (right-drag) instead of fill. */
  private rectErase = false;
  /** Which non-rect tool the marquee will apply on confirm. Snapped from
   *  `$lastTool` at pointerdown so changing the (hidden) tool mid-drag can't
   *  swap the marquee's effect under the user. Erase (right-drag) overrides it. */
  private rectTool: Tool = 'material';
  /** Marquee corners in grid-cell coordinates (start = pointerdown, end = last
   *  move). The rectangle is the axis-aligned bounding box of the two. */
  private rectSX = 0;
  private rectSY = 0;
  private rectEX = 0;
  private rectEY = 0;
  private cursorEl: HTMLDivElement;
  /** The rectangular marquee overlay (Photoshop-style 영역 선택). Hidden unless
   *  the rect tool is actively dragging or holding a pending selection. */
  private rectEl: HTMLDivElement;

  constructor(
    private canvas: HTMLCanvasElement,
    private grid: Grid,
    private layout: SandboxLayout,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    // A gesture can end without a pointerup (browser/OS takes it over for
    // scrolling, palm rejection, lost capture); without this, `down` would
    // stay stuck true and the per-frame `update()` would paint forever.
    window.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerenter', this.onEnter);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.cursorEl = createFloatingOverlay('brush-cursor');
    this.cursorEl.style.display = 'none';

    this.rectEl = createFloatingOverlay('rect-select');
    this.rectEl.style.display = 'none';

    // Brush size/shape/tool can change from the control panel while the pointer
    // sits still over the canvas; keep the cursor (size, shape, tool tint) in
    // sync either way.
    $brushSize.listen(() => this.updateCursor(this.lastClientX, this.lastClientY));
    $brushShape.listen(() => this.updateCursor(this.lastClientX, this.lastClientY));
    $tool.listen(() => {
      this.updateCursor(this.lastClientX, this.lastClientY);
      // Leaving the rect tool cancels any pending marquee — the selection is
      // only meaningful while the tool is active.
      this.cancelRect();
    });
    // Toggling the 돋보기 inspect overlay: retint the cursor and either populate
    // the readout right away (from where the pointer already rests) or clear it.
    $inspect.listen(() => {
      this.updateCursor(this.lastClientX, this.lastClientY);
      this.refreshInspect();
    });
    // A larger/smaller brush surveys a different footprint; re-read under the
    // stationary pointer so the readout tracks the size change immediately.
    $brushSize.listen(() => this.refreshInspect());
    $brushShape.listen(() => this.refreshInspect());

    // 영역 (rect) tool: Enter confirms a pending marquee, Escape cancels it.
    // Bound on window so it works regardless of focus (the canvas isn't a
    // keyboard element).
    window.addEventListener('keydown', this.onKey);
  }

  private lastClientX = 0;
  private lastClientY = 0;
  private hovering = false;
  /** Last inspect survey published to the store, kept so refreshInspect() can
   *  skip a redundant `$inspectData.set` (and the Svelte re-render it triggers)
   *  when the cells under a still cursor haven't changed — e.g. paused with the
   *  overlay on, where the frame loop would otherwise re-publish 60×/s. */
  private lastInspect: InspectStats | null = null;

  private toCell(e: PointerEvent): [number, number] {
    return this.clientToCell(e.clientX, e.clientY);
  }

  /** Map a client (screen) point to a grid cell, using the same sandbox rect the
   *  renderer draws into (CSS px) so pointer coords land on the right cell. Points
   *  outside the sandbox map out of bounds and get filtered by stamp/inspect. */
  private clientToCell(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const rect = this.layout.cssRect();
    const localX = clientX - r.left - rect.x;
    const localY = clientY - r.top - rect.y;
    const gx = Math.floor((localX / rect.width) * this.grid.width);
    const gy = Math.floor((localY / rect.height) * this.grid.height);
    return [gx, gy];
  }

  /** Like clientToCell but keeps sub-cell precision — the object layer lives in
   *  float grid coordinates, so picking/dragging needs the continuous position. */
  private clientToGridFloat(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const rect = this.layout.cssRect();
    const gx = ((clientX - r.left - rect.x) / rect.width) * this.grid.width;
    const gy = ((clientY - r.top - rect.y) / rect.height) * this.grid.height;
    return [gx, gy];
  }

  /** Remove any free object the eraser brush touches. The brush is a disc of
   *  radius `brushSize` centered on the cell; an object is deleted when that disc
   *  reaches its surface. Shared by the right-button erase and the 지우개 tool
   *  (both go through paint(erase)). */
  private eraseObjectsUnderBrush(cx: number, cy: number): void {
    const objs = this.grid.objects;
    if (objs.length === 0) return;
    const rad = $brushSize.get();
    const bx = cx + 0.5;
    const by = cy + 0.5;
    let w = 0;
    for (let i = 0; i < objs.length; i++) {
      // Keep objects the brush doesn't reach; drop the rest (deleted, no trace).
      if (distanceToBody(objs[i], bx, by) > rad) objs[w++] = objs[i];
    }
    objs.length = w;
    // If the erased object was the one being dragged, end the drag cleanly.
    if (this.dragBody && distanceToBody(this.dragBody, bx, by) <= rad) this.dragBody = null;
  }

  /** Apply the 가열/냉각 brush to any free object under it: nudge the body's own
   *  heat reservoir (SimBody.temp) by `delta`, clamped to the same range as the
   *  cell heat brush. This is how heat/cool reaches an object — especially one
   *  floating over empty air, which the cell heat brush (zero-conductivity air)
   *  can't warm — letting the brush melt a drum or burn a ball. */
  private heatObjectsUnderBrush(cx: number, cy: number, delta: number): void {
    const objs = this.grid.objects;
    if (objs.length === 0) return;
    const rad = $brushSize.get();
    const bx = cx + 0.5;
    const by = cy + 0.5;
    for (const o of objs) {
      if (o.held) continue; // a dragged body is shielded; don't cook it
      if (distanceToBody(o, bx, by) > rad) continue;
      const t = o.temp + delta;
      o.temp = t < HEAT_BRUSH_MIN ? HEAT_BRUSH_MIN : t > HEAT_BRUSH_MAX ? HEAT_BRUSH_MAX : t;
    }
  }

  /** Percent-mode counterpart for free objects: nudge each body's temp by
   *  `fraction` of its current temp, same clamp. Mirrors heatCellsPercent for
   *  the object layer so the chosen mode applies consistently to bodies too. */
  private heatObjectsUnderBrushPercent(cx: number, cy: number, fraction: number): void {
    const objs = this.grid.objects;
    if (objs.length === 0) return;
    const rad = $brushSize.get();
    const bx = cx + 0.5;
    const by = cy + 0.5;
    for (const o of objs) {
      if (o.held) continue;
      if (distanceToBody(o, bx, by) > rad) continue;
      const t = o.temp * (1 + fraction);
      o.temp = t < HEAT_BRUSH_MIN ? HEAT_BRUSH_MIN : t > HEAT_BRUSH_MAX ? HEAT_BRUSH_MAX : t;
    }
  }

  /** How many brush stamps land per wall-clock second. The held brush re-stamps
   *  once per simulation tick (Game.ts), and the tick rate is TICK_HZ × simSpeed
   *  / 2 (see Game.ts stepMs). Used to convert the user's per-second heat rate
   *  into a per-stamp delta/fraction so heating stays consistent across sim
   *  speeds and display refresh rates. */
  private static stampsPerSecond(): number {
    return (TICK_HZ * $simSpeed.get()) / 2;
  }

  /** Apply the heat/cool brush's per-stamp effect to the cells and objects under
   *  (cx,cy), respecting the current heat mode and rate. `sign` is +1 for heat,
   *  −1 for cool. */
  private stampHeat(cx: number, cy: number, sign: number): void {
    const cells = this.brushCells(cx, cy);
    const sps = PointerPainter.stampsPerSecond() || 1;
    if ($heatMode.get() === 'percent') {
      const fraction = (sign * $heatPercent.get()) / 100 / sps;
      heatCellsPercent(this.grid, cells, fraction, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
      this.heatObjectsUnderBrushPercent(cx, cy, fraction);
    } else {
      const delta = (sign * $heatRate.get()) / sps;
      heatCells(this.grid, cells, delta, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
      this.heatObjectsUnderBrush(cx, cy, delta);
    }
  }

  /** Shove any free object under the 섞기 brush — a random jostle with a slight
   *  outward push, so stirring scatters/ejects bodies the way it disperses cells.
   *  Drums also get a random spin. Skips a held body (the drag owns it) and any
   *  body already moving fast, so repeated stamps don't accumulate to a rocket. */
  private mixPushObjectsUnderBrush(cx: number, cy: number): void {
    const objs = this.grid.objects;
    if (objs.length === 0) return;
    const rad = $brushSize.get();
    const bx = cx + 0.5;
    const by = cy + 0.5;
    for (const o of objs) {
      if (o.held) continue;
      if (distanceToBody(o, bx, by) > rad) continue;
      if (Math.hypot(o.vx, o.vy) >= MIX_MAX_SPEED) continue; // already lively — don't pile on
      const dx = o.x - bx;
      const dy = o.y - by;
      const d = Math.hypot(dx, dy) || 1; // outward from the stir center (center hit → pure random)
      o.vx += (dx / d) * MIX_PUSH_SPEED * 0.5 + (Math.random() * 2 - 1) * MIX_PUSH_SPEED;
      o.vy += (dy / d) * MIX_PUSH_SPEED * 0.5 + (Math.random() * 2 - 1) * MIX_PUSH_SPEED;
      // Any capsule body (drum or dynamite) also gets a random spin; a ball doesn't rotate.
      if (o.kind !== 'ball') o.angularVelocity += (Math.random() * 2 - 1) * MIX_SPIN;
    }
  }

  /** Reposition the dragged body to follow the pointer (keeping the grab offset),
   *  clamped inside the sandbox, and track a smoothed release velocity so letting
   *  go flings it. Called from onMove while a drag is active. */
  private dragTo(clientX: number, clientY: number): void {
    const body = this.dragBody;
    if (!body) return;
    const [gx, gy] = this.clientToGridFloat(clientX, clientY);
    const nx = gx + this.dragOffX;
    const ny = gy + this.dragOffY;
    // Smooth the per-move delta into the throw velocity (cells/tick on release).
    this.dragVX = this.dragVX * 0.4 + (nx - body.x) * 0.6;
    this.dragVY = this.dragVY * 0.4 + (ny - body.y) * 0.6;
    // Clamp the center to the grid so an object can't be dragged off-world.
    body.x = nx < 0.5 ? 0.5 : nx > this.grid.width - 0.5 ? this.grid.width - 0.5 : nx;
    body.y = ny < 0.5 ? 0.5 : ny > this.grid.height - 0.5 ? this.grid.height - 0.5 : ny;
    body.vx = 0;
    body.vy = 0;
  }

  /** Apply the active brush at (cx,cy). A right-button press always erases; a
   *  normal press paints the selected material, or — for a special brush —
   *  heats/cools or mixes the cells already there. */
  private stamp(cx: number, cy: number): void {
    if (this.erasing) return this.paint(cx, cy, true);
    switch ($tool.get()) {
      case 'heat':
        return this.stampHeat(cx, cy, 1);
      case 'cool':
        return this.stampHeat(cx, cy, -1);
      case 'mix':
        mixCells(this.grid, this.brushCells(cx, cy));
        return this.mixPushObjectsUnderBrush(cx, cy);
      case 'erase':
        return this.paint(cx, cy, true);
      case 'blend':
        return this.paintBlend(cx, cy);
      case 'object':
        // Objects are placed once per press in onDown, not stamped continuously
        // (a held/dragged brush must not spew a stream of balls).
        return;
      case 'view':
        // 보기: an inert brush — a left press places nothing so you can move over
        // the world without disturbing it. (A right-button press is caught above
        // as erasing, so the eraser still works.)
        return;
    }
    this.paint(cx, cy);
  }

  /** Spawn the selected free object centered on the clicked cell. A ball's radius
   *  follows the brush size (min 2 so it's never a single pixel); a drum uses its
   *  own medium capsule size (its sprite dictates the aspect). The 독립 오브젝트
   *  layer lives beside the grid, so this just appends to grid.objects — no cells
   *  written. */
  private spawnObject(cx: number, cy: number): void {
    if (!this.grid.inBounds(cx, cy)) return;
    // Don't drop an object whose center lands inside solid terrain (walls/solids)
    // — it would spawn embedded. A click on open ground/fluid/powder is fine.
    const hit = this.grid.get(cx, cy);
    if (hit !== 0) {
      const m = getMaterial(hit);
      if (m.isWall || m.phase === Phase.Solid) return;
    }
    const kind = $selectedObject.get();
    if (kind === 'drum' || kind === 'oildrum' || kind === 'aciddrum') {
      // All three drums share one capsule; only the fill (spill contents + tint)
      // differs. 빈 드럼통 → empty, 원유 드럼통 → oil, 산 드럼통 → acid.
      const fill: DrumFill = kind === 'oildrum' ? 'oil' : kind === 'aciddrum' ? 'acid' : 'empty';
      this.grid.objects.push(createDrum(cx + 0.5, cy + 0.5, fill));
    } else if (kind === 'dynamite') {
      // 다이너마이트: dropped with its fuse already lit — a live countdown to the blast.
      this.grid.objects.push(createDynamite(cx + 0.5, cy + 0.5));
    } else {
      const r = Math.max(2, $brushSize.get());
      // Nudge each spawn a random sliver left/right (수직 쌓임 방지): clicking
      // repeatedly at one spot otherwise drops every ball on the same column with
      // no velocity, balancing them into a straight tower. Off-centre, a new ball
      // lands on the shoulder of the pile below and rolls off to spread into a
      // heap. See RUBBER_BALL_SPAWN_SCATTER for why this is a position offset
      // rather than a starting velocity.
      const jitter = (Math.random() * 2 - 1) * RUBBER_BALL_SPAWN_SCATTER * r;
      this.grid.objects.push(createRubberBall(cx + 0.5 + jitter, cy + 0.5, r));
    }
  }

  /** The in-bounds cells the brush covers at (cx,cy), packed flat as
   *  [x0,y0,x1,y1,...], masked to the same circle/square the cursor outline
   *  shows. The special brushes (heat/cool/mix) operate over this footprint;
   *  paint() keeps its own loop because it also applies the particle-fill and
   *  overwrite gates per cell. */
  private brushCells(cx: number, cy: number): number[] {
    const rad = $brushSize.get();
    const shape = $brushShape.get();
    const r2 = rad * rad;
    const out: number[] = [];
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (shape === 'circle' && dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.grid.inBounds(x, y)) continue;
        out.push(x, y);
      }
    }
    return out;
  }

  /** Paint the selected material over the brush footprint. When `erase` is set
   *  (right-button press), Empty is stamped instead, ignoring the material and
   *  active tool entirely. */
  private paint(cx: number, cy: number, erase = false): void {
    // The eraser also clears the free-object layer it passes over (오브젝트 삭제).
    if (erase) this.eraseObjectsUnderBrush(cx, cy);
    const id = erase ? 0 : $selectedMaterial.get();
    const rad = $brushSize.get();
    const shape = $brushShape.get();
    // Resolve the "자동" overwrite rule into a concrete level for this material.
    const level = effectiveOverwriteLevel($overwriteLevel.get(), id);
    // The overwrite gate is about new material displacing existing particles;
    // the eraser (Empty) always erases regardless of the setting.
    const isEraser = id === 0;
    // Solid materials always paint Full — a sparse pile of solid grains
    // reads as a bug, not a feature, so Particle mode only applies to
    // non-solid materials (sand, water, gases, ...). A right-button erase also
    // ignores Particle mode: "always erases" means a clean, gap-free clear.
    const particle =
      !erase && $brushMode.get() === 'particle' && getMaterial(id).phase !== Phase.Solid;
    // Fresh material is placed at its own initial temperature (e.g. Lava lands
    // molten, Water cool) so the heat system starts from a sensible state.
    const initTemp = getMaterial(id).thermal?.init ?? AMBIENT_TEMP;
    // A Conveyor records the stroke's direction in its aux so it runs that way
    // (좌우 정렬); every other material clears aux to 0 like normal.
    const beltAux = id === CONVEYOR.id ? (this.beltDirX < 0 ? CONVEYOR_LEFT : CONVEYOR_RIGHT) : 0;
    const r2 = rad * rad;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (shape === 'circle' && dx * dx + dy * dy > r2) continue;
        if (particle && Math.random() > PARTICLE_FILL_RATE) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.grid.inBounds(x, y)) continue;
        if (!isEraser && !canOverwrite(this.grid.get(x, y), level)) continue;
        this.grid.set(x, y, id);
        this.grid.setTemp(x, y, initTemp);
        // Freshly placed (or erased) material carries no prior per-cell state, so
        // clear aux — otherwise a stale byte left by whatever occupied this cell
        // (a Battery's cadence, a spark refractory, a Clone's adopted id) would
        // be read by the new material. Mirrors SimContext.spawn/set(EMPTY), the
        // only other create/clear paths; the raw grid.set here bypasses them. A
        // Conveyor instead seeds its travel direction here (beltAux).
        this.grid.setAux(x, y, beltAux);
        // Seed a random per-particle tint so a freshly painted powder/liquid is
        // grainy from the first frame instead of a flat block (see game/tint.ts).
        this.grid.setTint(x, y, (Math.random() * 256) | 0);
        // Painting (or erasing) replaces the whole cell, 겹침 overlap fluid
        // included — the eraser really empties a wet cell, and fresh material
        // starts dry.
        this.grid.setOverlay(x, y, 0);
      }
    }
  }

  /** Paint a stochastic blend (the 혼합 tool): each cell in the footprint is
   *  independently assigned one of $blendBrush's materials, weighted by ratio.
   *  Otherwise behaves like paint(): honors the overwrite gate, particle-mode
   *  gaps (non-solids only), per-material init temperature, aux clear and tint. */
  private paintBlend(cx: number, cy: number): void {
    const comps = $blendBrush.get();
    let total = 0;
    for (const c of comps) total += c.ratio;
    if (total <= 0) return;
    const rad = $brushSize.get();
    const shape = $brushShape.get();
    // "자동" resolves to whichever material the blend's *first* component is —
    // a sensible stand-in for "the mixture's dominant phase". The per-cell
    // weighted pick below keeps its own canOverwrite gate, so a heavier
    // component's level still admits cells a lighter one couldn't paint into.
    const level = effectiveOverwriteLevel($overwriteLevel.get(), comps[0].id);
    const particleMode = $brushMode.get() === 'particle';
    const r2 = rad * rad;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (shape === 'circle' && dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.grid.inBounds(x, y)) continue;
        // Weighted pick for THIS cell.
        let r = Math.random() * total;
        let id = comps[comps.length - 1].id;
        for (const c of comps) {
          r -= c.ratio;
          if (r < 0) { id = c.id; break; }
        }
        const mat = getMaterial(id);
        // Particle mode leaves random gaps for non-solids (matches paint()).
        if (particleMode && mat.phase !== Phase.Solid && Math.random() > PARTICLE_FILL_RATE) continue;
        if (!canOverwrite(this.grid.get(x, y), level)) continue;
        this.grid.set(x, y, id);
        this.grid.setTemp(x, y, mat.thermal?.init ?? AMBIENT_TEMP);
        this.grid.setAux(x, y, 0);
        this.grid.setTint(x, y, (Math.random() * 256) | 0);
        this.grid.setOverlay(x, y, 0); // freshly painted material starts dry
      }
    }
  }

  /**
   * Fill the axis-aligned bounding box of (sx,sy)–(ex,ey) with the selected
   * material (or Empty when `erase` is set), honoring the same overwrite gate,
   * particle-fill, init-temp, and aux-clear rules as `paint()`. This is the
   * 영역 (rect) tool's confirm action — a one-shot rectangular application of
   * the last active non-rect tool, not a per-tick brush stamp: material/blend
   * fills the box, mix shuffles it once, heat/cool apply one second's worth of
   * temperature change at once, and a right-drag erases.
   */
  private paintRect(sx: number, sy: number, ex: number, ey: number, erase: boolean): void {
    const x0 = Math.max(0, Math.min(sx, ex));
    const x1 = Math.min(this.grid.width - 1, Math.max(sx, ex));
    const y0 = Math.max(0, Math.min(sy, ey));
    const y1 = Math.min(this.grid.height - 1, Math.max(sy, ey));
    if (x1 < x0 || y1 < y0) return;
    // Right-drag always erases (the secondary button always erases). Otherwise
    // dispatch to the snapshotted tool so the marquee does what the last active
    // brush would do — but in one rectangular shot.
    if (erase) return this.eraseRect(x0, y0, x1, y1);
    switch (this.rectTool) {
      case 'blend':
        return this.blendRect(x0, y0, x1, y1);
      case 'mix': {
        const cells = this.rectCells(x0, y0, x1, y1);
        mixCells(this.grid, cells);
        // A rect stir also nudges objects inside the box, like the brush stir.
        this.mixPushObjectsInRect(x0, y0, x1, y1);
        return;
      }
      case 'heat':
        return this.heatRect(x0, y0, x1, y1, 1);
      case 'cool':
        return this.heatRect(x0, y0, x1, y1, -1);
    }
    this.fillRect(x0, y0, x1, y1);
  }

  /** Flat [x,y,...] list of every in-bounds cell in the AABB, the rect analogue
   *  of `brushCells` — passed to the engine's heatCells/mixCells. */
  private rectCells(x0: number, y0: number, x1: number, y1: number): number[] {
    const out: number[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) out.push(x, y);
    }
    return out;
  }

  /** Fill the AABB with the selected material — the rect tool's original fill
   *  action, honoring the same overwrite gate, particle-fill, init-temp, and
   *  aux-clear rules as `paint()`. */
  private fillRect(x0: number, y0: number, x1: number, y1: number): void {
    const id = $selectedMaterial.get();
    const level = effectiveOverwriteLevel($overwriteLevel.get(), id);
    const particle = $brushMode.get() === 'particle' && getMaterial(id).phase !== Phase.Solid;
    const initTemp = getMaterial(id).thermal?.init ?? AMBIENT_TEMP;
    const beltAux = id === CONVEYOR.id ? (this.beltDirX < 0 ? CONVEYOR_LEFT : CONVEYOR_RIGHT) : 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (particle && Math.random() > PARTICLE_FILL_RATE) continue;
        if (!canOverwrite(this.grid.get(x, y), level)) continue;
        this.grid.set(x, y, id);
        this.grid.setTemp(x, y, initTemp);
        this.grid.setAux(x, y, beltAux);
        this.grid.setTint(x, y, (Math.random() * 256) | 0);
        this.grid.setOverlay(x, y, 0);
      }
    }
  }

  /** Fill the AABB with the blend brush's stochastic mix, cell by cell — the
   *  rect analogue of `paintBlend`, one shot. */
  private blendRect(x0: number, y0: number, x1: number, y1: number): void {
    const comps = $blendBrush.get();
    let total = 0;
    for (const c of comps) total += c.ratio;
    if (total <= 0) return;
    const level = effectiveOverwriteLevel($overwriteLevel.get(), comps[0].id);
    const particleMode = $brushMode.get() === 'particle';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let r = Math.random() * total;
        let id = comps[comps.length - 1].id;
        for (const c of comps) {
          r -= c.ratio;
          if (r < 0) {
            id = c.id;
            break;
          }
        }
        const mat = getMaterial(id);
        if (particleMode && mat.phase !== Phase.Solid && Math.random() > PARTICLE_FILL_RATE) continue;
        if (!canOverwrite(this.grid.get(x, y), level)) continue;
        this.grid.set(x, y, id);
        this.grid.setTemp(x, y, mat.thermal?.init ?? AMBIENT_TEMP);
        this.grid.setAux(x, y, 0);
        this.grid.setTint(x, y, (Math.random() * 256) | 0);
        this.grid.setOverlay(x, y, 0);
      }
    }
  }

  /** Apply one full second's worth of heat/cool to the AABB at once (the rect
   *  tool applies the per-second rate immediately, not per-tick). `sign` is +1
   *  for heat, −1 for cool. Also warms/chills free objects inside the box. */
  private heatRect(x0: number, y0: number, x1: number, y1: number, sign: number): void {
    const cells = this.rectCells(x0, y0, x1, y1);
    if ($heatMode.get() === 'percent') {
      const fraction = (sign * $heatPercent.get()) / 100;
      heatCellsPercent(this.grid, cells, fraction, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
      this.heatObjectsInRect(x0, y0, x1, y1, (t) => t * (1 + fraction));
    } else {
      const delta = sign * $heatRate.get();
      heatCells(this.grid, cells, delta, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
      this.heatObjectsInRect(x0, y0, x1, y1, (t) => t + delta);
    }
  }

  /** Apply a heat transform to every free object whose center is inside the
   *  rect, the rect analogue of `heatObjectsUnderBrush`. `apply` maps the old
   *  temp to the new (pre-clamp) so the caller can express absolute or percent. */
  private heatObjectsInRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    apply: (t: number) => number,
  ): void {
    const objs = this.grid.objects;
    if (objs.length === 0) return;
    for (const o of objs) {
      if (o.held) continue;
      if (o.x < x0 || o.x > x1 + 1 || o.y < y0 || o.y > y1 + 1) continue;
      const t = apply(o.temp);
      o.temp = t < HEAT_BRUSH_MIN ? HEAT_BRUSH_MIN : t > HEAT_BRUSH_MAX ? HEAT_BRUSH_MAX : t;
    }
  }

  /** Erase the AABB to Empty and remove free objects whose center is inside it,
   *  the rect analogue of the brush eraser. */
  private eraseRect(x0: number, y0: number, x1: number, y1: number): void {
    const objs = this.grid.objects;
    if (objs.length > 0) {
      let w = 0;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        if (o.x < x0 || o.x > x1 + 1 || o.y < y0 || o.y > y1 + 1) objs[w++] = o;
      }
      objs.length = w;
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this.grid.set(x, y, 0);
        this.grid.setOverlay(x, y, 0);
      }
    }
  }

  /** Nudge free objects inside the rect outward — the rect analogue of
   *  `mixPushObjectsUnderBrush`, for the rect-mix action. */
  private mixPushObjectsInRect(x0: number, y0: number, x1: number, y1: number): void {
    const objs = this.grid.objects;
    if (objs.length === 0) return;
    const cx = (x0 + x1 + 1) / 2;
    const cy = (y0 + y1 + 1) / 2;
    for (const o of objs) {
      if (o.held) continue;
      if (o.x < x0 || o.x > x1 + 1 || o.y < y0 || o.y > y1 + 1) continue;
      if (Math.hypot(o.vx, o.vy) >= MIX_MAX_SPEED) continue;
      const dx = o.x - cx;
      const dy = o.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      o.vx += (dx / d) * MIX_PUSH_SPEED * 0.5 + (Math.random() * 2 - 1) * MIX_PUSH_SPEED;
      o.vy += (dy / d) * MIX_PUSH_SPEED * 0.5 + (Math.random() * 2 - 1) * MIX_PUSH_SPEED;
      if (o.kind !== 'ball') o.angularVelocity += (Math.random() * 2 - 1) * MIX_SPIN;
    }
  }

  /** Bresenham line so a quick drag paints a continuous stroke. */
  private stroke(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.stamp(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  private onDown = (e: PointerEvent): void => {
    this.down = true;
    // Right (secondary) button erases for the whole press; any other button
    // paints/uses the active tool. `contextmenu` is already suppressed on the
    // canvas so the right press is a clean erase gesture.
    this.erasing = e.button === 2;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw on some pointer types; safe to ignore */
    }
    const [x, y] = this.toCell(e);
    this.px = x;
    this.py = y;
    // 영역 (rect) tool: start a rectangular marquee drag. Both left (fill) and
    // right (erase) drags select a rectangle; the selection is confirmed by
    // Enter on PC or on release for touch pointers.
    if ($tool.get() === 'rect') {
      this.cancelRect(); // a new press supersedes any pending marquee
      this.rectDragging = true;
      this.rectErase = this.erasing;
      this.rectTool = $lastTool.get(); // snapshot which brush the marquee applies
      this.rectSX = x;
      this.rectSY = y;
      this.rectEX = x;
      this.rectEY = y;
      this.down = false; // no continuous brush stamping
      this.updateRectOverlay();
      return;
    }
    // Object tool: drop exactly one ball per press (no continuous stroke).
    if (!this.erasing && $tool.get() === 'object') {
      this.spawnObject(x, y);
      this.down = false;
      return;
    }
    // 보기(view) mode: grab the object under the cursor and drag it — brush is
    // inert here, so a press on a body picks it up instead of painting.
    if (!this.erasing && $tool.get() === 'view') {
      const [gx, gy] = this.clientToGridFloat(e.clientX, e.clientY);
      const body = pickBody(this.grid.objects, gx, gy);
      if (body) {
        this.dragBody = body;
        body.held = true;
        this.dragOffX = body.x - gx;
        this.dragOffY = body.y - gy;
        this.dragVX = 0;
        this.dragVY = 0;
        this.down = false; // a drag gesture, not a paint stroke
        return;
      }
    }
    this.stamp(x, y);
  };

  private onMove = (e: PointerEvent): void => {
    this.updateCursor(e.clientX, e.clientY);
    // Dragging an object (보기 mode): reposition it and skip all painting.
    if (this.dragBody) {
      this.dragTo(e.clientX, e.clientY);
      return;
    }
    // 영역 (rect) marquee drag: track the pointer and grow the selection.
    if (this.rectDragging) {
      const [x, y] = this.toCell(e);
      this.rectEX = x;
      this.rectEY = y;
      if (x !== this.rectSX) this.beltDirX = x > this.rectSX ? 1 : -1;
      this.updateRectOverlay();
      return;
    }
    // The inspect readout tracks the pointer too, but it's refreshed once per
    // frame from the game loop (see refreshInspect) off `lastClientX/Y`, which
    // updateCursor just updated — so a hover survey needs nothing more here.
    if (!this.down) return;
    const [x, y] = this.toCell(e);
    // Record the drag's horizontal direction so a Conveyor stamped this stroke
    // runs the way the brush moved.
    if (x !== this.px) this.beltDirX = x > this.px ? 1 : -1;
    this.stroke(this.px, this.py, x, y);
    this.px = x;
    this.py = y;
  };

  private onUp = (e: PointerEvent): void => {
    // Release a dragged object: hand it the smoothed drag velocity so a flick
    // flings it, clamped so a fast flick can't launch it across the world.
    if (this.dragBody) {
      const body = this.dragBody;
      body.held = false;
      const clamp = (v: number): number =>
        v < -DRAG_THROW_MAX ? -DRAG_THROW_MAX : v > DRAG_THROW_MAX ? DRAG_THROW_MAX : v;
      body.vx = clamp(this.dragVX);
      body.vy = clamp(this.dragVY);
      this.dragBody = null;
    }
    // 영역 (rect) marquee release: touch pointers confirm the fill immediately
    // (one gesture → one fill); mouse/pen pointers leave the marquee pending
    // so the user can review it and press Enter to apply (or Escape to cancel).
    // Note: confirmRect() reads rectDragging, so it must run before we clear it.
    // A pointercancel (OS scroll interrupt, palm rejection) is NOT a deliberate
    // release — cancel the marquee instead of committing a surprise fill.
    if (this.rectDragging) {
      if (e.type === 'pointercancel') {
        this.cancelRect();
      } else if (e.pointerType === 'touch') {
        this.confirmRect(); // calls cancelRect() internally (clears dragging)
      } else {
        this.rectDragging = false;
        this.rectPending = true;
        this.updateRectOverlay();
      }
    }
    this.down = false;
  };

  private onEnter = (e: PointerEvent): void => {
    this.hovering = true;
    this.updateCursor(e.clientX, e.clientY);
  };

  private onLeave = (): void => {
    this.hovering = false;
    this.cursorEl.style.display = 'none';
    // Restore the CSS fallback cursor now that our overlay is hidden again.
    this.canvas.style.cursor = 'crosshair';
    // The pointer left the canvas — nothing under the brush to report.
    this.refreshInspect();
  };

  private onWheel = (e: WheelEvent): void => {
    // Trackpad pinch-zoom and ctrl+scroll-zoom are also reported as `wheel`
    // with ctrlKey set; leave those alone so the browser's zoom still works.
    if (e.ctrlKey) return;
    e.preventDefault();
    const cur = $brushSize.get();
    const dir = e.deltaY > 0 ? -1 : 1;
    const next = Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, cur + dir));
    if (next !== cur) $brushSize.set(next);
  };

  /** Position and size the brush-outline cursor to match the current brush. */
  private updateCursor(clientX: number, clientY: number): void {
    this.lastClientX = clientX;
    this.lastClientY = clientY;
    if (!this.hovering) return;

    // The 영역 (rect) tool replaces the brush cursor with a marquee overlay, so
    // keep the native crosshair and skip the brush outline entirely.
    if ($tool.get() === 'rect') {
      this.canvas.style.cursor = 'crosshair';
      this.cursorEl.style.display = 'none';
      return;
    }

    const rad = $brushSize.get();
    const shape = $brushShape.get();
    const cell = this.layout.cell;
    const size = (2 * rad + 1) * cell;

    // Only hide the native cursor once the overlay is actually in place, so
    // there's no moment with neither cursor visible.
    this.canvas.style.cursor = 'none';
    this.cursorEl.style.display = 'block';
    this.cursorEl.style.left = `${clientX}px`;
    this.cursorEl.style.top = `${clientY}px`;
    this.cursorEl.style.width = `${size}px`;
    this.cursorEl.style.height = `${size}px`;
    this.cursorEl.style.borderRadius = shape === 'circle' ? '50%' : '0';
    // Tint the outline per tool (heat = warm, cool = cold, mix = violet) so the
    // active special brush is obvious; 'material' leaves the default neutral.
    this.cursorEl.dataset.tool = $tool.get();
    // The 돋보기 inspect overlay is independent of the tool, so flag it
    // separately — the outline picks up a magnifier accent while surveying.
    this.cursorEl.dataset.inspect = $inspect.get() ? 'on' : 'off';
  }

  /**
   * Re-syncs the cursor overlay after the sandbox layout changes (window
   * resize, drag-resize handle) — cell size may have changed even though the
   * pointer didn't move. No-ops while not hovering. Also refreshes the 영역
   * marquee overlay, whose screen position depends on the same layout.
   */
  refreshCursor(): void {
    this.updateCursor(this.lastClientX, this.lastClientY);
    this.updateRectOverlay();
  }

  /** Confirm a pending 영역 marquee: fill its bounding box and dismiss it. */
  private confirmRect(): void {
    if (!this.rectPending && !this.rectDragging) return;
    this.paintRect(this.rectSX, this.rectSY, this.rectEX, this.rectEY, this.rectErase);
    this.cancelRect();
  }

  /** Dismiss the 영역 marquee without filling (Escape, tool change, new press). */
  private cancelRect(): void {
    this.rectDragging = false;
    this.rectPending = false;
    this.rectEl.style.display = 'none';
  }

  /** Key handler for the 영역 tool: Enter confirms, Escape cancels. Skips
   *  events originating from a text input / textarea / contenteditable so typing
   *  Enter in a modal field (the SaveSlots name, a blend ratio, …) doesn't
   *  accidentally commit a pending marquee. */
  private onKey = (e: KeyboardEvent): void => {
    if ($tool.get() !== 'rect') return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      return;
    }
    if (e.key === 'Escape') {
      if (this.rectDragging || this.rectPending) {
        e.preventDefault();
        this.cancelRect();
      }
      return;
    }
    if (e.key === 'Enter' && this.rectPending) {
      e.preventDefault();
      this.confirmRect();
    }
  };

  /**
   * Position and size the rectangular marquee overlay (screen-space CSS px) to
   * match the current selection. The marquee is the axis-aligned bounding box
   * of the start/end grid cells, snapped to cell boundaries so it reads clean.
   * Hidden when no drag or pending selection is active.
   */
  private updateRectOverlay(): void {
    if (!this.rectDragging && !this.rectPending) {
      this.rectEl.style.display = 'none';
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const rect = this.layout.cssRect();
    const cell = this.layout.cell;
    const x0 = Math.min(this.rectSX, this.rectEX);
    const x1 = Math.max(this.rectSX, this.rectEX);
    const y0 = Math.min(this.rectSY, this.rectEY);
    const y1 = Math.max(this.rectSY, this.rectEY);
    // Grid y=0 is the top row; cell coords map linearly from there.
    const left = r.left + rect.x + x0 * cell;
    const top = r.top + rect.y + y0 * cell;
    const width = (x1 - x0 + 1) * cell;
    const height = (y1 - y0 + 1) * cell;
    this.rectEl.style.display = 'block';
    this.rectEl.style.left = `${left}px`;
    this.rectEl.style.top = `${top}px`;
    this.rectEl.style.width = `${width}px`;
    this.rectEl.style.height = `${height}px`;
    // The marquee color reflects which tool the rect will apply: erase for a
    // right-drag, otherwise the snapshotted tool (material→fill, heat, cool,
    // mix, blend, …) so the user can read the pending effect at a glance.
    this.rectEl.dataset.mode = this.rectErase ? 'erase' : this.rectTool;
    this.rectEl.dataset.pending = this.rectPending ? 'true' : 'false';
  }

  /**
   * Recompute the 돋보기 inspect readout ($inspectData) from the cells under the
   * brush at the pointer's current resting position. Publishes null (once) when
   * inspect is off or the pointer isn't over the canvas, so the UI panel hides.
   *
   * Called once per animation frame from the game loop (see Game.ts) so the
   * numbers stay live as the world flows beneath a still cursor, without the
   * per-sim-tick over-recompute a call inside update() would cause. When inspect
   * is off this is a two-`.get()` early return; when on, it surveys at most a
   * ~25×25 footprint and only writes the store when the result actually changed,
   * so a paused, resting cursor doesn't re-render the panel every frame.
   */
  refreshInspect(): void {
    if (!$inspect.get() || !this.hovering) {
      if (this.lastInspect !== null) {
        this.lastInspect = null;
        $inspectData.set(null);
      }
      return;
    }
    let cells: number[];
    if ($tool.get() === 'rect' && (this.rectDragging || this.rectPending)) {
      const x0 = Math.max(0, Math.min(this.rectSX, this.rectEX));
      const x1 = Math.min(this.grid.width - 1, Math.max(this.rectSX, this.rectEX));
      const y0 = Math.max(0, Math.min(this.rectSY, this.rectEY));
      const y1 = Math.min(this.grid.height - 1, Math.max(this.rectSY, this.rectEY));
      cells = x1 >= x0 && y1 >= y0 ? this.rectCells(x0, y0, x1, y1) : [];
    } else {
      const [cx, cy] = this.clientToCell(this.lastClientX, this.lastClientY);
      cells = this.brushCells(cx, cy);
    }
    const stats = inspectCells(this.grid, cells);
    if (sameInspect(this.lastInspect, stats)) return;
    this.lastInspect = stats;
    $inspectData.set(stats);
  }

  /**
   * Called once per animation frame from the main loop. Holding a pointer down
   * without moving it stops emitting pointermove events, so without this the
   * brush would silently stop painting while held still; re-stamping every
   * frame keeps it active for the whole press. This has to run every frame
   * rather than only on change: the simulation keeps moving the painted
   * material out of the brush's cells (e.g. falling sand), so re-stamping is
   * what makes holding still read as "pouring" instead of a single splat.
   */
  update(): void {
    if (this.down) this.stamp(this.px, this.py);
  }
}
