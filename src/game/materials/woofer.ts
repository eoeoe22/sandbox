import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { detonate } from './blast';

// Woofer (우퍼) — an electric appliance, not a charge: plug a Battery/LFP
// Battery straight into it, or wire one up through ordinary conductors, and
// every pulse that reaches it thumps out an INVISIBLE shockwave, like a
// speaker cone shoving air with no flash of light. It reuses the blast
// subsystem's own destructive-power/durability axis (see blast.ts,
// introduced for Gunpowder's weak "shove, don't crater" concussion) pinned to
// POWER 0 — a blast too weak to beat even the flimsiest solid's durability,
// so every structural solid within reach blocks/shadows it completely untouched
// (완전한 비파괴성) while every loose grain of powder or puddle of liquid is
// flung outward as Debris (mass-conserving — it arcs out and rains back).
// "Structural" is the operative word: a solid tagged `shockLoose` (a crawling
// Termite/Nanobot — see blast.ts) is matter this wave *carries* rather than
// structure it breaks against, so the thump blows the bugs away like powder
// (and crushes a termite half the time, via its `shockDeathChance`) without the
// Woofer ever gaining any destructive power.
// Unlike an ordinary detonation it never paints a Blast flash over the empty
// air it reaches either (see `onCell` in wooferPulse below) — a real
// shockwave doesn't glow, and a lit flash cell has a chance to decay into
// stray Fire (see blast.ts's SHELL_FIRE_CHANCE), which used to cook a nearby
// Lithium Battery into thermal runaway. Only the *physics* (the push) is
// inherited, not the crater/flash/ember dressing.
//
// Deliberately NOT `explosive`: that keeps it out of detonate()'s connected-
// mass survey (so neighboring Woofers each fire their own independent pulse
// instead of merging into one bigger blast) and, crucially, keeps the Woofer
// cell itself from ever being treated as the "detonating charge" that
// defaultCell always flashes away regardless of power. At POWER 0 the
// Woofer's own solid body also fails the "power beats durability" check, so
// it's left completely untouched — the speaker survives its own shockwave and
// can thump again on the next pulse, unlike a one-shot charge.
const REACH = 12; // × the global 2/3 blast-scale ⇒ ~8-cell non-destructive shove
const POWER = 0; // can't break anything, however tough — see blast.ts durability

// Visible reach of the cosmetic shockwave (cells): REACH trimmed by the same
// global 2/3 blast-scale detonate() applies (see blast.ts BLAST_REACH_SCALE), so
// the drawn wavefront sweeps out to exactly where the pulse actually shoves matter.
const SHOCK_VIS_REACH = (REACH * 2) / 3;

/** Fire one invisible, non-destructive shockwave pulse from a single Woofer
 *  cell: only the blast subsystem's physics is reused (loose matter shoved
 *  via the power/durability axis, solids shadowed untouched) — the visual
 *  crater dressing is switched off with a custom `onCell` that claims every
 *  reached EMPTY cell and does nothing to it (no Blast flash, so no chance of
 *  the flash decaying into stray Fire). Non-empty cells fall through
 *  (`onCell` returns false/undefined) to the ordinary default handling, so
 *  loose matter (including `shockLoose` bugs) still gets shoved and structural
 *  solids are still shadowed exactly as before. */
function wooferPulse(sim: SimContext, x: number, y: number): void {
  detonate(sim, x, y, 0, {
    power: POWER,
    reach: REACH,
    onCell: (_s, _cx, _cy, prevId) => (prevId === EMPTY ? true : false),
  });
}

// ── Reusable pattern: a one-way "outside → inside" electric sink ───────────
// Woofer is the mirror image of Turbine's own body-flood (see turbine.ts):
// Turbine floods *outward* (steam inside the body → power emitted at every
// external face); Woofer floods *inward* only (a pulse reaching any face
// cell from outside → every connected Woofer cell reacts at once, "전기가
// 즉시 전역 확산"). Two choices make this a clean template to copy for a
// future device material that should react to power without becoming a wire:
//
//   1. It is NOT `Material.conductive`. That tag drives a fully generic,
//      *symmetric* hand-off (any two conductive neighbors pass a Spark back
//      and forth — see spark.ts) and requires registering a fixed-width
//      conductor "class" (CONDUCTOR_IDS/CLASS_BITS in spark.ts) that's
//      already at capacity (7 of 7 — an 8th conductor would need to steal
//      packing bits from every conductor's strength range). A one-way sink
//      doesn't need any of that machinery: it never *reverts* from a Spark
//      because it never *becomes* one, so it needs no class at all.
//   2. Acceptance is declared once, as an electric-appliance hook, instead of
//      being special-cased at every pulse source. The Woofer registers
//      `directPulse: wooferBodyPulse` (see the register call below); every pulse
//      source — battery.ts's `injectPulses` (direct contact — 배터리 직접 연결),
//      turbine.ts's `energizeNeighbors`, and spark.ts's own arc phase (reached
//      via a relay through ordinary conductors) — dispatches a non-conductor
//      neighbor through the one shared `reactToPulse` (spark.ts), which fires that
//      hook. So a Woofer reacts to *every* source by construction, the same shape
//      as C4's `electricDetonate` / Nichrome's Joule-heat data-driven cases.
//      No path ever calls `sim.spawn(..., SPARK.id)` on a Woofer cell: the pulse
//      is consumed on arrival, so **no Spark is ever rendered inside/on the
//      body**, and nothing propagates onward to any *other* conductor the body
//      happens to touch — the one-way "outside → inside" property falls out for
//      free, with no extra guard needed.
//
// A future device that wants this same shape (external trigger → whole
// connected body reacts as one, never conducts further) copies points 1–2
// verbatim: skip `conductive`, register a `directPulse` hook (so no pulse source
// needs editing — the shared dispatch already routes to it), and memoize the
// flood per tick via a dedicated SimContext field (see `wooferFlooded`/
// `wooferFloodTick` there, modeled directly on Turbine's own `turbineFlooded`/
// `turbineFloodTick`) so a body touched from several directions/sources in one
// tick still fires exactly once instead of re-flooding per entry point.
//
// ── Reaching the free-object layer (독립 오브젝트) without a BLAST cell ──────
// Ordinary explosives push a rubber ball/drum/dynamite by leaving BLAST flash
// cells in the grid for engine/objects.ts to scan for on its own later pass
// (see applyBlastKnockback there) — but Woofer deliberately never creates one
// (see wooferPulse above), and reusing BLAST's id just for this would make
// every OTHER material that treats "an adjacent BLAST cell" as a detonation
// trigger (Gunpowder, TNT, Nitro, C4, …) misfire next to a completely
// non-destructive gadget. So each fired cell is instead queued into
// `SimContext.wooferPulseX/Y` — a plain per-tick event list, not a function
// call into objects.ts, specifically because objects.ts already imports
// spark.ts (for the Spark material) and spark.ts imports this file, so
// importing objects.ts here would close that loop. `stepObjects` reads the
// queue once after the CA scan and shoves nearby bodies (never destroys one —
// see `applyWooferKnockback` in objects.ts), the same event-channel trick a
// future device can reuse for any object-layer effect that shouldn't ride on
// a real (and semantically loaded) material id.

/** Backstop on how far one flood walks the connected Woofer body in a single
 *  pass (mirrors Turbine's own MAX_BODY) — a giant cabinet can't make one
 *  pulse unbounded. */
const MAX_BODY = 256;

/** Roll the per-tick Woofer bookkeeping over to `sim.tick` if it's still holding
 *  a previous tick's state: the body-flood memo and the object-knockback event
 *  queue are cleared together, lazily, so a tick with no Woofer activity costs
 *  nothing. Shared by the material's own body flood and the 충격파 브러시 (see
 *  `fireShockwave`), which both append to that same queue. */
function beginWooferTick(sim: SimContext): void {
  if (sim.tick === sim.wooferFloodTick) return;
  sim.wooferFloodTick = sim.tick;
  sim.wooferFlooded.clear();
  sim.wooferPulseX.length = 0;
  sim.wooferPulseY.length = 0;
}

/** Fire one Woofer pulse from `(x,y)` and queue it for the object layer's own
 *  knockback pass (see `SimContext.wooferPulseX/Y`, drained by `stepObjects`). */
function firePulseAt(sim: SimContext, x: number, y: number): void {
  wooferPulse(sim, x, y);
  sim.wooferPulseX.push(x);
  sim.wooferPulseY.push(y);
}

/**
 * Lattice spacing the 충격파 브러시 thins its pulse *sources* down to (see
 * `fireShockwave`). Unlike a Woofer body — which is small, and fires from every
 * single cell — a brush footprint can be thousands of cells, and firing a
 * reach-`SHOCK_VIS_REACH` flood from each one would be enormously redundant:
 * neighbouring sources one cell apart push almost exactly the same matter.
 *
 * Interior coverage alone would allow a much coarser lattice (the farthest point
 * from a lattice of spacing `s` is `s·√2/2` away, so anything up to `s = reach`
 * leaves every interior cell inside some source's reach). What actually sets the
 * spacing is the footprint's **rim**: the outermost sources sit up to `s-1` cells
 * inside the edge, so they push that much less far outward than the drawn
 * wavefront travels — and "the wave visibly sweeps over matter without moving
 * it" is exactly the mismatch this brush must not have. Measured against firing
 * from every cell, over a max-size brush on a fully packed world: `s=2` moves
 * 100% of the matter, `s=3` 93%, `s=4` 89%. So a quarter of the reach it is —
 * the coarsest spacing that still matches its own wavefront. The cost is ~9ms
 * for the largest possible brush on a completely packed world (~2ms on an
 * ordinary one), paid at most once per SHOCK_BRUSH_PERIOD ticks.
 */
const BRUSH_SOURCE_SPACING = Math.max(1, Math.round(SHOCK_VIS_REACH / 4));

/** Hard ceiling on how many source cells one 충격파 브러시 firing pulses from —
 *  the footprint's answer to `MAX_BODY`, and deliberately the same number, so a
 *  brush firing can never cost more than the giant cabinet the material already
 *  tolerates. Past `MAX_BODY × BRUSH_SOURCE_SPACING²` (~1k cells — so every brush
 *  footprint clears it, and only a 영역 selection ever hits the cap) the lattice
 *  is coarsened beyond BRUSH_SOURCE_SPACING to stay under it, which walks the rim
 *  shortfall described above back up as the selection grows. The push stays at
 *  least *interior*-solid (spacing within one pulse's own reach) up to
 *  `MAX_BODY × SHOCK_VIS_REACH²` ≈ 16k cells, about a 128×128 selection; a larger
 *  one still thumps everywhere, but as a lattice of overlapping discs with
 *  thinning pockets between them rather than one solid wall of push — the
 *  deliberate trade for bounded work, exactly as `MAX_BODY` trades away the far
 *  side of an enormous cabinet. The *visual* wavefront is never thinned: it's
 *  always grown from the full footprint. */
const BRUSH_MAX_SOURCES = MAX_BODY;

/** Flood the connected Woofer body (4-connected, like Turbine's own body
 *  walk) starting at (sx,sy) and fire every cell's pulse in the same event —
 *  "전기가 즉시 전역 확산" (the whole cabinet thumps together). Memoized per
 *  tick via `SimContext.wooferFlooded` so a body reached from several
 *  directions/sources this tick still fires exactly once. */
export function wooferBodyPulse(sim: SimContext, sx: number, sy: number): void {
  beginWooferTick(sim);
  const w = sim.width;
  const startIdx = sy * w + sx;
  if (sim.wooferFlooded.has(startIdx)) return;

  const seen = new Set<number>([startIdx]);
  const stack: number[] = [sx, sy];
  // Collect this flood's cells so the effect can honestly reflect the pulse's reach:
  // the shockwave fires from *every* body cell (wooferPulse below), so its true
  // extent is the body dilated by the reach — not a fixed radius from one point.
  // We hand the whole cell set to the renderer, which grows the wavefront out of
  // the body's own outline (see CanvasRenderer's distance-field ring).
  const bx: number[] = [];
  const by: number[] = [];
  while (stack.length > 0 && bx.length < MAX_BODY) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    bx.push(x);
    by.push(y);
    sim.wooferFlooded.add(y * w + x);
    firePulseAt(sim, x, y);
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== WOOFER.id) continue;
      const k = ny * w + nx;
      if (seen.has(k) || sim.wooferFlooded.has(k)) continue;
      seen.add(k);
      stack.push(nx, ny);
    }
  }
  // One expanding-wavefront VFX per firing body (a background effect the renderer
  // animates out of the body's own outline and draws behind matter — see
  // Grid.shockwaves / CanvasRenderer).
  if (bx.length > 0) sim.emitShockwave(bx, by, SHOCK_VIS_REACH);
}

/**
 * Fire one Woofer shockwave whose *source* is an arbitrary set of cells rather
 * than a Woofer body — the 충격파 브러시 (see engine/brushTools.shockCells): the
 * brush footprint (or the 영역 marquee) stands in for the speaker cabinet, so
 * the thump grows out of exactly the shape the cursor outline showed and scales
 * with the brush size. `cells` is the usual flat `[x0,y0,x1,y1,…]` run.
 *
 * Everything downstream is the material's own pulse, unchanged: the same
 * POWER-0, completely non-destructive shove (`wooferPulse`), the same
 * object-layer event queue, and the same wavefront VFX grown from the source's
 * own outline — a hand-held Woofer, not a second kind of blast. Only the count
 * of pulse *sources* is capped (BRUSH_MAX_SOURCES — see there for what that
 * costs in coverage), since a footprint can be far larger than any cabinet.
 *
 * Note the object-knockback queue this appends to is drained by the *simulation*
 * step (see Simulation.step), so while the sandbox is paused several firings
 * accumulate and are delivered together on the first step after resuming. That's
 * the honest reading of a paused world — nothing has moved in between, so every
 * thump you fired while time was stopped lands the moment it starts again — and
 * each queued pulse is still delivered exactly once and then dropped.
 *
 * Deliberately does NOT consult `sim.wooferFlooded`: that memo answers "has this
 * connected body already thumped this tick", which a free-floating footprint has
 * no identity in. The brush does its own rate limiting instead (see
 * PointerPainter's shock gate), so a held brush thumps on a battery-like cadence
 * rather than every tick.
 */
export function fireShockwave(sim: SimContext, cells: readonly number[]): void {
  const n = cells.length / 2;
  if (n === 0) return;
  beginWooferTick(sim);
  // Thin the sources onto a square lattice (rather than taking the first N, or
  // every k-th of the flat run) so they stay spread evenly over the footprint
  // whatever its shape: a stride over row-major order would rake a diagonal line
  // across a wide selection and leave its corners unshoved.
  // Coarsen to the coverage spacing, and coarsen further only if the cap forces
  // it (a footprint over BRUSH_MAX_SOURCES × spacing² cells).
  const step = Math.max(BRUSH_SOURCE_SPACING, Math.ceil(Math.sqrt(n / BRUSH_MAX_SOURCES)));
  // Anchor the lattice on the footprint's own first cell rather than on absolute
  // grid coordinates: a thin selection (a 1-cell-wide column at an odd x, say)
  // would miss an absolute lattice entirely and thump nothing at all. Anchored,
  // that first cell always qualifies, so every firing has at least one source.
  const ax = cells[0];
  const ay = cells[1];
  const bx: number[] = [];
  const by: number[] = [];
  for (let k = 0; k < cells.length; k += 2) {
    const x = cells[k];
    const y = cells[k + 1];
    // The full footprint is what the wavefront is drawn from…
    bx.push(x);
    by.push(y);
    // …while only the lattice cells actually pulse.
    if ((x - ax) % step === 0 && (y - ay) % step === 0) firePulseAt(sim, x, y);
  }
  sim.emitShockwave(bx, by, SHOCK_VIS_REACH);
}

export const WOOFER = register({
  id: 109,
  name: 'Woofer',
  phase: Phase.Solid,
  // Dark speaker-cone body; the lattice weave (copper grille tone) reads as a
  // speaker grille over the cone.
  color: rgb(40, 42, 48),
  lattice: rgb(150, 108, 66),
  density: 1000,
  category: '전기',
  thermal: { conductivity: 0.3 },
  // One-way "outside → inside" electric sink: any pulse source touching a face —
  // a Battery/LFP Battery/Turbine in direct contact, or a Spark relayed down a
  // wire — floods the whole connected body and thumps it. Declared once here so
  // every source reacts to it through the shared dispatch (spark.ts reactToPulse),
  // with no per-source id special-casing to keep in sync.
  directPulse: wooferBodyPulse,
});
