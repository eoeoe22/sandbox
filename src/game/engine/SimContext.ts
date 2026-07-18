import type { Grid } from './Grid';
import { EMPTY, Phase, type BorderMode } from './types';
import { getMaterial } from '../materials/registry';
import { DIR8 } from './directions';
import { SMOKE } from '../materials/smoke';
import {
  AMBIENT_TEMP,
  DISPLACE_DRAG_BASE,
  DISPLACE_DRAG_SCALE,
  DISPLACE_SIDE_PUSH,
  OVERLAP_ABSORB_CHANCE,
  OVERLAP_SOAK_CHANCE,
  POWDER_LIQUID_OVERLAP_DEFAULT,
  type SmokeLevel,
  SMOKE_LEVEL_DEFAULT,
  SMOKE_MEDIUM_KEEP,
  type GravityDir,
} from '../config';

/** Unit "down" vector for each gravity direction (positive y is screen-down). */
const GRAVITY_VECTORS: Record<GravityDir, readonly [number, number]> = {
  down: [0, 1],
  up: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * 겹침 (overlap) hosting rule: which fluids may share a cell with which primary
 * occupants (see Grid.overlay). A porous solid (Mesh, Turbine) hosts any liquid
 * or gas — fluids move through it as if it weren't there. A powder hosts a
 * liquid (water soaking into a sand bed). Everything else hosts nothing. One
 * overlap slot per cell. Module-private: the only enforcer of the (host,
 * overlay) invariant is this seam — grid tools that relocate cells (brushTools'
 * mix) instead swap the whole (id, …, overlay, overlayAux) tuple together, so
 * an overlay is never stranded on a cell that can't host it and they need no
 * hosting check of their own.
 */
function canHostOverlap(hostId: number, fluidId: number): boolean {
  if (hostId === EMPTY || fluidId === EMPTY) return false;
  const host = getMaterial(hostId);
  const fluidPhase = getMaterial(fluidId).phase;
  if (host.porous) return fluidPhase === Phase.Liquid || fluidPhase === Phase.Gas;
  return host.phase === Phase.Powder && fluidPhase === Phase.Liquid;
}

/**
 * The narrow surface that material `update` functions operate through. It hides
 * grid indexing and the per-tick "moved" bookkeeping, so material rules read
 * declaratively ("fall down, else slide diagonally"). This is the seam that a
 * Web Worker / WASM port would reimplement without touching material code.
 */
export class SimContext {
  /**
   * Edge behavior for movement. `wall` (default) blocks any move out of the grid
   * — the original solid-container behavior. `void` deletes a particle that
   * moves out of bounds, so the sandbox has no walls or floor and drains itself.
   * Set from the UI via Simulation.setBorderMode; only movement (tryMove) reads
   * it — neighbor reactions still treat out-of-bounds as simply "nothing there".
   */
  borderMode: BorderMode = 'wall';

  /**
   * How much Smoke reactions give off, a 3-level control (see config SmokeLevel):
   * `high` lets every Smoke write through unchanged (the original "smoke on"
   * amount), `off` suppresses reaction Smoke entirely to Empty (the original
   * "smoke off"), and `medium` keeps only SMOKE_MEDIUM_KEEP of it, dropping the
   * rest to Empty. The thinning happens at the single seam below (applySmokeLevel,
   * funnelled through set/spawn), so this one field covers Fire, Blue Flame,
   * Ember, Molten Uranium, Heat Ray, etc. without threading a level into each
   * material rule. Kept public so a material can read the level directly (Blue
   * Flame leaves a wisp only at `high`). Manual brush placement paints straight to
   * the Grid (bypassing this context), so it stays unaffected — the level governs
   * reactions, not the Smoke material itself. Set from the UI via
   * Simulation.setSmokeLevel.
   */
  smokeLevel: SmokeLevel = SMOKE_LEVEL_DEFAULT;

  /**
   * Gravity as a unit "down" vector `(gravityX, gravityY)` plus a perpendicular
   * axis `(perpX, perpY)` for sideways/diagonal motion. Every movement primitive
   * (moveDown/moveUp/moveSideways/…) is expressed through these, so all bulk
   * motion follows gravity while material rules stay unaware of its direction.
   * `gravityStrength` (0..1) gates how often a gravity-driven move is even
   * attempted: 1 = normal, fractional = a floaty slow settle, 0 = weightless.
   * Set from the UI via Simulation.setGravity; defaults to plain screen-down.
   */
  gravityX = 0;
  gravityY = 1;
  private perpX = 1;
  private perpY = 0;
  gravityStrength = 1;

  /** Point gravity in `dir` at `strength` (0..1). Recomputes the down + perp
   *  vectors that every movement primitive reads. */
  setGravity(dir: GravityDir, strength: number): void {
    const [gx, gy] = GRAVITY_VECTORS[dir];
    this.gravityX = gx;
    this.gravityY = gy;
    // Perpendicular to gravity (sign is irrelevant — sideways/diagonal try both
    // ±perp): rotate the down vector 90°.
    this.perpX = -gy;
    this.perpY = gx;
    this.gravityStrength = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  }

  /** True if a gravity-driven move should be attempted this tick, per the
   *  current strength: always at 1, never at 0, else with probability =
   *  strength (giving a floaty, stall-and-drift settle at reduced gravity). */
  private gravityPass(): boolean {
    const s = this.gravityStrength;
    return s >= 1 ? true : s <= 0 ? false : Math.random() < s;
  }

  /**
   * Current simulation tick, refreshed once per step by `Simulation`. Available
   * to material rules that want time-based per-cell logic (e.g. a marker that
   * self-expires by comparing against a tick it stamped earlier) without needing
   * a dedicated per-cell field of their own.
   */
  tick = 0;

  /**
   * Fractional salt "owed" to the world by Saltwater evaporations that haven't
   * added up to a full grain yet (see salt.ts SALT_WATER_RATIO). Dissolved
   * salt isn't tracked per-cell, so this single running total is what lets one
   * Salt grain salinate many Water cells while still depositing back roughly
   * one grain per that many cells boiled off, instead of 1:1 either way.
   */
  saltDebt = 0;

  /**
   * The sugar counterpart of `saltDebt` (see sugar.ts SUGAR_WATER_RATIO). One
   * Sugar grain sweetens many Water cells into Sugar Water, and boiling Sugar
   * Water deposits Sugar back only once this running total reaches a whole grain
   * — kept separate from `saltDebt` so the two round trips never leak mass into
   * each other.
   */
  sugarDebt = 0;

  /**
   * Per-tick memo for the Turbine's body-flood (materials/turbine.ts). When
   * steam is passing through a solid turbine block, its generated pulse walks
   * the whole connected turbine body to reach conductors on the outer faces;
   * without this memo every steam-carrying cell of the block would re-flood the
   * entire body (O(N²) on a steam-soaked block — its primary use case).
   * `turbineFlooded` holds the cell indices already covered by a flood this
   * tick, so each connected body floods at most once per tick (O(N)); it is
   * cleared whenever `turbineFloodTick` falls behind the current `tick`, so it
   * self-resets without a per-step allocation. Sim-local (each Simulation has
   * its own context), so parallel worlds/tests can't cross-contaminate.
   */
  turbineFloodTick = -1;
  turbineFlooded: Set<number> = new Set();

  /**
   * Per-tick memo for the Woofer's body-flood (materials/woofer.ts) — the
   * mirror image of `turbineFlooded` above (Turbine floods outward, Woofer
   * floods inward). When an external pulse (a direct Battery contact or a
   * relayed Spark) reaches any face of a connected Woofer body, the whole
   * body fires its shockwave at once; this memo keeps a body touched from
   * several directions/sources in the same tick from re-flooding (and
   * re-firing) once per entry point. Cleared whenever `wooferFloodTick`
   * falls behind the current `tick`. Sim-local, same reasoning as
   * `turbineFlooded`.
   */
  wooferFloodTick = -1;
  wooferFlooded: Set<number> = new Set();

  /**
   * Per-tick queue of every cell a Woofer's shockwave fired from this tick
   * (populated by `wooferBodyPulse`, materials/woofer.ts; shares the same
   * `wooferFloodTick` lazy-reset guard above since both are cleared together
   * at the start of the same flood). Consumed once by `stepObjects`
   * (engine/objects.ts) after the CA scan to shove nearby free rigid bodies
   * — see `applyWooferKnockback` there.
   *
   * This is a plain event queue rather than woofer.ts importing objects.ts
   * and calling its push helper directly, specifically to avoid a real
   * (value, not just type) import cycle: objects.ts already imports
   * materials/spark.ts (for the Spark material), and spark.ts imports
   * materials/woofer.ts (to trigger a Woofer's pulse) — so woofer.ts
   * importing back into objects.ts would close the loop. Routing the event
   * through SimContext, neutral ground both sides already depend on, breaks
   * it. Never destroys a body — see applyWooferKnockback's own doc comment.
   */
  wooferPulseX: number[] = [];
  wooferPulseY: number[] = [];

  constructor(private grid: Grid) {}

  /** Grid dimensions, exposed so area-effect rules (e.g. a blast that floods a
   *  disc) can index cells by a flat `y * width + x` key without reaching past
   *  this seam into the Grid directly. */
  get width(): number {
    return this.grid.width;
  }
  get height(): number {
    return this.grid.height;
  }

  inBounds(x: number, y: number): boolean {
    return this.grid.inBounds(x, y);
  }

  get(x: number, y: number): number {
    return this.grid.get(x, y);
  }

  /** Resolve a Smoke write against the current smoke level: 'high' keeps it,
   *  'off' drops it to Empty, 'medium' keeps it with probability
   *  SMOKE_MEDIUM_KEEP. Non-Smoke ids pass through untouched. */
  private applySmokeLevel(id: number): number {
    if (id !== SMOKE.id) return id;
    if (this.smokeLevel === 'high') return id;
    if (this.smokeLevel === 'off') return EMPTY;
    return Math.random() < SMOKE_MEDIUM_KEEP ? id : EMPTY;
  }

  set(x: number, y: number, id: number): void {
    // Smoke thinned/suppressed per the current smoke level (see applySmokeLevel).
    id = this.applySmokeLevel(id);
    // 겹침 lifecycle: a write that replaces the host of an overlapped fluid has
    // to settle what happens to that fluid.
    const gi = this.grid.idx(x, y);
    const ov = this.grid.overlay[gi];
    if (ov !== 0 && !canHostOverlap(id, ov)) {
      const ovAux = this.grid.overlayAux[gi];
      this.grid.overlay[gi] = 0;
      this.grid.overlayAux[gi] = 0;
      if (id === EMPTY) {
        // Removing the host releases its absorbed fluid: the fluid takes over
        // the vacated cell instead of vanishing with the host — dissolve or
        // blast away wet sand and the water it held spills back out. It shared
        // the host's temperature, so the cell's temp is already its own, and it
        // reclaims its parked aux state (overlayAux). Marked moved so it isn't
        // double-processed within this tick.
        this.grid.set(x, y, ov);
        this.grid.setAux(x, y, ovAux);
        this.grid.tint[gi] = (Math.random() * 256) | 0;
        this.grid.moved[gi] = 1;
        return;
      }
      // Transformed into a non-host (sand melting to Molten Glass): the pore
      // space is gone, and the absorbed fluid is destroyed along with it.
    }
    this.grid.set(x, y, id);
    // Erasing/emptying a cell resets it to ambient so no stale heat lingers in
    // air (which conducts nothing and would otherwise be carried around by a
    // later swap). In-place transforms to a *non-empty* material deliberately
    // keep the cell's temperature — that's what lets a just-frozen Stone crust
    // stay cool and a just-boiled Steam cell stay hot.
    if (id === EMPTY) {
      this.grid.setTemp(x, y, AMBIENT_TEMP);
      // Aux is private per-material state (see Grid.aux); clearing it on erase
      // stops one material's leftover state (a Clone's adopted id, a
      // conductor's refractory) from being read by whatever is placed here next.
      this.grid.setAux(x, y, 0);
    } else {
      // A non-empty write is a fresh material at this cell, so reseed a random
      // per-particle tint — otherwise an in-place transform into a powder (Water
      // → Snow, Saltwater → Salt) would inherit a stale/zero tint and render as
      // a flat block, since powder tint is fixed at creation (see game/tint.ts).
      this.grid.tint[this.grid.idx(x, y)] = (Math.random() * 256) | 0;
    }
  }

  /** Current auxiliary state byte at a cell (see Grid.aux). Interpreted only by
   *  the material that occupies the cell; 0 means "no state". */
  getAux(x: number, y: number): number {
    return this.grid.getAux(x, y);
  }

  setAux(x: number, y: number, v: number): void {
    this.grid.setAux(x, y, v);
  }

  /** The 겹침 (overlap) fluid sharing this cell with its primary occupant, or
   *  EMPTY when nothing is overlapped (see Grid.overlay). A material rule can
   *  read this to react to a fluid passing through it — the Turbine makes power
   *  while Steam is in its slot. */
  getOverlay(x: number, y: number): number {
    return this.grid.getOverlay(x, y);
  }

  /** Current temperature at a cell. Material `update` rules read this to drive
   *  temperature-based phase changes (Lava→Stone freeze, Water→Steam boil). */
  getTemp(x: number, y: number): number {
    return this.grid.getTemp(x, y);
  }

  setTemp(x: number, y: number, t: number): void {
    this.grid.setTemp(x, y, t);
  }

  /** Like set(), but also marks the cell moved. Use this for any write to a
   * neighbor (non-self) cell that isn't Empty — otherwise a not-yet-scanned
   * neighbor can be reprocessed again within the same tick (runaway spread /
   * growth / explosion chains). Writes to the material's own (x,y), and
   * writes of EMPTY to any cell, are always safe via plain set(). Bounds-
   * checked (unlike a raw grid write) since, unlike today's call sites, a
   * future caller isn't guaranteed to have checked first. */
  spawn(x: number, y: number, id: number): void {
    if (!this.inBounds(x, y)) return;
    // Smoke thinned/suppressed per the current smoke level (see applySmokeLevel).
    if (id === SMOKE.id) {
      id = this.applySmokeLevel(id);
      if (id === EMPTY) {
        this.set(x, y, EMPTY);
        return;
      }
    }
    // 겹침: spawned material that can't host the fluid overlapped here destroys
    // it along with whatever held it (matches the set() transform rule); a host
    // (Debris flinging a wet grain) keeps carrying it.
    const gi = this.grid.idx(x, y);
    if (this.grid.overlay[gi] !== 0 && !canHostOverlap(id, this.grid.overlay[gi])) {
      this.grid.overlay[gi] = 0;
      this.grid.overlayAux[gi] = 0;
    }
    this.grid.set(x, y, id);
    // A spawned cell is newly created material, so it starts at that material's
    // own initial temperature (hot for Fire/Steam, ambient for the rest) —
    // mirroring how the brush places fresh material.
    this.grid.setTemp(x, y, getMaterial(id).thermal?.init ?? AMBIENT_TEMP);
    // Fresh material carries no leftover per-cell state. Callers that need a
    // specific initial state (Spark's conductor id, Battery's cadence) call
    // setAux right after this returns.
    this.grid.setAux(x, y, 0);
    // Seed a random tint so spawned powder/liquid is grainy immediately rather
    // than sharing one uniform shade until it moves (see game/tint.ts).
    this.grid.tint[this.grid.idx(x, y)] = (Math.random() * 256) | 0;
    this.grid.moved[this.grid.idx(x, y)] = 1;
  }

  isEmpty(x: number, y: number): boolean {
    return this.grid.get(x, y) === EMPTY;
  }

  /** Mark a cell as already processed this tick, so it isn't updated or reacted
   *  again in the same scan. The reaction pass (engine/reactions.ts) uses this on
   *  both cells it transforms — the same guarantee `spawn`/`swap` bake in for
   *  their writes — so a fresh reaction product can't reverse-react or be
   *  reprocessed within the tick it formed. Bounds-checked. */
  markMoved(x: number, y: number): void {
    if (this.inBounds(x, y)) this.grid.moved[this.grid.idx(x, y)] = 1;
  }

  /** True if the cell already moved/was processed this tick (see Grid.moved).
   *  A Conveyor reads this so a row of belts advances a carried cell exactly one
   *  step per tick instead of relaying it clear across in a single scan. */
  hasMoved(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.grid.moved[this.grid.idx(x, y)] === 1;
  }

  /**
   * True if the liquid at (x,y) is at or below its freezing point (see
   * Material.freeze). A frozen liquid acts solid: its own update stops flowing
   * it, and tryMove refuses to let a denser cell displace it — so a chilled
   * puddle hardens into a block that other material sits on rather than sinks
   * through, until it warms back above the freeze point. Materials without a
   * `freeze` spec (Water, the molten liquids, every non-liquid) are never frozen.
   */
  isFrozen(x: number, y: number): boolean {
    const f = getMaterial(this.grid.get(x, y)).freeze;
    return f !== undefined && this.grid.getTemp(x, y) <= f.temp;
  }

  /**
   * 겹침 admission for a *specific* host cell — layered on top of the type-level
   * `canHostOverlap` so overlap is partial, not all-or-nothing: some cells admit
   * a fluid and some block it, which is what restores a water-level rise and a
   * little drag instead of a powder passing every drop straight through. A
   * blocked cell fails every 겹침 entry point (absorb, soak, host-to-host
   * percolation, porous entry), so the fluid displaces/pools against it.
   *
   *   - Powder: a per-grain split by the grain's stable `tint` byte against the
   *     material's 액체 겹침 계수 (`liquidOverlap`, default
   *     POWDER_LIQUID_OVERLAP_DEFAULT). The coefficient is the fraction that
   *     admit; because `tint` is fixed for a grain's life (see game/tint.ts) a
   *     given grain is consistently hosting or blocking.
   *   - Lattice porous (Mesh): only the light checkerboard cells admit; the dark
   *     woven cells — the ones the renderer draws in `lattice` — block, so a
   *     screen filters at half its pore density (fluids thread the light cells,
   *     which connect diagonally, same parity). Ties the block pattern to the
   *     exact cells that look solid.
   *   - Plain porous (Turbine): every cell admits — fluids pass freely.
   */
  private canOverlapAt(x: number, y: number, hostId: number, fluidId: number): boolean {
    if (!canHostOverlap(hostId, fluidId)) return false;
    const host = getMaterial(hostId);
    if (host.phase === Phase.Powder) {
      const coeff = host.liquidOverlap ?? POWDER_LIQUID_OVERLAP_DEFAULT;
      if (coeff >= 1) return true;
      if (coeff <= 0) return false;
      // tint is uniform in [0,256): P(tint < coeff*256) = coeff grains admit.
      return this.grid.getTint(x, y) < coeff * 256;
    }
    // Mesh's dark checkerboard cells ((x^y) odd, drawn in `lattice`) block; the
    // light cells admit. Plain porous solids have no lattice → always admit.
    if (host.lattice !== undefined) return ((x ^ y) & 1) === 0;
    return true;
  }

  /** True with probability `p` (0-1). Routes material randomness through the
   * same seam as movement, so a future deterministic/worker RNG swap only
   * touches this file. */
  chance(p: number): boolean {
    return Math.random() < p;
  }

  /** Uniform integer in [0, n). Same seam rationale as chance() — materials
   * that need a random magnitude (e.g. an ember's launch speed) draw it here
   * instead of reaching for Math.random themselves. */
  randInt(n: number): number {
    return Math.floor(Math.random() * n);
  }

  /** Swap two cells and mark both as moved this tick. Temperature travels with
   *  the material, so a moving cell carries its heat (a falling drop of cold
   *  water stays cold, molten lava that flows stays hot). */
  swap(x1: number, y1: number, x2: number, y2: number): void {
    const g = this.grid;
    const a = g.idx(x1, y1);
    const b = g.idx(x2, y2);
    const t = g.cells[a];
    g.cells[a] = g.cells[b];
    g.cells[b] = t;
    const ta = g.temp[a];
    g.temp[a] = g.temp[b];
    g.temp[b] = ta;
    // Per-cell aux state travels with the material it belongs to, just like
    // temperature — so a moving conductor keeps its refractory countdown and a
    // sliding Clone keeps its adopted id.
    const xa = g.aux[a];
    g.aux[a] = g.aux[b];
    g.aux[b] = xa;
    // Cosmetic tint travels with its cell too, so a moving particle carries its
    // own shade (see Grid.tint / game/tint.ts).
    const na = g.tint[a];
    g.tint[a] = g.tint[b];
    g.tint[b] = na;
    // The 겹침 overlap fluid travels with its host (wet sand carries its water as
    // it falls), keeping the (host, overlay) tuple consistent — an overlay can
    // never be stranded on a cell that can't host it by a swap. Both overlay
    // slots are marked moved so a fluid carried by its host doesn't also
    // percolate on its own in the same tick.
    const oa = g.overlay[a];
    const ob = g.overlay[b];
    if (oa !== 0 || ob !== 0) {
      g.overlay[a] = ob;
      g.overlay[b] = oa;
      const oxa = g.overlayAux[a];
      g.overlayAux[a] = g.overlayAux[b];
      g.overlayAux[b] = oxa;
      g.overlayMoved[a] = 1;
      g.overlayMoved[b] = 1;
    }
    g.moved[a] = 1;
    g.moved[b] = 1;
    // swap writes cells/overlay directly (bypassing grid.set), so wake both
    // endpoints' tiles for the active-tile scan (see engine/dirtyTiles.ts).
    g.markActive(x1, y1);
    g.markActive(x2, y2);
  }

  /** Fluids and gases can be displaced by denser materials; solids and powders block. */
  private isDisplaceable(id: number): boolean {
    if (id === EMPTY) return true;
    const p = getMaterial(id).phase;
    return p === Phase.Liquid || p === Phase.Gas;
  }

  /** True if (px,py) is an in-bounds EMPTY cell a displaced fluid can be shoved
   *  into. Deliberately EMPTY-only: pushing into another fluid would need a
   *  recursive displacement and can cascade across the grid. */
  private canPushTo(px: number, py: number): boolean {
    return this.inBounds(px, py) && this.get(px, py) === EMPTY;
  }

  /**
   * Try to shove the fluid at (tx,ty) sideways so the mover at (x,y) can take
   * its place without the fluid teleporting past it. Tries the fluid's own
   * flanks first (flows away within its layer), then the mover's flanks (wells
   * up beside a particle sinking at the surface — the key visual), with
   * randomized left/right priority. Uses swap() so temp/aux/tint travel with
   * the fluid and both cells are marked moved. Returns true if (tx,ty) was
   * vacated; false when boxed in (deep inside a fluid body), in which case the
   * caller falls back to the legacy position swap.
   */
  private pushAside(x: number, y: number, tx: number, ty: number): boolean {
    // Shove along the axis perpendicular to gravity (horizontal under normal
    // down-gravity, vertical under sideways gravity), randomizing which flank
    // is tried first.
    const [px, py] = this.randomPerp();
    if (this.canPushTo(tx + px, ty + py)) {
      this.swap(tx, ty, tx + px, ty + py);
      return true;
    }
    if (this.canPushTo(tx - px, ty - py)) {
      this.swap(tx, ty, tx - px, ty - py);
      return true;
    }
    if (this.canPushTo(x + px, y + py)) {
      this.swap(tx, ty, x + px, y + py);
      return true;
    }
    if (this.canPushTo(x - px, y - py)) {
      this.swap(tx, ty, x - px, y - py);
      return true;
    }
    return false;
  }

  /**
   * Try to move the cell at (x,y) into (tx,ty). Moves into empty space, or
   * displaces a fluid/gas cell when doing so sorts the pair by density: a
   * denser cell sinks through a lighter one below it (ty > y), and a lighter
   * cell rises through a denser one above it (ty < y) — e.g. gas bubbling up
   * through a liquid. Returns true if it moved.
   */
  tryMove(x: number, y: number, tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) {
      // Void border: moving off the grid means falling out of the world. Delete
      // the source cell and count it as a move so the material "flows out". In
      // wall mode the edge is solid, so the move is simply blocked.
      if (this.borderMode === 'void') {
        // A 겹침 fluid absorbed in the falling cell falls out of the world with
        // its host (cleared first so set() doesn't release it at the edge).
        this.grid.setOverlay(x, y, 0);
        this.set(x, y, EMPTY);
        return true;
      }
      return false;
    }
    const targetId = this.get(tx, ty);
    if (targetId === EMPTY) {
      this.swap(x, y, tx, ty);
      return true;
    }
    const srcId = this.get(x, y);
    const src = getMaterial(srcId);
    // 겹침 entry: to a moving liquid or gas, a porous solid (Mesh, Turbine) whose
    // cell admits the fluid (canOverlapAt — a Mesh blocks on its dark
    // checkerboard cells) and has a free overlap slot is as good as empty — the
    // fluid slips into the slot and keeps travelling through the screen under its
    // own rules (see updateOverlay). One fluid per cell: a saturated screen
    // blocks like any solid until its fluid moves on. Powders are NOT entered
    // here — soaking into a bed is a deliberate last resort (soakDown), not a
    // movement path, or water would dive into sand instead of pooling on it.
    if (
      (src.phase === Phase.Liquid || src.phase === Phase.Gas) &&
      getMaterial(targetId).porous === true &&
      this.canOverlapAt(tx, ty, targetId, srcId) &&
      this.grid.getOverlay(tx, ty) === EMPTY &&
      !this.isFrozen(x, y)
    ) {
      this.enterOverlay(x, y, tx, ty, srcId);
      return true;
    }
    if (this.isDisplaceable(targetId) && !this.isFrozen(tx, ty)) {
      const tgt = getMaterial(targetId);
      // Displacement is sorted along gravity, not the screen: the move's
      // component along the down vector decides which cell should end up lower.
      // Moving *against* gravity (along < 0) a lighter cell rises through a
      // denser one (buoyancy); moving with gravity or sideways (along >= 0) a
      // denser cell sinks through a lighter one. For default down-gravity this
      // is exactly the old `ty < y ? … : …` test.
      const along = (tx - x) * this.gravityX + (ty - y) * this.gravityY;
      const displaces = along < 0 ? src.density < tgt.density : src.density > tgt.density;
      if (displaces) {
        // Drag gate: a small density gap resists displacement, so sinking
        // through a fluid is slower than free fall. Failing the gate returns
        // true — the move is CONSUMED and the particle visibly stalls against
        // the fluid this tick; returning false would let the caller's fallback
        // fire (e.g. updatePowder skating off diagonally along the surface).
        const gap = Math.abs(src.density - tgt.density);
        const p = DISPLACE_DRAG_BASE + gap * DISPLACE_DRAG_SCALE;
        if (p < 1 && !this.chance(p)) return true;
        // 겹침 absorb: a dry fluid-hosting powder grain sinking into a liquid can
        // swallow the liquid it displaces instead of shoving it aside — the
        // grain takes the liquid's cell, the liquid rides along in the grain's
        // overlap slot, and the vacated source cell closes up empty (two cells
        // become one). Gated two ways so only SOME grains absorb: the per-grain
        // 액체 겹침 계수 (canOverlapAt) rules a "겹침 불가" grain out entirely, and
        // the rest absorb only by OVERLAP_ABSORB_CHANCE. The blocked grains
        // instead shove the water aside, so sand poured into water raises the
        // level (and drags a little) rather than overlapping it away completely.
        // The absorbed water percolates on down through the bed afterwards
        // (updateOverlay).
        if (
          along > 0 &&
          this.canOverlapAt(x, y, srcId, targetId) &&
          this.grid.getOverlay(x, y) === EMPTY &&
          this.chance(OVERLAP_ABSORB_CHANCE)
        ) {
          this.swap(x, y, tx, ty); // the grain (with its temp/aux/tint) takes the liquid's cell
          const t = this.grid.idx(tx, ty);
          this.grid.overlay[t] = targetId;
          // Park the swallowed liquid's own aux (now sitting at the source cell
          // after the swap) so it survives the passage — a tagged fluid keeps
          // its identity. Read before the set() below clears the source.
          this.grid.overlayAux[t] = this.grid.getAux(x, y);
          this.grid.overlayMoved[t] = 1;
          // They now share one temperature; meet in the middle.
          this.grid.temp[t] = (this.grid.temp[t] + this.grid.getTemp(x, y)) / 2;
          this.set(x, y, EMPTY); // the swallowed liquid's old spot closes up
          return true;
        }
        // Push the displaced fluid into empty space around the intruder before
        // swapping, so it flows aside instead of teleporting to the far side.
        // Vertical/diagonal moves only — a sideways displacement has no
        // sensible shove direction. When pushAside vacates the target this
        // swap moves into empty space; when boxed in (deep fluid) it degrades
        // to the legacy position trade, invisible inside a homogeneous body.
        if (DISPLACE_SIDE_PUSH && along !== 0) this.pushAside(x, y, tx, ty);
        this.swap(x, y, tx, ty);
        return true;
      }
    }
    return false;
  }

  // The five movement primitives are all expressed relative to the gravity
  // vector (gravityX/Y) and its perpendicular (perpX/Y), and gated by gravity
  // strength — so a material rule that says "fall down, else tumble diagonally"
  // works unchanged whichever way gravity points, and slows/stops as strength
  // drops. A gated-out (stalled) move returns false, so the caller falls through
  // to its next behavior that tick, exactly as if the cell were blocked.

  /** Move one step along gravity ("down"). */
  moveDown(x: number, y: number): boolean {
    if (!this.gravityPass()) return false;
    return this.tryMove(x, y, x + this.gravityX, y + this.gravityY);
  }

  /** A random perpendicular-to-gravity step, ±(perpX,perpY) with the sign
   *  picked 50/50 — the shared "which side to try first" roll behind every
   *  sideways/diagonal primitive below. */
  private randomPerp(): [number, number] {
    const s = Math.random() < 0.5 ? -1 : 1;
    return [this.perpX * s, this.perpY * s];
  }

  /** Move one step diagonally along gravity (down + either perpendicular side). */
  moveDiagonalDown(x: number, y: number): boolean {
    if (!this.gravityPass()) return false;
    const [px, py] = this.randomPerp();
    const dgx = this.gravityX;
    const dgy = this.gravityY;
    return (
      this.tryMove(x, y, x + dgx + px, y + dgy + py) ||
      this.tryMove(x, y, x + dgx - px, y + dgy - py)
    );
  }

  /** Move one step against gravity ("up" — buoyant rise). */
  moveUp(x: number, y: number): boolean {
    if (!this.gravityPass()) return false;
    return this.tryMove(x, y, x - this.gravityX, y - this.gravityY);
  }

  /** Move one step diagonally against gravity (up + either perpendicular side). */
  moveDiagonalUp(x: number, y: number): boolean {
    if (!this.gravityPass()) return false;
    const [px, py] = this.randomPerp();
    return (
      this.tryMove(x, y, x - this.gravityX + px, y - this.gravityY + py) ||
      this.tryMove(x, y, x - this.gravityX - px, y - this.gravityY - py)
    );
  }

  /** Move one step perpendicular to gravity (sideways leveling / spreading). */
  moveSideways(x: number, y: number): boolean {
    if (!this.gravityPass()) return false;
    const [px, py] = this.randomPerp();
    return this.tryMove(x, y, x + px, y + py) || this.tryMove(x, y, x - px, y - py);
  }

  /**
   * Sideways move for a cell already established to be buoyantly floating
   * (resting on a denser Liquid — see behaviors.ts's flattenIfFloating): tries
   * the same density-sorted attempt as moveSideways first (inlined here, not
   * delegated, so gravityPass is only rolled once), then — if both flanks are
   * blocked — swaps unconditionally with an adjacent Liquid cell
   * (swapOntoLiquid). The fallback exists because tryMove's sideways rule
   * requires the *mover* be denser to displace a neighbor — right for two
   * different-density liquids leveling out, backwards for a raft that's
   * already lighter than the liquid holding it up and just needs to glide
   * across it. Without this, a floating raft in a pool's interior (liquid on
   * both flanks, not open air) could never spread — only escape through an
   * incidental gap at the pool's edge.
   */
  moveSidewaysBuoyant(x: number, y: number): boolean {
    if (!this.gravityPass()) return false;
    const [px, py] = this.randomPerp();
    return (
      this.tryMove(x, y, x + px, y + py) ||
      this.tryMove(x, y, x - px, y - py) ||
      this.swapOntoLiquid(x, y, x + px, y + py) ||
      this.swapOntoLiquid(x, y, x - px, y - py)
    );
  }

  /**
   * Sideways move for a cell pinned in place by melt above it (see
   * behaviors.ts's updatePowderSink / moltenironore.ts's tryHoldInActiveMelt):
   * swaps unconditionally with an adjacent Liquid neighbor via swapOntoLiquid,
   * the same fallback moveSidewaysBuoyant uses — but skips the density-sorted
   * tryMove attempt that method tries first, since tryMove treats an EMPTY
   * neighbor as always enterable. A grain still covered above must stay
   * contained within the melt (that's the whole point of the hold), so
   * stepping into open air the instant one happens to be exposed at that row
   * would defeat it; only a Liquid neighbor is ever a valid target here.
   */
  moveSidewaysContained(x: number, y: number): boolean {
    if (!this.gravityPass()) return false;
    const [px, py] = this.randomPerp();
    return (
      this.swapOntoLiquid(x, y, x + px, y + py) || this.swapOntoLiquid(x, y, x - px, y - py)
    );
  }

  /** Unconditional swap with an adjacent Liquid cell, skipping both tryMove's
   *  density-sort and its DISPLACE_DRAG throttle. Two callers rely on this for
   *  different reasons. moveSidewaysBuoyant always tries the normal
   *  density-sorted tryMove on this same (tx,ty) first — that prior attempt is
   *  what makes skipping the density check safe there, not an assumption about
   *  material densities: tryMove's sideways rule only fails when the mover
   *  *isn't* denser than the target, so by the time this runs the target is
   *  already guaranteed to be at least as dense as the mover. moveSidewaysContained
   *  has no such prior attempt and doesn't need one: its caller (updatePowderSink,
   *  via tryHoldInActiveMelt) is itself a deliberate override of the density rule
   *  — the grain is being held in the melt *against* what its own density would
   *  otherwise do — so redistributing it among Liquid neighbors regardless of
   *  their relative density is exactly the intended behavior, not a hazard to
   *  guard against. Neither caller wants a drag gate either — gating this on
   *  density gap the way vertical displacement is would just reintroduce the
   *  stuck-column problem moveSidewaysBuoyant exists to fix, and would throttle
   *  moveSidewaysContained's redistribution for no reason (it isn't sorting by
   *  density in the first place). Doesn't require the neighbor be the *same*
   *  liquid the mover is floating on/pinned in — any Liquid counts, matching the
   *  density-only rule floatingOnLiquid/tryBuoyantRise already use everywhere
   *  else (a powder floats clear of whichever liquid it's lighter than, not
   *  just one it's "assigned" to). */
  private swapOntoLiquid(x: number, y: number, tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty) || this.isFrozen(tx, ty)) return false;
    const id = this.get(tx, ty);
    if (id === EMPTY || getMaterial(id).phase !== Phase.Liquid) return false;
    this.swap(x, y, tx, ty);
    return true;
  }

  /**
   * Single isotropic step into a random empty neighbor (8-directional). Unlike
   * the primitives above this is NOT gated by gravity strength — it models
   * gravity-independent thermal diffusion, so a gas keeps spreading (rather than
   * freezing in place like a solid) as gravity weakens toward zero. Honors the
   * void border the same way tryMove does. Empty-target only, so it's pure
   * spreading through open space, never a density displacement. Returns true if
   * the cell moved (or drained out a void edge).
   */
  moveRandom(x: number, y: number): boolean {
    const [dx, dy] = DIR8[this.randInt(8)];
    const tx = x + dx;
    const ty = y + dy;
    if (!this.inBounds(tx, ty)) {
      if (this.borderMode === 'void') {
        this.set(x, y, EMPTY);
        return true;
      }
      return false;
    }
    if (this.get(tx, ty) === EMPTY) {
      this.swap(x, y, tx, ty);
      return true;
    }
    return false;
  }

  /** Move the fluid at (x,y) into the free 겹침 slot of the host at (tx,ty).
   *  The two now share one cell — and one temperature, met in the middle (a
   *  fluid carries heat in/out of the screen or bed it passes through). The
   *  fluid's aux rides along in the overlay's parked slot (overlayAux) so a
   *  tagged fluid keeps its identity; its tint is shed (reseeded on exit). */
  private enterOverlay(x: number, y: number, tx: number, ty: number, fluidId: number): void {
    const g = this.grid;
    const t = g.idx(tx, ty);
    g.overlay[t] = fluidId;
    g.overlayAux[t] = g.getAux(x, y);
    g.overlayMoved[t] = 1;
    g.temp[t] = (g.temp[t] + g.getTemp(x, y)) / 2;
    g.markActive(tx, ty); // direct overlay write — wake the host's tile
    this.set(x, y, EMPTY); // marks (x,y) itself
  }

  /**
   * 겹침 soak: last-resort move for a liquid with nowhere left to flow — seep
   * down into a fluid-hosting powder bed below (straight down, then the two
   * diagonals). Chance-gated (OVERLAP_SOAK_CHANCE) so a standing pool sinks
   * into sand gradually. Once inside, the liquid keeps percolating down through
   * the bed via the overlap layer (updateOverlay) — which is what lets water
   * reach a Mesh floor buried under sand and still drain out (모래가 체와 물
   * 사이를 가로막아도 물이 샌다). Returns true if the liquid soaked in.
   */
  soakDown(x: number, y: number): boolean {
    if (!this.chance(OVERLAP_SOAK_CHANCE)) return false;
    const dir = this.chance(0.5) ? 1 : -1;
    return (
      this.soakInto(x, y, x, y + 1) ||
      this.soakInto(x, y, x + dir, y + 1) ||
      this.soakInto(x, y, x - dir, y + 1)
    );
  }

  private soakInto(x: number, y: number, tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const targetId = this.get(tx, ty);
    // Powder beds only: porous solids are already entered at full priority by
    // ordinary movement (tryMove), so they never need the soak fallback.
    if (getMaterial(targetId).phase !== Phase.Powder) return false;
    const srcId = this.get(x, y);
    // A "겹침 불가" grain (per its 액체 겹침 계수) refuses the soak, so a pool over
    // a partly-permeable bed sinks in only through the hosting grains.
    if (!this.canOverlapAt(tx, ty, targetId, srcId)) return false;
    if (this.grid.getOverlay(tx, ty) !== EMPTY) return false;
    this.enterOverlay(x, y, tx, ty, srcId);
    return true;
  }

  /**
   * Per-tick movement for the 겹침 (overlap) fluid at a host cell: a liquid
   * seeps downward (down, then diagonally down, then sideways along the bed), a
   * gas bubbles upward (mirrored). Each step either transfers into the next
   * host's free overlap slot — percolating through a sand bed, crossing a mesh
   * wall of any thickness — or exits into an EMPTY cell, where the fluid
   * surfaces as an ordinary particle again. Exits are EMPTY-only, so a fluid
   * never pops out into another fluid's cell (and can't ping-pong back and
   * forth across a wall — re-entering its own pool is impossible). Overlapped
   * fluids get no material update: no boiling, freezing, or reactions while
   * inside a host. Called by Simulation's scan, guarded by Grid.overlayMoved.
   */
  updateOverlay(x: number, y: number): void {
    // Overlap percolation is gravity-driven too, so it stalls/freezes with the
    // strength gate (weightless mode holds soaked fluids in place). Its
    // direction stays screen-relative — a niche secondary layer inside porous
    // hosts, not worth rotating with the bulk motion.
    if (!this.gravityPass()) return;
    const fluidId = this.grid.getOverlay(x, y);
    // Liquids sink, gases rise; everything tries its vertical first.
    const dy = getMaterial(fluidId).phase === Phase.Gas ? -1 : 1;
    const dir = this.chance(0.5) ? 1 : -1;
    if (this.tryOverlayMove(x, y, x, y + dy)) return;
    if (this.tryOverlayMove(x, y, x + dir, y + dy)) return;
    if (this.tryOverlayMove(x, y, x - dir, y + dy)) return;
    if (this.tryOverlayMove(x, y, x + dir, y)) return;
    this.tryOverlayMove(x, y, x - dir, y);
  }

  private tryOverlayMove(x: number, y: number, tx: number, ty: number): boolean {
    const g = this.grid;
    const i = g.idx(x, y);
    const fluidId = g.overlay[i];
    if (!this.inBounds(tx, ty)) {
      // Mirrors tryMove's border rule: open void edges drop the fluid out of
      // the world; wall edges block it.
      if (this.borderMode === 'void') {
        g.overlay[i] = 0;
        g.overlayAux[i] = 0;
        return true;
      }
      return false;
    }
    const targetId = this.get(tx, ty);
    if (targetId === EMPTY) {
      // Exit: the fluid becomes an ordinary particle again, at the temperature
      // it shared with its host, reclaiming its parked aux (so a tagged fluid
      // re-condenses to the right cut), with a fresh tint (it carried none).
      const t = g.idx(tx, ty);
      g.cells[t] = fluidId;
      g.temp[t] = g.temp[i];
      g.aux[t] = g.overlayAux[i];
      g.tint[t] = (Math.random() * 256) | 0;
      g.moved[t] = 1;
      g.overlay[i] = 0;
      g.overlayAux[i] = 0;
      g.markActive(tx, ty); // fluid re-surfaced here — wake its tile
      return true;
    }
    if (this.canOverlapAt(tx, ty, targetId, fluidId) && g.overlay[g.idx(tx, ty)] === 0) {
      const t = g.idx(tx, ty);
      g.overlay[t] = fluidId;
      g.overlayAux[t] = g.overlayAux[i]; // the parked aux rides along, host to host
      g.overlayMoved[t] = 1;
      g.overlay[i] = 0;
      g.overlayAux[i] = 0;
      g.markActive(tx, ty); // overlay moved into this host — wake its tile
      return true;
    }
    return false;
  }
}
