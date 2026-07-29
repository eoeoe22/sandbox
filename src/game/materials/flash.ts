import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';

// Flash — the blinding white light a Flash Powder charge fills its reach with
// (see flashpowder.ts), and the reason that charge reads as a *flash* rather
// than as one more orange explosion.
//
// The ordinary shockwave flash (BLAST, blast.ts) is deliberately fire-coloured:
// it starts near-white and fades down a glow ramp to a dull orange, which is
// right for a chemical explosion whose signature is heat. Flash powder's
// signature is the opposite — a burning-metal flash is so much hotter than a
// hydrocarbon fire that it goes past orange into white, which is exactly why
// photographers used it and why looking at one hurts. Reusing BLAST for it made
// the charge look like a small bomb; this cell is a flat, unramped white that
// holds its colour for its whole (short) life and then simply stops.
//
// It is an *effect* cell, built on the same three tags the firework flower uses
// (fireworkburst.ts), for the same reasons:
//
//   • `blastInert` — light, not matter. A blast front (a second flash charge in
//     the volley, or anything else) passes straight over it instead of shoving
//     it as Debris or re-flashing it.
//   • `conductivity: 0` + `decorTemp` — it carries a real, very hot reading so
//     the 돋보기 and the heat overlay show it as the burning thing it looks
//     like, but it heats nothing: the grid is safe on conductivity alone (heat
//     exchange is gated by the lower of two cells' conductivities), and
//     `decorTemp` is what stops the object layer — the one place that reads raw
//     cell temperature as heat on a body — from treating it as a fire.
//   • a motionless `update` — a gas that rose and diffused would smear the
//     flash upward into a plume. It fills the disc where the charge went off and
//     dies there.
//
// Deliberately NOT a detonation trigger. Every charge in the game watches for
// an adjacent Fire/Lava/BLAST cell, and the Woofer's history (see the write-up
// in materials/woofer.ts) is the cautionary tale: an effect cell that reads as a
// trigger lets a *non-destructive* pulse set off a stockpile. Flash Powder
// chains the ordinary way instead — through the real BLAST cells its own charge
// leaves, the rim embers, and the fire its flash scatters (flashpowder.ts).
//
// Never painted from the palette: like the shockwave flash and the firework
// flower, it only ever exists as the product of something else.

/** Mean life (ticks) of one flash cell. Shorter than the firework flower's 14
 *  and than the shockwave flash's own countdown: a flash is over almost before
 *  you see it, which is what separates "번쩍" from "타오른다". */
const LIFE_TICKS = 7;

/** Apparent temperature (°C) — burning aluminum runs far past any flame in the
 *  palette (Fire 1000, Blue Flame 1800, Thermite 2800), which is what puts the
 *  light up in the white. A reading only: see `decorTemp` below. */
const FLASH_TEMP = 3000;

/** Stamp a flash cell at (x,y). spawn() marks the cell moved, so a freshly lit
 *  flash isn't re-processed the same tick. */
export function flashLight(sim: SimContext, x: number, y: number): void {
  sim.spawn(x, y, FLASH.id);
}

export const FLASH = register({
  id: 138,
  name: 'Flash',
  phase: Phase.Gas,
  // Flat, unramped white — no `glow`, which is the whole point: the shockwave
  // flash it replaces is defined by fading to orange, and this one must not.
  color: rgb(255, 255, 255),
  colorVary: 0,
  density: 1,
  category: 'explosive',
  blastInert: true,
  thermal: { init: FLASH_TEMP, conductivity: 0 },
  decorTemp: true,
  life: { ticks: LIFE_TICKS },
  update: () => {},
});
