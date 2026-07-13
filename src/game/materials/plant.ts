import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { tryBurn, type Combustible } from './combustion';

// Plant — a living green growth that drinks water and *climbs*. Rather than the
// old "eat the puddle you're standing in" fill, a plant now grows the way a real
// one does: roots at the waterline drink, that moisture wicks up the stem cell by
// cell, and the growing tips spend it to push new growth upward into open air —
// so a plant sprouts from a wet patch and creeps up in branching tendrils toward
// the light, slowing and stopping as it outgrows its water supply.
//
// The mechanism is a per-cell moisture store kept in `aux` (0..MAX_MOISTURE):
//   • Drink — a cell touching Water/Saltwater tops itself up to full, consuming
//     that water cell (chance-gated, so a pool is sipped down gradually, and you
//     can watch the puddle shrink as the plant drinks it).
//   • Wick — each tick a cell pulls moisture up from its wettest plant neighbour,
//     losing WICK_STEP per hop. Moisture thus climbs outward from the roots as a
//     gradient, and a tip more than ~MAX/WICK_STEP cells from water is too dry to
//     grow — a natural, water-limited height cap with no bookkeeping.
//   • Decay — a slow per-tick drain, so when the water runs dry the whole plant's
//     moisture bleeds away and growth halts (the plant then reads as dry fuel).
//   • Grow — a watered cell spends GROW_COST moisture to extend into an empty
//     neighbour, strongly preferring the three upward cells (a climbing stem) and
//     only creeping sideways when capped from above.
//
// Dry vegetation is eager fuel: it burns on the self-sustaining combustion model
// (see combustion.ts) with its own `burnChance`, and water smothers a burning
// cell — so only growth that has dried away from its water actually catches.
const BURN_SPEC: Combustible = { burnChance: 0.1, autoIgniteTemp: 400 };

const MAX_MOISTURE = 250; // a byte's worth — a root cell fills to here
/** Moisture a fresh sprout (a germinated Seed) starts with, so it can climb out
 *  of the soil straight away before its roots have topped up. */
export const PLANT_START_MOISTURE = 150;
const DRINK_CHANCE = 0.25; // per-tick chance a root tops up from adjacent water
const WICK_STEP = 14; // moisture lost per cell as it wicks up the stem
const DECAY = 1; // moisture drained per tick (empties the plant once cut off)
const GROW_CHANCE = 0.08; // how often a watered cell attempts to grow
const GROW_COST = 40; // moisture a cell spends to put out one new cell

// Upward growth cells (a climbing stem, branching diagonally); the sideways
// fallback lets a plant capped by a ceiling still creep along it.
const GROW_UP: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, -1],
  [1, -1],
];
const GROW_SIDE: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
];

function isWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

/** Reservoir-sample one random empty cell among `dirs` around (x,y); returns
 *  [-1,-1] if none is open. */
function pickEmpty(
  x: number,
  y: number,
  sim: SimContext,
  dirs: ReadonlyArray<readonly [number, number]>,
): [number, number] {
  let tx = -1;
  let ty = -1;
  let count = 0;
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny) || !sim.isEmpty(nx, ny)) continue;
    count++;
    if (sim.randInt(count) === 0) {
      tx = nx;
      ty = ny;
    }
  }
  return [tx, ty];
}

function updatePlant(x: number, y: number, sim: SimContext): void {
  // Combustion first: a burning plant (once consumed → Fire) stops here, and it
  // doesn't grow while alight.
  if (tryBurn(x, y, sim, BURN_SPEC)) return;
  if (sim.getTemp(x, y) >= BURN_SPEC.autoIgniteTemp) return;

  let m = sim.getAux(x, y);

  // Drink: a root cell touching water refills to full and absorbs that water
  // cell. Only when it has actually dropped, so a full root doesn't waste water.
  if (m < MAX_MOISTURE - WICK_STEP) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      if (isWater(sim.get(nx, ny)) && sim.chance(DRINK_CHANCE)) {
        sim.set(nx, ny, EMPTY); // absorb the water — the pool visibly shrinks
        m = MAX_MOISTURE;
        break;
      }
    }
  }

  // Wick: pull moisture up from the wettest plant neighbour, losing WICK_STEP per
  // hop, so moisture climbs outward from the roots as a decaying gradient.
  let best = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === PLANT.id) {
      const nm = sim.getAux(nx, ny);
      if (nm > best) best = nm;
    }
  }
  if (best - WICK_STEP > m) m = best - WICK_STEP;

  // Decay: bleed a little each tick, so a plant cut off from water dries out and
  // stops growing instead of climbing forever on stale moisture.
  if (m > 0) m -= DECAY;

  // Grow: spend moisture to climb into open space, preferring up and branching
  // diagonally; only creep sideways when boxed in above.
  if (m >= GROW_COST && sim.chance(GROW_CHANCE)) {
    let [tx, ty] = pickEmpty(x, y, sim, GROW_UP);
    if (tx < 0) [tx, ty] = pickEmpty(x, y, sim, GROW_SIDE);
    if (tx >= 0) {
      sim.spawn(tx, ty, PLANT.id); // marks moved → capped at one new cell/tick
      m -= GROW_COST;
    }
  }

  sim.setAux(x, y, m);
}

export const PLANT = register({
  id: 47,
  name: 'Plant',
  phase: Phase.Solid,
  color: rgb(74, 122, 52),
  density: 1000,
  // Burns via the shared combustion model (see updatePlant / combustion.ts), so
  // it's tagged `combustible`, not `flammable` — the two ignition paths are
  // mutually exclusive by design (combustion.ts) to keep the per-fuel burn rate.
  combustible: true,
  category: '생명',
  thermal: { conductivity: 0.3 },
  update: updatePlant,
});
