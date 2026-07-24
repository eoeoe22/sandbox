import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { AMBIENT_TEMP } from '../config';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { MOLTEN_U238 } from './moltenu238';

// U238 — the other radioactive solid (compare U235 in uranium.ts). Like U235 it
// *self-heats*: each cell warms in proportion to how many fellow-uranium cells
// surround it (the same emergent "critical mass" from surface-area-to-volume and
// conduction), a lone grain inert while a thick block runs away. And just like
// U235 a Water/Saltwater surface boils to Steam and carries the heat off, so a
// U238 pile can be run as a cooled reactor.
//
// The difference is what happens at the top of that ramp. U235 is *explosive*:
// past melt it becomes a self-accelerating corium that goes critical and burns
// off in a Heat-Ray sweep. U238 is deliberately **non-explosive — it only ever
// melts down**. At MELT_TEMP the cell turns into Molten U238 (moltenu238.ts), and
// there the story ends: the melt stops reacting, cools, and sets *irreversibly*
// into Nuke Waste. No criticality, no Nuclear Ray, no detonation — meltdown is the
// worst it can do. So U238 is the "slow, dirty" fuel: it'll cook itself down into
// a pile of waste, but it will never blow the screen apart the way U235 does.
const HEAT_PER_NEIGHBOR = 1;
const MELT_TEMP = 1500;
const COOL_CHANCE = 0.12;
const COOL_AMOUNT = 25;

function updateU238(x: number, y: number, sim: SimContext): void {
  let neighbors = 0;
  let temp = sim.getTemp(x, y);

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === U238.id || nid === MOLTEN_U238.id) {
      // A half-melted mass keeps feeding the solid's reaction, so it doesn't
      // stall at the melt front (matching U235).
      neighbors++;
    } else if (nid === WATER.id || nid === SALTWATER.id) {
      if (sim.chance(COOL_CHANCE)) {
        sim.spawn(nx, ny, STEAM.id);
        temp -= COOL_AMOUNT;
      }
    }
  }

  if (neighbors > 0) {
    temp += neighbors * HEAT_PER_NEIGHBOR;
  }

  sim.setTemp(x, y, temp);

  if (temp >= MELT_TEMP) {
    // Meltdown: melt in place into Molten U238. The in-place `set` keeps the
    // (now high) temperature so the fresh melt reads as molten. Unlike U235 this
    // is the end of the line — the melt won't come back to solid U238, it cools
    // into Nuke Waste.
    sim.set(x, y, MOLTEN_U238.id);
  }
}

export const U238 = register({
  id: 106,
  name: 'U238',
  phase: Phase.Solid,
  color: rgb(150, 165, 95),
  density: 1000,
  category: '방사성',
  explosionProof: true, // 방폭 — see uranium.ts
  thermal: { conductivity: 0.5 },
  // Duller, more metallic olive than U235's brighter yellow-green, brightening as
  // it heats toward meltdown.
  glow: { min: AMBIENT_TEMP, max: MELT_TEMP, cool: rgb(60, 70, 40) },
  update: updateU238,
});
