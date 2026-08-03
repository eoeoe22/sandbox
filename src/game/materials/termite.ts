import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { SAWDUST } from './sawdust';
import { WOOD } from './wood';
import { crawl, eatAndReproduce, isSubmerged, touchingBlast, EAT_CHANCE, type FeedOptions } from './crawler';

// Termite (흰개미) — a wood-eating bug that crawls along surfaces (see crawler.ts
// for the shared locomotion). It gnaws its way through wood and sawdust; half of
// what it eats simply *disappears* down the colony and the other half turns into
// another termite, so a swarm visibly chews a timber structure away and multiplies
// while it does — but it no longer converts a wall into its own mass cell for cell
// (see VANISH_CHANCE).
//
// It's a fragile organic thing, so it dies three ways — every death leaves a
// fleck of Sawdust (the frass a termite leaves behind), which conveniently is
// *also* termite food, so a colony that cooks or drowns feeds the survivors:
//   • 물에 완전히 잠기면 익사 — fully surrounded by liquid.
//   • 폭발 충격파 — an adjacent Blast flash cell (a real detonation) kills outright.
//   • 충격파 노출 50% — a shockwave too weak to *break* it (a Woofer's silent thump,
//     a Gunpowder concussion) still crushes it half the time; the survivors are
//     blown away as Debris and land elsewhere. A termite's body is far too small
//     and unanchored to shrug a pressure wave off, so it rides the wave like loose
//     matter instead of standing in it (`shockLoose`) — see blast.ts.
//   • 70°C 이상 열 — anything from a nearby fire to a warm metal bar cooks it.
const DEATH_TEMP = 70;
/** 충격파 노출 시 사망 확률 — half the colony caught in a (non-destructive) shockwave
 *  is crushed to Sawdust; the rest is merely flung. */
const SHOCK_DEATH_CHANCE = 0.5;
const FOOD = [SAWDUST.id, WOOD.id] as const;
/** 갉아먹은 나무가 그대로 사라질 확률 — a coin flip per meal between "eaten away"
 *  (the cell goes back to air) and "번식" (it becomes another termite). Feeding
 *  used to reproduce every time, which meant a colony's mass exactly replaced the
 *  timber it ate: a beam turned into a beam-shaped swarm and nothing was ever
 *  really *gone*. Half and half keeps the spread — a nest still grows on a big
 *  enough meal — while letting a structure actually be eaten down to nothing. */
const VANISH_CHANCE = 0.5;
const FEED: FeedOptions = { vanishChance: VANISH_CHANCE };

function updateTermite(x: number, y: number, sim: SimContext): void {
  if (
    sim.getTemp(x, y) >= DEATH_TEMP ||
    isSubmerged(x, y, sim) ||
    touchingBlast(x, y, sim)
  ) {
    sim.set(x, y, SAWDUST.id); // dies, leaving frass (also food for the colony)
    return;
  }
  eatAndReproduce(x, y, sim, TERMITE.id, FOOD, EAT_CHANCE, FEED);
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
  category: 'life',
  // Crushed to Sawdust (its own food) when a blast destroys it at the epicenter,
  // matching the death-by-shockwave its update handles for rim survivors — and
  // the remains a shockDeathChance roll leaves too.
  blastDeathId: SAWDUST.id,
  // 피폭사 — a fourth way for a fragile organic body to die: crawl next to anything
  // in the 방사능 tab and the dose kills it (see engine/radiation.ts). It leaves the
  // same fleck of Sawdust every other death does — which the colony still eats, so
  // an irradiated swarm feeds the ones behind it right up to the front line.
  radiationDeath: SAWDUST.id,
  // Only nominally a solid (it walks instead of piling), so a shockwave sweeps it
  // up like loose matter rather than being shadowed by it, and a body caught in
  // one is crushed half the time (leaving blastDeathId) instead of just tumbling.
  shockLoose: true,
  shockDeathChance: SHOCK_DEATH_CHANCE,
  // Organic and poorly conductive (like Wood/Sawdust), so it heats up slowly —
  // but once it crosses 70° it's cooked.
  thermal: { conductivity: 0.2 },
  update: updateTermite,
});
