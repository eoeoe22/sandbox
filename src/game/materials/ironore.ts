import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { COAL } from './coal';
import { COAL_POWDER } from './coalpowder';
import { IRON } from './iron';
import { IRON_MELT_TEMP } from './moltenmetal';
import { SLAG } from './slag';
import { LIMESTONE } from './limestone';
import { SMOKE } from './smoke';

// Iron Ore — the heart of the smelting toy. A red-brown powder that pours and
// piles, it turns into metal only through the single rule that gives the whole
// process its identity: *heat alone makes useless slag; heat plus carbon makes
// iron*. Everything else — bloomeries, blast furnaces, tapping, casting, the
// failure modes — falls out of that rule meeting the existing physics
// (conduction, density layering, the 800° burn pin, oxygen forced draught).
//
// Two temperature bands drive it:
//
//  • Reduction band [780°, 1400°): if a Coal / Coal Powder cell is touching,
//    the ore slowly reduces — a per-tick chance advances an `aux` progress
//    counter (0..4), spending roughly one carbon cell per ore cell along the
//    way (released as a puff of Smoke, standing in for CO₂). When the counter
//    fills, the ore becomes Iron with probability IRON_YIELD, else Slag. A
//    Limestone neighbour acts as flux, raising that yield toward FLUX_YIELD and
//    being consumed. Bare coal smoulders at exactly 800° (see combustion.ts), so
//    an ordinary coal fire sits right inside this band — a plain bloomery reduces
//    ore with no forced draught, and 800° < Stone's 1100° melt keeps the walls
//    safe.
//
//  • Melt band [1400°, ∞): at or past Iron's melting point the ore just slumps
//    into Slag regardless of carbon — the failure product. This is the moral of
//    the toy: blast Blue Flame or Lava straight at ore (no carbon, way over
//    1400°) and you get a glassy slag puddle, never iron. Over-blow a furnace so
//    the ore crosses 1400° before enough carbon has reduced it and the yield
//    collapses — reduction and melting are a race.
//
// The reduced Iron is placed in-place (temperature preserved), so a cool bloom
// stays solid where it formed and a white-hot one flows on as Molten Metal down
// into the hearth — the vertical zones of a real furnace emerge on their own.
const REDUCE_MIN = 780;
const PROGRESS_CHANCE = 0.05;
const REDUCE_STAGES = 4;
const CARBON_COST = 0.25;
const IRON_YIELD = 0.7;
const FLUX_YIELD = 0.95;
const FLUX_CONSUME = 0.5;
const ORE_MELT_CHANCE = 0.15;

function isCarbon(id: number): boolean {
  return id === COAL.id || id === COAL_POWDER.id;
}

function updateIronOre(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);

  if (t >= IRON_MELT_TEMP) {
    // Too hot, carbon or not: slump into slag over a few ticks (probabilistic so
    // a pile visibly slumps rather than flashing over). Clear aux first — Iron
    // reads aux as its spark-refractory countdown, and Slag ignores it, but
    // leaving a stale value would be a latent bug if either ever converted back.
    if (sim.chance(ORE_MELT_CHANCE)) {
      sim.setAux(x, y, 0);
      sim.set(x, y, SLAG.id); // in-place: keeps the high temperature (stays molten)
      return;
    }
  } else if (t >= REDUCE_MIN) {
    // Scan the 8 neighbours once for a carbon source (required) and a flux
    // grain (optional), taking the first of each.
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
      // Each step of progress may burn a carbon grain (≈1 coal per ore over the
      // 4 stages), venting a puff of Smoke as CO₂. Writing EMPTY then spawning
      // Smoke into the vacated cell is safe against same-tick reprocessing.
      if (sim.chance(CARBON_COST)) {
        sim.set(cx, cy, EMPTY);
        sim.spawn(cx, cy, SMOKE.id);
      }
      const aux = sim.getAux(x, y) + 1;
      if (aux >= REDUCE_STAGES) {
        // Fully reduced: become Iron (or Slag on a miss). Flux lifts the yield.
        sim.setAux(x, y, 0); // clear before handing the cell to Iron
        const yield_ = fx >= 0 ? FLUX_YIELD : IRON_YIELD;
        sim.set(x, y, sim.chance(yield_) ? IRON.id : SLAG.id); // in-place: keeps temp
        if (fx >= 0 && sim.chance(FLUX_CONSUME)) {
          sim.set(fx, fy, EMPTY);
          sim.spawn(fx, fy, SMOKE.id); // calcining puff
        }
        return;
      }
      sim.setAux(x, y, aux);
    }
  }

  // Not converted this tick: fall and pile like an ordinary powder.
  updatePowder(x, y, sim);
}

export const IRON_ORE = register({
  id: 67,
  name: 'Iron Ore',
  phase: Phase.Powder,
  color: rgb(148, 90, 62),
  // Sinks through water (3) and liquid slag (6) but floats on Molten Metal (8),
  // so ore charged over a molten hearth rides on top like a real furnace burden.
  density: 7,
  category: '제련',
  thermal: { conductivity: 0.4 },
  update: updateIronOre,
});
