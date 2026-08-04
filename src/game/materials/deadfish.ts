import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { updateFloatyPowder } from '../engine/behaviors';
import { SIM_HZ_AT_1X } from '../config';

// Dead Fish (죽은 물고기) — what a Fish leaves behind, every way it can die (see
// fish.ts). Not in the palette: 사체는 만들어 놓는 것이 아니라 *생기는* 것이라,
// 물고기를 죽여야만 나온다. Placed only by conversion — fish.ts's own update
// (열/충격파/질식), and the two declarative death hooks (`radiationDeath`,
// `blastDeathId`) that name this id.
//
// 배가 하얗게 뜬 물고기, and it does so with no floating logic of its own: a
// Powder lighter than Water (density 2 against Water's 3) is already carried to
// the surface by the engine's buoyancy step, exactly as Ash and Snow are —
// updateFloatyPowder's `tryBuoyantRise`. So the corpse rises out of the school it
// died in and collects in a pale raft on the waterline, and "이 물고기는 죽었다"
// reads twice over: once from the colour, once from where it ended up.
//
// 부패 — a corpse doesn't pile up forever. Instead of a countdown in `aux` it just
// rolls DECAY_CHANCE every tick, which costs no state at all and comes out better:
// a shoal that died together doesn't blink out together, it thins away one fish at
// a time over about DECAY_SECONDS. (A counter would have needed care anyway — `set`
// keeps the old cell's aux on a non-empty write, so a corpse would have inherited
// the fish's own aux word as a decay count from the declarative death hooks, which
// don't clear it.)
const DECAY_SECONDS = 45;
/** 부패 확률/틱 — mean lifetime DECAY_SECONDS at ×1 speed. Exponential rather than
 *  fixed, so corpses fade out staggered instead of all at once. */
const DECAY_CHANCE = 1 / (DECAY_SECONDS * SIM_HZ_AT_1X);

function updateDeadFish(x: number, y: number, sim: SimContext): void {
  if (sim.chance(DECAY_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }
  updateFloatyPowder(x, y, sim);
}

export const DEAD_FISH = register({
  id: 147,
  name: 'Dead Fish',
  phase: Phase.Powder,
  // Pale grey-beige — the washed-out belly of a fish floating upside down, kept
  // well clear of the live fish's dark navy so the two never read as the same
  // thing at a glance.
  color: rgb(0xc6, 0xbe, 0xa6),
  colorVary: 20,
  // Lighter than Water (3), so it rises to the surface on its own — see above.
  density: 2,
  category: 'life',
  // Organic and poorly conductive, like the live fish and the Termite.
  thermal: { conductivity: 0.2 },
  update: updateDeadFish,
});
