import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// The residue left behind once all the volatile cuts have boiled out of a crude
// oil cell (see oil.ts's distillation) — the black tar at the bottom of the
// still. Deliberately a *liquid*, not a solid: a solid crust forming at the
// pool surface would cap the crude beneath it and choke off the vapor vents, so
// distillation would stall after only the top layer converted. As a very dense
// liquid (heavier than everything, even water) it instead sinks straight to the
// bottom, letting fresh crude flow up to the surface to keep distilling — so the
// still grows a thick tar layer underneath while the light fractions vent off
// the top, exactly like a real fractionating column. Thick and non-flammable;
// inherits the default (slow-settling) liquid movement.
export const ASPHALT = register({
  id: 62,
  name: 'Asphalt',
  phase: Phase.Liquid,
  color: rgb(26, 22, 24),
  density: 5,
  category: '석유',
  thermal: { conductivity: 0.2 },
});
