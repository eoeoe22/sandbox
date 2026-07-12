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
//  • Carbon on the melt reduces it: a per-tick chance advances an `aux` progress
//    counter (0..4), spending ~1 carbon cell per ore cell (released as a puff of
//    Smoke = CO₂). When it fills, the cell becomes Molten Metal (or Slag on a
//    miss). A Limestone neighbour acts as flux, raising the iron yield and being
//    consumed. Because the fresh Molten Metal keeps the pool's temperature, a
//    merely-melted pool (~850°, below Molten Metal's 1350° freeze) sets into a
//    solid Iron bloom at once, while a super-hot pool (blue flame / lava, >1350°)
//    stays flowing molten iron you can pour and cast — the tiers fall out of the
//    temperature for free.
//  • Left to cool below SOLIDIFY_TEMP *without* being reduced, the pool sets into
//    useless Slag — so "heat alone makes slag, heat + carbon makes iron" survives
//    the rework, just melt-first now.
//
// Density 7: Coal Powder (5) floats on the pool so you can dust carbon over its
// surface, the reduced Molten Metal (8) sinks out below it, and Slag (6) rides
// between — the furnace's vertical layers emerge on their own.
const SOLIDIFY_TEMP = 750; // cools below this without reduction → Slag
const PROGRESS_CHANCE = 0.05; // per-tick reduction step while carbon is adjacent
const REDUCE_STAGES = 4; // aux progress needed to fully reduce a cell
const CARBON_COST = 0.25; // ≈1 carbon cell consumed per ore cell over the stages
const IRON_YIELD = 0.7; // chance a finished reduction yields iron (else slag)
const FLUX_YIELD = 0.95; // …raised when a Limestone flux grain is adjacent
const FLUX_CONSUME = 0.5; // chance that flux grain is spent
const FLOW_CHANCE = 0.2; // viscous: flows on a fraction of ticks (like Molten Metal)

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

  if (cx >= 0 && sim.chance(PROGRESS_CHANCE)) {
    // Each step may burn a carbon grain (≈1 per ore over the 4 stages), venting a
    // puff of Smoke. Writing EMPTY then spawning Smoke is safe against same-tick
    // reprocessing.
    if (sim.chance(CARBON_COST)) {
      sim.set(cx, cy, EMPTY);
      sim.spawn(cx, cy, SMOKE.id);
    }
    const aux = sim.getAux(x, y) + 1;
    if (aux >= REDUCE_STAGES) {
      sim.setAux(x, y, 0); // clear before handing the cell to Molten Metal
      const yield_ = fx >= 0 ? FLUX_YIELD : IRON_YIELD;
      // Success → Molten Metal (cools to Iron); miss → Slag. In-place keeps temp.
      sim.set(x, y, sim.chance(yield_) ? MOLTEN_METAL.id : SLAG.id);
      if (fx >= 0 && sim.chance(FLUX_CONSUME)) {
        sim.set(fx, fy, EMPTY);
        sim.spawn(fx, fy, SMOKE.id); // calcining puff
      }
      return;
    }
    sim.setAux(x, y, aux);
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
