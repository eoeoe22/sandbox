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
// so every solid within reach blocks/shadows it completely untouched
// (완전한 비파괴성) while every loose grain of powder or puddle of liquid is
// flung outward as Debris (mass-conserving — it arcs out and rains back).
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

// Visible reach of the cosmetic shockwave ring (cells): REACH trimmed by the
// same global 2/3 blast-scale detonate() applies (see blast.ts BLAST_REACH_SCALE),
// so the drawn ring sweeps out to exactly where the pulse actually shoves matter.
const SHOCK_VIS_REACH = (REACH * 2) / 3;

/** Fire one invisible, non-destructive shockwave pulse from a single Woofer
 *  cell: only the blast subsystem's physics is reused (loose matter shoved
 *  via the power/durability axis, solids shadowed untouched) — the visual
 *  crater dressing is switched off with a custom `onCell` that claims every
 *  reached EMPTY cell and does nothing to it (no Blast flash, so no chance of
 *  the flash decaying into stray Fire). Non-empty cells fall through
 *  (`onCell` returns false/undefined) to the ordinary default handling, so
 *  loose matter still gets shoved and solids are still shadowed exactly as
 *  before. */
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
//   2. Acceptance is wired directly at every *source* of a pulse instead of
//      through the generic conductive path: battery.ts's `injectPulses`
//      (direct contact — 배터리 직접 연결) and spark.ts's own arc phase
//      (reached via a relay through ordinary conductors) both special-case
//      `WOOFER.id` by id and call `wooferBodyPulse` straight away — the same
//      shape as C4's `electricDetonate` / Nichrome's Joule-heat special
//      cases. Neither path ever calls `sim.spawn(..., SPARK.id)` on a Woofer
//      cell: the pulse is consumed on arrival, so **no Spark is ever
//      rendered inside/on the body**, and nothing propagates onward to any
//      *other* conductor the body happens to touch — the one-way
//      "outside → inside" property falls out for free, with no extra guard
//      needed.
//
// A future device that wants this same shape (external trigger → whole
// connected body reacts as one, never conducts further) can copy points 1–2
// verbatim: skip `conductive`, add an id-check + flood call at each pulse
// source (battery/turbine/spark.ts), and memoize the flood per tick via a
// dedicated SimContext field (see `wooferFlooded`/`wooferFloodTick` there,
// modeled directly on Turbine's own `turbineFlooded`/`turbineFloodTick`) so a
// body touched from several directions/sources in one tick still fires
// exactly once instead of re-flooding per entry point.
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

/** Flood the connected Woofer body (4-connected, like Turbine's own body
 *  walk) starting at (sx,sy) and fire every cell's pulse in the same event —
 *  "전기가 즉시 전역 확산" (the whole cabinet thumps together). Memoized per
 *  tick via `SimContext.wooferFlooded` so a body reached from several
 *  directions/sources this tick still fires exactly once. */
export function wooferBodyPulse(sim: SimContext, sx: number, sy: number): void {
  if (sim.tick !== sim.wooferFloodTick) {
    sim.wooferFloodTick = sim.tick;
    sim.wooferFlooded.clear();
    sim.wooferPulseX.length = 0;
    sim.wooferPulseY.length = 0;
  }
  const w = sim.width;
  const startIdx = sy * w + sx;
  if (sim.wooferFlooded.has(startIdx)) return;

  const seen = new Set<number>([startIdx]);
  const stack: number[] = [sx, sy];
  // Collect this flood's cells so the ring can honestly reflect the pulse's reach:
  // the shockwave fires from *every* body cell (wooferPulse below), so its true
  // extent is the body dilated by the reach — not a fixed radius from one point.
  // We take the centroid as the ring centre and the body's own radius (farthest
  // cell from that centre) as where the wavefront *starts*, so it then travels the
  // real reach outward from the cabinet's surface (see the renderer's ring).
  const bx: number[] = [];
  const by: number[] = [];
  let sumX = 0;
  let sumY = 0;
  while (stack.length > 0 && bx.length < MAX_BODY) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    bx.push(x);
    by.push(y);
    sumX += x;
    sumY += y;
    sim.wooferFlooded.add(y * w + x);
    wooferPulse(sim, x, y);
    sim.wooferPulseX.push(x);
    sim.wooferPulseY.push(y);
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
  // One expanding-ring VFX per firing body (a background effect the renderer
  // animates and draws behind matter — see Grid.shockwaves / CanvasRenderer).
  const count = bx.length;
  if (count > 0) {
    const cx = sumX / count;
    const cy = sumY / count;
    // Body radius: farthest covered cell from the centroid — the wavefront's start.
    let r0 = 0;
    for (let i = 0; i < count; i++) {
      const dx = bx[i] - cx;
      const dy = by[i] - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r0) r0 = d;
    }
    sim.emitShockwave(cx, cy, r0, SHOCK_VIS_REACH);
  }
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
});
