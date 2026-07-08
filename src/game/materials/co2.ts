import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { BLUE_FLAME } from './blueflame';

// Carbon dioxide — the cold, heavy, inert vapor that Dry Ice sublimates into and
// Liquid Nitrogen boils off (a deliberate simplification: both give off one
// shared "cold fog" instead of two near-identical gases). It's a fire
// extinguisher you can pour: being heavier than air it *sinks* and pools along
// the floor (unlike every other gas here, which rises), flooding low ground and
// snuffing out any flame it flows over by crowding out the oxygen.
//
// It's modeled as a Gas (so denser liquids still displace it and it's light
// enough to be shoved around), but with an inverted, liquid-like movement rule:
// fall, then slide diagonally down, then spread sideways to find its level —
// exactly updateLiquid's shape, which is what makes it collect in pits.
const SMOTHER_CHANCE = 0.5; // per-tick chance to put out one adjacent flame
const DISSIPATE_CHANCE = 0.004; // slowly thins back to air so a room isn't CO2 forever
const STALL_CHANCE = 0.12; // occasional skipped move → a lazy, settling drift

function updateCO2(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if ((nid === FIRE.id || nid === BLUE_FLAME.id) && sim.chance(SMOTHER_CHANCE)) {
      // Crowd out the oxygen: the flame simply dies (no smoke — it was
      // smothered, not burnt out).
      sim.set(nx, ny, EMPTY);
    }
  }

  if (sim.chance(DISSIPATE_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }

  if (sim.chance(STALL_CHANCE)) return;
  if (sim.moveDown(x, y)) return;
  if (sim.moveDiagonalDown(x, y)) return;
  sim.moveSideways(x, y);
}

export const CO2 = register({
  id: 35,
  name: 'CO₂',
  phase: Phase.Gas,
  color: rgb(190, 200, 208),
  density: 1,
  category: '기체',
  // A gas: conducts poorly (carries its chill mostly by physically flowing).
  thermal: { conductivity: 0.08 },
  update: updateCO2,
});
