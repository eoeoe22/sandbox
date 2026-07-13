import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateHeavyGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';

// Carbon Dioxide (이산화탄소) — the world's first *heavy* gas and its first
// "smother it" fire extinguisher. Unlike Smoke/Steam/Oxygen (which all rise), CO₂
// is denser than air, so it slumps to the floor and pools in low ground, sliding
// under the lighter gases and settling on top of any liquid (see updateHeavyGas /
// its density below). Flood a burning room's floor with it and the fire drowns.
//
// Its signature is suffocation: an adjacent Fire cell is displaced/snuffed
// outright (the flame has no oxygen), so a blanket of CO₂ puts out flames it
// rolls over — the gaseous counterpart to Soda's dry-chem smother. It's otherwise
// inert and slowly thins back into air so a room doesn't stay gassed forever.
//
// It's also what Dry Ice now sublimates into (see dryice.ts) instead of vanishing
// to nothing — a block of dry ice fumes a cold, creeping CO₂ fog that pools and
// snuffs fire, exactly like the real thing.
const SNUFF_CHANCE = 0.7; // adjacent flame is smothered fast
const DISSIPATE_CHANCE = 0.002; // slowly thins back into air (no permanent fog)

function updateCO2(x: number, y: number, sim: SimContext): void {
  // Suffocate adjacent flame: Fire needs oxygen, and a CO₂ blanket has none.
  // Writing the neighbor to EMPTY is a safe write (EMPTY never re-processes).
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === FIRE.id && sim.chance(SNUFF_CHANCE)) {
      sim.set(nx, ny, EMPTY);
    }
  }

  // Inert and long-lived, but not eternal — a very low per-tick chance to thin
  // back into air keeps a gassed room from staying gassed forever.
  if (sim.chance(DISSIPATE_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }

  updateHeavyGas(x, y, sim);
}

export const CO2 = register({
  id: 87,
  name: 'CO2',
  phase: Phase.Gas,
  color: rgb(150, 160, 172),
  // Heavier than the ordinary gases (all density 1) so it sinks below them and
  // pools on the floor, but lighter than every liquid (Water 3) so it settles on
  // a puddle's surface instead of diving through. See updateHeavyGas.
  density: 2,
  category: '기체',
  // A gas, so it conducts heat poorly; it mostly carries cold (from sublimating
  // Dry Ice) by physically flowing rather than by conduction.
  thermal: { conductivity: 0.06 },
  update: updateCO2,
});
