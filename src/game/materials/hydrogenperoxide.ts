import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { OXYGEN } from './oxygen';
import { YEAST } from './yeast';
import { IRON } from './iron';
import { VIRUS, CURE_SEED_BUDGET } from './virus';

// Hydrogen Peroxide (과산화수소, H₂O₂) — a clear liquid that looks like water but
// is always quietly falling apart: 2H₂O₂ → 2H₂O + O₂. Each tick it has a small
// chance to decompose in place, turning back into Water and burping a bubble of
// Oxygen into the air above it. That's the fun hook: the released Oxygen is the
// game's fire accelerant (see oxygen.ts — it flashes to Fire beside a flame), so
// pouring peroxide near a fire feeds it pure oxygen and the blaze roars. Heat
// (or a catalyst-hot neighbour) sharply speeds the breakdown, so a splash on
// something burning gushes oxygen in a runaway.
//
// It's also an *area* disinfectant, but a self-limiting one. Touching an infection
// seeds a "corrosion front" on one adjacent Virus cell (see virus.ts): that front
// eats inward as a ragged one-cell-per-tick random walk, up to a small budget, so
// the plague dissolves from the edge with an organic frayed boundary rather than a
// clean expanding square. Crucially the peroxide is *consumed* (→Water) each time
// it seeds a front, so the amount of virus a splash can clear is proportional to
// how much you pour — a drop clears a small ragged bite, a poured pool eats deep,
// but nothing lets a trace sterilise an entire colony. (Contrast Alcohol, which
// disinfects only the single cell it touches.)
const DECOMPOSE_CHANCE = 0.004; // very slow, steady breakdown at room temperature
const HOT_DECOMPOSE_CHANCE = 0.067; // heat/catalysis rips it apart faster
const HOT_THRESHOLD = 50; // warmed past this, decomposition accelerates
const STERILIZE_CHANCE = 0.4; // per-tick chance to react with a touched Virus (seed + consume)

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
  // Disinfect: react with one adjacent healthy Virus cell — seed a bounded random
  // corrosion front on it (virus.ts) and be consumed in the reaction (this cell
  // reverts to Water). Because each seed costs a peroxide cell, the total virus a
  // splash clears is bounded by how much you pour; a trace can't wipe a colony.
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === VIRUS.id && sim.getAux(nx, ny) === 0 && sim.chance(STERILIZE_CHANCE)) {
      sim.spawn(nx, ny, VIRUS.id); // re-stamp so we can flag it moved…
      sim.setAux(nx, ny, CURE_SEED_BUDGET); // …then seed the corrosion budget
      sim.set(x, y, WATER.id); // peroxide spent oxidising the virus
      return;
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
  // Catalytic decomposition, expressed declaratively (see engine/reactions.ts):
  //  • Yeast (catalase) is the classic "elephant toothpaste" catalyst — it rips
  //    the peroxide into Water and a frothing gush of Oxygen, exothermically.
  //  • An Iron/rust surface catalyses it too, but only once slightly warmed
  //    (tempMin), and a nearby Yeast colony speeds even that further (catalyst).
  // Both vent Oxygen (byproduct), the game's fire accelerant — decompose peroxide
  // by a flame and the blaze roars.
  reactions: [
    { with: YEAST.id, produce: WATER.id, byproduct: OXYGEN.id, probability: 0.14, heat: 28 },
    {
      with: IRON.id,
      produce: WATER.id,
      byproduct: OXYGEN.id,
      probability: 0.05,
      tempMin: 25,
      heat: 16,
      catalyst: YEAST.id,
      catalystFactor: 3,
    },
  ],
  thermal: { conductivity: 0.55 },
  update: updateHydrogenPeroxide,
});
