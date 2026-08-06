import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { updateFloatyPowder } from '../engine/behaviors';
import { SMOKE } from './smoke';
import { spoilStep } from './spoil';
import { SPOILED_FOOD } from './spoiledfood';

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
// 부패 — a corpse doesn't pile up forever, and since the 부패 계통 exists it does
// not merely *stop existing* either: it rots into 부패물 on the same shared
// machinery every food in the palette uses (spoil.ts), and from there into 퇴비.
// 어항 바닥에 쌓인 것이 결국 밭이 된다.
//
// That replaced a flat DECAY_CHANCE roll — no state at all, and for a corpse that
// only had to disappear it was the right trade. Two things made it the wrong one
// once preservation existed. A memoryless roll cannot be *paused*, so a frozen
// tank would have gone on quietly deleting its dead; and a corpse that vanishes
// is mass leaving the world, which is precisely what the compost loop is for. The
// counter costs three aux bits — 1-3, above the facing bit the renderer reads.
//
// Spending aux here needed checking against every way a corpse is made, because a
// living fish's word is *full* — facing in bit 0, heading in 1-4, a time-out-of-
// water counter in 5-14 (fish.ts) — and bits 1-3 landing on the spoilage counter
// would mean a fish that happened to be swimming north-east arriving pre-rotten.
// Every path is already safe, for two different reasons worth keeping written
// down. fish.ts's own `die` uses `set` (which preserves aux by contract) and so
// masks the word down to the facing bit by hand. The declarative hooks
// (`radiationDeath`, `blastDeathId`, `shockDeathChance`) go through `spawn`
// instead, which clears aux as part of its contract — so those corpses start at
// zero and simply face left, which deadfish's own note already recorded.
//
// 소사 — checked before the rot step, for the same reason fish.ts checks it before
// DEATH_TEMP: a corpse is not exempt just because it already died once. A raft of
// Dead Fish drifting into a lava flow (or a tank that's since been set ablaze)
// burns away into Smoke on the spot rather than waiting out its ordinary rot timer.

/** 소사(燒死) 온도 — fish.ts의 VAPORIZE_TEMP와 같은 값. 산 물고기가 이 온도에서
 *  사체도 없이 곧장 Smoke가 되는 것과 같은 이유로, 이미 떠 있는 사체도 예외가 아니다
 *  — 용암에 뜬 채 흘러든 사체가 부패를 기다리며 멀쩡히 떠 있으면 어색하다. */
const VAPORIZE_TEMP = 500;

function updateDeadFish(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= VAPORIZE_TEMP) {
    sim.set(x, y, SMOKE.id);
    return;
  }
  // 부패 — into 부패물, on the shared counter. Freeze the tank and the raft keeps.
  if (spoilStep(x, y, sim, DEAD_FISH.spoil!)) return;
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
  // 부패 — fast, like the raw meat it essentially is. `auxShift: 1` clears the
  // facing bit at 0 that the renderer draws the tail pixel from (see above), and
  // there is no `dryMask` because a corpse keeps no moisture counter: a dead fish
  // cannot be turned into 육포, it has to be salted or frozen like anything else.
  spoil: { seconds: 140, auxShift: 1, into: () => SPOILED_FOOD.id },
  // Organic and poorly conductive, like the live fish and the Termite.
  thermal: { conductivity: 0.2 },
  update: updateDeadFish,
});
