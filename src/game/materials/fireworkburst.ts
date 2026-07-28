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
  // flash blast.ts already refuses to shove (see its `prevId === BLAST.id` case).
  // Durability 0 puts it under every blast's destructive power, so a blast washing
  // over one always *destroys* it (leaving its own flash) instead of taking the
  // "too tough to break, fling it as Debris" path. Without this a weak blast
  // (Gunpowder-class, power 6 < the gas default 15) turns a flower into a Debris
  // fragment carrying this material's id in `aux` — and that aux word is then two
  // things at once: a carried material id to the fragment, a colour index to this
  // material. The fragment drew a wrong colour and landed as a colour-0 flower,
  // its original colour lost. Neither state is reachable now.
  durability: 0,
  // Inert to heat: a firework flower is light, not a heat source, and its cells
  // shouldn't warm what they wash over.
  thermal: { conductivity: 0 },
  // Fades on the shared memoryless timer (Material.life), like Smoke.
  life: { ticks: LIFE_TICKS },
  // Deliberately motionless: a gas that rose and diffused would smear the flower
  // upward into a smudge. It flashes where the star opened it and dies there.
  update: () => {},
});
