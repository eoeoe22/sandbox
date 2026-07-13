import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Mesh (체) — a static grey screen with a woven lattice look (the renderer draws
// it as a two-tone checkerboard, see `lattice`). To powders and solids it's an
// ordinary solid — sand piles on it, things rest against it — but to liquids and
// gases it's a filter: only the light checkerboard cells let a fluid through,
// while the dark woven cells (the `lattice` colour) block it (see SimContext
// canOverlapAt), so a screen passes fluid at half its pore density rather than
// as if it weren't there. A fluid entering a light cell slips into its 겹침
// (overlap) slot and threads on through the screen under its own
// gravity/buoyancy — the light cells connect diagonally, so it zig-zags across a
// mesh of any thickness (see Grid.overlay / SimContext). Pour water onto a mesh
// floor and it drips out the underside; hold water against a mesh wall and it
// seeps across until the levels equalize; steam trapped underneath bubbles up
// past it. Handy as a filter — the sand stays, the water drains. Pure data: the
// overlap system reads `porous` (and `lattice` for the dark-cell split); the
// mesh itself has no update.
export const MESH = register({
  id: 83,
  name: 'Mesh',
  phase: Phase.Solid,
  color: rgb(132, 136, 142),
  // Second, darker grey woven through the base as a checkerboard so the screen
  // reads as a grid/lattice rather than a flat grey slab (see the renderer).
  lattice: rgb(92, 96, 102),
  density: 1000,
  category: '고체',
  // Fluids pass through it via the 겹침 overlap layer — see Material.porous.
  porous: true,
  thermal: { conductivity: 0.4 },
});
