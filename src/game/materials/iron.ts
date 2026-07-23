import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_METAL, IRON_MELT_TEMP } from './moltenmetal';
import { SALTWATER } from './saltwater';
import { RUST } from './rust';
import { RUST_POWDER } from './rustpowder';
import { DIR8 } from '../engine/directions';

const RUST_CHANCE = 0.03;

function isSaltwater(x: number, y: number, sim: SimContext): boolean {
  if (!sim.inBounds(x, y)) return false;
  return sim.get(x, y) === SALTWATER.id || sim.getOverlay(x, y) === SALTWATER.id;
}

function isRustOrIron(id: number): boolean {
  return id === IRON.id || id === RUST.id || id === RUST_POWDER.id;
}

function isWetRustOrSaltwater(x: number, y: number, sim: SimContext): boolean {
  if (!sim.inBounds(x, y)) return false;
  if (isSaltwater(x, y, sim)) return true;
  const id = sim.get(x, y);
  if (id === RUST.id || id === RUST_POWDER.id) {
    if (sim.getOverlay(x, y) === SALTWATER.id) return true;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (isSaltwater(nx, ny, sim)) return true;
    }
  }
  return false;
}

function touchingSaltwaterWithinDepth2(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (isWetRustOrSaltwater(nx, ny, sim)) {
      return true;
    }
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && isRustOrIron(sim.get(nx, ny))) {
      for (const [ddx, ddy] of DIR8) {
        const nnx = nx + ddx;
        const nny = ny + ddy;
        if (isWetRustOrSaltwater(nnx, nny, sim)) {
          return true;
        }
      }
    }
  }
  return false;
}

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

  // Saltwater oxidation (surface depth 2 max): 20% Rust Powder, 80% Rust
  if (touchingSaltwaterWithinDepth2(x, y, sim) && sim.chance(RUST_CHANCE)) {
    if (sim.chance(0.2)) {
      sim.set(x, y, RUST_POWDER.id);
    } else {
      sim.set(x, y, RUST.id);
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
