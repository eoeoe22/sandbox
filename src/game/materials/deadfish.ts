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
// 꼬리는 죽어도 남는다 — the corpse trails the same display-only tail pixel the
// living fish does (`Material.tailPixel`), just washed out to match the body. A
// fish that lost its tail the instant it died stopped reading as *that* fish and
// started reading as a stray grain of ash; keeping it is what makes a raft of
// corpses on the waterline legible as 물고기들.
//
// Which side it trails from is bit 0 of the cell's `aux` — the renderer's whole
// contract for a `tailPixel` material (see CanvasRenderer.drawTailPixels). The
// corpse doesn't maintain it, it inherits it: fish.ts's own `die` copies the
// living fish's facing bit across, and `set`/`spawn` hand the rest of the aux word
// over (or zero it) without either being able to mean anything else here, since
// nothing below reads aux. A corpse from one of the paths that zeroes it simply
// faces left. 죽은 물고기는 방향을 바꾸지 않는다 — it drifts as it is pushed.
//
// 부패 — a corpse doesn't pile up forever. Instead of a countdown in `aux` it just
// rolls DECAY_CHANCE every tick, which costs no state at all and comes out better:
// a shoal that died together doesn't blink out together, it thins away one fish at
// a time over about DECAY_SECONDS. (A counter would have needed care anyway — `set`
// keeps the old cell's aux on a non-empty write, so a corpse would have inherited
// the fish's own aux word as a decay count from the declarative death hooks, which
// don't clear it. That inheritance is now load-bearing for the facing bit above,
// which is another reason not to spend aux on a timer here.)
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
  // 꼬리 — the same display-only pixel the live fish trails, in a muted version of
  // the corpse's own colour: dark enough to be seen against the pale belly and
  // against water, but well short of the living fish's slate grey, so a floating
  // corpse never reads as a fish that is still swimming.
  tailPixel: rgb(0x93, 0x8b, 0x79),
  // Organic and poorly conductive, like the live fish and the Termite.
  thermal: { conductivity: 0.2 },
  update: updateDeadFish,
});
