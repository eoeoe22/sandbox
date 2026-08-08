import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Aerogel (단열재) — "frozen smoke": an ultralight solid that is a near-perfect
// thermal insulator. Its whole point is `thermal.conductivity: 0`, so heat can't
// pass through it at all (heat exchange across any interface is gated by the
// lower of the two cells' conductivities — see config.ts), making it the ideal
// wall for building an insulated chamber: lava on one side, ice on the other,
// and neither feels the other through an aerogel partition.
//
// It is a plain, static Solid with no update — piles rest on it, fluids are
// blocked by it. Deliberately NOT indestructible/explosion-proof: unlike Diamond
// it blocks *heat* but not *force*, so a blast breaks it like any ordinary solid.
// (It also never reacts to temperature itself, so it won't melt — but it can be
// blown apart, cut by Thermite, or dissolved by Acid.)
export const AEROGEL = register({
  id: 98,
  name: 'Aerogel',
  phase: Phase.Solid,
  color: rgb(214, 224, 232),
  density: 1000,
  category: 'solid',
  // Pitted with pores on the board, the way the palette chip has always drawn it:
  // the material that is 99% air used to render as a flat pale slab, which is the
  // one thing it should never look like. The chip's holes are on a fixed grid; a
  // wall's sit on a checkerboard lattice with a cell of jitter in size and position,
  // so it reads as a fine even foam — and pores never merge, which is what would
  // turn it into styrofoam (see render/poreField.ts).
  //
  // `lattice` is the void tone — the exact grey the chip pits with (#9aabb8), so
  // the chip and the canvas are one picture at two scales. It is only a second
  // colour supply here: `poresPattern` is matched before the weave in the
  // renderer's branch chain, so this never draws a Mesh-style checkerboard.
  poresPattern: true,
  lattice: rgb(0x9a, 0xab, 0xb8),
  // The defining property: a perfect insulator. min(conductivity) gating means a
  // 0 here blocks all conduction through the material, whatever it's touching.
  thermal: { conductivity: 0 },
});
