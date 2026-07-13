import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { ASH } from './ash';

// Sugar (설탕) — a fine white powder that falls and piles like salt, with two
// fates when things get hot. Touch a flame and it catches and burns like a light
// fuel (see combustion.ts). Merely *heat* it — on hot stone, near lava, under the
// heat brush — and before it reaches its ignition point it caramelises and then
// chars: past CARBONIZE_TEMP a grain blackens into Ash without ever bursting into
// flame, the burnt-sugar smell made literal.
//
// Its other role is as fermentation feedstock: Yeast sitting between Sugar and
// Water turns the pair into Alcohol + CO₂ (see yeast.ts), which is why Sugar
// deliberately does NOT dissolve in water on its own — a grain has to sit there,
// undissolved, for the yeast to work on it.
const SPEC: Combustible = { burnChance: 0.09, autoIgniteTemp: 300 };
// Below the ignition point: heat alone caramelises then carbonises the grain into
// char (Ash) instead of open flame.
const CARBONIZE_TEMP = 200;
const CARBONIZE_CHANCE = 0.08;

function updateSugar(x: number, y: number, sim: SimContext): void {
  // Direct flame (or self-ignition past 300°) → burns as a fuel.
  if (tryBurn(x, y, sim, SPEC)) return;
  // Heated but not yet burning → caramelise/carbonise to Ash. Keeps the cell's
  // temperature so the fresh char reads as hot.
  if (sim.getTemp(x, y) >= CARBONIZE_TEMP && sim.chance(CARBONIZE_CHANCE)) {
    sim.set(x, y, ASH.id);
    return;
  }
  updatePowder(x, y, sim);
}

export const SUGAR = register({
  id: 95,
  name: 'Sugar',
  phase: Phase.Powder,
  color: rgb(242, 240, 233),
  density: 5,
  combustible: true,
  category: '가루',
  thermal: { conductivity: 0.3 },
  update: updateSugar,
});
