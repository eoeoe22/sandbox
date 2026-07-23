import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_METAL, IRON_MELT_TEMP } from './moltenmetal';
import { SALTWATER } from './saltwater';
import { RUST } from './rust';
import { RUST_POWDER } from './rustpowder';

const SURFACE_RUST_CHANCE = 0.001;  // 표면 (깊이 1칸) 부식 확률 (0.1%)
const INSIDE_RUST_CHANCE = 0.0002; // 안쪽 (깊이 2칸) 부식 확률 (0.02%)

function getSaltWaterDepth(x: number, y: number, sim: SimContext): number {
  let depth = 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny)) {
        if (sim.get(nx, ny) === SALTWATER.id) {
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
            return 1; // Direct surface contact
          }
          depth = 2;
        } else if (sim.getOverlay(nx, ny) === SALTWATER.id) {
          depth = 2;
        }
      }
    }
  }
  return depth;
}

// Solid metal — the workhorse of two subsystems at once:
//
//  • Heat: it conducts heat better than any other material (conductivity 0.85),
//    so a bar of Iron carries a flame's warmth to its far end and, heated past
//    its melting point (by Lava, Blue Flame, or Thermite), turns molten and
//    flows away as Molten Metal — which then re-freezes to Iron when it cools.
//  • Electricity: it's `conductive`, so a Spark travels along it (see spark.ts).
//    When a spark passes through and reverts, it stamps this cell's `aux` byte
//    with a short refractory countdown; Iron's only per-tick job as a static
//    solid is to tick that countdown back down so the cell can carry current
//    again — that one-way "recently energized" memory is what makes a pulse run
//    down a wire instead of sloshing back and forth (see spark.ts's comment).
//
// Acid dissolves Iron outright via Acid's own corrosion pass (Iron isn't tagged
// acidResistant), so a wet-but-safe metal is still vulnerable to acid.
function updateIron(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again.
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (sim.getTemp(x, y) >= IRON_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature, so the fresh Molten Metal
    // reads as molten instead of instantly re-freezing next tick.
    sim.set(x, y, MOLTEN_METAL.id);
    return;
  }

  // Salt water corrosion: surface (depth 1) 0.1%, inside (depth 2) 0.02%.
  // 20% Rust Powder, 80% Rust. Exothermic reaction heat (+100°C fixed).
  const depth = getSaltWaterDepth(x, y, sim);
  if (depth > 0) {
    const chance = depth === 1 ? SURFACE_RUST_CHANCE : INSIDE_RUST_CHANCE;
    if (sim.chance(chance)) {
      sim.setTemp(x, y, sim.getTemp(x, y) + 100);
      if (sim.chance(0.2)) {
        sim.set(x, y, RUST_POWDER.id);
      } else {
        sim.set(x, y, RUST.id);
      }
    }
  }
}

export const IRON = register({
  id: 28,
  name: 'Iron',
  phase: Phase.Solid,
  color: rgb(135, 140, 150),
  density: 1000,
  conductive: true,
  category: '고체',
  // The best heat conductor in the game: an Iron bar shuttles heat end-to-end,
  // so it both melts readily against a hot source and makes a fine cold bridge.
  thermal: { conductivity: 0.85 },
  update: updateIron,
});

