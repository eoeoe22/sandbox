import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { ALUMINUM } from './aluminum';

// Molten Aluminum — the liquid half of the aluminum pair, mirroring
// Molten Metal↔Iron and Molten Glass↔Glass, but at a *far* lower temperature
// than either. That temperature is the whole point of the material.
//
// Real aluminum melts at 660°, less than half of iron's 1200°, and that single
// number gives the metal a niche nothing else in the palette occupies: it is
// the one structural metal an ordinary fire can cast. A bare Fire runs ~1000°
// and a coal bed pins itself at 1300° (see coal.ts), so a heap of Aluminum
// Powder set over any fire at all slumps into a pool you can pour and freeze
// into solid Aluminum — no ore, no reduction step, no Diamond/Heatpipe hearth.
// Iron demands the full 철광석 제련 line for the same result; aluminum trades
// that away and instead gives up its heat resistance (a cast aluminum wall
// melts right back into a puddle in the fire that made it).
//
// It also deliberately does NOT glow like Molten Metal or Lava. Real aluminum
// melts well below visible incandescence: a crucible of it looks like a bright
// silver mirror, not a blazing orange one — the classic "it looks cold but it
// is 700°" hazard. The `glow` ramp below therefore runs between two *silvers*
// (warm-bright when fully molten, dull grey as it sets), so the cooling front
// is still visible, but the pool never reads as fire. That is the visual tell
// that separates it from the iron pool at a glance.
export const ALUMINUM_MELT_TEMP = 660;
// Temperature a freshly placed/poured cell starts at — comfortably molten, well
// clear of the set point below so a poured puddle stays liquid long enough to
// run into a mold before it skins over.
const MOLTEN_ALUMINUM_TEMP = 800;
// Placed 100° under the melt point, the same hysteresis gap Glass↔Molten Glass
// uses (1150/1050), so a cell hovering right at 660° can't flicker between the
// two states every tick. Like Lava and Molten Metal, nothing cold touching it
// means it never cools at all (air conducts no heat), so an isolated pool stays
// liquid forever and it takes water, or the metal/stone it was poured onto, to
// bleed the heat away and actually set it.
const MOLTEN_ALUMINUM_FREEZE_TEMP = 560;

function updateMoltenAluminum(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) <= MOLTEN_ALUMINUM_FREEZE_TEMP) {
    // Cooled enough to set. In-place `set` keeps the (now low) temperature so
    // the fresh Aluminum reads as cold and keeps drawing heat out of any melt
    // still under it, exactly as Molten Metal → Iron does.
    sim.set(x, y, ALUMINUM.id);
    return;
  }
  // No flammable-ignition pass of its own (unlike Molten Metal's, which runs at
  // 1550°): at 660–800° this pool is barely above wood's own ignition point, so
  // whether it lights what it touches is left to ordinary conduction rather
  // than a scripted roll. It sets fire to a wooden floor it is poured on; it
  // does not flash-ignite a room the way a crucible of iron does.

  // …and then it flows, like the liquid it is. Molten Metal and Lava gate this
  // behind a FLOW_CHANCE roll because they are thick, sluggish melts; molten
  // aluminum is a thin one (real aluminum pours about as freely as water), so
  // it runs every tick and its `viscosity` field alone supplies the small drag
  // that keeps a pour reading as metal rather than a splash.
  updateLiquid(x, y, sim);
}

export const MOLTEN_ALUMINUM = register({
  // 134 is deliberately skipped — it's claimed by a material being added on a
  // parallel branch, so leaving the gap keeps the two from colliding when both
  // land (npm run check:material-ids enforces uniqueness at build time).
  id: 135,
  name: 'Molten Aluminum',
  phase: Phase.Liquid,
  // The fully-molten end of the glow ramp: warm, bright silver — a mirror-like
  // liquid metal, not a glowing one (see the header note).
  color: rgb(232, 224, 208),
  // Real molten aluminum (~2.4 g/cm³) is the lightest of the game's *metal and
  // mineral* melts and, like real aluminum, is lighter as a liquid than as a
  // solid — so its own powder (4.6) sinks through it. Placed just under Lava
  // (4.5) and Molten Glass (5), and well under Slag (5.75) / Molten Iron Ore
  // (6.5) / Molten Metal (8), so a pour floats clear on top of every smelting
  // liquid and on lava. It is not the lightest melt outright: Molten Salt (4)
  // is lighter still, so aluminum sinks through a salt bath — and through
  // Water (3), so it sinks in a quench instead of skating on it.
  density: 4.4,
  category: 'fire',
  // Runs nearly as freely as water (real molten aluminum is a thin, fluid melt,
  // not a sluggish one like lava or slag) — just enough drag to read as a metal
  // pour rather than a splash, so it still fills a mold cleanly.
  viscosity: 0.2,
  // Same conductivity as the iron pool: a metal melt shuttles heat readily,
  // which is what lets a mold or a quench actually set it.
  thermal: { init: MOLTEN_ALUMINUM_TEMP, conductivity: 0.85 },
  // Silver→dull grey rather than white→orange: it dims toward lead-grey as it
  // approaches the set point, so the cooling front is legible without the pool
  // ever pretending to be fire.
  glow: {
    min: MOLTEN_ALUMINUM_FREEZE_TEMP,
    max: MOLTEN_ALUMINUM_TEMP,
    cool: rgb(168, 168, 172),
  },
  update: updateMoltenAluminum,
});
