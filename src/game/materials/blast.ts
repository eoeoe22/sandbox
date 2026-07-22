import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { launchEmber } from './ember';
import { launchDebris, DEBRIS } from './debris';
import { launchBallistic, type LaunchSpec } from './ballistic';

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
//      region outward from EVERY surveyed cell at once. The crater is the whole
//      mass grown by R, so more explosive means both a bigger mass *and* a bigger
//      R — the destruction grows with the amount, not just the surface. Within
//      reach, a *second* axis decides each cell's fate: the blast's destructive
//      power (파괴력) vs. the cell's durability (내구력) — see `defaultCell` /
//      `blocksBlast`. A strong blast destroys everything (sand, salt, stone, the
//      charges themselves, …), drops a bright shockwave flash, and hurls Embers
//      past the rim (see ember.ts); water it reaches flash-boils to a Steam plume
//      instead of being erased (any charge underwater erupts a steam column). A
//      *weak* blast (low-power Gunpowder) can't break tough matter: it shoves
//      loose powder/liquid/gas aside as Debris (mass-conserving) and is shadowed
//      by solids it can't crack. So "concussion" and "depth charge" are built-in
//      mechanisms of every detonation, not bolted-on special materials.
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

// Global blast-range scale: every detonation's crater reach is trimmed to this
// fraction, so the whole game's explosions are dialed down at a single knob
// (기획: 폭발 범위 전체 2/3 축소). Applied to both the surveyed √-law reach and any
// fixed `opts.reach`, so shaped blasts (napalm's fixed fireball) shrink in the
// same proportion rather than escaping the reduction.
const BLAST_REACH_SCALE = 2 / 3;

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

// ── Shockwave pressure wave (충격파 압력전파) ────────────────────────────────
// Beyond the crater it carves, a detonation sends a pressure wave a few cells
// further that can't *break* anything but SHOVES loose matter (powder/liquid)
// radially outward as Debris — the concussion you feel past the blast's edge, so
// an explosion tosses the sand and water around it outward instead of stopping
// dead at the crater rim. It's a light bolt-on to the existing dilate flood: a
// second, non-destructive ring seeded from the crater's rim, expanding outward,
// blocked (shadowed) by solids it can't move but flowing around them through gaps.
//
// Its reach is *dynamic*: it scales with the blast's crater reach R, so a strong
// detonation shoves matter proportionally farther out while a firecracker barely
// nudges its surroundings (기획: 강한 폭발일수록 넓은 동적 충격파). Clamped at both
// ends so even a lone pop rings out a little and a giant mass can't shove across
// the whole screen.
const PRESSURE_REACH_FACTOR = 0.6; // pressure reach ≈ this × crater reach R
const PRESSURE_REACH_MIN = 2;
const PRESSURE_REACH_MAX = 24;
const PRESSURE_LAUNCH_CHANCE = 0.5; // per loose cell reached, chance it's flung

/** The pressure wave's reach (cells beyond the crater) for a blast of crater
 *  reach `R` — proportional to R, clamped to [MIN, MAX]. */
function pressureReachFor(R: number): number {
  const r = Math.round(R * PRESSURE_REACH_FACTOR);
  return r < PRESSURE_REACH_MIN ? PRESSURE_REACH_MIN : r > PRESSURE_REACH_MAX ? PRESSURE_REACH_MAX : r;
}
// Modest outward launch — a shove, not the fierce fountain the in-crater
// concussion throws (that scales with the blast budget; this is a fixed nudge).
const PRESSURE_SHOVE: LaunchSpec = {
  speedMinQ: 6,
  speedVarQ: 5,
  jitterQ: 2,
  upBiasQ: 2,
  lifeMin: 8,
  lifeVar: 6,
};

// Per-tick destruction, survey, and pressure budgets shared across every
// detonate() call, so a whole field of charges going off on the same tick still
// can't exceed one big blast's worth of work — for the phase-1 mass scan, the
// phase-2 destruction, and the pressure-wave shove alike. All reset lazily
// whenever the tick advances.
let budgetTick = -1;
let budgetLeft = 0;
let surveyLeft = 0;
let pressureLeft = 0;

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

// ── Destructive power vs. durability: destroy, shove, or shadow ──────────────
// A blast carries a *destructive power* (파괴력) — whether it can break a given
// material — which is separate from its reach (범위) and its heat. Each material
// has a *durability* (내구력). Comparing the two decides a reached cell's fate, so
// a detonation is no longer all-or-nothing:
//   • power ≥ durability → the cell is destroyed (the ordinary crater flash; or,
//     for water, the steam plume — see defaultCell).
//   • power < durability → the blast can't break it:
//       – loose matter (powder/liquid/gas) is FLUNG aside as Debris (debris.ts):
//         a mass-conserving shove that arcs out and rains back, rearranging the
//         world rather than emptying it. This is the "concussion" a weak charge
//         (low-power Gunpowder) delivers — now built into every detonation
//         instead of living in a separate material.
//       – a solid it can't crack SURVIVES and shadows the blast behind it (it is
//         never even entered — see blocksBlast, applied at propagation time).
// Ordinary explosives omit `destructivePower`, so DEFAULT_DESTRUCTIVE_POWER lets
// them level everything exactly as before; only a deliberately weak charge ever
// shows the shove.
const DEFAULT_DESTRUCTIVE_POWER = 100_000;

// Phase-default durability when a material sets no explicit `durability`: loose
// matter is easy to shift (a weak blast shoves it), solids are tough (a weak
// blast can't break them and is shadowed). All sit well under
// DEFAULT_DESTRUCTIVE_POWER, so an ordinary blast still destroys everything with
// a finite durability.
const DURABILITY_GAS = 15;
const DURABILITY_LIQUID = 25;
const DURABILITY_POWDER = 35;
const DURABILITY_SOLID = 200;
// A blast only sprays smashing rim Embers if it's violent enough to break solid
// terrain; a weaker concussion (which merely shoves loose matter) throws none, so
// its shove stays mass-conserving instead of having embers punch out flung grains.
const EMBER_MIN_POWER = DURABILITY_SOLID;

/** How hard a material is to destroy by a blast — its own `durability`, else a
 *  phase default. Empty air offers no resistance. */
function durabilityOf(id: number): number {
  if (id === EMPTY) return 0;
  const m = getMaterial(id);
  if (m.durability !== undefined) return m.durability;
  switch (m.phase) {
    case Phase.Gas:
      return DURABILITY_GAS;
    case Phase.Liquid:
      return DURABILITY_LIQUID;
    case Phase.Powder:
      return DURABILITY_POWDER;
    default:
      return DURABILITY_SOLID;
  }
}

/** The destructive power one explosive cell contributes to its mass's blast (the
 *  strongest cell in a connected mass wins). Unset ⇒ effectively unlimited. */
function cellPower(id: number): number {
  if (id === EMPTY) return 0;
  return getMaterial(id).destructivePower ?? DEFAULT_DESTRUCTIVE_POWER;
}

/** True if the cell stops the shockwave — it survives intact and casts a shadow.
 *  Always the indestructible boundary Wall and blast-proof solids (Diamond); and,
 *  for a blast too weak to break it, any *solid* whose durability exceeds `power`.
 *  Loose matter never blocks — a weak blast shoves it aside and passes through.
 *  (The one force that gets past Diamond is a critical uranium's Heat Ray — see
 *  heatray.ts — which isn't a blast at all.) */
function blocksBlast(id: number, power: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.isWall === true || m.explosionProof === true || m.indestructible === true) return true;
  return m.phase === Phase.Solid && durabilityOf(id) > power;
}

/** True if the cell shadows the non-destructive pressure wave (충격파 압력전파) —
 *  it stops the wave and shelters what's behind it, and is never shoved as Debris.
 *  Ordinarily only solids do this (loose powder/liquid is what the wave flings
 *  aside), but a 방폭 material — explosion-proof or truly indestructible — is inert
 *  to the whole blast regardless of phase, so a Molten U238 pool or a Nuke Waste
 *  pile shrugs the concussion off instead of being scattered by it. (Compare
 *  blocksBlast, the same idea for the destructive crater flood.) */
function shadowsPressure(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  return m.phase === Phase.Solid || m.explosionProof === true || m.indestructible === true;
}

/** Replace a cleared cell with a shockwave flash cell — a short-lived Blast cell
 *  whose life (in `temp`) both times its fade and drives its glow. spawn() marks
 *  it moved, so a not-yet-scanned cell isn't reprocessed this same tick. Exported
 *  so a custom `onCell` handler (see DetonateOptions) can drop the same flash in
 *  the cells it chooses not to transform (e.g. a concussion's empty air). */
export function flashCell(sim: SimContext, x: number, y: number): void {
  const life = SHELL_LIFE_MIN + sim.randInt(SHELL_LIFE_VAR);
  sim.spawn(x, y, BLAST.id);
  sim.setTemp(x, y, life); // ≤ SHELL_MAX ⇒ a flash, never mistaken for a seed
}

// Underwater detonation is likewise a mechanism, not a material: water a blast is
// strong enough to destroy flash-boils to a hot Steam plume (which rises, cools,
// condenses and rains back) instead of being erased — so any charge set off
// underwater erupts a steam column, with no per-material opt-in and no "depth
// charge" item. A blast too weak to break water (power < its durability) instead
// shoves it aside like any other liquid, so a firecracker underwater makes waves,
// not steam.
const UNDERWATER_STEAM_TEMP = 240;

function isWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

/** Default fate of a cell the front reaches when no `onCell` claims it, decided by
 *  the blast's destructive `power` against the cell's durability (see the block
 *  comment above blocksBlast). `entryDx/entryDy` is the inward shock direction and
 *  `outB` the remaining outward budget — handed to Debris so a shoved grain flies
 *  outward, fiercest near the epicenter. */
function defaultCell(
  sim: SimContext,
  x: number,
  y: number,
  prevId: number,
  power: number,
  entryDx: number,
  entryDy: number,
  outB: number,
  harmless: boolean,
): void {
  // Empty air and the detonating charge itself always take the shockwave flash:
  // air so the blast still reads as a filled disc, an explosive so a source cell
  // is consumed (left intact it would re-detonate every tick forever).
  if (prevId === EMPTY) {
    flashCell(sim, x, y);
    return;
  }
  const m = getMaterial(prevId);
  if (m.explosive) {
    flashCell(sim, x, y);
    return;
  }
  // The shockwave flash itself isn't matter — a blast passing over an existing
  // flash just refreshes it (overlapping blasts). Never shove it as Debris: a
  // fragment carrying BLAST would respawn on landing with BLAST's seed temp and
  // spuriously re-detonate a full crater.
  if (prevId === BLAST.id) {
    flashCell(sim, x, y);
    return;
  }
  // A Debris fragment already in flight is likewise not matter to resolve — a
  // submerged liquid fragment jets up into cells this same flood hasn't
  // processed yet (see debris.ts), and re-shoving it would launch a fragment
  // whose "carried material" is Debris itself, while flashing it would delete
  // the mass it carries. Leave it flying.
  if (prevId === DEBRIS.id) return;
  if (power >= durabilityOf(prevId)) {
    // Strong enough to destroy it: water flash-boils to a steam plume, everything
    // else takes the ordinary crater flash.
    if (isWater(prevId)) {
      sim.spawn(x, y, STEAM.id); // marks moved; won't be re-processed this tick
      sim.setTemp(x, y, UNDERWATER_STEAM_TEMP); // a hot, buoyant bubble that rises
    } else {
      flashCell(sim, x, y);
    }
    return;
  }
  // Too tough to destroy. Loose matter (powder/liquid/gas) is flung aside as
  // Debris — a mass-conserving shove that carries the material out and rains it
  // back. A solid it can't crack never reaches here (blocksBlast keeps the front
  // out of it), so anything still solid is left untouched, defensively.
  if (m.phase !== Phase.Solid) {
    // A shock-fragile living grain (Termite/Nanobot) doesn't survive being
    // knocked around by a real blast the way inert matter does — it dies
    // outright instead of flying off as Debris — unless this concussion is
    // itself harmless (Woofer), which treats it exactly like ordinary matter.
    if (!harmless && m.shockFragile !== undefined) {
      sim.set(x, y, m.shockFragile);
    } else {
      launchDebris(sim, x, y, prevId, entryDx, entryDy, outB);
    }
  }
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
): { Y: number; maxYield: number; power: number } {
  const w = sim.width;
  const h = sim.height;
  const originId = sim.get(cx, cy);
  const originMat = originId === EMPTY ? null : getMaterial(originId);
  if (!originMat?.explosive) {
    // Non-explosive origin (brush Blast seed): a single fixed-yield source that
    // levels everything (default destructive power). An explosive origin always
    // surveys its mass below even if its own yield is 0, so it can still
    // aggregate stronger connected neighbors.
    srcX.push(cx);
    srcY.push(cy);
    return { Y: seedYield, maxYield: seedYield, power: DEFAULT_DESTRUCTIVE_POWER };
  }

  let Y = 0;
  let maxYield = 0;
  // The mass's destructive power is its strongest cell's — a single potent charge
  // wired into a mass of weak ones detonates the whole thing at full brisance.
  let power = 0;
  stamp[cy * w + cx] = id_s;
  const qx: number[] = [cx];
  const qy: number[] = [cy];
  let head = 0;
  while (head < qx.length && srcX.length < MAX_SURVEY_CELLS) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const cellId = sim.get(x, y);
    const y0 = cellYield(cellId);
    Y += y0;
    if (y0 > maxYield) maxYield = y0;
    const p0 = cellPower(cellId);
    if (p0 > power) power = p0;
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
  return { Y, maxYield, power };
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
 * Options that reshape a detonation *without* touching this file — the seam that
 * turns "every explosive is the same round crater" into a family of distinct
 * blasts (cluster, napalm, …). Every field is optional and defaults to the
 * classic behavior, so the base explosives pass nothing and are bit-for-bit
 * unchanged. (The concussion shove, the underwater steam plume, and the durability
 * shadow are *not* options here — they're the built-in default, driven by the
 * blast's destructive power vs. each material's durability; see defaultCell /
 * blocksBlast above.) See the field docs; the design lives in the wiki
 * ("폭발 다변화 구상").
 */
export interface DetonateOptions {
  /** Fixed blast reach (cells), overriding the surveyed √-law reach. Lets a
   *  self-contained small blast (napalm's fixed R6) ignore how much connected
   *  explosive happened to be packed. */
  reach?: number;
  /** Extra cap on cells this single call processes, on top of the shared
   *  per-call / per-tick caps — bounds a small self-flood so, e.g., napalm can't
   *  run a screen-wide fire even if wired to a huge mass. */
  maxCells?: number;
  /** Per-direction propagation-cost multipliers, indexed like NEIGHBORS (0..7).
   *  >1 shortens the reach that way, <1 lengthens it — a directional/shaped
   *  blast. Omit for the default round disc. */
  costMul?: readonly number[];
  /**
   * Handler run for every cell the front reaches, *replacing* the default
   * shockwave-flash placement. Receives the cell's previous id, the inward blast
   * direction (entryDx,entryDy — the step from the cell the front arrived from;
   * 0,0 at a source cell) and the remaining outward budget `outB` (high near the
   * epicenter, 0 at the rim — a free strength gradient). Return `true` to signal
   * the cell was fully handled (no default flash is placed); return
   * `false`/nothing to fall back to the default flash for this cell. Lets a blast
   * transform / scatter / ignite instead of merely destroying.
   */
  onCell?: (
    sim: SimContext,
    x: number,
    y: number,
    prevId: number,
    entryDx: number,
    entryDy: number,
    outB: number,
  ) => boolean | void;
  /** Replace the rim ejecta launched at the crater edge with something else
   *  (bomblets, gel, …). Receives the local outward normal. When omitted the
   *  default hurls Embers at `rimEmberChance`. */
  rimHandler?: (sim: SimContext, x: number, y: number, dirX: number, dirY: number) => void;
  /** Probability the *default* rim handler launches an ember per rim cell
   *  (default RIM_EMBER_CHANCE). Ignored when `rimHandler` is set. */
  rimEmberChance?: number;
  /** Whether the non-destructive pressure wave (충격파 압력전파) rings out past the
   *  crater to shove loose matter radially outward (see pressureRing). Defaults to
   *  true, so every blast gets the concussion; set false for a self-contained blast
   *  that shouldn't disturb its surroundings. */
  pressure?: boolean;
  /** Override the blast's destructive power (파괴력) — what it can break — instead
   *  of taking it from the surveyed mass (or DEFAULT_DESTRUCTIVE_POWER for a seed).
   *  A low value makes a deliberately *weak* blast that shoves loose matter aside
   *  and is shadowed by solids it can't crack (the Gunpowder concussion), even at a
   *  large `reach` — so a single seed can throw a wide, non-cratering shockwave.
   *  See defaultCell / blocksBlast for how power meets each cell's durability. */
  power?: number;
  /**
   * Skip the phase-1 connected-mass survey and detonate the trigger cell alone,
   * even though the material itself is `explosive` (so same-material neighbors
   * would normally be swept into one shared mass). Without this, a big fused
   * blob of the material becomes hundreds of simultaneous "sources" that must
   * *all* be dequeued (FIFO, in survey order outward from the trigger) before
   * any of them gets to flood its own `reach` — so a `maxCells`-capped call
   * spends its whole budget just converting cells nearest the trigger, leaving
   * none for the radius flourish there, while only the last (farthest) sliver
   * of the mass — whichever tick's re-trigger finally shrinks the remaining
   * connected mass under the cap — ever gets the full flood. `soloSource`
   * keeps every trigger a self-contained, uniformly-sized blast (like napalm's
   * fixed fireball) that chains to neighbors one at a time instead of pooling
   * into one lopsided mass survey. */
  soloSource?: boolean;
  /**
   * This blast's concussion is truly harmless to living things caught in it —
   * even a `Material.shockFragile` grain (Termite/Nanobot) is just shoved as
   * ordinary Debris instead of dying (see defaultCell/pressureRing). Set by
   * Woofer (woofer.ts), the one "explosion" that's actually a non-destructive
   * audio device rather than a weapon; every real explosive omits this and
   * kills shock-fragile matter its non-destructive shove/pressure-ring reaches.
   */
  harmless?: boolean;
}

/**
 * Detonate the connected explosive mass at (cx,cy) — immediately and in full.
 * Phase 1 surveys the connected mass for its total yield; phase 2 turns that into
 * a reach R and floods a filled region outward from *every* surveyed cell at once
 * (so the crater is the whole mass grown by R). Within reach each cell meets the
 * blast's destructive power against its durability (see defaultCell/blocksBlast):
 * strong blasts destroy everything and spray rim embers; a weak one instead shoves
 * loose matter aside and is shadowed by solids it can't break. Runs entirely within
 * the calling tick — the whole point is that there's no crawl.
 *
 * `seedYield` is only consulted when (cx,cy) isn't itself an explosive — the
 * brush-painted Blast path passes its own radius so a hand-placed blast keeps a
 * fixed size; an explosive origin ignores it and uses the surveyed yield instead.
 *
 * `opts` (see DetonateOptions) reshapes the blast — the whole variety of exotic
 * explosives rides on this one seam; omitting it reproduces the classic crater.
 */
export function detonate(
  sim: SimContext,
  cx: number,
  cy: number,
  seedYield = 0,
  opts: DetonateOptions = {},
): void {
  const w = sim.width;
  const h = sim.height;

  // Refresh the shared per-tick destruction and survey budgets when the tick
  // advances, so a whole field of charges detonating on one tick can't exceed a
  // bounded amount of scanning or destruction work.
  if (sim.tick !== budgetTick) {
    budgetTick = sim.tick;
    budgetLeft = MAX_DETONATE_CELLS_PER_TICK;
    surveyLeft = MAX_SURVEY_CELLS_PER_TICK;
    pressureLeft = MAX_DETONATE_CELLS_PER_TICK;
  }

  // ── Phase 1: survey the connected explosive mass for its total yield ──
  const stamp = nextStamp(sim);
  const id_s = stampId;
  const srcX: number[] = [];
  const srcY: number[] = [];
  // soloSource skips the connected-mass flood entirely — the trigger cell is
  // the mass's only source, exactly like a non-explosive seed (see surveyMass's
  // own fallback for a brush-painted Blast). See DetonateOptions.soloSource.
  let Y: number;
  let maxYield: number;
  let surveyedPower: number;
  if (opts.soloSource) {
    srcX.push(cx);
    srcY.push(cy);
    Y = seedYield;
    maxYield = seedYield;
    surveyedPower = DEFAULT_DESTRUCTIVE_POWER;
  } else {
    ({ Y, maxYield, power: surveyedPower } = surveyMass(sim, cx, cy, seedYield, stamp, id_s, srcX, srcY));
  }
  // Destructive power (파괴력) — the surveyed mass's, unless the caller overrides it
  // (opts.power) to force a deliberately weak/strong blast regardless of the source
  // (e.g. dynamite's wide, non-cratering shockwave from a single seed).
  const power = opts.power !== undefined ? opts.power : surveyedPower;
  // Trim every blast's reach to the global scale (2/3), whether it came from the
  // surveyed √-law or a fixed opts.reach, so the whole game's craters shrink.
  const R = (opts.reach !== undefined ? opts.reach : computeReach(Y, maxYield)) * BLAST_REACH_SCALE;

  // ── Phase 2: dilate the whole mass outward by R, destroying what it reaches ──
  // A fresh stamp id on the same buffer marks the dilation's visited set; it never
  // equals id_s, so survey-stamped cells are re-marked cleanly as the flood
  // re-crosses them. Every source seeds the FIFO frontier at the full budget R.
  nextStamp(sim);
  const id_d = stampId;
  const qx = srcX.slice();
  const qy = srcY.slice();
  const qb: number[] = new Array(srcX.length).fill(R);
  // Inward blast direction each queued cell was reached from (0,0 for a source),
  // handed to `onCell` and to the default shove so flung material flies outward
  // along the shock (see defaultCell/debris.ts). Parallel to qx/qy/qb.
  const qdx: number[] = new Array(srcX.length).fill(0);
  const qdy: number[] = new Array(srcX.length).fill(0);
  for (let i = 0; i < srcX.length; i++) stamp[srcY[i] * w + srcX[i]] = id_d;
  // Rim cells (the outer edge, one outward direction each) that spray ejecta
  // once the flood settles — collected rather than launched inline so spawning
  // them can't disturb the cell reads the flood depends on.
  const rimX: number[] = [];
  const rimY: number[] = [];
  const rimDX: number[] = [];
  const rimDY: number[] = [];

  const onCell = opts.onCell;
  const costMul = opts.costMul;
  const harmless = opts.harmless === true;
  const callCap =
    opts.maxCells !== undefined && opts.maxCells < MAX_DETONATE_CELLS
      ? opts.maxCells
      : MAX_DETONATE_CELLS;

  let head = 0;
  let destroyed = 0;
  // The mass always detonates (so a triggered charge always makes progress);
  // every cell after the first is gated by both the per-call cap and the shared
  // per-tick budget.
  while (head < qx.length && destroyed < callCap && (destroyed === 0 || budgetLeft > 0)) {
    const x = qx[head];
    const y = qy[head];
    const outB = qb[head];
    const edx = qdx[head];
    const edy = qdy[head];
    head++;

    // Resolve this cell: a custom handler may transform it (returning true to
    // claim it), otherwise the default fate applies (water → steam plume,
    // everything else → the shockwave flash). prevId drives both the handler and
    // the water check, so it's read once here.
    const prevId = sim.get(x, y);
    let handled = false;
    if (onCell) handled = onCell(sim, x, y, prevId, edx, edy, outB) === true;
    if (!handled) defaultCell(sim, x, y, prevId, power, edx, edy, outB, harmless);
    destroyed++;
    budgetLeft--;

    let isRim = false;
    let rimDx = 0;
    let rimDy = 0;
    for (let i = 0; i < NEIGHBORS.length; i++) {
      const dx = NEIGHBORS[i][0];
      const dy = NEIGHBORS[i][1];
      // `?? 1` guards a short/sparse costMul: a missing entry means "no scaling"
      // rather than a NaN cost, which would corrupt the budget arithmetic.
      const cost = costMul ? NEIGHBORS[i][2] * (costMul[i] ?? 1) : NEIGHBORS[i][2];
      const nx = x + dx;
      const ny = y + dy;
      // A container edge contains the blast (like a Wall) — no leak, no ejecta.
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nidx = ny * w + nx;
      if (stamp[nidx] === id_d) continue;
      if (outB - cost < 0) {
        // The front ran out of push in this direction: this cell is the outer
        // rim here, so it can fling ejecta outward along the local outward
        // normal (the direction whose budget ran out). Record the first such
        // direction and move on.
        if (!isRim) {
          isRim = true;
          rimDx = dx;
          rimDy = dy;
        }
        continue;
      }
      // Wall/Diamond — and any solid this blast is too weak to break — stop the
      // front and shadow what's beyond, with no ejecta. Loose matter never blocks
      // (a weak blast shoves it and passes through; see blocksBlast).
      if (blocksBlast(sim.get(nx, ny), power)) continue;
      stamp[nidx] = id_d;
      qx.push(nx);
      qy.push(ny);
      qb.push(outB - cost);
      qdx.push(dx);
      qdy.push(dy);
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

  // Shockwave pressure wave: rings out past the crater rim to shove loose matter
  // radially outward (concussion), without breaking anything. On by default, its
  // reach scaling with this blast's crater reach R (bigger blast → wider shove).
  if (opts.pressure !== false) {
    pressureRing(sim, rimX, rimY, rimDX, rimDY, stamp, id_d, pressureReachFor(R), harmless);
  }

  const rimHandler = opts.rimHandler;
  const rimEmberChance = opts.rimEmberChance !== undefined ? opts.rimEmberChance : RIM_EMBER_CHANCE;
  // Smashing rim embers only fly from a blast violent enough to break solid
  // terrain; a weak concussion (which merely shoves loose matter) throws none, so
  // its shove stays mass-conserving. A custom rimHandler (cluster/napalm) always runs.
  const throwsEmbers = power >= EMBER_MIN_POWER;
  for (let i = 0; i < rimX.length; i++) {
    if (rimHandler) rimHandler(sim, rimX[i], rimY[i], rimDX[i], rimDY[i]);
    else if (throwsEmbers && sim.chance(rimEmberChance))
      launchEmber(sim, rimX[i], rimY[i], rimDX[i], rimDY[i]);
  }
}

/**
 * Non-destructive pressure wave — the "충격파 압력전파" that rings out past the
 * crater. Seeded from the crater's rim cells (each with the outward normal the
 * dilation recorded), it floods `reach` cells further (scaled to the blast's
 * crater reach R by the caller) using the same chamfer metric, and every loose
 * cell (powder/liquid) it reaches is flung
 * radially outward as Debris (mass-conserving — it rains back). It never breaks
 * anything: a solid stops the wave and shadows what's behind it, while it flows
 * around solids through open gaps. `stamp`/`id_d` are the destruction flood's
 * visited buffer + id, so the ring never re-enters the crater; it claims its own
 * fresh stamp id for its visited set. Bounded by the shared per-tick `pressureLeft`
 * budget so a field of blasts can't blow the frame.
 */
function pressureRing(
  sim: SimContext,
  seedX: number[],
  seedY: number[],
  seedDX: number[],
  seedDY: number[],
  stamp: Int32Array,
  id_d: number,
  reach: number,
  harmless: boolean,
): void {
  const w = sim.width;
  const h = sim.height;
  nextStamp(sim); // a fresh visited-set id for the pressure flood
  const id_p = stampId;

  const qx: number[] = [];
  const qy: number[] = [];
  const qb: number[] = [];
  const qdx: number[] = [];
  const qdy: number[] = [];
  // Seed from the OUTWARD neighbor of each rim cell (the crater edge itself is
  // already spent). A rim cell with no outward normal (0,0 — an interior source
  // that never reached a frontier) contributes nothing.
  for (let i = 0; i < seedX.length; i++) {
    const dx = seedDX[i];
    const dy = seedDY[i];
    if (dx === 0 && dy === 0) continue;
    const nx = seedX[i] + dx;
    const ny = seedY[i] + dy;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
    const nidx = ny * w + nx;
    if (stamp[nidx] === id_p || stamp[nidx] === id_d) continue;
    const nid = sim.get(nx, ny);
    if (shadowsPressure(nid)) continue; // solid or 방폭 matter shadows it at once
    stamp[nidx] = id_p;
    qx.push(nx);
    qy.push(ny);
    qb.push(reach);
    qdx.push(dx);
    qdy.push(dy);
  }

  let head = 0;
  while (head < qx.length && pressureLeft > 0) {
    const x = qx[head];
    const y = qy[head];
    const outB = qb[head];
    const edx = qdx[head];
    const edy = qdy[head];
    head++;
    pressureLeft--;

    const id = sim.get(x, y);
    const phase = id === EMPTY ? Phase.Empty : getMaterial(id).phase;
    // Loose matter is shoved outward along the wave direction; it becomes a Debris
    // fragment carrying its own id (rains back, so mass is conserved). A 방폭
    // (explosion-proof) powder/liquid is exempt — it's inert to the blast, so the
    // concussion can't fling it (it was already shadowed out of the flood above,
    // but guard here too since a cell can be seeded as the wave's own origin).
    if (
      (phase === Phase.Powder || phase === Phase.Liquid) &&
      !shadowsPressure(id) &&
      sim.chance(PRESSURE_LAUNCH_CHANCE)
    ) {
      // A shock-fragile living grain (Termite/Nanobot) dies from the
      // concussion instead of being flung unharmed like inert matter —
      // unless this wave is itself harmless (Woofer). See defaultCell's
      // matching branch for the in-crater shove.
      const fragileInto = getMaterial(id).shockFragile;
      if (!harmless && fragileInto !== undefined) {
        sim.set(x, y, fragileInto);
      } else {
        launchBallistic(sim, x, y, edx, edy, DEBRIS.id, PRESSURE_SHOVE);
        sim.setAux(x, y, id);
      }
    }

    for (let i = 0; i < NEIGHBORS.length; i++) {
      const dx = NEIGHBORS[i][0];
      const dy = NEIGHBORS[i][1];
      const cost = NEIGHBORS[i][2];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (outB - cost < 0) continue;
      const nidx = ny * w + nx;
      if (stamp[nidx] === id_p || stamp[nidx] === id_d) continue;
      const nid = sim.get(nx, ny);
      // A solid — or any 방폭 matter — stops the wave and shadows what's behind it;
      // ordinary loose matter and empty air let it flow on through.
      if (shadowsPressure(nid)) continue;
      stamp[nidx] = id_p;
      qx.push(nx);
      qy.push(ny);
      qb.push(outB - cost);
      qdx.push(dx);
      qdy.push(dy);
    }
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
  packedTemp: true,
  // Fade the flash white-hot → orange as its life (stored in temp) drops from
  // SHELL_MAX to 1, so the shockwave visibly cools as it dies.
  glow: { min: 1, max: SHELL_MAX, cool: rgb(255, 120, 24) },
  update: updateBlast,
});
