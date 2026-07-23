import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { updatePowder } from '../engine/behaviors';
import { MOLTEN_METAL, IRON_MELT_TEMP } from './moltenmetal';
import { SALTWATER } from './saltwater';
import { RUST_POWDER } from './rustpowder';
import { DIR8 } from '../engine/directions';

// Metal Powder — when saltwater touches metal powder (including when saltwater
// soaks deep into a powder heap), it ignores solid Iron's depth-2 surface restriction
// and oxidizes into Rust Powder at any contact depth.
const RUST_CHANCE = 0.03;

function isSaltwater(x: number, y: number, sim: SimContext): boolean {
  if (!sim.inBounds(x, y)) return false;
  return sim.get(x, y) === SALTWATER.id || sim.getOverlay(x, y) === SALTWATER.id;
}

function touchesSaltwater(x: number, y: number, sim: SimContext): boolean {
  if (sim.getOverlay(x, y) === SALTWATER.id) return true;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isSaltwater(nx, ny, sim)) return true;
    if (sim.get(nx, ny) === RUST_POWDER.id) {
      if (sim.getOverlay(nx, ny) === SALTWATER.id) return true;
      for (const [ddx, ddy] of DIR8) {
        const nnx = nx + ddx;
        const nny = ny + ddy;
        if (isSaltwater(nnx, nny, sim)) return true;
      }
    }
  }
  return false;
}

function updateMetalPowder(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= IRON_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten Metal
    // reads as molten instead of instantly re-freezing next tick (mirrors Iron).
    sim.set(x, y, MOLTEN_METAL.id);
    return;
  }
  if (touchesSaltwater(x, y, sim) && sim.chance(RUST_CHANCE)) {
    sim.set(x, y, RUST_POWDER.id);
    return;
  }
  updatePowder(x, y, sim);
}

export const METAL_POWDER = register({
  id: 105,
  name: 'Metal Powder',
  phase: Phase.Powder,
  // A grainier, slightly lighter steel-grey than solid Iron's rgb(135,140,150),
  // so a loose pile reads as dusty metal shavings rather than a solid bar.
  color: rgb(158, 162, 172),
  density: 7,
  category: '가루',
  // Rounded, tumbling grains slide more freely than angular coal dust, so a metal
  // heap spreads to a shallower angle of repose (마찰 lower than Coal Powder).
  friction: 0.32,
  // Loose grains bridge heat far worse than a solid Iron bar (0.85), but metal
  // still carries warmth better than mineral dust.
  thermal: { conductivity: 0.35 },
  update: updateMetalPowder,
});
