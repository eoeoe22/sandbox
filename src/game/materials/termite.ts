import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { SAWDUST } from './sawdust';
import { WOOD } from './wood';
import { crawl, eatAndReproduce, isSubmerged, touchingBlast, EAT_CHANCE } from './crawler';

// Termite (흰개미) — a wood-eating bug that crawls along surfaces (see crawler.ts
// for the shared locomotion). It gnaws its way through wood and sawdust, turning
// each cell it eats into another termite, so a colony visibly chews through a
// timber structure and multiplies as it goes.
//
// It's a fragile organic thing, so it dies three ways — every death leaves a
// fleck of Sawdust (the frass a termite leaves behind), which conveniently is
// *also* termite food, so a colony that cooks or drowns feeds the survivors:
//   • 물에 완전히 잠기면 익사 — fully surrounded by liquid.
//   • 폭발 충격파 (단 Woofer 제외) — an adjacent Blast flash cell; a Woofer's
//     silent thump leaves no flash, so it doesn't harm them (see crawler.ts).
//   • 70°C 이상 열 — anything from a nearby fire to a warm metal bar cooks it.
const DEATH_TEMP = 70;
const FOOD = [SAWDUST.id, WOOD.id] as const;

function updateTermite(x: number, y: number, sim: SimContext): void {
  if (
    sim.getTemp(x, y) >= DEATH_TEMP ||
    isSubmerged(x, y, sim) ||
    touchingBlast(x, y, sim)
  ) {
    sim.set(x, y, SAWDUST.id); // dies, leaving frass (also food for the colony)
    return;
  }
  eatAndReproduce(x, y, sim, TERMITE.id, FOOD, EAT_CHANCE);
  crawl(x, y, sim, TERMITE.id, 'avoid'); // skirts liquid rather than entering it
}

export const TERMITE = register({
  id: 110,
  name: 'Termite',
  phase: Phase.Solid,
  // Pale, waxy body — the milky yellow-white of a real termite, kept distinct
  // from the browner Sawdust it eats and leaves behind.
  color: rgb(224, 206, 168),
  colorVary: 22,
  density: 1000,
  category: '생명',
  // Organic and poorly conductive (like Wood/Sawdust), so it heats up slowly —
  // but once it crosses 70° it's cooked.
  thermal: { conductivity: 0.2 },
  update: updateTermite,
});
