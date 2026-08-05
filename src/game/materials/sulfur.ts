import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn } from './combustion';
import { tryMixGunpowder } from './gunpowdermix';

// Sulfur (황) — the bright yellow brimstone powder, and one of the three
// ingredients of the black-powder recipe (see gunpowdermix.ts: Sulfur +
// Saltpeter + Coal Powder → Gunpowder).
//
// On its own it's the palette's *easiest-lighting* fuel: it catches at a mere
// 250°, far below every other fuel's autoignition (the next lowest is Alcohol's
// band, and Coal needs 580°), so radiant heat alone sets a pile off — no flame
// contact needed. That's its job in the mix, too: sulfur is what makes black
// powder ignite from a spark instead of needing a blast.
//
// The trade is that it burns *cool*. `burnTemp` 600° is below the shared 800°
// default, so a sulfur fire lights easily and spreads readily but melts nothing
// — it won't reach Iron's 1200°, or even Stone's 1100°. It's a fuse-lighter and
// a fire-starter, not a cutting torch. (Real sulfur behaves the same way: it
// ignites around 250°C with a low, pale flame.)

function updateSulfur(x: number, y: number, sim: SimContext): void {
  // The recipe first: cold sulfur sitting against saltpeter and coal dust grinds
  // into Gunpowder (the mix is temperature-gated, so a burning pile burns instead
  // — see gunpowdermix.ts).
  if (tryMixGunpowder(x, y, sim)) return;
  if (tryBurn(x, y, sim)) return;
  updatePowder(x, y, sim);
}

export const SULFUR = register({
  id: 125,
  name: 'Sulfur',
  phase: Phase.Powder,
  // Saturated brimstone yellow — deliberately greener/hotter than Sand's sandy
  // rgb(232, 201, 107) so a heap of the two never reads the same.
  color: rgb(230, 214, 48),
  // Real sulfur (~2.07 g/cm³) is lighter than the mineral powders Sand/Salt (5),
  // heavier than Sugar (3.65) — and, importantly, above Water (3) and below
  // Saltwater (4): a poured heap sinks in fresh water (so a wet mix is possible)
  // but floats up out of brine.
  density: 3.9,
  combustion: {
    // Between Wood (0.06) and Sawdust (0.08): a loose mineral powder that carries
    // a front briskly once lit, without the volatile-liquid race.
    burnChance: 0.08,
    autoIgniteTemp: 250, // the lowest in the game — radiant heat alone lights it
    burnTemp: 600, // cool flame: spreads well, melts nothing
  },
  // Filed under 불・열 rather than 폭발 — sulfur isn't itself an explosive,
  // it's a fuel (the easiest-lighting one in the game), so it sits with the
  // other fire/heat materials alongside Saltpeter.
  category: 'fire',
  alsoIn: ['powder'],
  // Fine, slightly cohesive crystalline dust — piles a bit steeper than Salt (마찰).
  friction: 0.42,
  thermal: { conductivity: 0.25 },
  update: updateSulfur,
});
