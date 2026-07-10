import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';

// The residue left behind once crude oil has been cracked past its boiling range
// (see oil.ts's distillation) — the black tar at the bottom of the still.
//
// Cold, it's a static Solid: a growing crust that stays put. But when it's hot
// (freshly cracked at ~380°, or reheated) it *softens into a thick, viscous
// liquid* that slowly oozes and sinks — real asphalt flows when heated. It's the
// most sluggish liquid there is, creeping on only a small fraction of ticks, so
// a hot pool slumps and levels very slowly before it cools back below its
// softening point and firms up into solid crust again. Because distillation
// works by crude boiling *in place* into vapour that bubbles up, a tar layer
// forming at the bottom doesn't choke it off — heat still conducts up through
// the tar to distil the crude above until the whole charge is spent. Left inert
// (not flammable) so a finished still just holds its tar.
const SOFTEN_TEMP = 200; // above this the tar softens and oozes as a viscous liquid
const FLOW_CHANCE = 0.08; // extremely viscous — creeps only on a small fraction of ticks

function updateAsphalt(x: number, y: number, sim: SimContext): void {
  // Only hot asphalt flows; cold asphalt is a static crust (no movement).
  if (sim.getTemp(x, y) >= SOFTEN_TEMP && sim.chance(FLOW_CHANCE)) {
    updateLiquid(x, y, sim);
  }
}

export const ASPHALT = register({
  id: 62,
  name: 'Asphalt',
  // Solid so a cold crust reads as (and blocks like) a solid; its own update
  // makes it flow as a viscous liquid only while hot.
  phase: Phase.Solid,
  color: rgb(26, 22, 24),
  density: 1000,
  category: '석유',
  thermal: { conductivity: 0.2 },
  update: updateAsphalt,
});
