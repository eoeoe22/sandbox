import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';

// Solid, but with a custom `update` (Solid's phase default is static/no-op).
// Each tick, if the cell directly above is empty, scans its own 4 neighbors
// for Water; on success it spawns a new Vine cell above (capping growth to
// one cell/tick — the `spawn` there is what prevents a vine growing its full
// height in a single tick) and consumes that Water neighbor. Growth stops
// naturally once no adjacent Water remains — no `life`/counter field needed.
// Flammable: fuel for Fire/Lava.
const GROW_CHANCE = 0.05;

function updateVine(x: number, y: number, sim: SimContext): void {
  if (!sim.inBounds(x, y - 1) || !sim.isEmpty(x, y - 1)) return;

  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(GROW_CHANCE)) {
      sim.spawn(x, y - 1, VINE.id);
      sim.set(nx, ny, EMPTY);
      return;
    }
  }
}

export const VINE = register({
  id: 15,
  name: 'Vine',
  phase: Phase.Solid,
  color: rgb(70, 150, 60),
  density: 1000,
  flammable: true,
  category: '생명',
  thermal: { conductivity: 0.3 },
  update: updateVine,
});
