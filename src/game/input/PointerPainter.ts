import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import {
  $selectedMaterial,
  $brushSize,
  $brushShape,
  $brushMode,
  $overwriteLevel,
  $tool,
  $areaSelect,
  $blendBrush,
  $inspect,
  $inspectData,
  $selectedObject,
} from '../../state/store';
import {
  BRUSH_MIN,
  BRUSH_MAX,
  PARTICLE_FILL_RATE,
  HEAT_BRUSH_DELTA,
  HEAT_BRUSH_MAX,
  HEAT_BRUSH_MIN,
  AMBIENT_TEMP,
  OVERWRITE_AUTO,
  OVERWRITE_LEVEL_MAX,
} from '../config';
import { createFloatingOverlay } from './floatingOverlay';
import { getMaterial } from '../materials';
import { Phase } from '../engine/types';
import { heatCells, mixCells, inspectCells } from '../engine/brushTools';
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

/** Clamped axis-aligned bounding box of a 영역 marquee, in inclusive grid-cell
 *  coordinates. See `PointerPainter.rectBounds`. */
interface RectBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

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
  /** Whether the current marquee will erase (right-drag) instead of applying
   *  the active tool. */
  private rectErase = false;
  /** Marquee corners in grid-cell coordinates (start = pointerdown, end = last
   *  move). The rectangle is the axis-aligned bounding box of the two. */
  private rectSX = 0;
  private rectSY = 0;
  private rectEX = 0;
  private rectEY = 0;
  private cursorEl: HTMLDivElement;
  /** The rectangular marquee overlay (Photoshop-style 영역 선택). Hidden unless
   *  영역 select mode is actively dragging or holding a pending selection. */
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
      // The tool is now independent of 영역 select mode (unlike the old 'rect'
      // tool value), so switching tools no longer cancels a pending/dragging
      // marquee — you can drag a rect, then pick which tool to apply to it
      // before confirming. Just retint the marquee overlay to match.
      this.updateRectOverlay();
    });
    // Toggling 영역 select mode: retint the cursor (crosshair vs brush outline)
    // and cancel any marquee once it turns off — a selection is only
    // meaningful while the mode is active.
    $areaSelect.listen(() => {
      this.updateCursor(this.lastClientX, this.lastClientY);
      if (!$areaSelect.get()) this.cancelRect();
      this.refreshInspect();
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

  /** Remove every free object matching `hit` (its center falls under the
   *  current footprint) — deleted, no trace. Shared by the circular brush
   *  eraser and the rectangular 영역 erase, each supplying its own geometry
   *  test. If the erased object was the one being dragged, ends the drag
   *  cleanly. */
  private eraseObjectsWhere(hit: (o: SimBody) => boolean): void {
    const objs = this.grid.objects;
    if (objs.length === 0) return;
    let w = 0;
    for (let i = 0; i < objs.length; i++) {
      // Keep objects the footprint doesn't reach; drop the rest.
      if (!hit(objs[i])) objs[w++] = objs[i];
    }
    objs.length = w;
    if (this.dragBody && hit(this.dragBody)) this.dragBody = null;
  }

  /** Remove any free object the eraser brush touches. The brush is a disc of
   *  radius `brushSize` centered on the cell; an object is deleted when that disc
   *  reaches its surface. Shared by the right-button erase and the 지우개 tool
   *  (both go through paintBrush(erase)). */
  private eraseObjectsUnderBrush(cx: number, cy: number): void {
    const rad = $brushSize.get();
    const bx = cx + 0.5;
    const by = cy + 0.5;
    this.eraseObjectsWhere((o) => distanceToBody(o, bx, by) <= rad);
  }

  /** Nudge every matching free object's own heat reservoir (SimBody.temp) by
   *  `delta`, clamped to the same range as the cell heat brush, skipping a
   *  held (dragged) body. Shared by the circular 가열/냉각 brush and the
   *  rectangular 영역 heat/cool, each supplying its own geometry test. This is
   *  how heat/cool reaches an object — especially one floating over empty air,
   *  which the cell heat brush (zero-conductivity air) can't warm — letting it
   *  melt a drum or burn a ball. */
  private heatObjectsWhere(hit: (o: SimBody) => boolean, delta: number): void {
    for (const o of this.grid.objects) {
      if (o.held || !hit(o)) continue; // a dragged body is shielded; don't cook it
      const t = o.temp + delta;
      o.temp = t < HEAT_BRUSH_MIN ? HEAT_BRUSH_MIN : t > HEAT_BRUSH_MAX ? HEAT_BRUSH_MAX : t;
    }
  }

  /** Apply the 가열/냉각 brush to any free object under it — see heatObjectsWhere. */
  private heatObjectsUnderBrush(cx: number, cy: number, delta: number): void {
    const rad = $brushSize.get();
    const bx = cx + 0.5;
    const by = cy + 0.5;
    this.heatObjectsWhere((o) => distanceToBody(o, bx, by) <= rad, delta);
  }

  /** Shove every matching free object — a random jostle with a slight outward
   *  push from (cx,cy), so stirring scatters/ejects bodies the way it disperses
   *  cells. Drums/dynamite also get a random spin. Skips a held body (the drag
   *  owns it) and any body already moving fast, so repeated stamps don't
   *  accumulate to a rocket. Shared by the circular 섞기 brush and the
   *  rectangular 영역 mix, each supplying its own geometry test and push center. */
  private mixPushObjectsWhere(hit: (o: SimBody) => boolean, cx: number, cy: number): void {
    for (const o of this.grid.objects) {
      if (o.held || !hit(o)) continue;
      if (Math.hypot(o.vx, o.vy) >= MIX_MAX_SPEED) continue; // already lively — don't pile on
      const dx = o.x - cx;
      const dy = o.y - cy;
      const d = Math.hypot(dx, dy) || 1; // outward from the stir center (center hit → pure random)
      o.vx += (dx / d) * MIX_PUSH_SPEED * 0.5 + (Math.random() * 2 - 1) * MIX_PUSH_SPEED;
      o.vy += (dy / d) * MIX_PUSH_SPEED * 0.5 + (Math.random() * 2 - 1) * MIX_PUSH_SPEED;
      // Any capsule body (drum or dynamite) also gets a random spin; a ball doesn't rotate.
      if (o.kind !== 'ball') o.angularVelocity += (Math.random() * 2 - 1) * MIX_SPIN;
    }
  }

  /** Shove any free object under the 섞기 brush — see mixPushObjectsWhere. */
  private mixPushObjectsUnderBrush(cx: number, cy: number): void {
    const rad = $brushSize.get();
    const bx = cx + 0.5;
    const by = cy + 0.5;
    this.mixPushObjectsWhere((o) => distanceToBody(o, bx, by) <= rad, bx, by);
  }

  /** Whether object `o`'s center falls inside rect `bounds` — the object-layer
   *  counterpart of a cell footprint (objects live in continuous grid
   *  coordinates, so this can't reuse `cellsInBounds`). The `+1` matches the
   *  fact that `x1`/`y1` are inclusive last cell indices, so an object resting
   *  right at the rectangle's far edge still counts as inside it. */
  private objectInRectBounds(o: SimBody, bounds: RectBounds): boolean {
    return o.x >= bounds.x0 && o.x <= bounds.x1 + 1 && o.y >= bounds.y0 && o.y <= bounds.y1 + 1;
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
    if (this.erasing) return this.paintBrush(cx, cy, true);
    switch ($tool.get()) {
      case 'heat':
        heatCells(this.grid, this.brushCells(cx, cy), HEAT_BRUSH_DELTA, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
        return this.heatObjectsUnderBrush(cx, cy, HEAT_BRUSH_DELTA);
      case 'cool':
        heatCells(this.grid, this.brushCells(cx, cy), -HEAT_BRUSH_DELTA, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
        return this.heatObjectsUnderBrush(cx, cy, -HEAT_BRUSH_DELTA);
      case 'mix':
        mixCells(this.grid, this.brushCells(cx, cy));
        return this.mixPushObjectsUnderBrush(cx, cy);
      case 'erase':
        return this.paintBrush(cx, cy, true);
      case 'blend':
        return this.paintBlend(this.brushCells(cx, cy));
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
    this.paintBrush(cx, cy, false);
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

  /** Paint the selected material (or Empty when `erase` is set) over `cells`,
   *  honoring the overwrite gate, particle-fill (non-solid only, disabled for
   *  erase — "always erases" means a clean, gap-free clear), per-material init
   *  temperature, aux-clear (Conveyor direction aside), fresh tint, and dry
   *  overlay. Shared by the brush stroke (`paintBrush`, circular/square
   *  footprint) and the 영역 rect fill (`applyRect`, rectangular footprint) —
   *  each builds its own `cells` list; object erasure needs the brush/rect
   *  geometry a flat cell list doesn't carry, so callers handle that
   *  separately (see `eraseObjectsWhere`). */
  private paintCells(cells: readonly number[], erase: boolean): void {
    const id = erase ? 0 : $selectedMaterial.get();
    // Resolve the "자동" overwrite rule into a concrete level for this material.
    const level = effectiveOverwriteLevel($overwriteLevel.get(), id);
    // The overwrite gate is about new material displacing existing particles;
    // the eraser (Empty) always erases regardless of the setting.
    const isEraser = id === 0;
    // Solid materials always paint Full — a sparse pile of solid grains reads
    // as a bug, not a feature, so Particle mode only applies to non-solid
    // materials (sand, water, gases, ...).
    const particle = !erase && $brushMode.get() === 'particle' && getMaterial(id).phase !== Phase.Solid;
    // Fresh material is placed at its own initial temperature (e.g. Lava lands
    // molten, Water cool) so the heat system starts from a sensible state.
    const initTemp = getMaterial(id).thermal?.init ?? AMBIENT_TEMP;
    // A Conveyor records the stroke's direction in its aux so it runs that way
    // (좌우 정렬); every other material clears aux to 0 like normal.
    const beltAux = id === CONVEYOR.id ? (this.beltDirX < 0 ? CONVEYOR_LEFT : CONVEYOR_RIGHT) : 0;
    for (let k = 0; k < cells.length; k += 2) {
      const x = cells[k];
      const y = cells[k + 1];
      if (particle && Math.random() > PARTICLE_FILL_RATE) continue;
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

  /** Brush-footprint wrapper around `paintCells()`: builds the circular/square
   *  cell list for (cx,cy) and, for an erase press, also clears the free
   *  objects under the same footprint. */
  private paintBrush(cx: number, cy: number, erase: boolean): void {
    if (erase) this.eraseObjectsUnderBrush(cx, cy);
    this.paintCells(this.brushCells(cx, cy), erase);
  }

  /** Paint a stochastic blend (the 혼합 tool) over `cells`: each cell is
   *  independently assigned one of $blendBrush's materials, weighted by ratio.
   *  Otherwise behaves like `paintCells()`: honors the overwrite gate,
   *  particle-mode gaps (non-solids only), per-material init temperature, aux
   *  clear and tint. Shared by the brush stroke and the 영역 rect fill, each
   *  building its own `cells` list. */
  private paintBlend(cells: readonly number[]): void {
    const comps = $blendBrush.get();
    let total = 0;
    for (const c of comps) total += c.ratio;
    if (total <= 0) return;
    // "자동" resolves to whichever material the blend's *first* component is —
    // a sensible stand-in for "the mixture's dominant phase". The per-cell
    // weighted pick below keeps its own canOverwrite gate, so a heavier
    // component's level still admits cells a lighter one couldn't paint into.
    const level = effectiveOverwriteLevel($overwriteLevel.get(), comps[0].id);
    const particleMode = $brushMode.get() === 'particle';
    for (let k = 0; k < cells.length; k += 2) {
      const x = cells[k];
      const y = cells[k + 1];
      // Weighted pick for THIS cell.
      let r = Math.random() * total;
      let id = comps[comps.length - 1].id;
      for (const c of comps) {
        r -= c.ratio;
        if (r < 0) { id = c.id; break; }
      }
      const mat = getMaterial(id);
      // Particle mode leaves random gaps for non-solids (matches paintCells()).
      if (particleMode && mat.phase !== Phase.Solid && Math.random() > PARTICLE_FILL_RATE) continue;
      if (!canOverwrite(this.grid.get(x, y), level)) continue;
      this.grid.set(x, y, id);
      this.grid.setTemp(x, y, mat.thermal?.init ?? AMBIENT_TEMP);
      this.grid.setAux(x, y, 0);
      this.grid.setTint(x, y, (Math.random() * 256) | 0);
      this.grid.setOverlay(x, y, 0); // freshly painted material starts dry
    }
  }

  /** Clamped axis-aligned bounding box of the current 영역 marquee corners
   *  (rectSX/SY/EX/EY), or `null` when the marquee doesn't overlap the grid at
   *  all (e.g. dragged fully past an edge — pointer capture keeps delivering
   *  coordinates outside the canvas). Shared by every 영역 action (`applyRect`)
   *  and `rectFootprintCells()` (돋보기 survey target) so all of them agree on
   *  what counts as "no selection" instead of drifting out of sync. */
  private rectBounds(): RectBounds | null {
    const x0 = Math.max(0, Math.min(this.rectSX, this.rectEX));
    const x1 = Math.min(this.grid.width - 1, Math.max(this.rectSX, this.rectEX));
    const y0 = Math.max(0, Math.min(this.rectSY, this.rectEY));
    const y1 = Math.min(this.grid.height - 1, Math.max(this.rectSY, this.rectEY));
    return x1 < x0 || y1 < y0 ? null : { x0, y0, x1, y1 };
  }

  /** Flat [x0,y0,x1,y1,...] list of every cell inside `bounds` (inclusive). */
  private cellsInBounds(bounds: RectBounds): number[] {
    const out: number[] = [];
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) out.push(x, y);
    }
    return out;
  }

  /**
   * Commit the current 영역 marquee: apply whatever the active `$tool` (or a
   * right-button erase) would do to a brush stroke, but over the marquee's
   * rectangular footprint in one shot instead of a per-tick stamp — the 영역
   * (rect) selection mode's confirm action. Every tool `stamp()` supports is
   * supported here too (재료/혼합 fill, 가열/냉각, 섞기, 지우개/우클릭 clear),
   * except 'object' (a spawn action, not area-shaped) and 'view' (inert by
   * design), which no-op just like their brush-stroke counterparts.
   */
  private applyRect(erase: boolean): void {
    const bounds = this.rectBounds();
    if (!bounds) return;
    const tool = $tool.get();
    if (erase || tool === 'erase') {
      // Erase any free objects whose center falls inside the marquee, the same
      // way the brush eraser sweeps its footprint.
      this.eraseObjectsWhere((o) => this.objectInRectBounds(o, bounds));
      return this.paintCells(this.cellsInBounds(bounds), true);
    }
    switch (tool) {
      case 'heat':
        heatCells(this.grid, this.cellsInBounds(bounds), HEAT_BRUSH_DELTA, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
        return this.heatObjectsWhere((o) => this.objectInRectBounds(o, bounds), HEAT_BRUSH_DELTA);
      case 'cool':
        heatCells(this.grid, this.cellsInBounds(bounds), -HEAT_BRUSH_DELTA, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
        return this.heatObjectsWhere((o) => this.objectInRectBounds(o, bounds), -HEAT_BRUSH_DELTA);
      case 'mix':
        mixCells(this.grid, this.cellsInBounds(bounds));
        // Push outward from the rect's own center, mirroring how the circular
        // brush pushes outward from the stamp's center.
        return this.mixPushObjectsWhere(
          (o) => this.objectInRectBounds(o, bounds),
          (bounds.x0 + bounds.x1 + 1) / 2,
          (bounds.y0 + bounds.y1 + 1) / 2,
        );
      case 'blend':
        return this.paintBlend(this.cellsInBounds(bounds));
      case 'object':
      case 'view':
        // Neither has an area-shaped action (spawn is a point action; 보기 is
        // inert) — a marquee under either just no-ops on confirm.
        return;
    }
    this.paintCells(this.cellsInBounds(bounds), false);
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
    // 영역 select mode: start a rectangular marquee drag instead of a brush
    // stroke, regardless of the active tool (it takes priority over the
    // object-spawn and 보기 object-drag presses below too). Both left (fill)
    // and right (erase) drags select a rectangle; the selection is confirmed
    // by Enter on PC or on release for touch pointers, then applies whichever
    // tool is active (see `applyRect`).
    if ($areaSelect.get()) {
      this.cancelRect(); // a new press supersedes any pending marquee
      this.rectDragging = true;
      this.rectErase = this.erasing;
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
    // Re-sync 돋보기: for the pointer-following case there's nothing under the
    // brush to report anymore, so this clears it (inspectFootprint() checks
    // `hovering`). A pending/dragging 영역 marquee is unaffected — it doesn't
    // depend on `hovering` — so it keeps reporting the selected area even once
    // the pointer wanders off the canvas.
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

    // 영역 select mode replaces the brush cursor with a marquee overlay, so
    // keep the native crosshair and skip the brush outline entirely.
    if ($areaSelect.get()) {
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

  /** Confirm a pending 영역 marquee: apply the active tool to its bounding box
   *  (see `applyRect`) and dismiss it. */
  private confirmRect(): void {
    if (!this.rectPending && !this.rectDragging) return;
    this.applyRect(this.rectErase);
    this.cancelRect();
  }

  /** Dismiss the 영역 marquee without applying anything (Escape, mode turned
   *  off, new press). */
  private cancelRect(): void {
    this.rectDragging = false;
    this.rectPending = false;
    this.rectEl.style.display = 'none';
  }

  /** Key handler for 영역 select mode: Enter confirms, Escape cancels. Skips
   *  events originating from a text input / textarea / contenteditable so typing
   *  Enter in a modal field (the SaveSlots name, a blend ratio, …) doesn't
   *  accidentally commit a pending marquee. */
  private onKey = (e: KeyboardEvent): void => {
    if (!$areaSelect.get()) return;
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
    // Tint the marquee like the brush cursor (heat = warm, cool = cold, mix =
    // violet, ...) so it's obvious which action Enter will apply — a
    // right-drag (or the 지우개 tool) always erases regardless of $tool, same
    // as the brush. A pending selection (awaiting Enter) pulses (data-pending).
    this.rectEl.dataset.mode = this.rectErase ? 'erase' : $tool.get();
    this.rectEl.dataset.pending = this.rectPending ? 'true' : 'false';
  }

  /**
   * Recompute the 돋보기 inspect readout ($inspectData) from the cells under the
   * brush at the pointer's current resting position (or, for the 영역 tool,
   * the marquee — see `inspectFootprint()`). Publishes null (once) when inspect
   * is off or there's nothing to survey, so the UI panel hides.
   *
   * Called once per animation frame from the game loop (see Game.ts) so the
   * numbers stay live as the world flows beneath a still cursor, without the
   * per-sim-tick over-recompute a call inside update() would cause. When inspect
   * is off this is a two-`.get()` early return; when on, it surveys at most a
   * ~25×25 footprint (or the marquee, for 영역) and only writes the store when
   * the result actually changed, so a paused, resting cursor doesn't re-render
   * the panel every frame.
   */
  refreshInspect(): void {
    const cells = $inspect.get() ? this.inspectFootprint() : null;
    if (cells === null) {
      if (this.lastInspect !== null) {
        this.lastInspect = null;
        $inspectData.set(null);
      }
      return;
    }
    const stats = inspectCells(this.grid, cells);
    if (sameInspect(this.lastInspect, stats)) return;
    this.lastInspect = stats;
    $inspectData.set(stats);
  }

  /** The cell footprint the 돋보기 overlay should currently survey. 영역 select
   *  mode doesn't paint from the pointer position at all — it applies the
   *  active tool to the marquee's bounding box on confirm — so while it's on,
   *  돋보기 follows the marquee instead of the cursor: the currently-dragged or
   *  pending selection's bounding box, or `null` (nothing to show) before any
   *  marquee exists. This ignores `hovering` on purpose — a *pending* marquee
   *  (mouse/pen released, awaiting Enter) stays valid and its overlay stays
   *  visible even after the pointer wanders off the canvas (e.g. to the
   *  sidebar to pick a different tool), so 돋보기 should keep reporting it too
   *  rather than blanking out. With 영역 select off, this surveys the normal
   *  brush footprint under the pointer, which does require the pointer to be
   *  over the canvas. */
  private inspectFootprint(): number[] | null {
    if ($areaSelect.get()) {
      if (!this.rectDragging && !this.rectPending) return null;
      const bounds = this.rectBounds();
      return bounds ? this.cellsInBounds(bounds) : null;
    }
    if (!this.hovering) return null;
    const [cx, cy] = this.clientToCell(this.lastClientX, this.lastClientY);
    return this.brushCells(cx, cy);
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
