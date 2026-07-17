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
// Density 7: Coal Powder (5) floats on the pool so you can dust carbon over its
// surface, the reduced Molten Metal (8) sinks below it to pool on the floor, and
// Slag (6) floats up above — the furnace's vertical layers emerge on their own,
// with the heavy iron settling under the light slag as in a real hearth.
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
// the smelting liquids (dusted on top and pulled under, or stirred down for
// reduction — see Coal Powder's mixIntoMelt) and should work back up once
// there's no more reduction left to do, the same "가벼운 가루" float Ash/
// Sawdust get in water. Deliberately *excludes* Molten Iron Ore itself,
// though: that's the one layer where reduction is still actively happening,
// so carbon/flux submerged in *it* should stay put and keep reacting with
// its ore neighbours rather than skim straight back to the surface — only
// once it's below the ore, in the settled Slag or finished Molten Metal
// (nothing left to reduce), does it float clear. Gated on material identity
// rather than the generic density check (tryBuoyantRise) because *every*
// ordinary liquid is denser than these powders too — only these two are
// meant to float them, nothing else is.
export function isSpentMelt(id: number): boolean {
  return id === SLAG.id || id === MOLTEN_METAL.id;
}

const FLUX_RISE_STALL_CHANCE = 0.3; // rises in a bobbing flutter, not a dead-straight snap
const FLUX_RISE_SWAY_CHANCE = 0.35; // occasional sideways drift while rising

export function tryRiseThroughFlux(x: number, y: number, sim: SimContext): boolean {
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  if (!sim.inBounds(ux, uy) || !isSpentMelt(sim.get(ux, uy))) return false;
  if (sim.chance(FLUX_RISE_STALL_CHANCE)) return true;
  if (sim.chance(FLUX_RISE_SWAY_CHANCE) && sim.moveDiagonalUp(x, y)) return true;
  if (sim.moveUp(x, y)) return true;
  sim.moveDiagonalUp(x, y);
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
  density: 7,
  category: '제련',
  // Placed hot; conducts a little worse than stone.
  thermal: { init: 1000, conductivity: 0.35 },
  glow: { min: SOLIDIFY_TEMP, max: 1150, cool: rgb(62, 56, 66) },
  update: updateMoltenIronOre,
});
