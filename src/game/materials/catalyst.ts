import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Catalyst (촉매) — the catalyst bed, the piece of plant equipment the whole
// plastics line is built around. A static, inert Solid: it has no `update` of
// its own and never changes, reacts or wears out. Everything it "does" is read
// off it by something else, exactly the way Limestone works in the smelting
// line, and it drives BOTH steps of the line:
//
//   • Petroleum Vapor touching a catalyst face cracks to Ethylene, at any
//     temperature (see petroleumvapor.ts).
//   • Ethylene touching a catalyst face, and inside 40~200°, polymerizes to
//     Polyethylene (see ethylene.ts).
//
// Nothing here needs to know either of those. One bed doing both is the point:
// the line is not "a furnace over here and a reactor over there" but a single
// bed whose output depends on how well you are cooling it.
//
// Deliberately not consumed. A real cracking or Ziegler–Natta catalyst is spent
// eventually, but a bed that had to be re-laid would turn "run a plastics plant"
// into re-painting the same cells forever; leaving it permanent is what lets a
// player build a reactor once and then work on the interesting problem, which is
// holding it inside the polymerization window while the reaction's own exotherm
// pushes it out.
//
// It conducts heat moderately well (0.5, between Stone and Iron) on purpose:
// the bed is usually the reactor's floor, so it's the path by which a water
// jacket underneath actually pulls the polymerization exotherm back out.
export const CATALYST = register({
  id: 140,
  name: 'Catalyst',
  phase: Phase.Solid,
  color: rgb(120, 96, 142),
  density: 5,
  category: 'polymer',
  thermal: { conductivity: 0.5 },
});
