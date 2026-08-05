import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryDustExplosion, type DustFlash } from './dustexplosion';
import { ASH } from './ash';
import { WATER } from './water';
import { BATTER } from './batter';

// Flour (밀가루) — the front of the 요리 line, and the game's second dust
// explosive. It is built as the deliberate inverse of a normal fuel:
//
//   • **더미로 쌓이면 안 탄다.** A heap of flour has no `combustion` spec at all,
//     so no flame front can start in it and none can creep through it. Hold a
//     torch to a sack of flour and nothing happens — which is exactly right, and
//     it is the whole setup for the next line.
//   • **공중에 뜨면 폭발한다.** The same grains thrown into the air are the
//     textbook dust explosion (dustexplosion.ts): a suspended grain flashes at
//     350° or on contact with any igniter, and hands the front to every other
//     airborne grain within two cells, so a dispersed cloud goes off all at once
//     instead of burning face-first. 팬 + 밀가루 + 불씨 is the build, out of
//     three things that were already here.
//   • **그냥 데우면 탄다(炭).** Heat with no suspension — a pile sitting on hot
//     stone, under the heat brush, beside lava — chars the grain to Ash past
//     260°. That is the only thing heat alone does to a heap, and it is a slow
//     browning rather than a fire.
//   • **재를 남긴다.** A flashed grain has a small chance of dropping Ash where
//     it went off rather than becoming pure flame, so a dust explosion visibly
//     rains soot over whatever it happened above.
//
// Its fifth fate is water: a grain touching Water becomes Batter, one cell of
// each making two cells of dough (batter.ts). That is the branch the whole
// baking chain hangs off — 밀가루 + 물 → 반죽 → 빵.
//
// Flour floats (density 2.6, under Water's 3): tip it into a pool and it rafts
// on the surface and turns to dough there, rather than sinking out of reach the
// way Sugar and Salt do. It is also the lightest thing in the palette that a Fan
// can loft into a real cloud, which is the point.

/** Flour dust's flash numbers (see DustFlash). It lights cooler than aluminum
 *  dust (350° vs 400°) — organic dust has no oxide skin to break through — and
 *  the fireball it leaves is an ordinary hot flame rather than a 1700° metal
 *  one. The residue is what makes a flour blast read as a *kitchen* accident:
 *  roughly one grain in eight leaves scorched Ash instead of flame. */
const FLOUR_DUST_FLASH: DustFlash = {
  flashTemp: 350,
  pinTemp: 900,
  residue: { id: () => ASH.id, chance: 0.12 },
};

/** Held this hot with no flash, a grain chars. Deliberately well under the
 *  cloud's 350° flash point: a *pile* can never reach the flash temperature
 *  without browning to Ash first, which is what guarantees "쌓인 밀가루는 타지
 *  않는다" holds even beside lava. */
const CHAR_TEMP = 260;
/** Per-tick chance a hot grain chars, so a heap browns front-first over a
 *  visible moment instead of vanishing in one frame. */
const CHAR_CHANCE = 0.06;

/** Per-tick, per-contact chance a grain and the Water cell it touches turn into
 *  two cells of Batter. Low enough that a bowl of flour and water visibly works
 *  itself into dough from the interface outward rather than flashing over. */
const HYDRATE_CHANCE = 0.14;

function updateFlour(x: number, y: number, sim: SimContext): void {
  // Airborne and lit → the cloud goes off. Checked first, and before anything
  // heat-related, because a suspended grain must flash rather than char.
  if (tryDustExplosion(x, y, sim, FLOUR_DUST_FLASH)) return;

  // Piled and merely hot → chars to Ash. This is the *only* thing heat does to a
  // heap; there is no combustion spec for a flame front to run through.
  if (sim.getTemp(x, y) >= CHAR_TEMP && sim.chance(CHAR_CHANCE)) {
    // In-place `set` keeps the cell's heat, so fresh Ash arrives hot rather than
    // reading as long-cold residue next to the grains still browning around it.
    sim.set(x, y, ASH.id);
    return;
  }

  updatePowder(x, y, sim);
}

export const FLOUR = register({
  id: 151,
  name: 'Flour',
  phase: Phase.Powder,
  // Warm off-white — a shade creamier than Sugar's cold crystal white
  // (242,240,233), so the two are told apart at a glance in the palette and in
  // the world.
  color: rgb(236, 228, 206),
  // Milled grain (~0.55 g/cm³ loose) is the lightest ordinary powder here after
  // Ash (1.5). Under Water's 3, so it rafts on a pool instead of sinking — a
  // pour of flour onto water hydrates at the surface where you can see it.
  density: 2.6,
  category: 'food',
  // Also on the 가루 shelf: someone hunting for a dust explosive opens 가루 and
  // expects to find every powder that does one next to Aluminum Powder, not just
  // the metal ones.
  alsoIn: ['powder'],
  // 겹침 불가, for Sugar's reason and then some. The dough reaction below pairs
  // *primary* cells, so water that soaked invisibly into a grain would neither
  // make dough nor be visible — and worse, it would be destroyed outright the
  // moment that grain reacted, because the product is a Liquid and a liquid has
  // no pore space to keep an occupant in (see SimContext.set, 스며든 액체 삭제).
  // Measured before this: a 120+120 bed came out as 203 cells of dough instead
  // of 240.
  //
  // `liquidOverlap: 0` alone does NOT stop it here, which is the trap. That
  // coefficient is consulted only *after* canOverlapAt's "액체보다 가벼운 가루는
  // 겹침" rule, and flour is deliberately lighter than water — so every grain
  // hosted regardless of the coefficient. The type-level allowlist is the gate
  // that runs first (Ammonium Nitrate uses it to soak up diesel while keeping
  // water primary); an empty list means "nothing, ever", which is what a grain
  // that turns into dough on contact actually needs. Both are declared: the
  // coefficient is the honest statement of intent for any future reader, and the
  // allowlist is what enforces it at this density.
  overlapFluids: [],
  liquidOverlap: 0,
  thermal: { conductivity: 0.25 },
  // 밀가루 + 물 → 반죽. One cell of each makes two cells of Batter, so the dough
  // conserves the cells that went into it — no mass appears and none is lost.
  // Declared here rather than on Batter because flour is the thing being changed
  // by the water, and a rule fires from the cell that declares it.
  reactions: [
    {
      with: WATER.id,
      produce: BATTER.id,
      otherBecomes: BATTER.id,
      probability: HYDRATE_CHANCE,
    },
  ],
  update: updateFlour,
});
