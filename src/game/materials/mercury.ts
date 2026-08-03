import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { MERCURY_VAPOR } from './mercuryvapor';
import { tryPhaseChange } from './phasechange';

// Real mercury boils at ~357°: heated past this, a puddle flashes to Mercury
// Vapor, which drifts up and condenses back to liquid Mercury when it cools
// (see mercuryvapor.ts) — the same boil↔condense loop Water/Steam and
// Acid/Acid Vapor run.
export const MERCURY_BOIL_TEMP = 357;

// Mercury — liquid metal: the densest fluid in the game (9), so it sinks beneath
// everything, even Molten Iron, and shoulders lighter liquids up and out of its
// way. Its party trick is that it's `conductive`: a Spark travels through a
// puddle of mercury exactly as it does through solid Iron, so you can bridge a
// circuit across a pool of it or let it flow into a gap to close a switch. As a
// moving conductor it does the same one job Iron does for the electricity
// system — tick down the post-spark refractory stamped in its `aux` — before
// flowing as a normal (rather heavy) liquid.
function updateMercury(x: number, y: number, sim: SimContext): void {
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (tryPhaseChange(x, y, sim)) return;

  updateLiquid(x, y, sim);
}

export const MERCURY = register({
  id: 40,
  name: 'Mercury',
  phase: Phase.Liquid,
  color: rgb(205, 208, 216),
  density: 9,
  conductive: true,
  // 배선재: a metal, so a generator gated to "wiring only" (the Turbine — see
  // spark.ts's PulseGate) will feed it. Zero-loss, as all wiring is.
  wiring: true,
  category: 'liquid',
  // Beads up hard (표면장력): scattered drops pull themselves into tight rounded
  // balls instead of wetting a surface — the signature "quicksilver beads".
  surfaceTension: 0.6,
  // A smooth mirror-like metal, so it renders as a flat single colour rather than
  // sampling the shimmering background tint field the other liquids use.
  colorVary: 0,
  // A quicksilver surface is a mirror — a Heat Ray beam reflects cleanly off it
  // (정반사), so a puddle aims the beam (see heatray.ts).
  laserReflective: true,
  thermal: { conductivity: 0.7 },
  // Freezes solid deep below zero (real mercury sets at ~-39°): a chilled puddle
  // hardens in place (still conducts electricity — solid metal) until it warms.
  freeze: { temp: -38 },
  // 끓는점
  phaseChange: { at: () => MERCURY_BOIL_TEMP, when: 'atOrAbove', into: () => MERCURY_VAPOR.id },
  update: updateMercury,
});
