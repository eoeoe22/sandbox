import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { SPARK } from './spark';
import { BLAST, detonate } from './blast';

// C4 (플라스틱 폭약) — a stable demolition charge with a realistic split
// personality: touch it with a flame and it merely *burns off* (deflagrates,
// harmless); hit it with an electric arc or a shockwave and it *detonates*. That
// makes it the game's first real bridge between the electricity subsystem and
// explosions — wire a Battery through a switch to a C4 tucked against a wall of
// TNT, and the spark sets off the whole connected charge (surveyMass gathers the
// lot). The reliable, plannable detonator that fire-triggered explosives, which
// go off the instant any flame drifts near, never were.
const BLAST_RADIUS = 14;
// Deflagration when lit by fire/lava: slow and cool, it just burns away rather
// than exploding. A high autoignition means only genuine heat cooks it off, and
// even then it burns instead of detonating.
const SPEC: Combustible = { burnChance: 0.05, autoIgniteTemp: 320 };

function updateC4(x: number, y: number, sim: SimContext): void {
  // Detonate ONLY on a deliberate trigger: an adjacent electric arc (Spark) or a
  // shockwave (Blast). Plain flame or radiant heat makes it burn instead (below)
  // — that stability is the whole identity of C4.
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === SPARK.id || nid === BLAST.id) {
      detonate(sim, x, y);
      return;
    }
  }
  // Not shocked: if fire/lava is licking it (or it's been cooked past its
  // autoignition point) it quietly burns via the shared surface-front model —
  // deflagration, no boom. A Solid, so if it doesn't burn it simply stays put.
  tryBurn(x, y, sim, SPEC);
}

export const C4 = register({
  id: 79,
  name: 'C4',
  phase: Phase.Solid,
  color: rgb(210, 200, 176), // off-white plastic explosive
  density: 1000,
  explosive: true,
  combustible: true,
  blastRadius: BLAST_RADIUS,
  category: '폭발',
  thermal: { conductivity: 0.3 },
  update: updateC4,
});
