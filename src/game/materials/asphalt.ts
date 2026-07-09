import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// The residue left behind once crude oil has been cracked past its boiling range
// (see oil.ts's distillation) — the black tar at the bottom of the still. A
// static Solid: it forms where the hottest crude cracks (against a heated floor)
// and stays put as a growing crust. Because distillation here works by crude
// boiling *in place* into vapour that bubbles up through the liquid above (no
// open vent needed), a solid crust at the bottom doesn't choke it off — heat
// still conducts up through the tar to distil the crude resting on top, which in
// turn cracks and thickens the crust upward until the whole charge is spent.
// Conducts and burns like the other heavy residues would: left inert here (not
// flammable) so a finished still just holds its tar.
export const ASPHALT = register({
  id: 62,
  name: 'Asphalt',
  phase: Phase.Solid,
  color: rgb(26, 22, 24),
  density: 1000,
  category: '석유',
  thermal: { conductivity: 0.2 },
});
