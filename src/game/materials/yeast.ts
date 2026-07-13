import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SUGAR } from './sugar';
import { HONEY } from './honey';
import { ALCOHOL } from './alcohol';
import { CO2 } from './co2';

// Yeast (효모) — a living powder that eats sugar and makes booze. A grain sitting
// between a sugar source (Sugar or Honey) and Water ferments the pair:
// (sugar) + (water) → Alcohol + CO₂. The water cell becomes Alcohol (which then
// plugs straight into the fuel chain — it's the game's most eager liquid fuel),
// and the sugar cell fizzes off as a bubble of CO₂, so a mash visibly works,
// bubbling gas up while a spirit collects below. The yeast itself is the catalyst
// and persists — one culture keeps converting as long as it's fed.
//
// It's alive, so heat kills it: warmed past DIE_TEMP a grain dies off to nothing
// (you can't ferment in boiling water), which is also why fermentation only
// happens in fresh Water and stops once the sugar or water around it runs out.
const FERMENT_CHANCE = 0.12;
const DIE_TEMP = 60; // pasteurised — the culture dies above this

function isSugarSource(id: number): boolean {
  return id === SUGAR.id || id === HONEY.id;
}

function updateYeast(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= DIE_TEMP) {
    sim.set(x, y, EMPTY); // cooked — the culture dies
    return;
  }

  let waterX = -1;
  let waterY = -1;
  let sugarX = -1;
  let sugarY = -1;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id) {
      if (waterX < 0) {
        waterX = nx;
        waterY = ny;
      }
    } else if (isSugarSource(nid)) {
      if (sugarX < 0) {
        sugarX = nx;
        sugarY = ny;
      }
    }
  }

  if (waterX >= 0 && sugarX >= 0 && sim.chance(FERMENT_CHANCE)) {
    // Ferment: water → Alcohol, the sugar → a rising bubble of CO₂. The yeast
    // stays put (the return keeps it from falling this tick) and lives on to keep
    // converting — the persistent culture.
    sim.spawn(waterX, waterY, ALCOHOL.id);
    sim.spawn(sugarX, sugarY, CO2.id);
    return;
  }

  updatePowder(x, y, sim);
}

export const YEAST = register({
  id: 89,
  name: 'Yeast',
  phase: Phase.Powder,
  color: rgb(214, 198, 150),
  density: 5,
  category: '생명',
  thermal: { conductivity: 0.3 },
  update: updateYeast,
});
