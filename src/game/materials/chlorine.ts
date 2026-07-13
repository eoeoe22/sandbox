import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateHeavyGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { PLANT } from './plant';
import { VIRUS } from './virus';
import { YEAST } from './yeast';
import { SEED } from './seed';
import { SLIME } from './slime';

// Chlorine (염소가스) — a heavy, sickly yellow-green poison gas. Like CO₂ it's
// denser than air, so it slumps and pools along the floor (see updateHeavyGas),
// but where CO₂ merely suffocates, Chlorine *kills*: any living thing it touches —
// Plant, Virus, Yeast, Seed, Slime — withers to nothing. It creeps into low
// ground and wipes out a garden or an infection from below, the classic "gas the
// trench" horror. It's otherwise inert and slowly disperses back into air.
//
// (In reality Chlorine is made by mixing Bleach with Acid; Bleach isn't in the
// game yet, so for now it's a directly-placed hazard. When Bleach lands it will
// spawn Chlorine on contact with Acid — see the wiki's 신규 물질 doc.)
const KILL_CHANCE = 0.3; // living neighbors wither fairly fast
const DISSIPATE_CHANCE = 0.004; // disperses back into air over time

function isLiving(id: number): boolean {
  return (
    id === PLANT.id ||
    id === VIRUS.id ||
    id === YEAST.id ||
    id === SEED.id ||
    id === SLIME.id
  );
}

function updateChlorine(x: number, y: number, sim: SimContext): void {
  // Poison: kill any living neighbor. A write to EMPTY is always safe (it can't
  // cause same-tick re-processing).
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isLiving(sim.get(nx, ny)) && sim.chance(KILL_CHANCE)) {
      sim.set(nx, ny, EMPTY);
    }
  }

  if (sim.chance(DISSIPATE_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }

  updateHeavyGas(x, y, sim);
}

export const CHLORINE = register({
  id: 96,
  name: 'Chlorine',
  phase: Phase.Gas,
  color: rgb(190, 214, 92),
  // Heaviest of the gases — sinks below CO₂ (2) and the ordinary gases (1), pools
  // on the floor, but still lighter than any liquid so it rides on a puddle.
  density: 2.5,
  category: '기체',
  thermal: { conductivity: 0.06 },
  update: updateChlorine,
});
