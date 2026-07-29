import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Catalyst (촉매) — the polymerization catalyst bed, the piece of plant
// equipment the whole plastics line is built around. A static, inert Solid: it
// has no `update` of its own and never changes, reacts or wears out. Everything
// it "does" is read off it by something else, exactly the way Limestone works
// in the smelting line — an Ethylene cell touching a catalyst face polymerizes
// into Polyethylene (see ethylene.ts). Nothing here needs to know that.
//
// Deliberately not consumed. A real Ziegler–Natta catalyst is spent eventually,
// but a bed that had to be re-laid would turn "run a plastics plant" into
// re-painting the same cells forever; leaving it permanent is what lets a
// player build a reactor once and then work on the interesting problem, which
// is keeping it in its temperature window (40~200°) while a 850° cracker runs
// next door.
//
// It conducts heat moderately well (0.5, between Stone and Iron) on purpose:
// the bed is usually the reactor's floor, so it's the path by which a water
// jacket underneath actually pulls the polymerization exotherm back out.
export const CATALYST = register({
  id: 139,
  name: 'Catalyst',
  phase: Phase.Solid,
  color: rgb(120, 96, 142),
  density: 5,
  category: 'polymer',
  thermal: { conductivity: 0.5 },
});
