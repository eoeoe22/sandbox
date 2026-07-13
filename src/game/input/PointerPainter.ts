import type { Grid } from '../engine/Grid';
import type { SandboxLayout } from '../layout';
import {
  $selectedMaterial,
  $brushSize,
  $brushShape,
  $brushMode,
  $overwriteLevel,
  $tool,
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
} from '../config';
import { createFloatingOverlay } from './floatingOverlay';
import { getMaterial } from '../materials';
import { Phase } from '../engine/types';
import { heatCells, mixCells, inspectCells } from '../engine/brushTools';
import type { InspectStats } from '../engine/brushTools';
import { CONVEYOR, CONVEYOR_LEFT, CONVEYOR_RIGHT } from '../materials/conveyor';
import { createRubberBall, createBlueDrum } from '../engine/objects';

/**
 * Ordering of phases from "easiest to overwrite" to "hardest", used by the
 * brush overwrite gate. Wall is a tag on top of Phase.Solid rather than its
 * own phase, so it's checked separately and always sits at the top.
 */
const OVERWRITE_PHASE_ORDER = [Phase.Gas, Phase.Liquid, Phase.Powder, Phase.Solid];

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
  private cursorEl: HTMLDivElement;

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

    // Brush size/shape/tool can change from the control panel while the pointer
    // sits still over the canvas; keep the cursor (size, shape, tool tint) in
    // sync either way.
    $brushSize.listen(() => this.updateCursor(this.lastClientX, this.lastClientY));
    $brushShape.listen(() => this.updateCursor(this.lastClientX, this.lastClientY));
    $tool.listen(() => this.updateCursor(this.lastClientX, this.lastClientY));
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

  /** Apply the active brush at (cx,cy). A right-button press always erases; a
   *  normal press paints the selected material, or — for a special brush —
   *  heats/cools or mixes the cells already there. */
  private stamp(cx: number, cy: number): void {
    if (this.erasing) return this.paint(cx, cy, true);
    switch ($tool.get()) {
      case 'heat':
        return heatCells(this.grid, this.brushCells(cx, cy), HEAT_BRUSH_DELTA, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
      case 'cool':
        return heatCells(this.grid, this.brushCells(cx, cy), -HEAT_BRUSH_DELTA, HEAT_BRUSH_MIN, HEAT_BRUSH_MAX);
      case 'mix':
        return mixCells(this.grid, this.brushCells(cx, cy));
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
    if ($selectedObject.get() === 'drum') {
      this.grid.objects.push(createBlueDrum(cx + 0.5, cy + 0.5));
    } else {
      const r = Math.max(2, $brushSize.get());
      this.grid.objects.push(createRubberBall(cx + 0.5, cy + 0.5, r));
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
    const id = erase ? 0 : $selectedMaterial.get();
    const rad = $brushSize.get();
    const shape = $brushShape.get();
    const level = $overwriteLevel.get();
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
    const level = $overwriteLevel.get();
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
    // Object tool: drop exactly one ball per press (no continuous stroke).
    if (!this.erasing && $tool.get() === 'object') {
      this.spawnObject(x, y);
      this.down = false;
      return;
    }
    this.stamp(x, y);
  };

  private onMove = (e: PointerEvent): void => {
    this.updateCursor(e.clientX, e.clientY);
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

  private onUp = (): void => {
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
   * pointer didn't move. No-ops while not hovering.
   */
  refreshCursor(): void {
    this.updateCursor(this.lastClientX, this.lastClientY);
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
    const [cx, cy] = this.clientToCell(this.lastClientX, this.lastClientY);
    const stats = inspectCells(this.grid, this.brushCells(cx, cy));
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
