import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { ACID } from './acid';
import { ACID_VAPOR } from './acidvapor';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { DIRT } from './dirt';
import { SAND } from './sand';
import { MUD } from './mud';

// Virus — a plague that converts what it touches into more of itself, then
// spreads from there. It infects soft, "organic" matter — anything flammable or
// combustible (plants, wood, the fuels…) plus water and loose earth — one cell
// per tick via `spawn` (which marks the new cell moved, so it can't fill a
// region in a single frame). It leaves the hard world alone: Stone, metals, Glass, Concrete, Wall,
// the gases, and the explosives are all immune, so a virus outbreak is contained
// by a stone or glass wall.
//
// The cure is heat and chemistry: it's tagged `flammable`, so Fire and Lava burn
// it out; and an adjacent Acid/Acid Vapor cell, or being heated to boiling,
// kills a cell outright. So the counters are exactly what you'd reach for —
// torch it, douse it in acid, or steam it.
const INFECT_CHANCE = 0.05;
const CURE_TEMP = 100;

// A virus cell reached by a chemical disinfectant (H₂O₂) becomes a *corrosion
// front*, and its `aux` byte carries a small "reach" budget (1..CURE_SEED_BUDGET).
// On its own turn a front eats itself away and, if any budget is left, hands
// budget-1 to a SINGLE randomly-chosen still-infected neighbour (via `spawn`, so
// it acts only next tick). That one random step per tick does two things the old
// sweep-the-whole-colony wave didn't: the eaten edge comes out ragged and organic
// instead of a clean expanding square, and the decrementing budget hard-caps how
// far one seed can travel — so the spread can't run away across a whole colony.
// Because H₂O₂ is also consumed each time it seeds one (see hydrogenperoxide.ts),
// the total virus a splash can clear is proportional to how much you actually
// pour: a drop can't sterilise a huge mass. Contact-only disinfectants (Alcohol)
// kill the touched cell outright and seed no front. Virus otherwise never uses
// aux, so any healthy cell reads 0 here.
export const CURE_SEED_BUDGET = 10;

function isInfectable(id: number): boolean {
  if (id === EMPTY || id === VIRUS.id) return false;
  if (id === WATER.id || id === SALTWATER.id || id === DIRT.id || id === SAND.id || id === MUD.id) {
    return true;
  }
  const m = getMaterial(id);
  return !!(m.flammable || m.combustible);
}

function updateVirus(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= CURE_TEMP) {
    sim.set(x, y, EMPTY); // boiled/burned away
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === ACID.id || nid === ACID_VAPOR.id) {
      sim.set(x, y, EMPTY); // dissolved by acid
      return;
    }
  }

  // Corrosion front (aux = remaining reach): eat this cell away, and if any reach
  // is left, hand the corrosion to ONE random still-healthy virus neighbour. A
  // single random step per tick makes the eaten boundary ragged (not a geometric
  // ring), and the decrementing budget bounds one seed's total reach so a splash
  // can't sterilise a whole colony. `spawn` marks the chosen neighbour moved so it
  // only acts next tick (one step per tick, no same-tick runaway).
  const budget = sim.getAux(x, y);
  if (budget > 0) {
    if (budget > 1) {
      const cxs: number[] = [];
      const cys: number[] = [];
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!sim.inBounds(nx, ny)) continue;
        if (sim.get(nx, ny) === VIRUS.id && sim.getAux(nx, ny) === 0) {
          cxs.push(nx);
          cys.push(ny);
        }
      }
      if (cxs.length > 0) {
        const k = sim.randInt(cxs.length);
        sim.spawn(cxs[k], cys[k], VIRUS.id); // moved-guard: acts next tick
        sim.setAux(cxs[k], cys[k], budget - 1);
      }
    }
    sim.set(x, y, EMPTY); // corroded away
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isInfectable(sim.get(nx, ny)) && sim.chance(INFECT_CHANCE)) {
      sim.spawn(nx, ny, VIRUS.id);
      return;
    }
  }
}

export const VIRUS = register({
  id: 48,
  name: 'Virus',
  phase: Phase.Solid,
  color: rgb(158, 66, 176),
  density: 1000,
  flammable: true,
  category: '생명',
  thermal: { conductivity: 0.3 },
  update: updateVirus,
});
