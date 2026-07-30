import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { floodDeviceBody } from '../engine/deviceBody';
import type { SimContext } from '../engine/SimContext';

// Electromagnet (전자석) — an electric appliance that PULLS. Every force in the
// sandbox so far pushes: explosions, the Woofer's thump, the Fan's gust, the
// Conveyor. Nothing gathers. The magnet is the missing sign, and it doesn't just
// pull — it pulls *selectively*: where wind shoves anything loose, the field only
// takes ferromagnetic matter (`Material.magnetic` — Metal Powder, Rust Powder,
// Iron Ore, Nanobot). That selectivity is the whole toy. Hang one over a mixed
// heap and it lifts the iron filings out of the sand and slag, fishes metal back
// out of a tank of water, and plucks crawling Nanobots off the floor and holds
// them — a 자력 선별기 you build rather than a button you press.
//
// ## The field
//
// The pull is a geodesic (octile) shortest-path sweep out of the magnet body's own
// outline — the same distance field the Woofer's shockwave and the renderer's own
// 자기력선 rings use — not a radius from a point (see `pullField` for why the
// metric is octile and not hop count). Two consequences fall out of that and both
// are wanted:
//
//   • **Solids block it.** The sweep only spreads through matter it could pull
//     something *through* — air, gas, liquid, powder, crawlers — so a structural
//     solid casts a shadow. Sink a magnet behind an iron plate and it reaches
//     nothing; box it in and it's inert. (Real ferromagnetic shielding does about
//     the same thing, which is a pleasant coincidence rather than the reason.)
//   • **Shape matters.** A long magnet bar pulls along its whole length, because
//     the field grows from every body cell at once instead of from a centre.
//     The outer boundary is the body's bounding box grown by REACH, so a wide
//     magnet has a wide field rather than a circular one that misses its own ends.
//
// Each swept cell remembers the neighbor it was reached *from*, so pulling is just
// "step one cell back along the path to the magnet" — which is what makes the pull
// follow the field around a corner instead of dragging a grain into the wall it's
// behind. Cells are pulled nearest-first so the grain in front vacates before the
// grain behind it steps up, and a whole column creeps in rather than jamming.
//
// ## Holding
//
// A grain that *can't* step closer — it's already against the magnet, or the cell
// ahead is occupied by another grain that's also clinging — is marked moved for the
// tick instead. That's what makes a magnet hold a clump against gravity rather than
// juggle it: without it, every grain would fall a cell and be re-pulled a cell,
// forever, and nothing would ever collect. The `moved` flag also gates the reaction
// pass (see Simulation.updateCell), so matter held on a live magnet doesn't react
// while it's held — iron filings stuck to an energized magnet won't rust until you
// cut the power. That's a real cost, accepted deliberately: "the magnet freezes
// what it grips" is a legible rule, and a jittering cloud that never clumps would
// have made the whole material pointless.
//
// ## Powering
//
// The Fan's one-way "outside → inside" electric sink, verbatim (see fan.ts, and
// the pattern write-up in woofer.ts): deliberately NOT `conductive` (a magnet wall
// would otherwise be a free wire, and spark.ts's conductor-class field has only a
// handful of slots left), just a `Material.directPulse` hook, so a Battery/LFP
// Battery/Turbine in contact or a Spark relayed down a wire all energize it
// through the one shared dispatch (`reactToPulse`) with no per-source special
// casing. A pulse floods the whole connected body (`floodDeviceBody` — 전기 세기에
// 관계없이 연결 부위 전역 즉시 활성화, see engine/deviceBody.ts) and refreshes a
// powered countdown generous enough to bridge the quiet ticks between a Battery's
// periodic pulses, so the field holds steadily instead of strobing its grip on and
// off.
//
// Unlike the Fan and Laser the magnet has no direction to record, so its whole
// `aux` byte is the countdown and the renderer draws brightening coil windings
// rather than a directional mark (see Material.coilPattern). The mark it is being
// contrasted with is the Laser's chevron — the Fan still *stores* a direction in
// its low aux bits, it just stopped drawing one when it took the rotor wheel
// (Material.rotorPattern).

/** Ticks a single power pulse keeps the field up. Set well above the Battery's
 *  PULSE_PERIOD (12) so the grip never lapses between pulses — a held clump would
 *  visibly drop and be re-caught otherwise. Matches the Fan/Laser/Pump; the whole
 *  aux byte is the countdown here, so there's no packing limit to respect. */
const POWERED_TICKS = 24;

/** How far the field reaches past the magnet body, in cells. Comparable to the
 *  Woofer's effective shove radius (~8) — far enough to sweep a heap poured under
 *  it, short enough that a magnet is a local tool you position rather than a
 *  world-wide vacuum. */
const REACH = 10;

/** Absolute backstop on how many cells one field sweep visits — a runaway guard,
 *  not a tuning knob. The real budget is per-magnet: the box the field can occupy
 *  at all, i.e. the body's bounding box grown by REACH on every side (see
 *  `pullField`). That is exactly the region the 자기력선 rings are drawn in, so the
 *  pull now covers everything the effect promises.
 *
 *  It used to be a flat 1024 cells, which quietly made the magnet *narrower than
 *  its own halo* as soon as a body got big: the sweep is nearest-first, so the
 *  cells it dropped were the far ones — the outer rings. Measured against the
 *  ring region (geodesic REACH from the body, the renderer's own field): a 20×20
 *  block lost 38 of its outermost cells, a 40×6 bar 136, and a 60×3 bar 456 —
 *  39% of the drawn halo, with nothing at all pulling past 6 cells at the far end
 *  of the bar. Long bars are exactly the shape a 자력 선별기 wants, so the flat cap
 *  was hitting the build it was most needed for.
 *
 *  The sweep only ever enqueues *passable* cells, so the box budget doesn't turn
 *  into box-sized work: a solid 300×300 magnet's box is 320×320, but the air band
 *  it can actually walk is ~12k cells. This ceiling only bounds the pathological
 *  end (a board-spanning magnet in open air).
 *
 *  Note what any of this caps and what it doesn't: the *field* (an effect swept
 *  through open space every tick the countdown is live), never the magnet's
 *  activation. The body itself — which cells are powered, and which cells the field
 *  is grown out of — is always walked in full (see `floodDeviceBody`,
 *  engine/deviceBody.ts: 전기 세기에 관계없이 연결 부위 전역 즉시 활성화). */
const MAX_FIELD_CELLS = 65536;

// ── Sweep scratch ────────────────────────────────────────────────────────────
/** The sweep works over a *local field box* — the body's bounding box grown by
 *  REACH, clipped to the grid — indexed li = (y-ly0)*lbw + (x-lx0). Flat typed
 *  arrays over that box rather than Maps keyed by cell, because this runs EVERY
 *  tick a magnet is powered (unlike the power flood, which only runs on a pulse),
 *  so nothing here should allocate or hash per cell. They are module scratch,
 *  grown on demand and never cleared: a per-sweep generation stamp says which
 *  entries belong to the current sweep, so a sweep costs its own cells and not the
 *  box's area.
 *
 *  Worth being straight about what this bought: it pays for *part* of the octile
 *  Dijkstra that replaced the old hop-count BFS, not all of it. Interleaved
 *  measurement against the BFS (medians of 3 rounds): a 60×3 bar 0.64 → 0.84
 *  ms/tick, a 20×20 block 0.58 → 0.68, an 8×8 0.24 → 0.29. The heap's push/pop and
 *  re-relaxation are simply more work than a queue, and correct pull directions are
 *  what that buys (see `pullField`).
 *
 *  Safe as module state for the same reason the old containers were: nothing here
 *  outlives a single synchronous `pullField` call — the generation is bumped on
 *  entry and every read is gated on it — so two Simulations sharing this module
 *  can't leak state into each other the way a tick-keyed cache would (see
 *  SimContext.wooferFlood's note on exactly that hazard). */
let fDist = new Float64Array(0);
/** Predecessor on the shortest path back to the magnet, as a local index
 *  (-1 = the body itself, i.e. this cell is a clinging position). */
let fPar = new Int32Array(0);
/** Generation this cell was given a distance in. */
let fStamp = new Uint32Array(0);
/** Generation this cell was settled (popped at its final distance) in. */
let fSettled = new Uint32Array(0);
let fGen = 0;

/** Swept cells in nearest-first (settled) order — the order the pull walks them. */
const sweptX: number[] = [];
const sweptY: number[] = [];
/** Binary min-heap over pending local indices (parallel key/index arrays), so the
 *  sweep settles cells in true distance order rather than hop order. */
const heapD: number[] = [];
const heapI: number[] = [];

/** Diagonal step cost — the sweep measures the same octile distance the renderer's
 *  ring field does (CanvasRenderer.buildShockField), so what pulls and what is
 *  drawn are the same set of cells by construction. */
const DIAG = Math.SQRT2;

function heapPush(d: number, i: number): void {
  let c = heapD.length;
  heapD.push(d);
  heapI.push(i);
  while (c > 0) {
    const par = (c - 1) >> 1;
    if (heapD[par] <= heapD[c]) break;
    const td = heapD[par];
    heapD[par] = heapD[c];
    heapD[c] = td;
    const ti = heapI[par];
    heapI[par] = heapI[c];
    heapI[c] = ti;
    c = par;
  }
}

/** Pop the nearest pending cell's local index, or -1 when the heap is empty. */
function heapPop(): number {
  const n = heapD.length;
  if (n === 0) return -1;
  const top = heapI[0];
  const lastD = heapD.pop()!;
  const lastI = heapI.pop()!;
  if (heapD.length > 0) {
    heapD[0] = lastD;
    heapI[0] = lastI;
    let par = 0;
    const len = heapD.length;
    for (;;) {
      const l = 2 * par + 1;
      const r = l + 1;
      let m = par;
      if (l < len && heapD[l] < heapD[m]) m = l;
      if (r < len && heapD[r] < heapD[m]) m = r;
      if (m === par) break;
      const td = heapD[par];
      heapD[par] = heapD[m];
      heapD[m] = td;
      const ti = heapI[par];
      heapI[par] = heapI[m];
      heapI[m] = ti;
      par = m;
    }
  }
  return top;
}

/** True if the field spreads *through* this cell: air, or any matter loose enough
 *  that a grain could be dragged through it — gas, liquid, powder, and the
 *  `shockLoose` crawlers (a Termite is a Solid only because it walks instead of
 *  piling, so it shouldn't shield a magnet any more than it shields a shockwave).
 *  Structural solids stop the sweep and shadow whatever is behind them; a frozen
 *  liquid counts as one, since below its freeze point it acts solid everywhere
 *  else too (see SimContext.isFrozen). */
function isFieldPassable(sim: SimContext, x: number, y: number): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return true;
  const m = getMaterial(id);
  if (m.shockLoose) return true;
  const p = m.phase;
  if (p !== Phase.Powder && p !== Phase.Liquid && p !== Phase.Gas) return false;
  return !sim.isFrozen(x, y);
}

/** True if the cell holds ferromagnetic matter this field can actually move.
 *  `magnetic` alone isn't enough: a structural solid is never dragged, so tagging
 *  one (a future magnetized wall/rail) can't tear a player's build off its mounts
 *  — the same rule the Fan's gust follows for solids. Only loose phases and
 *  `shockLoose` crawlers are pulled. */
function isPullable(sim: SimContext, x: number, y: number): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (!m.magnetic) return false;
  return m.phase !== Phase.Solid || m.shockLoose === true;
}

/** True if a pulled grain can step into this cell, displacing whatever is there
 *  back into the grain's own spot. Empty air always takes it; so does gas, liquid
 *  and (non-magnetic) powder — that last one is what lets the field draw iron
 *  filings *up through* a heap of sand, which is the whole separator toy. Blocked
 *  by: another magnetic grain (it's clinging too — the column waits), a frozen
 *  liquid or any structural solid, and a `packedTemp` particle (Ember/Debris/
 *  Blast/Nuclear Ray/Heat Ray), whose `temp` holds flight state rather than heat
 *  and which must not be teleported out of its own arc. */
function acceptsPull(sim: SimContext, x: number, y: number): boolean {
  const id = sim.get(x, y);
  if (id === EMPTY) return true;
  const m = getMaterial(id);
  if (m.magnetic || m.packedTemp) return false;
  const p = m.phase;
  if (p !== Phase.Powder && p !== Phase.Liquid && p !== Phase.Gas) return false;
  return !sim.isFrozen(x, y);
}

/**
 * Sweep the field around one connected magnet body and pull everything
 * ferromagnetic in it one cell closer (or hold it, if it can't get closer). See
 * the header for why it's a sweep out of the body's outline and not a radius.
 *
 * The sweep is a **geodesic (octile) shortest-path field**: a Dijkstra out of every
 * body cell at once, one unit per orthogonal step and √2 per diagonal, cut off at
 * REACH and blocked by structural solids. Two things fall out of measuring distance
 * that way rather than in hops, and both are the point:
 *
 *   • **A grain is pulled toward the nearest part of the magnet, along the straight
 *     line to it.** Counting hops made every direction within the diagonal cone
 *     equally near, so the predecessor a cell recorded was whichever neighbour the
 *     queue happened to reach it from — systematically a diagonal one. Matter under
 *     a flat face crabbed sideways up a 45° staircase instead of rising straight
 *     into it (자기력선이 평행한 곳에서도 45도로만 붙던 문제), and a grain beside a
 *     tall face slid *down* along it. With octile costs the shortest path from a
 *     cell straight below a face is straight up (5 beats 1·√2+4), so the pull is
 *     perpendicular to a flat face and diagonal only where the geometry really is.
 *   • **The pull covers exactly what the 자기력선 rings draw**, since the renderer's
 *     ring field is the same octile Dijkstra (CanvasRenderer.buildShockField). The
 *     old hop metric reached cells at off-diagonal angles that no ring was drawn in
 *     (measured: 33 of 1091 candidates around an 8×8 body), which is now impossible
 *     by construction rather than by tuning.
 *
 * Following the predecessor chain still walks *around* obstacles — that's what a
 * geodesic field is — so the field bending around a corner is unchanged.
 *
 * `bx`/`by` are the body's surface cells and `minX..maxY` its bounding box (used
 * only to size the sweep's budget).
 */
function pullField(
  sim: SimContext,
  bx: readonly number[],
  by: readonly number[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  // The local field box: the body's box grown by REACH (all the field can occupy),
  // clipped to the grid. Everything below is indexed inside it.
  const lx0 = Math.max(0, minX - REACH);
  const ly0 = Math.max(0, minY - REACH);
  const lx1 = Math.min(sim.width - 1, maxX + REACH);
  const ly1 = Math.min(sim.height - 1, maxY + REACH);
  const lbw = lx1 - lx0 + 1;
  const lbh = ly1 - ly0 + 1;
  const need = lbw * lbh;
  if (fDist.length < need) {
    fDist = new Float64Array(need);
    fPar = new Int32Array(need);
    fStamp = new Uint32Array(need);
    fSettled = new Uint32Array(need);
    fGen = 0; // fresh arrays read as generation 0 everywhere
  }
  if (fGen === 0xffffffff) {
    fStamp.fill(0);
    fSettled.fill(0);
    fGen = 0;
  }
  fGen++;
  sweptX.length = 0;
  sweptY.length = 0;
  heapD.length = 0;
  heapI.length = 0;

  // This sweep's cell budget: the box the field can occupy at all, which is exactly
  // the region the rings are drawn in — so the pull reaches everywhere the halo says
  // it does, whatever the body's size or shape. Only passable cells are ever taken,
  // so this bounds the *region*, not the work. MAX_FIELD_CELLS is the runaway
  // backstop.
  const budget = Math.min(MAX_FIELD_CELLS, need);
  let taken = 0;

  /** Relax (x,y) to distance `d` reached from local index `par` (-1 = the body). */
  const relax = (x: number, y: number, d: number, par: number): void => {
    if (d > REACH || x < lx0 || x > lx1 || y < ly0 || y > ly1) return;
    const li = (y - ly0) * lbw + (x - lx0);
    if (fSettled[li] === fGen) return; // already final — Dijkstra can't improve it
    if (fStamp[li] === fGen) {
      if (fDist[li] <= d) return; // already on a path at least as short
    } else {
      if (taken >= budget || !isFieldPassable(sim, x, y)) return;
      fStamp[li] = fGen;
      taken++;
    }
    fDist[li] = d;
    fPar[li] = par;
    heapPush(d, li);
  };

  // Seed: every cell touching the body (8-connected, so a grain sitting on a
  // corner clings too) starts one step out, and its "path back" is the magnet
  // itself. A diagonal touch really is √2 away, which is what keeps a corner from
  // out-pulling the flat face beside it.
  for (let i = 0; i < bx.length; i++) {
    for (const [dx, dy] of DIR8) relax(bx[i] + dx, by[i] + dy, dx && dy ? DIAG : 1, -1);
  }

  // Settle the field outward, nearest first — the order the pull below relies on.
  // A cell can sit in the heap more than once (re-relaxed onto a shorter path);
  // only its final, settled visit is recorded and walks its neighbours.
  for (;;) {
    const li = heapPop();
    if (li < 0) break;
    if (fSettled[li] === fGen) continue;
    fSettled[li] = fGen;
    const x = lx0 + (li % lbw);
    const y = ly0 + ((li / lbw) | 0);
    sweptX.push(x);
    sweptY.push(y);
    const d = fDist[li];
    if (d >= REACH) continue;
    for (const [dx, dy] of DIR8) relax(x + dx, y + dy, d + (dx && dy ? DIAG : 1), li);
  }

  // Pull, nearest-first: the grain in front vacates before the one behind it steps
  // up, so a column creeps toward the magnet instead of jamming against itself.
  for (let i = 0; i < sweptX.length; i++) {
    let cx = sweptX[i];
    let cy = sweptY[i];
    if (!isPullable(sim, cx, cy)) continue;
    // How many cells the grain travels along the field path this tick. Normally
    // one — but a grain that has ALREADY resolved its own motion this scan gets
    // two, so the pull is measured from where the grain started the tick rather
    // than from where something else left it. With the field's own gravity override
    // (see `holdMagnetically` below) that is no longer the common case it was
    // written for — matter in a live field doesn't take a gravity step of its own
    // any more — but a grain shoved by a gust or a blast still arrives here already
    // moved, and this is what puts it straight back on the magnet.
    let steps = sim.hasMoved(cx, cy) ? 2 : 1;
    while (steps-- > 0) {
      const li = (cy - ly0) * lbw + (cx - lx0);
      const par = fPar[li];
      // A settled cell always has a predecessor; -1 means the grain is already
      // against the magnet — either way there is nowhere closer to go.
      if (fStamp[li] !== fGen || par < 0) break;
      const tx = lx0 + (par % lbw);
      const ty = ly0 + ((par / lbw) | 0);
      if (!acceptsPull(sim, tx, ty)) break; // blocked by the clump in front
      // swap carries the grain's temp/aux/tint (and marks both ends moved), so a
      // red-hot filing arrives still hot.
      sim.swap(cx, cy, tx, ty);
      cx = tx;
      cy = ty;
    }
    // Hold it wherever it ended up: `markMoved` keeps the rest of *this* tick's
    // scan off it, and `holdMagnetically` carries that over to the next tick, where
    // it overrides the grain's own gravity step before the magnet has even been
    // scanned (see SimContext.isMagnetHeld / Simulation.updateCell). Without the
    // second one the grain falls a cell on every tick the scan reaches it first and
    // is yanked back on the next — the shiver on a magnet's underside
    // (떨어지려는 철가루와 당기는 자력이 충돌해 흔들리던 문제).
    sim.markMoved(cx, cy);
    sim.holdMagnetically(cx, cy);
  }
}

/** True if this body cell touches anything that isn't the magnet itself — the only
 *  cells a field sweep can seed from (see `pullField`'s seeding round and the note
 *  in updateElectromagnet). In-bounds is required both ways: an off-grid neighbor
 *  is nothing to seed into, so a cell hard against the world edge is "interior" as
 *  far as that edge is concerned. */
function isBodySurface(sim: SimContext, x: number, y: number): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) !== ELECTROMAGNET.id) return true;
  }
  return false;
}

/**
 * One magnet cell's tick. The countdown is per-cell (every cell of the body was
 * refreshed together by the last pulse), but the *field* belongs to the body as a
 * whole, so only the first cell of a given body to be scanned this tick sweeps it
 * — the rest find themselves already recorded in `SimContext.magnetField` and
 * just spin their own countdown down. Without that memo an N-cell magnet would
 * sweep the same field N times a tick.
 */
function updateElectromagnet(x: number, y: number, sim: SimContext): void {
  const timer = sim.getAux(x, y);
  if (timer <= 0) return; // idle until a pulse energizes the body
  sim.setAux(x, y, timer - 1);

  // Walk the connected *powered* body in full (4-connected, the shared
  // `floodDeviceBody` every device's activation uses), recording its bounding box
  // and its *surface* cells, and claiming all of it for this tick — so the field is
  // grown out of the magnet's whole outline, not just the corner of it nearest the
  // scan.
  //
  // Powered-only (the `canWalk` guard) is kept from the field-line effect's own
  // walk, with half its reason retired: it was there both to make the *chunks* a
  // capped walk breaks a big body into a stable partition, and to keep dead magnet
  // from seeding a pull it isn't making. There are no chunks any more — the walk is
  // uncapped, so a powered body is swept whole, once, every tick, and the
  // renderer's membership fingerprint can't churn with scan direction because
  // there's nothing to partition. The second reason stands on its own: a stretch no
  // pulse has reached yet (a freshly painted extension) is not part of this
  // magnet's field until the next beat powers it. The other old guard (skip cells
  // an earlier walk claimed this tick) is now the memo's own job — `floodDeviceBody`
  // marks at push time, so its memo *is* the walk's visited set.
  //
  // Only surface cells are collected because only they can seed anything: pullField
  // seeds by trying each body cell's 8 neighbors, and a neighbor that is itself
  // magnet is never field-passable, so an interior cell's whole seeding round is
  // rejected. Handing over the interior anyway made a solid block pay 8 dead
  // enqueues per cell. That matters here more than for any other device: the magnet
  // is the one whose body walk runs EVERY tick it's powered (the field pulls every
  // tick), not once per pulse — so now that a pulse genuinely lights the whole body,
  // the whole body is what gets walked, every tick. Measured on a 300×300 block:
  // 90,000 seeds → ~1,200, 61.7 → 45.4 ms/tick, with the swept field — and so the
  // pull — bit-identical. (For scale, the old 256-cell cap "cost" 58.1 ms/tick on
  // the same block while powering only 512 of its 90,000 cells, and 4.9 *seconds*
  // when several faces were fed at once, because every cell the cap left unclaimed
  // restarted its own capped walk and its own sweep. The cap bought no speed; it
  // just stopped the machine from working. See docs/ELECTRICITY.md.) The bounding
  // box is still taken over every cell (its extremes are surface cells regardless,
  // but this way the box can't drift if the surface rule is ever narrowed).
  //
  // The surface set is also all the *renderer* needs for the 자기력선 rings below:
  // buildShockField seeds distance 0 on exactly the cells it's handed and expands
  // only through non-solid cells, so an interior magnet cell can only ever be a
  // seed that goes nowhere and lands in band 0, which draws no ring. Same picture,
  // and the per-frame membership fingerprint gets shorter with it.
  const bx: number[] = [];
  const by: number[] = [];
  let minX = x;
  let minY = y;
  let maxX = x;
  let maxY = y;
  const swept = floodDeviceBody(
    sim,
    x,
    y,
    ELECTROMAGNET.id,
    sim.magnetField,
    (cx, cy) => {
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      if (!isBodySurface(sim, cx, cy)) return;
      bx.push(cx);
      by.push(cy);
    },
    (cx, cy) => sim.getAux(cx, cy) > 0, // powered cells only — see the note above
  );
  if (!swept) return; // another cell of this body already swept the field this tick

  // Publish the live body for the renderer's contour-ring effect (자기력선) —
  // re-stamped every powered tick alongside the pull itself, so the rings appear
  // and vanish exactly with the field (see Grid.magnetFields). Skipped when the
  // surface set came back empty, which needs a magnet with no non-magnet neighbor
  // anywhere — a body filling the whole board. There is no outline to grow rings
  // from in that case, and an empty entry would hand the renderer's clustering an
  // undefined first cell.
  if (bx.length > 0) sim.emitMagnetField(bx, by, REACH);

  pullField(sim, bx, by, minX, minY, maxX, maxY);
}

/**
 * Deliver a power pulse to the connected magnet body containing (sx,sy): flood the
 * whole thing through magnet cells (4-connected, `floodDeviceBody`) and refresh
 * every cell's powered countdown to POWERED_TICKS. A one-way sink — a pulse only
 * ever *arrives* here (see the header) — so power reaching any face energizes the
 * entire magnet at once, at full effect whatever strength the arriving pulse had
 * left. Memoized per tick via SimContext.magnetFlood so a body touched from
 * several faces/sources in one tick still floods exactly once. Called from the
 * pulse sources (battery.ts, spark.ts) via the shared reactToPulse, the same way
 * the Fan's, Laser's and Pump's body pulses are.
 */
export function energizeElectromagnetBody(sim: SimContext, sx: number, sy: number): void {
  floodDeviceBody(sim, sx, sy, ELECTROMAGNET.id, sim.magnetFlood, (x, y) => {
    // The whole aux byte is the countdown — a magnet has no direction to preserve.
    sim.setAux(x, y, POWERED_TICKS);
  });
}

export const ELECTROMAGNET = register({
  id: 123,
  name: 'Electromagnet',
  phase: Phase.Solid,
  // A dark iron core wrapped in copper windings — horizontal coil stripes in the
  // lattice colour that brighten while the field is up (see Material.coilPattern).
  color: rgb(52, 54, 62),
  lattice: rgb(196, 122, 58),
  coilPattern: true,
  density: 1000,
  category: 'electric',
  // Doesn't burn or corrode away underfoot, like the other electric machines.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  // One-way "outside → inside" electric sink (see the header): any pulse source
  // touching a face — Battery/LFP Battery/Turbine direct, or a relayed Spark —
  // floods the connected body and refreshes its field countdown. Declared once
  // here so every source powers it through the shared dispatch (spark.ts
  // reactToPulse), with no per-source id special-casing.
  directPulse: energizeElectromagnetBody,
  update: updateElectromagnet,
});
