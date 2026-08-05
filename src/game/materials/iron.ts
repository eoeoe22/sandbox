import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_IRON, IRON_MELT_TEMP } from './molteniron';
import { SALTWATER } from './saltwater';
import { RUST } from './rust';
import { RUST_POWDER } from './rustpowder';
import { tryPhaseChange } from './phasechange';

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
//    flows away as Molten Iron — which then re-freezes to Iron when it cools.
//  • Electricity: it's `conductive`, so a Spark travels along it (see spark.ts).
//    When a spark passes through and reverts, it stamps this cell's `aux` byte
//    with a short refractory countdown; Iron's only per-tick job as a static
//    solid is to tick that countdown back down so the cell can carry current
//    again — that one-way "recently energized" memory is what makes a pulse run
//    down a wire instead of sloshing back and forth (see spark.ts's comment).
//
// Acid dissolves Iron outright via Acid's own corrosion pass (Iron isn't tagged
// acidResistant), so a wet-but-safe metal is still vulnerable to acid — and it
// dissolves *fizzing*, see ACID_HYDROGEN_CHANCE below.

// Per-tick, per-acid-contact chance a face of the bar dissolves into a hydrogen
// bubble (`Material.acidHydrogen` — the reactivity-series tag; see corrosion.ts).
// Fe + 2HCl → FeCl₂ + H₂ is the fizz every school lab does with an iron nail,
// and iron sits below aluminum in the series, so this is deliberately under cast
// Aluminum's 0.04: pour acid on both and the aluminum bubbles harder. Its own
// filings go three times faster (ironpowder.ts, 0.09) for the surface-area
// reason the aluminum pair already encodes — dust presents all of itself where a
// bar presents one face.
const ACID_HYDROGEN_CHANCE = 0.03;

function updateIron(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again.
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (tryPhaseChange(x, y, sim)) return;

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
  // 배선재: a metal, so a generator gated to "wiring only" (the Turbine — see
  // spark.ts's PulseGate) will feed it. Zero-loss, as all wiring is.
  wiring: true,
  category: 'solid',
  alsoIn: ['metal'],
  // A polished metal surface: a Heat Ray beam reflects cleanly off it (정반사) —
  // see heatray.ts.
  laserReflective: true,
  // The best heat conductor in the game: an Iron bar shuttles heat end-to-end,
  // so it both melts readily against a hot source and makes a fine cold bridge.
  thermal: { conductivity: 0.85 },
  // 이온화 경향이 수소보다 크다 — acid doesn't just erase an iron bar, it fizzes
  // hydrogen off the wetted face (see the constant above and corrosion.ts).
  acidHydrogen: { chance: ACID_HYDROGEN_CHANCE },
  // 녹는점
  phaseChange: { at: () => IRON_MELT_TEMP, when: 'atOrAbove', into: () => MOLTEN_IRON.id },
  update: updateIron,
});

