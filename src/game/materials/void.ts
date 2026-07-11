import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';

// Void — a bottomless sink: a static solid that deletes any material touching it
// (every tick it clears its 8 neighbors to Empty). The one exception is the
// indestructible Wall, so Void can't eat through the container. It's the natural
// counterpart to Clone (the infinite source): a Clone feeding a Void makes a
// conveyor that runs forever, and a Void is the tidy way to drain a flood or
// throttle a runaway reaction without the sandbox filling up.
function updateVoid(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY || nid === VOID.id) continue;
    const nm = getMaterial(nid);
    if (nm.isWall || nm.indestructible) continue; // can't swallow the container or an indestructible solid (Clone)
    sim.set(nx, ny, EMPTY);
  }
}

export const VOID = register({
  id: 50,
  name: 'Void',
  phase: Phase.Solid,
  color: rgb(34, 22, 44),
  density: 1000,
  acidResistant: true,
  category: '특수',
  thermal: { conductivity: 0 },
  update: updateVoid,
});
