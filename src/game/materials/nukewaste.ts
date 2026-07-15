import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { POWDER_VARY } from '../tint';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';

// Nuke Waste (핵폐기물) — the cold, spent end-state of the U238 fuel cycle (see
// u238.ts / moltenu238.ts). A meltdown of U238 never explodes; it melts down,
// stops reacting, and once the molten pool cools it settles into this dull green
// powder. Unlike fresh fuel it has no chain reaction left — it can't melt down
// again — but the decay heat of its fission products lingers, so it stays a
// *weak* heat source: each tick it tops its own temperature back up toward a mild
// WARM_TEMP, and heat conduction bleeds that warmth into whatever it's piled
// against. Far too cool to ignite anything on its own — it just keeps its
// surroundings gently, persistently warm, the "잔열" of a waste cask.
//
// Being inert spent fuel it's also 방폭 (explosion-immune) like the rest of the
// uranium family: a Blast stops at it, an Ember shatters on it, Antimatter skips
// it. Otherwise it's an ordinary powder that falls and piles — something to
// bury, store, or dump.
const WARM_TEMP = 160; // decay-heat set point the waste keeps topping itself to
const WARM_RATE = 4; // per-tick nudge back toward WARM_TEMP (a slow, weak source)

function updateNukeWaste(x: number, y: number, sim: SimContext): void {
  // Weak decay heat: creep the cell's own temperature back up toward WARM_TEMP
  // (never past it), so conduction keeps radiating a mild warmth into neighbors
  // without the waste ever getting hot enough to burn anything. Left alone in a
  // hotter environment it doesn't cool anything — it only ever adds a little.
  const t = sim.getTemp(x, y);
  if (t < WARM_TEMP) sim.setTemp(x, y, Math.min(t + WARM_RATE, WARM_TEMP));
  updatePowder(x, y, sim);
}

export const NUKE_WASTE = register({
  id: 108,
  name: 'Nuke Waste',
  phase: Phase.Powder,
  color: rgb(120, 150, 80),
  colorVary: POWDER_VARY,
  density: 6,
  category: '방사성',
  explosionProof: true, // 방폭 — see uranium.ts
  thermal: { init: WARM_TEMP, conductivity: 0.3 },
  // Faintly glows a warmer sickly green as its decay heat builds, cooling to a
  // dull olive when something has drawn the warmth out of it.
  glow: { min: 20, max: WARM_TEMP, cool: rgb(70, 90, 50) },
  update: updateNukeWaste,
});
