import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { ZINC } from './zinc';

// Molten Zinc — the liquid half of the Zinc pair (Molten Metal↔Iron, Molten
// Aluminum↔Aluminum, and now this one), and the **lowest-melting metal pour in
// the game**: real zinc melts at 420°, well under aluminum's 660° and a third of
// iron's 1200°.
//
// That number is the material's whole reason to exist. Aluminum already made the
// point that "a metal an ordinary fire can cast" is a different toy from one that
// needs a smelting line; zinc takes it further down. A bare Fire runs ~1000° and
// even a *wood* fire clears this — so the metal you keep in an acid tank to make
// hydrogen is also the one you can re-melt and re-pour with nothing but a
// campfire, which is exactly why zinc is the die-casting metal in reality.
//
// Like Molten Aluminum it deliberately does NOT glow orange: 420° is nowhere near
// visible incandescence, so a crucible of it looks like a bright, *cool* silver
// mirror — the "it looks cold and it is 500°" hazard. The `glow` ramp runs between
// two silvers, and both are bluer than the aluminum pool's warm ones, so the two
// melts never read as the same liquid at a glance.
export const ZINC_MELT_TEMP = 420;
// Temperature a freshly placed/poured cell starts at — comfortably molten, the same
// 140° margin over its melt point that Molten Aluminum keeps (660/800), so a pour
// runs into a mold before it skins over.
const MOLTEN_ZINC_TEMP = 560;
// 100° under the melt point: the same hysteresis gap Glass↔Molten Glass (1150/1050)
// and Aluminum (660/560) use, so a cell hovering right at 420° can't flicker between
// the two states every tick. As with every melt here, nothing cold in contact means
// it never cools at all (air conducts no heat), so an isolated pool stays liquid
// forever and it takes water, or the metal/stone it was poured onto, to set it.
const MOLTEN_ZINC_FREEZE_TEMP = 320;

function updateMoltenZinc(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) <= MOLTEN_ZINC_FREEZE_TEMP) {
    // Cooled enough to set. In-place `set` keeps the (now low) temperature so the
    // fresh Zinc reads as cold and keeps drawing heat out of any melt still under
    // it, exactly as Molten Aluminum → Aluminum does.
    sim.set(x, y, ZINC.id);
    return;
  }
  // …and then it flows. Every liquid metal here has to call this explicitly; the
  // aluminum pour shipped once *without* it and froze in place in a neat column
  // instead of spreading (see test/acidhydrogen.ts, which pins the same behavior
  // for this pool for exactly that reason).
  updateLiquid(x, y, sim);
}

export const MOLTEN_ZINC = register({
  // 147, one past Zinc's 146 — the pair added together, at the end of the roster.
  // Retired ids (14, 15, 30, 35, 64, 72, 76, 142) are never recycled: save files
  // store material ids verbatim, so reusing a number silently renders old worlds
  // as a different material (see docs/SNAPSHOTS.md).
  id: 147,
  name: 'Molten Zinc',
  phase: Phase.Liquid,
  // The fully-molten end of the glow ramp: a cool, bright silver — bluer than the
  // aluminum pool's warm rgb(232, 224, 208), matching solid Zinc's own blue cast.
  color: rgb(214, 224, 232),
  // Real molten zinc is ~6.6 g/cm³ — the *heavy* end of the melts, since zinc
  // itself (7.14 solid) is nearly as dense as iron. Placed above Molten Iron Ore
  // (6.5) and below Molten Metal (8), so a zinc pour sinks through Lava (4.5),
  // Molten Aluminum (4.4), Molten Glass (5) and Slag (5.75) and collects under
  // them, while the iron pool still sinks under it. Its own solid form floats
  // nothing: a structural solid is never displaced.
  density: 6.7,
  category: 'fire',
  // Real molten zinc is a thin, freely-running melt (it is die-cast for exactly
  // that reason), so it pours like the aluminum pool rather than sluggish lava.
  viscosity: 0.2,
  // Same as the other metal melts: a liquid metal shuttles heat readily, which is
  // what lets a mold or a quench actually set it.
  thermal: { init: MOLTEN_ZINC_TEMP, conductivity: 0.85 },
  // Silver → dull blue-grey as it approaches the set point, so the cooling front is
  // legible without the pool ever pretending to be fire.
  glow: {
    min: MOLTEN_ZINC_FREEZE_TEMP,
    max: MOLTEN_ZINC_TEMP,
    cool: rgb(146, 156, 166),
  },
  update: updateMoltenZinc,
});
