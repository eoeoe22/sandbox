import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';

// Firework Burst — the coloured flower a firework star opens into (see
// fireworkstar.ts). It's the *visual* half of the shell: a short-lived glowing
// cell that sits where it was placed and fades, so a star's burst reads as a
// crisp expanding disc of one colour rather than a puff of smoke drifting off.
//
// One material carries every colour. Each cell's `aux` holds an index into
// BURST_COLORS and the renderer draws that entry instead of the base `color`
// (see Material.auxPalette) — so a single volley of stars, each having rolled its
// own index at launch, paints half a dozen differently-coloured flowers without a
// material per colour. The index is opaque to the simulation; only the renderer
// reads it.
//
// Never painted from the palette (like Ember/Blast flash it only ever exists as
// the product of something else); placed by hand it would just fade out at once.

/** The star colours a shell can open in — saturated firework tones, deliberately
 *  far apart in hue so two bursts in the same volley never read as the same
 *  colour. A star picks one at launch (see fireworkstar.ts) and every cell of the
 *  burst it opens carries that index in `aux`. */
export const BURST_COLORS: readonly number[] = [
  rgb(255, 86, 86), // red
  rgb(255, 170, 60), // amber
  rgb(255, 240, 120), // gold
  rgb(120, 255, 130), // green
  rgb(90, 220, 255), // cyan
  rgb(120, 140, 255), // blue
  rgb(220, 120, 255), // violet
  rgb(255, 130, 200), // pink
];

/** Mean life (ticks) of one burst cell — about half a second at the default sim
 *  rate. Short: a firework flower flashes and fades, well before the ordinary
 *  Smoke's ~37-tick drift, so a volley reads as a sequence of bursts rather than
 *  a coloured haze that piles up. */
const LIFE_TICKS = 14;

/** Apparent temperature of a burst cell (°C). A star's composition burns hotter
 *  than an ordinary wood flame (Fire's 1000) and well short of the Blue Flame's
 *  1800 — so a flower surveyed with the 돋보기, or watched through the heat
 *  overlay, reads as the burning thing it looks like instead of as 20°C room air.
 *  It's a *reading*, not heat: see `decorTemp` below. */
const BURN_TEMP = 1200;

/** Stamp a burst cell of colour `colorIndex` at (x,y). spawn() marks the cell
 *  moved, so a freshly opened flower isn't re-processed the same tick. */
export function burstCell(sim: SimContext, x: number, y: number, colorIndex: number): void {
  sim.spawn(x, y, FIREWORK_BURST.id);
  sim.setAux(x, y, colorIndex);
}

export const FIREWORK_BURST = register({
  id: 131,
  name: 'Firework Burst',
  phase: Phase.Gas,
  color: BURST_COLORS[2], // fallback tone; every real cell draws from auxPalette
  density: 1,
  category: 'explosive',
  // The cell's colour comes from its aux index, not from `color`.
  auxPalette: BURST_COLORS,
  // A firework flower is LIGHT, not matter — the same category as the shockwave
  // flash and the in-flight Debris fragment that blast.ts already passes straight
  // over. So a blast neither destroys, flashes nor shoves it; it just keeps fading
  // on its own timer (see Material.blastInert).
  //
  // The shove is the part that matters. Without this, a weak blast (Gunpowder
  // class, power 6, under the gas default durability of 15) turned a flower into a
  // Debris fragment carrying this material's id in `aux` — and that one aux word
  // then meant two contradictory things at once: a carried material id to the
  // fragment, a colour index to this material. The fragment drew a wrong colour and
  // landed as a colour-0 flower with its own colour lost.
  blastInert: true,
  // Inert to heat: a firework flower is light, not a heat source, and its cells
  // shouldn't warm what they wash over. conductivity 0 handles the grid on its
  // own (conduction is gated by the lower of the two cells' conductivities, so a
  // 0 neither gains nor gives heat)…
  thermal: { init: BURN_TEMP, conductivity: 0 },
  // …and `decorTemp` says the reading it carries is for the eye only, so the
  // object layer — the one place that reads raw cell temperatures as heat
  // applied to a body — keeps ignoring it. Without this the hot reading would
  // silently start igniting wooden boxes and burning balls that a flower drifts
  // over, which is exactly the "washes over, changes nothing" behaviour above.
  decorTemp: true,
  // Fades on the shared memoryless timer (Material.life), like Smoke.
  life: { ticks: LIFE_TICKS },
  // Deliberately motionless: a gas that rose and diffused would smear the flower
  // upward into a smudge. It flashes where the star opened it and dies there.
  update: () => {},
});
