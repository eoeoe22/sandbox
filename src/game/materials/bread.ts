import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryFlameOnlyBurn } from './combustion';

// Bread (빵) — what Batter becomes in an oven (batter.ts), and the end of the
// 밀가루 → 반죽 → 빵 line. A rigid Solid like Wood: it just sits there, holds a
// shape, and can be built with.
//
// The one thing it does that no other solid here does is have an *inside*. A
// baked loaf is two colours: the face that met the air while it baked is a dark
// browned crust, and everything the crust closed around is pale ivory crumb. The
// split is decided once, at the moment each cell bakes (see `bakeCrustAux` in
// batter.ts) — a cell that had any non-dough neighbour when its turn came is
// crust, a cell walled in by dough on all eight sides is crumb. Because a loaf
// bakes from the outside in, that falls out exactly right on its own: the shell
// browns first and the middle, still surrounded by batter, is left pale.
//
// It is stored in `aux` and drawn through `CRUST_RAMP` (Material.auxPalette), and
// the encoding is chosen so that **0 = crust**: a fresh `spawn` and the brush
// both leave aux at 0, so a loaf placed by hand out of the palette is a solid
// browned block, which is what a hand-placed loaf should look like. Crumb is
// something you *bake*, and that is the honest incentive — you only get the
// ivory inside by actually baking a body of dough big enough to have one.
//
// Deliberately NOT re-derived per tick. Slicing a baked loaf in half with the
// eraser leaves the cut face pale, because that face never met an oven — a crust
// is where the loaf browned, not merely where it currently ends.
//
// Overbake it and it burns like any other dry solid fuel — a slow front, and a
// generous ash yield, since a burnt loaf is mostly char (see combustion.ts).

/** aux bit 0 = crust(0) / crumb(1); aux bit 1 = alight. See the note above for
 *  why crust is the zero value, and `updateBread` for the lit bit.
 *
 *  The ramp below has exactly two entries and `auxPalette` indexes with
 *  `aux % length`, so `aux % 2` reads bit 0 alone and the lit bit never shifts
 *  the colour — the same trick Batter's 8-entry proof ramp uses to keep its two
 *  flags out of its own colour. */
export const CRUST_AUX = 0;
export const CRUMB_AUX = 1;
const LIT_BIT = 0b10;

/**
 * The temperature an already-lit loaf must stay at or above to still count as
 * alight — the `flameOnly` floor, not a 발화점. Nothing here ever reaches it by
 * being heated; see `tryFlameOnlyBurn` in combustion.ts for what the number is
 * actually doing and why the codex hides the 발화점 stat for these materials.
 *
 * Kept well under FUEL_BURN_TEMP (800°) so a burning cell is comfortably above
 * it, and well over anything a doused loaf sits at.
 */
const ALIGHT_FLOOR = 300;

/** The two faces of a loaf, indexed by `aux` (Material.auxPalette). The crust is
 *  a deep bake brown, the crumb the pale ivory of an open slice — far enough
 *  apart that a cut-open loaf reads as bread at a glance, at any zoom. */
const CRUST_RAMP = [rgb(166, 106, 50), rgb(238, 223, 189)] as const;

function updateBread(x: number, y: number, sim: SimContext): void {
  // Radiant heat alone never lights it, however fierce the oven — only a flame
  // actually touching the loaf, or a neighbouring loaf already burning, does.
  // That rule is the whole reason an oven works at all, and it is shared with
  // the rest of the food line (`tryFlameOnlyBurn`, combustion.ts). A Solid, so
  // there is nothing to move afterwards either way.
  tryFlameOnlyBurn(x, y, sim, LIT_BIT);
}

export const BREAD = register({
  id: 153,
  name: 'Bread',
  phase: Phase.Solid,
  // The palette chip's colour, and the one every un-baked (aux 0) cell draws:
  // crust. Kept a shade lighter than CRUST_RAMP[0] so the 18×18 chip doesn't
  // read as burnt at icon size.
  color: rgb(178, 118, 58),
  // A loaf is never one flat tone — the crust blisters and the crumb is full of
  // holes. 14 matches the organic solids (Wood 16, Plant 16) closely enough to
  // sit beside them without turning a big block into static.
  colorVary: 14,
  // Crust vs crumb, stamped once when the cell baked (see batter.ts).
  auxPalette: CRUST_RAMP,
  // The palette icon draws this as a browned crust band over pale crumb
  // rather than the generic bottom-to-top progress ramp other auxPalette
  // materials get (Material.crustPattern, render/materialSvg.ts) — crust vs
  // crumb is an inside/outside split, not a timeline.
  crustPattern: true,
  density: 1000,
  // Dry starch: it catches slowly, like Wood, and burns down to a lot of ash —
  // a burnt loaf really is mostly char. `flameOnly` is the important one: see
  // ALIGHT_FLOOR above and `Combustible.flameOnly` for why `autoIgniteTemp` is
  // not an ignition point here.
  combustion: {
    burnChance: 0.05,
    autoIgniteTemp: ALIGHT_FLOOR,
    ashChance: 0.45,
    flameOnly: true,
  },
  category: 'food',
  // Also on the 고체 shelf: it is a building block like Wood or Stone, and
  // someone stacking things up looks there.
  alsoIn: ['solid'],
  thermal: { conductivity: 0.2 },
  update: updateBread,
});
