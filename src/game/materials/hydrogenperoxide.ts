import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { OXYGEN } from './oxygen';
import { VIRUS } from './virus';

// Hydrogen Peroxide (과산화수소, H₂O₂) — a clear liquid that looks like water but
// is always quietly falling apart: 2H₂O₂ → 2H₂O + O₂. Each tick it has a small
// chance to decompose in place, turning back into Water and burping a bubble of
// Oxygen into the air above it. That's the fun hook: the released Oxygen is the
// game's fire accelerant (see oxygen.ts — it flashes to Fire beside a flame), so
// pouring peroxide near a fire feeds it pure oxygen and the blaze roars. Heat
// (or a catalyst-hot neighbour) sharply speeds the breakdown, so a splash on
// something burning gushes oxygen in a runaway.
//
// It's also a disinfectant: an adjacent Virus cell is oxidised away to nothing —
// dab peroxide on an infection and it bubbles the plague out, the same way it
// cleans a wound.
const DECOMPOSE_CHANCE = 0.012; // slow, steady breakdown at room temperature
const HOT_DECOMPOSE_CHANCE = 0.2; // heat/catalysis rips it apart far faster
const HOT_THRESHOLD = 50; // warmed past this, decomposition accelerates
const STERILIZE_CHANCE = 0.4; // oxidises adjacent Virus away

/** Find an EMPTY neighbour for the liberated O₂, preferring straight up so the
 *  bubble rises off the liquid; returns [-1,-1] if the cell is boxed in. */
function ventCell(x: number, y: number, sim: SimContext): [number, number] {
  if (sim.inBounds(x, y - 1) && sim.isEmpty(x, y - 1)) return [x, y - 1];
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) return [nx, ny];
  }
  return [-1, -1];
}

function updateHydrogenPeroxide(x: number, y: number, sim: SimContext): void {
  // Disinfect: oxidise any adjacent Virus away. EMPTY writes are always safe.
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === VIRUS.id && sim.chance(STERILIZE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
    }
  }

  const rate = sim.getTemp(x, y) >= HOT_THRESHOLD ? HOT_DECOMPOSE_CHANCE : DECOMPOSE_CHANCE;
  if (sim.chance(rate)) {
    // Decompose: vent a bubble of Oxygen (if there's room) and revert to Water,
    // keeping this cell's temperature so hot peroxide leaves hot water behind.
    const [vx, vy] = ventCell(x, y, sim);
    if (vx >= 0) sim.spawn(vx, vy, OXYGEN.id);
    sim.set(x, y, WATER.id);
    return;
  }

  updateLiquid(x, y, sim);
}

export const HYDROGEN_PEROXIDE = register({
  id: 88,
  name: 'H2O2',
  phase: Phase.Liquid,
  color: rgb(206, 228, 238),
  // A touch denser than Water (3), so a peroxide layer sinks beneath fresh water.
  density: 3.4,
  category: '액체',
  thermal: { conductivity: 0.55 },
  update: updateHydrogenPeroxide,
});
