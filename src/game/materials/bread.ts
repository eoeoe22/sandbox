import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, flameAdjacent, FUEL_BURN_TEMP } from './combustion';

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
 * alight. It is declared as this material's `combustion.autoIgniteTemp` because
 * that is the number `combustion.ts` compares against to decide "is this cell
 * burning?", but for a `flameOnly` fuel it is **not** a 발화점 — nothing here ever
 * reaches it by being heated, since `updateBread` refuses to light the cell at
 * all without flame contact. Its real job is the other end: `combustion.ts`
 * writes AMBIENT_TEMP into a cell water has smothered, so a cell that has fallen
 * under this floor is a cell whose fire is out. The codex hides the 발화점 stat
 * for exactly this reason and shows the 직화 전용 trait instead.
 *
 * Kept well under FUEL_BURN_TEMP (800°) so a burning cell is comfortably above
 * it, and well over anything a doused loaf sits at.
 */
const ALIGHT_FLOOR = 300;

/** The two faces of a loaf, indexed by `aux` (Material.auxPalette). The crust is
 *  a deep bake brown, the crumb the pale ivory of an open slice — far enough
 *  apart that a cut-open loaf reads as bread at a glance, at any zoom. */
const CRUST_RAMP = [rgb(166, 106, 50), rgb(238, 223, 189)] as const;

/** Per-tick chance a loaf in contact with flame (or with a loaf already alight)
 *  catches. Matches the `combustion.burnChance` the front then spreads at, so
 *  lighting a loaf feels the same whether it started at the flame or two cells
 *  in. */
const CATCH_CHANCE = 0.05;

/** True if a touching Bread cell is already alight — how the front crosses the
 *  inside of a loaf, where there is no air for a flame to stand in. Without it a
 *  burning loaf would only be eaten from the faces its wreathing flames could
 *  reach and the middle would never go. */
function litNeighbor(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) !== BREAD.id) continue;
    if ((sim.getAux(nx, ny) & LIT_BIT) !== 0) return true;
  }
  return false;
}

function updateBread(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  if ((aux & LIT_BIT) !== 0) {
    // Alight. `combustion.ts` reads "is this cell burning?" off its temperature,
    // and it also writes AMBIENT_TEMP into a cell that water just smothered — so
    // a cell that has fallen back under its own floor is a cell whose fire went
    // out, and the lit bit has to go with it or the loaf would re-light itself
    // out of the water every tick.
    if (sim.getTemp(x, y) < ALIGHT_FLOOR) {
      sim.setAux(x, y, aux & ~LIT_BIT);
      return;
    }
    tryBurn(x, y, sim);
    return;
  }
  // Not alight — and radiant heat alone never lights it, however fierce the
  // oven. Only a flame actually touching the loaf, or a neighbouring loaf that
  // is already burning, does. This is the whole reason an oven works at all:
  // see `combustion.flameOnly` in engine/types.ts.
  if (!flameAdjacent(x, y, sim) && !litNeighbor(x, y, sim)) return;
  if (!sim.chance(CATCH_CHANCE)) return;
  sim.setAux(x, y, aux | LIT_BIT);
  // Pin it into the burning band so `tryBurn` reads it as alight on its next
  // turn; from then on `burnStep` re-pins it itself each tick.
  if (sim.getTemp(x, y) < FUEL_BURN_TEMP) sim.setTemp(x, y, FUEL_BURN_TEMP);
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
