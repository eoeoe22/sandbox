import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { SOAPY_WATER } from './soapywater';

// Bubble (거품) — an air bubble, produced ONLY inside Soapy Water (soapywater.ts).
// It rises buoyantly through the liquid and POPS back into soapy water the instant
// it reaches the surface (open air against gravity), so a soapy pool visibly
// churns and fizzes while never losing mass — the bubble is just displaced soapy
// water in gaseous form. It's kept out of the palette (like Ember/Spark/Debris):
// a hand-placed bubble in open air just pops back to soapy water on its first turn.
const POP_CHANCE = 0.02; // random mid-body pop, so a bubble trapped under a lid still clears

function updateBubble(x: number, y: number, sim: SimContext): void {
  // Reached the surface (open air directly against gravity) → pop back to soapy
  // water. The small random pop is a safety valve so a bubble sealed under a solid
  // lid can't live forever.
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  const surfaced = !sim.inBounds(ux, uy) || sim.get(ux, uy) === EMPTY;
  if (surfaced || sim.chance(POP_CHANCE)) {
    sim.set(x, y, SOAPY_WATER.id);
    return;
  }
  // Otherwise rise through the surrounding liquid — a bubble is far lighter than
  // soapy water (see the density below), so tryMove floats it up on buoyancy.
  updateGas(x, y, sim);
}

export const BUBBLE = register({
  id: 103,
  name: 'Bubble',
  phase: Phase.Gas,
  // Nearly white with a faint blue cast — a soap-film bubble.
  color: rgb(226, 240, 248),
  // Lighter than soapy water (3) so it rises through it; lighter than the ordinary
  // gases (≈1) too, so it always floats to the top.
  density: 0.5,
  thermal: { conductivity: 0.05 },
  category: '특수',
  update: updateBubble,
});
