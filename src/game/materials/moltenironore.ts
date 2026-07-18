import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid, updatePowderSink } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { COAL } from './coal';
import { COAL_POWDER } from './coalpowder';
import { LIMESTONE } from './limestone';
import { MOLTEN_METAL } from './moltenmetal';
import { SLAG } from './slag';
import { SMOKE } from './smoke';

// Molten Iron Ore — the glowing pool that ordinary Fire melts iron ore into, and
// the heart of the reworked smelting flow: heat *melts* the ore (a plain Fire is
// enough), then you dust carbon onto the melt to pull iron out of it.
//
//  • Carbon against the melt reduces it fast and 1:1: a per-tick chance
//    (REDUCE_CHANCE, ~4 ticks) spends one adjacent carbon grain to convert this
//    cell, venting a puff of Smoke (CO₂). Coal packed against the pool doesn't
//    burn — it's a reductant, shielded from combustion (see coalpowder.ts) — so
//    it's spent by reduction instead of flashing off, and coal dusted on the pool
//    sinks in to disperse (also coalpowder.ts) so the whole depth reduces rather
//    than only the surface. The cell becomes *hot* Molten Metal (or Slag on a
//    yield miss): reduction is treated as exothermic, forcing the fresh iron
//    molten (≥ REDUCE_HEAT) so it stays liquid and flows clear (sinking out of the
//    pool, since the reduced metal is now the densest phase) instead of freezing
//    into a solid crust right where the carbon sits — a crust would seal the melt
//    off and stall reduction (the original bug). A
//    Limestone neighbour acts as flux, raising the iron yield.
//  • Left to cool below SOLIDIFY_TEMP *without* being reduced, the pool sets into
//    useless Slag — so "heat alone makes slag, heat + carbon makes iron" survives
//    the rework, just melt-first now.
//
// Density 6.5: Coal Powder (7.5) is now *denser* than the pool, so dusted carbon
// sinks straight into it on its own (touching, and reducing, ore cells along the
// way down) rather than needing to be skimmed off the surface; the reduced
// Molten Metal (8) sinks below everything to pool on the floor, and Slag (5.75)
// floats up above — the furnace's vertical layers still emerge on their own,
// with the heavy iron settling under the light slag as in a real hearth, just
// with carbon now plunging through the melt instead of riding on top of it (a
// deliberate gameplay call, not a real-world coal density — see
// docs/MATERIAL-SYSTEMS.md's 제련 밀도 재서열 section).
// Kept above Molten Metal's own freeze point (moltenmetal.ts) on purpose: a
// reduction pulls a cell out of *this* pool into that one while both are still
// liquid, so the fresh metal needs to be able to outlive this cell's own
// remaining liquid life, or it freezes into a stray Iron fleck mid-transit
// before it can sink clear (see the comment on Molten Metal's freeze temp).
const SOLIDIFY_TEMP = 750; // cools below this without reduction → Slag
const REDUCE_CHANCE = 0.25; // per-tick chance a carbon-touching cell reduces (fast,
// 1:1 — one carbon grain spent per ore cell, ~4 ticks: contact keeps up so a
// dusted pool sweeps top-down and a mixed charge reacts everywhere at once).
const IRON_YIELD = 0.7; // chance a reduction yields iron (else slag)
const FLUX_YIELD = 0.95; // …raised when a Limestone flux grain is adjacent
const FLUX_CONSUME = 0.5; // chance that flux grain is spent
const FLOW_CHANCE = 0.2; // viscous: flows on a fraction of ticks (like Molten Metal)
const REDUCE_HEAT = 1450; // exothermic: fresh iron is forced this hot so it stays
// molten (well above Molten Metal's 650° freeze) and sinks clear instead of crusting.

function isCarbon(id: number): boolean {
  return id === COAL.id || id === COAL_POWDER.id;
}

// Shared with Limestone and Coal Powder: either can end up submerged inside
// the smelting liquids (dusted on top and pulled under, or stirred/sunk down
// for reduction — see Coal Powder's mixIntoMelt). Originally both were lighter
// than every one of the three smelting liquids, so the generic density-based
// buoyancy every powder gets (updatePowder's tryBuoyantRise — see
// engine/behaviors.ts) would float them clear of all three, which was wrong for
// Molten Iron Ore (still actively reducing; carbon/flux submerged in it should
// stay put and keep reacting with its ore neighbours) and Slag (waste, but flux
// dusted onto it should settle and mix in). This function intercepts exactly
// those two liquids by material identity and holds the grain there — *without*
// freezing it solid: it still needs to be free to settle further down if
// there's room (an ordinary powder never just stops falling because something
// denser sits above it), so the hold calls the plain sink-only fallback
// (updatePowderSink — fall/pile, no rise attempt) instead of doing nothing.
//
// After the 제련 밀도 재서열 (Coal Powder 5→7.5, now denser than both Molten
// Iron Ore 6.5 and Slag 5.75), this is a load-bearing exception only for
// Limestone (still the lightest thing in the furnace). For Coal Powder it's a
// harmless no-op: tryBuoyantRise would already refuse to rise there on density
// alone, and updatePowderSink's own sideways step is gated on the same
// "actually floating" check updatePower's flattenIfFloating uses — false for
// Coal Powder either way, since it's denser than both liquids listed below —
// so calling updatePowderSink instead of updatePowder produces the exact same
// outcome. Left shared rather than split out, since the shared call is still
// correct and Coal Powder needs no separate code path.
//
// This returns false for every other liquid — including the finished Molten
// Metal layer — so the caller's ordinary `updatePowderMix` fallback takes over
// there; Molten Metal needs no special case of its own because Limestone (and
// Coal Powder, though it gets there by sinking through Ore/Slag first now
// rather than starting out on top of everything) is lighter than it, so the
// generic buoyancy already floats each clear on its own (same rise mechanics
// every other powder gets, not a separately-tuned duplicate).
//
// The `pinIds` list below is what updatePowderSink is forwarded as
// SimContext.moveSidewaysContained's `containerIds` — see swapOntoLiquid's own
// doc comment (SimContext.ts) for why that restriction exists at all (the
// short version: an unrestricted swap could leak a pinned grain sideways into
// an unrelated liquid, defeating the containment this hold exists for). The
// set passed here is `[...pinIds, MOLTEN_METAL.id]`, one liquid wider than the
// pin check itself: Molten Metal is this furnace's own product layer (made by
// reduction, always structurally connected to the Ore/Slag body sitting on
// top of it), not a foreign liquid a player placed nearby, so it's safe to
// spread into even though it doesn't trigger the pin. It has to be included —
// Molten Metal is the densest phase and settles beneath Ore/Slag as the
// routine end state of any smelt, so a grain pinned above by Ore/Slag but
// flanked on both sides by Molten Metal at that boundary is common, not a
// contrived edge case. Without Molten Metal in the spread set, such a grain
// could sink no further (too light for Metal), rise no further (the pin
// blocks it while Ore/Slag stays above), and spread no further either —
// reproducing the exact frozen-comb bug this fix exists to prevent, just
// relocated to the Ore/Slag-Metal interface instead of mid-charge.
export function tryHoldInActiveMelt(x: number, y: number, sim: SimContext): boolean {
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  if (!sim.inBounds(ux, uy)) return false;
  const aboveId = sim.get(ux, uy);
  const pinIds = [MOLTEN_IRON_ORE.id, SLAG.id];
  if (!pinIds.includes(aboveId)) return false;
  updatePowderSink(x, y, sim, [...pinIds, MOLTEN_METAL.id]);
  return true;
}

function updateMoltenIronOre(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  if (t < SOLIDIFY_TEMP) {
    // Cooled without being reduced: sets into waste Slag (in-place keeps temp).
    sim.setAux(x, y, 0);
    sim.set(x, y, SLAG.id);
    return;
  }

  // Scan the 8 neighbours once for a carbon source (required) and a flux grain
  // (optional), taking the first of each.
  let cx = -1;
  let cy = -1;
  let fx = -1;
  let fy = -1;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (cx < 0 && isCarbon(nid)) {
      cx = nx;
      cy = ny;
    } else if (fx < 0 && nid === LIMESTONE.id) {
      fx = nx;
      fy = ny;
    }
  }

  if (cx >= 0 && sim.chance(REDUCE_CHANCE)) {
    // Spend one carbon grain to reduce this cell (1:1), venting a puff of Smoke
    // (CO₂). Writing EMPTY then spawning Smoke is safe against same-tick
    // reprocessing; the conversion below is an in-place self write.
    sim.set(cx, cy, EMPTY);
    sim.spawn(cx, cy, SMOKE.id);
    sim.setAux(x, y, 0); // clear before handing the cell to Molten Metal
    const yield_ = fx >= 0 ? FLUX_YIELD : IRON_YIELD;
    if (sim.chance(yield_)) {
      // Success → hot Molten Metal that sinks clear (see REDUCE_HEAT). In-place set
      // keeps temp, so force it molten if the pool was only just melted.
      sim.set(x, y, MOLTEN_METAL.id);
      if (sim.getTemp(x, y) < REDUCE_HEAT) sim.setTemp(x, y, REDUCE_HEAT);
    } else {
      sim.set(x, y, SLAG.id); // yield miss → waste slag (in-place keeps temp)
    }
    if (fx >= 0 && sim.chance(FLUX_CONSUME)) {
      sim.set(fx, fy, EMPTY);
      sim.spawn(fx, fy, SMOKE.id); // calcining puff
    }
    return;
  }

  // Still a molten pool: flow viscously (thicker than water, like Molten Metal).
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const MOLTEN_IRON_ORE = register({
  id: 71,
  name: 'Molten Iron Ore',
  phase: Phase.Liquid,
  // Base colour is the hot end of the glow ramp (bright molten orange); darkens
  // toward `cool` as it sets.
  color: rgb(255, 140, 60),
  density: 6.5,
  category: '제련',
  // Placed hot; conducts a little worse than stone.
  thermal: { init: 1000, conductivity: 0.35 },
  glow: { min: SOLIDIFY_TEMP, max: 1150, cool: rgb(62, 56, 66) },
  update: updateMoltenIronOre,
});
