import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { GLASS } from './glass';
import { FIRE } from './fire';

// Molten Glass — what Sand becomes when it's heated past its melting point (see
// sand.ts and glass.ts). A hot, sluggish, glowing liquid that flows to fill a
// mold and then freezes into clear solid Glass as it cools, the same
// melt→flow→set cycle as Lava→Stone and Molten Metal→Iron. It's still fiercely
// hot, so it ignites flammable neighbors while molten.
// Raw silica sand has to fully fuse before it flows, so it needs the highest
// heat. Already-fused Glass just has to soften back up, so it re-melts at a
// lower temperature (GLASS_MELT_TEMP) — the same reason a glass pane slumps in
// a kiln well before loose sand would. Both stay comfortably above the molten
// freeze point so the melt→set cycle keeps its hysteresis (no boundary flicker).
export const SAND_MELT_TEMP = 1250;
export const GLASS_MELT_TEMP = 1150;
const MOLTEN_GLASS_TEMP = 1400;
const MOLTEN_GLASS_FREEZE_TEMP = 1050;
const IGNITE_CHANCE = 0.1;
const FLOW_CHANCE = 0.18;

function updateMoltenGlass(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) <= MOLTEN_GLASS_FREEZE_TEMP) {
    // In-place `set` keeps the (now low) temperature so the fresh Glass reads as
    // set rather than instantly re-melting next tick.
    sim.set(x, y, GLASS.id);
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (getMaterial(nid).flammable && sim.chance(IGNITE_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }

  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const MOLTEN_GLASS = register({
  id: 31,
  name: 'Molten Glass',
  phase: Phase.Liquid,
  color: rgb(255, 200, 120),
  density: 5,
  category: '불·열',
  thermal: { init: MOLTEN_GLASS_TEMP, conductivity: 0.5 },
  glow: { min: MOLTEN_GLASS_FREEZE_TEMP, max: MOLTEN_GLASS_TEMP, cool: rgb(130, 95, 70) },
  update: updateMoltenGlass,
});
