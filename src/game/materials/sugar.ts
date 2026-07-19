import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { ASH } from './ash';
import { WATER } from './water';
import { SUGAR_WATER } from './sugarwater';

// Sugar (설탕) — a fine white powder that falls and piles like salt, with three
// fates. Touch a flame and it catches and burns like a light fuel (see
// combustion.ts). Merely *heat* it — on hot stone, near lava, under the heat
// brush — and before it reaches its ignition point it caramelises and then chars:
// past CARBONIZE_TEMP a grain blackens into Ash without ever bursting into flame,
// the burnt-sugar smell made literal.
//
// Its third fate is to DISSOLVE: a grain touching fresh Water melts into it and
// turns it into Sugar Water (설탕물), the same way Salt makes Saltwater — except
// sugar is far more soluble, so one grain sweetens a *larger* pocket of water than
// a pinch of salt salinates (SUGAR_WATER_RATIO > SALT_WATER_RATIO). The undissolved
// grain is still fermentation feedstock in its own right — Yeast between Sugar and
// Water turns the pair into Alcohol + CO₂ (see yeast.ts) — but now the usual path
// is that the sugar dissolves first and the Yeast ferments the resulting Sugar
// Water directly (sugarwater.ts handles that fermentation in its update).
const SPEC: Combustible = { burnChance: 0.09, autoIgniteTemp: 300 };
// Below the ignition point: heat alone caramelises then carbonises the grain into
// char (Ash) instead of open flame.
const CARBONIZE_TEMP = 200;
const CARBONIZE_CHANCE = 0.08;

// Dissolving (mirrors salt.ts). A Water neighbour dissolves the grain each tick;
// the grain vanishes and its water pocket turns to Sugar Water. Sugar is more
// soluble than salt in both senses: a grain dissolves a touch more readily
// (DISSOLVE_CHANCE ≥ salt's 0.04) and, crucially, salts a *bigger* pocket —
// SUGAR_WATER_RATIO connected Water cells per grain, vs salt's 8.
const DISSOLVE_CHANCE = 0.05;

// One grain sweetens up to this many connected Water cells (a spoon of sugar
// sweetens a whole glass — and more of it than salt would). Sugar Water's boiling
// deposits Sugar back at this same rate via SimContext.sugarDebt, so the round
// trip is symmetric: it takes roughly this many evaporated cells to re-form one
// grain. Deliberately larger than SALT_WATER_RATIO (8) — sugar is more soluble.
export const SUGAR_WATER_RATIO = 12;

function updateSugar(x: number, y: number, sim: SimContext): void {
  // Direct flame (or self-ignition past 300°) → burns as a fuel.
  if (tryBurn(x, y, sim, SPEC)) return;
  // Heated but not yet burning → caramelise/carbonise to Ash. Gated *below* the
  // ignition point: an actually-burning grain is pinned at combustion's 800°, so
  // without this upper bound it would keep short-circuiting to inert Ash instead
  // of burning as a fuel (Ash isn't combustible, so the flame front would die).
  // Keeps the cell's temperature so the fresh char reads as hot.
  const t = sim.getTemp(x, y);
  if (t >= CARBONIZE_TEMP && t < SPEC.autoIgniteTemp && sim.chance(CARBONIZE_CHANCE)) {
    sim.set(x, y, ASH.id);
    return;
  }

  // Dissolve into fresh Water → Sugar Water (mirrors salt.ts exactly).
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(DISSOLVE_CHANCE)) {
      const converted = sweetenPocket(nx, ny, sim);
      // A pocket smaller than SUGAR_WATER_RATIO can't use up the whole grain —
      // credit the unused portion to the shared running total that boiling
      // (sugarwater.ts) draws from, so a grain dissolving into a too-small puddle
      // never leaks sugar mass. If that pushes the total back to a full grain, the
      // grain simply doesn't finish leaving this cell.
      sim.sugarDebt += (SUGAR_WATER_RATIO - converted) / SUGAR_WATER_RATIO;
      if (sim.sugarDebt >= 1) {
        sim.sugarDebt -= 1;
        sim.set(x, y, SUGAR.id);
      } else {
        sim.set(x, y, EMPTY);
      }
      return;
    }
  }

  updatePowder(x, y, sim);
}

// Bounded breadth-first flood fill over connected fresh Water, converting up to
// SUGAR_WATER_RATIO cells to Sugar Water in one shot. Stops early if the connected
// pocket is smaller than that, and returns however many cells it actually
// converted (mirrors salt.ts's salinatePocket).
function sweetenPocket(startX: number, startY: number, sim: SimContext): number {
  const queue: Array<[number, number]> = [[startX, startY]];
  const visited = new Set<string>([`${startX},${startY}`]);
  let converted = 0;
  while (queue.length > 0 && converted < SUGAR_WATER_RATIO) {
    const [x, y] = queue.shift()!;
    sim.spawn(x, y, SUGAR_WATER.id);
    converted++;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key) || !sim.inBounds(nx, ny)) continue;
      visited.add(key);
      if (sim.get(nx, ny) === WATER.id) queue.push([nx, ny]);
    }
  }
  return converted;
}

export const SUGAR = register({
  id: 95,
  name: 'Sugar',
  phase: Phase.Powder,
  color: rgb(242, 240, 233),
  // Real sucrose crystal (~1.59 g/cm³) is notably lighter than mineral salt
  // (~2.16), so it gets its own, lighter tier — still dense enough to sink
  // through fresh Water (so it dissolves from within a pool, mirroring Salt),
  // but floats clear of denser liquids salt sinks straight through.
  density: 3.65,
  combustible: true,
  category: '가루',
  thermal: { conductivity: 0.3 },
  update: updateSugar,
});
