import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { LIQUID_GALLIUM, GALLIUM_MELT_TEMP } from './liquidgallium';
import { tryPhaseChange } from './phasechange';

// Gallium — a solid silvery-blue metal with one famous quirk: it melts with the
// faintest warmth. Its melt point sits barely above room temperature
// (GALLIUM_MELT_TEMP = 30°, ambient is 20°), so a coal ember, a warm neighbour,
// even a passing flame's radiant heat is enough to slump a Gallium bar into a
// shiny puddle of Liquid Gallium — the classic "metal that melts in your hand".
// It's `conductive` like Iron and Mercury, so a Spark runs along a Gallium
// wire; its only per-tick job as a static solid is to tick down the post-spark
// refractory stamped in its `aux` (mirrors Iron) and to check whether it's warm
// enough to melt.

// Per-tick, per-acid-contact chance a face dissolves into a hydrogen bubble
// (`Material.acidHydrogen`, driven by corrosion.ts). Gallium is above hydrogen in the
// reactivity series — it is amphoteric, dissolving in acids *and* alkalis — but
// it is also the sluggish end of the roster: a tough oxide film and a low place
// in the series make it the slowest fizz here, well under solid Iron's 0.03.
//
// Only the *solid* carries the tag. That isn't a judgement about liquid gallium's
// chemistry, it's the engine's rule: acid's corrosion pass eats solids and
// powders only (corrosion.ts's `isCorrodible`), so no liquid in the game dissolves
// in acid, and
// a gallium puddle is no exception. Warm a bar past 30° and it stops fizzing
// because it stopped being a solid — which, for the metal whose whole identity is
// "temperature is the switch", is a quirk rather than a hole.
const ACID_HYDROGEN_CHANCE = 0.015;

function updateGallium(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again.
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (tryPhaseChange(x, y, sim)) return;
}

export const GALLIUM = register({
  id: 116,
  name: 'Gallium',
  phase: Phase.Solid,
  color: rgb(178, 188, 202),
  density: 1000,
  conductive: true,
  // 배선재: a metal, so a generator gated to "wiring only" (the Turbine — see
  // spark.ts's PulseGate) will feed it. Zero-loss, as all wiring is.
  wiring: true,
  category: 'solid',
  // A bright silvery metal surface: a Heat Ray beam reflects cleanly off it
  // (정반사) — see heatray.ts.
  laserReflective: true,
  // A metal, so it carries heat readily — which, with its very low melt point,
  // is exactly why the smallest warm touch spreads through a bar and melts it.
  thermal: { conductivity: 0.7 },
  // The slowest fizz on the roster (see the constant above and corrosion.ts).
  acidHydrogen: { chance: ACID_HYDROGEN_CHANCE },
  // 녹는점
  phaseChange: { at: () => GALLIUM_MELT_TEMP, when: 'atOrAbove', into: () => LIQUID_GALLIUM.id },
  update: updateGallium,
});
