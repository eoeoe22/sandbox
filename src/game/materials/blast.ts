import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { launchEmber } from './ember';

// ── Explosions: an instant shockwave that scales with the charge ────────────
//
// A detonation resolves in a SINGLE tick, in two phases (see `detonate`):
//
//   1. SURVEY — from the triggered cell, flood the *connected mass* of explosive
//      cells (8-connected) and sum their total yield Y. This is what makes the
//      blast scale with how much you packed: a chamber filled solid with charges
//      has a far larger Y than the same chamber merely lined, so it reaches much
//      farther. (Yield per cell = the material's `blastYield`, defaulting to its
//      `blastRadius`.)
//   2. DILATE — turn Y into a reach R (see `computeReach`) and flood a *filled*
//      region outward from EVERY surveyed cell at once, destroying everything it
//      reaches (sand, salt, stone, water, the charges themselves, …). The crater
//      is the whole mass grown by R, so more explosive means both a bigger mass
//      *and* a bigger R — the destruction grows with the amount, not just the
//      surface. A bright, short-lived shockwave flash is dropped over the crater
//      and glowing Embers are hurled out past the rim (see ember.ts).
//
// A lone charge (Y == its own yield) reaches exactly its `blastRadius`, so single
// charges feel unchanged; only stacking more explosive makes the blast grow.
//
// The Blast material serves purely as that flash: a freshly *painted* Blast cell
// (or one reloaded from a save) detonates on its first turn; every cell the flood
// clears becomes a Blast flash cell that just fades and dies. The two are told
// apart by the cell's `temp` slot (Blast conducts nothing, so the heat pass
// leaves it alone as opaque per-cell state): a flash stores its remaining life
// there (1..SHELL_MAX, doubling as the glow brightness), while anything above
// SHELL_MAX is the "detonate me" seed marker. Storing it in `temp` (which
// persists) rather than `aux` (which doesn't) means a flash saved mid-explosion
// reloads as a flash and quietly dies, instead of re-detonating on load.
//
// Walls and blast-proof solids (Diamond) stop the flood — they neither break nor
// let it pass, so they cast a shadow and can shelter what's behind them. A whole
// connected mass of Gunpowder / Nitro / TNT goes off as one crater (the survey
// gathers it all before the dilation levels it). Separate charges nearby are set
// off a tick later by the flash / fire the blast leaves touching them — the same
// id-based trigger every explosive already watches for.

/** Blast radius (cells) used when a Blast cell is painted directly by the brush.
 *  Explosives pass their own `blastRadius` to `detonate` instead. */
const BRUSH_RADIUS = 8;

// The shockwave flash lives briefly, then collapses. Each cleared cell gets a
// randomized life in [SHELL_LIFE_MIN, SHELL_LIFE_MIN + SHELL_LIFE_VAR) so the
// disc dissolves organically over a handful of frames rather than blinking off
// all at once. Life is stored in `temp` and also drives the glow ramp below —
// high life renders white-hot, low life orange.
const SHELL_LIFE_MIN = 3;
const SHELL_LIFE_VAR = 4; // flash lives 3..6 ticks
/** Glow's hot end / the ceiling on a flash life. Any `temp` above this is not a
 *  flash but the seed marker that tells a painted Blast to detonate. */
const SHELL_MAX = SHELL_LIFE_MIN + SHELL_LIFE_VAR; // 7
/** `temp` of a Blast cell that still needs to detonate. Comfortably above every
 *  possible flash life so the two states can never be confused, and above the
 *  glow range so a seed renders at full brightness for the one tick it exists. */
const SEED_TEMP = 100;

// A spent flash cell leaves scattered Fire this often (dusting the fresh crater
// with flame that can ignite what's left); otherwise it clears straight to
// Empty, so the net result is a bare crater lightly seasoned with fire.
const SHELL_FIRE_CHANCE = 0.28;

// Rim debris: the outermost flash cells hurl glowing Embers outward — fast
// ballistic sparks that fly well past the crater, pockmark whatever they hit,
// and set off distant explosives via the fire they leave (see ember.ts). Only
// the rim sparks, and never through a Wall, so a blast sealed in a chamber stays
// contained.
const RIM_EMBER_CHANCE = 0.55;

// Chamfer-metric step costs so the flooded region reads as a round disc instead
// of a square: a diagonal step costs ~√2 orthogonal steps. Each source starts at
// the computed reach R and the budget drains as the front travels; a cell is
// reached (and destroyed) while the budget hasn't gone negative.
const ORTH_COST = 1;
const DIAG_COST = 1.4142;
const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, ORTH_COST],
  [0, 1, ORTH_COST],
  [-1, 0, ORTH_COST],
  [1, 0, ORTH_COST],
  [-1, -1, DIAG_COST],
  [1, -1, DIAG_COST],
  [-1, 1, DIAG_COST],
  [1, 1, DIAG_COST],
];

// Reach law: R = maxYield + REACH_GAIN·√(Y − maxYield), clamped to R_MAX, where
// Y is the connected mass's total yield and maxYield its strongest single cell.
// A lone charge (Y == maxYield) reaches exactly its own yield, so single charges
// are unchanged; extra connected yield adds reach *sublinearly*, so a filled
// chamber's larger Y pushes its crater past a thin lining's without a modest
// stack filling the screen. Both are playtest knobs: raise REACH_GAIN for a
// bigger fill-vs-line gap, lower R_MAX to cap how far a big pile can ever reach.
// Tuned down from 0.35 / 128 — packed masses were reaching most of the screen.
const REACH_GAIN = 0.14;
const R_MAX = 64;

// Cap on how many connected explosive cells one survey (phase 1) sums before it
// gives up and detonates with the partial yield gathered so far — a graceful
// bound on a pathologically huge mass, never a hang. MAX_SURVEY_CELLS_PER_TICK
// is the same idea shared across *all* surveys in a tick: without it, a mass
// bigger than the destruction budget would be re-surveyed in full by every
// same-tick re-trigger (the survivors the flood couldn't reach this tick), which
// is O(mass²) work — so the per-tick survey scan is capped just like destruction.
const MAX_SURVEY_CELLS = 60_000;
const MAX_SURVEY_CELLS_PER_TICK = 80_000;

// Hard cap on cells destroyed by a single detonate() call, and by all detonate
// calls within one tick combined, so even a screen-filling mass of explosives
// can't blow the frame budget in a single frame. Sized well above any normal
// deliberate blast (a radius-16 disc is ~800 cells; even a filled 60×40 chamber
// craters only ~10-15k at the current reach); when a giant connected mass
// exceeds them the flood simply stops for the tick,
// and the explosives left at the ragged frontier detonate over the next few
// ticks via the flash now touching them — a graceful spread, never a hang.
const MAX_DETONATE_CELLS = 60_000;
const MAX_DETONATE_CELLS_PER_TICK = 80_000;

// Per-tick destruction and survey budgets shared across every detonate() call,
// so a whole field of charges going off on the same tick still can't exceed one
// big blast's worth of work — for either the phase-1 mass scan or the phase-2
// destruction. Both reset lazily whenever the tick advances.
let budgetTick = -1;
let budgetLeft = 0;
let surveyLeft = 0;

// Reused visited buffer for the flood, keyed by flat cell index. A monotonic
// `stampId` marks cells touched by the current detonation, so we never allocate
// a Set per blast nor clear the buffer between blasts — a cell counts as visited
// only while its stamp equals the current id. Re-sized to match the grid.
let stampBuf: Int32Array | null = null;
let stampW = 0;
let stampH = 0;
let stampId = 0;

/** Fetch the visited buffer (reallocating on a grid resize) and advance to a
 *  fresh stamp id for this detonation. */
function nextStamp(sim: SimContext): Int32Array {
  if (!stampBuf || stampW !== sim.width || stampH !== sim.height) {
    stampW = sim.width;
    stampH = sim.height;
    stampBuf = new Int32Array(stampW * stampH); // all zero; ids start at 1
    stampId = 0;
  }
  stampId++;
  if (stampId >= 0x7fffffff) {
    // Astronomically unlikely, but keep ids from overflowing Int32: wipe once
    // and restart, so no stale stamp is ever mistaken for the current one.
    stampBuf.fill(0);
    stampId = 1;
  }
  return stampBuf;
}

/** True if the cell blocks the shockwave outright — it survives intact and casts
 *  a shadow. Only the indestructible boundary Wall and blast-proof solids
 *  (Diamond); everything else is fair game to destroy. */
function isBlocker(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  return m.isWall === true || m.explosionProof === true;
}

/** Replace a cleared cell with a shockwave flash cell — a short-lived Blast cell
 *  whose life (in `temp`) both times its fade and drives its glow. spawn() marks
 *  it moved, so a not-yet-scanned cell isn't reprocessed this same tick. */
function placeShell(sim: SimContext, x: number, y: number): void {
  const life = SHELL_LIFE_MIN + sim.randInt(SHELL_LIFE_VAR);
  sim.spawn(x, y, BLAST.id);
  sim.setTemp(x, y, life); // ≤ SHELL_MAX ⇒ a flash, never mistaken for a seed
}

/** Yield one explosive cell contributes to its connected mass's total. Defaults
 *  to `blastRadius` when a material doesn't set an explicit `blastYield`, so a
 *  lone charge still reaches its familiar radius. 0 for anything not explosive. */
function cellYield(id: number): number {
  if (id === EMPTY) return 0;
  const m = getMaterial(id);
  return m.blastYield ?? m.blastRadius ?? 0;
}

/**
 * Phase 1 — survey the 8-connected mass of `explosive` cells reachable from
 * (cx,cy), collecting every source cell into srcX/srcY and returning the total
 * yield Y plus the strongest single cell's yield (maxYield). Visited cells are
 * marked with `id_s` on the shared stamp buffer. If (cx,cy) itself isn't an
 * explosive (a brush-painted Blast seed, say), the mass is just that one cell
 * with yield = seedYield — so a painted Blast still detonates at a fixed size.
 */
function surveyMass(
  sim: SimContext,
  cx: number,
  cy: number,
  seedYield: number,
  stamp: Int32Array,
  id_s: number,
  srcX: number[],
  srcY: number[],
): { Y: number; maxYield: number } {
  const w = sim.width;
  const h = sim.height;
  const originId = sim.get(cx, cy);
  const originMat = originId === EMPTY ? null : getMaterial(originId);
  if (!originMat?.explosive) {
    // Non-explosive origin (brush Blast seed): a single fixed-yield source. An
    // explosive origin always surveys its mass below even if its own yield is 0,
    // so it can still aggregate stronger connected neighbors.
    srcX.push(cx);
    srcY.push(cy);
    return { Y: seedYield, maxYield: seedYield };
  }

  let Y = 0;
  let maxYield = 0;
  stamp[cy * w + cx] = id_s;
  const qx: number[] = [cx];
  const qy: number[] = [cy];
  let head = 0;
  while (head < qx.length && srcX.length < MAX_SURVEY_CELLS) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const y0 = cellYield(sim.get(x, y));
    Y += y0;
    if (y0 > maxYield) maxYield = y0;
    srcX.push(x);
    srcY.push(y);
    // Once the shared per-tick survey budget is spent, keep counting cells
    // already queued but stop expanding into new ones, so a mass far larger than
    // a tick's destruction budget isn't re-scanned in full by every same-tick
    // re-trigger. The origin is always processed (queued before this check), so a
    // directly triggered charge still makes progress; the rest of the mass is
    // surveyed and detonated over the next ticks as the budget refreshes.
    if (surveyLeft <= 0) continue;
    surveyLeft--;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nidx = ny * w + nx;
      if (stamp[nidx] === id_s) continue;
      const nid = sim.get(nx, ny);
      if (nid === EMPTY || !getMaterial(nid).explosive) continue;
      stamp[nidx] = id_s;
      qx.push(nx);
      qy.push(ny);
    }
  }
  return { Y, maxYield };
}

/** Turn a connected mass's total yield into a blast reach (cells). A lone charge
 *  (Y == maxYield) reaches exactly its own yield; extra connected yield adds
 *  reach sublinearly (√) so packing more explosive grows the crater without a
 *  modest stack instantly filling the screen. Clamped to [1, R_MAX]. */
function computeReach(Y: number, maxYield: number): number {
  const r = maxYield + REACH_GAIN * Math.sqrt(Math.max(0, Y - maxYield));
  return r < 1 ? 1 : r > R_MAX ? R_MAX : r;
}

/**
 * Detonate the connected explosive mass at (cx,cy) — immediately and in full.
 * Phase 1 surveys the connected mass for its total yield; phase 2 turns that into
 * a reach R and floods a filled region outward from *every* surveyed cell at once
 * (so the crater is the whole mass grown by R), destroying everything destructible
 * it reaches and dropping the shockwave flash plus a spray of rim embers. Runs
 * entirely within the calling tick — the whole point is that there's no crawl.
 *
 * `seedYield` is only consulted when (cx,cy) isn't itself an explosive — the
 * brush-painted Blast path passes its own radius so a hand-placed blast keeps a
 * fixed size; an explosive origin ignores it and uses the surveyed yield instead.
 */
export function detonate(sim: SimContext, cx: number, cy: number, seedYield = 0): void {
  const w = sim.width;
  const h = sim.height;

  // Refresh the shared per-tick destruction and survey budgets when the tick
  // advances, so a whole field of charges detonating on one tick can't exceed a
  // bounded amount of scanning or destruction work.
  if (sim.tick !== budgetTick) {
    budgetTick = sim.tick;
    budgetLeft = MAX_DETONATE_CELLS_PER_TICK;
    surveyLeft = MAX_SURVEY_CELLS_PER_TICK;
  }

  // ── Phase 1: survey the connected explosive mass for its total yield ──
  const stamp = nextStamp(sim);
  const id_s = stampId;
  const srcX: number[] = [];
  const srcY: number[] = [];
  const { Y, maxYield } = surveyMass(sim, cx, cy, seedYield, stamp, id_s, srcX, srcY);
  const R = computeReach(Y, maxYield);

  // ── Phase 2: dilate the whole mass outward by R, destroying what it reaches ──
  // A fresh stamp id on the same buffer marks the dilation's visited set; it never
  // equals id_s, so survey-stamped cells are re-marked cleanly as the flood
  // re-crosses them. Every source seeds the FIFO frontier at the full budget R.
  nextStamp(sim);
  const id_d = stampId;
  const qx = srcX.slice();
  const qy = srcY.slice();
  const qb: number[] = new Array(srcX.length).fill(R);
  for (let i = 0; i < srcX.length; i++) stamp[srcY[i] * w + srcX[i]] = id_d;
  // Rim cells (the outer edge, one outward direction each) that spray embers
  // once the flood settles — collected rather than launched inline so spawning
  // them can't disturb the cell reads the flood depends on.
  const rimX: number[] = [];
  const rimY: number[] = [];
  const rimDX: number[] = [];
  const rimDY: number[] = [];

  let head = 0;
  let destroyed = 0;
  // The mass always detonates (so a triggered charge always makes progress);
  // every cell after the first is gated by both the per-call cap and the shared
  // per-tick budget.
  while (
    head < qx.length &&
    destroyed < MAX_DETONATE_CELLS &&
    (destroyed === 0 || budgetLeft > 0)
  ) {
    const x = qx[head];
    const y = qy[head];
    const outB = qb[head];
    head++;

    placeShell(sim, x, y);
    destroyed++;
    budgetLeft--;

    let isRim = false;
    let rimDx = 0;
    let rimDy = 0;
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      // A container edge contains the blast (like a Wall) — no leak, no ember.
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nidx = ny * w + nx;
      if (stamp[nidx] === id_d) continue;
      if (outB - cost < 0) {
        // The front ran out of push in this direction: this cell is the outer
        // rim here, so it can fling an ember outward along the local outward
        // normal (the direction whose budget ran out). Record the first such
        // direction and move on.
        if (!isRim) {
          isRim = true;
          rimDx = dx;
          rimDy = dy;
        }
        continue;
      }
      // Wall / Diamond stops the front and shadows what's beyond — no ember
      // either (an explosion behind a wall shouldn't spit sparks through it).
      if (isBlocker(sim.get(nx, ny))) continue;
      stamp[nidx] = id_d;
      qx.push(nx);
      qy.push(ny);
      qb.push(outB - cost);
    }
    if (isRim) {
      // With many sources there's no single epicenter to fling from, so the
      // rim uses the local outward normal captured above — the spray still fans
      // out from the true crater edge in all directions.
      rimX.push(x);
      rimY.push(y);
      rimDX.push(rimDx);
      rimDY.push(rimDy);
    }
  }

  for (let i = 0; i < rimX.length; i++) {
    if (sim.chance(RIM_EMBER_CHANCE)) launchEmber(sim, rimX[i], rimY[i], rimDX[i], rimDY[i]);
  }
}

/** One tick of a Blast cell: either it's a seed that detonates now, or a flash
 *  cell fading toward the bare crater. */
function updateBlast(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  if (t > SHELL_MAX) {
    // A freshly painted Blast (or a seed reloaded from a save): go off, using
    // the brush radius. detonate() overwrites this very cell with a flash.
    detonate(sim, x, y, BRUSH_RADIUS);
    return;
  }
  // A shockwave flash cell: dim one step (life + brightness share this slot);
  // when spent, collapse into a lick of Fire or clear to the bare crater.
  const life = Math.round(t);
  if (life <= 1) {
    if (sim.chance(SHELL_FIRE_CHANCE)) sim.spawn(x, y, FIRE.id);
    else sim.set(x, y, EMPTY);
    return;
  }
  sim.setTemp(x, y, life - 1);
  // No movement: the flash marks where the shockwave passed and fades in place,
  // rather than drifting upward like ordinary gas would.
}

export const BLAST = register({
  id: 17,
  name: 'Blast',
  phase: Phase.Gas,
  // Base (hot) color of the flash; the glow ramp fades it toward the cool orange
  // below as each flash cell's life counts down.
  color: rgb(255, 246, 224),
  density: 1,
  category: '폭발',
  // conductivity 0 is load-bearing: it makes the heat pass treat `temp` as inert
  // per-cell state (the flash's life / the seed marker) instead of real heat.
  // init = SEED_TEMP so a brush-placed cell reads as a seed and detonates.
  thermal: { init: SEED_TEMP, conductivity: 0 },
  // Fade the flash white-hot → orange as its life (stored in temp) drops from
  // SHELL_MAX to 1, so the shockwave visibly cools as it dies.
  glow: { min: 1, max: SHELL_MAX, cool: rgb(255, 120, 24) },
  update: updateBlast,
});
