import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
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
//  • Carbon against the melt reduces it: a per-tick chance advances an `aux`
//    progress counter (0..4), spending ~1 carbon cell per ore cell (released as a
//    puff of Smoke = CO₂). Coal packed against the pool doesn't burn — it's a
//    reductant, shielded from combustion (see coalpowder.ts) — so it's spent by
//    reduction instead of flashing off. When the counter fills, the cell becomes
//    *hot* Molten Metal (or Slag on a yield miss). Reduction is treated as
//    exothermic: the fresh iron is forced molten (≥ REDUCE_HEAT) so it SINKS out
//    of the pool and collects in the hearth instead of freezing into a solid
//    crust on the surface right where the carbon sits — a crust would seal the
//    melt off and stall reduction (the original bug). The released heat also
//    keeps the surrounding pool molten, so once reduction starts it sustains
//    itself and the pool convects: reduced iron sinks, fresh ore rises to the
//    carbon. A Limestone neighbour acts as flux, raising the iron yield.
//  • Left to cool below SOLIDIFY_TEMP *without* being reduced, the pool sets into
//    useless Slag — so "heat alone makes slag, heat + carbon makes iron" survives
//    the rework, just melt-first now.
//
// Density 7: Coal Powder (5) floats on the pool so you can dust carbon over its
// surface, the reduced Molten Metal (8) sinks out below it, and Slag (6) rides
// between — the furnace's vertical layers emerge on their own.
const SOLIDIFY_TEMP = 750; // cools below this without reduction → Slag
const REDUCE_CHANCE = 0.25; // per-tick chance a carbon-touching cell reduces (fast,
// 1:1 — one carbon grain spent per ore cell, ~4 ticks: contact keeps up so a
// dusted pool sweeps top-down and a mixed charge reacts everywhere at once).
const IRON_YIELD = 0.7; // chance a reduction yields iron (else slag)
const FLUX_YIELD = 0.95; // …raised when a Limestone flux grain is adjacent
const FLUX_CONSUME = 0.5; // chance that flux grain is spent
const FLOW_CHANCE = 0.2; // viscous: flows on a fraction of ticks (like Molten Metal)
const REDUCE_HEAT = 1450; // exothermic: fresh iron is forced this hot so it stays
// molten (above Molten Metal's 1350° freeze) and sinks out instead of crusting.

function isCarbon(id: number): boolean {
  return id === COAL.id || id === COAL_POWDER.id;
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
      // Success → hot Molten Metal that sinks out (see REDUCE_HEAT). In-place set
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
  // Base colour is the hot end of the glow ramp (molten red-orange, redder than
  // Slag since it's iron-rich ore); darkens toward `cool` as it sets.
  color: rgb(225, 95, 45),
  density: 7,
  category: '제련',
  // Placed hot; conducts a little worse than stone.
  thermal: { init: 1000, conductivity: 0.35 },
  glow: { min: SOLIDIFY_TEMP, max: 1150, cool: rgb(70, 34, 28) },
  update: updateMoltenIronOre,
});
