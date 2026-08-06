import { EMPTY } from '../engine/types';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { DIRT } from './dirt';
import { MUD } from './mud';
import { SAND } from './sand';
import { ASH } from './ash';
import { COMPOST } from './compost';

// Shared 흙·물 lookup for the growing things — Seed's germination check and
// Plant's roots (seed.ts / plant.ts). Not a material: just the one definition of
// "이 땅이 젖었는가?", so the seed that sprouts and the plant that grows out of it
// can never disagree about it.
//
// Why a *downward probe* rather than "is there water next to me": watering a
// dirt bed doesn't leave a puddle. Water soaks into loose ground as an absorbed
// overlay (겹침 — see Grid.overlay) and drains down through it in seconds, so a
// few ticks after you pour, the surface is dry and the water is sitting several
// cells below as a water table. Checking only the eight neighbours made a
// watered field read as bone dry, which is why planting a seed used to look
// broken — you did everything right and nothing happened.
//
// So the ground counts as damp when, straight down from the cell, within
// ROOT_REACH cells and without leaving the soil (bar one cell of slack for a
// cavity — see GAP_ALLOWANCE), there is any of:
//   • standing fresh Water or Mud (a real source — roots consume it), or
//   • loose ground that has soaked water into its pores (a damp bed — a trickle
//     that isn't consumed; it drains on its own soon enough).
// Saltwater is deliberately absent from all of it: brine is Coral's element
// (coral.ts), and no amount of it makes ground fertile.

/** Loose ground a root can work through and a seed can be planted in. */
export function isSoil(id: number): boolean {
  return (
    id === DIRT.id ||
    id === MUD.id ||
    id === SAND.id ||
    id === ASH.id ||
    id === COMPOST.id
  );
}

/** 걸어진 땅 — ground that sustains a plant properly rather than merely keeping it
 *  alive. See `moistFertile` and compost.ts; today it is exactly 퇴비, the end of
 *  the 부패 chain, which is what makes rotting worth doing. */
export function isFertile(id: number): boolean {
  return id === COMPOST.id;
}

/** A cell that *is* fresh moisture, and can be drunk (consumed) as such. */
export function isFreshWater(id: number): boolean {
  return id === WATER.id || id === MUD.id;
}

/** How deep roots reach through soil for the water table under them — deep
 *  enough to find what a poured bucket drains down to in a hand-drawn bed. */
export const ROOT_REACH = 10;

/** How many empty cells the path down may cross. Ground moves: wet Dirt turns to
 *  Mud and Mud oozes, so the cell under a plant can slump away and leave it
 *  standing over a cavity — and with a strict "soil all the way down" rule that
 *  plant starves on a bed that is still soaking wet, for reasons nothing on
 *  screen explains. One cell of slack lets roots bridge that. */
const GAP_ALLOWANCE = 1;

/** Whether the cell findMoisture() last landed on is a source that can actually
 *  be drunk down (standing Water/Mud) or merely damp ground (a soaked grain,
 *  which is left alone). Module scratch rather than an allocated result tuple —
 *  this runs per cell per tick. Only meaningful right after a `true` return. */
export let moistDrinkable = false;

/**
 * Whether the root path `findMoisture` last walked went through 걸어진 땅 (퇴비 —
 * see `isFertile`). Same module-scratch arrangement as `moistDrinkable`, and only
 * meaningful right after a `true` return.
 *
 * Read by the plant's roots (plant.ts): damp ground alone normally sustains only
 * a modest plant, and this is what lifts that ceiling. It is set from the whole
 * path rather than only from the cell the probe landed on, because a bed is not
 * one grain — compost worked into the top of a plot should count even when the
 * water table itself sits in the sand under it, which is exactly how a real
 * dressing of compost is used.
 */
export let moistFertile = false;

/**
 * Look for fresh moisture straight below (x,y): standing Water/Mud, or ground
 * that has soaked water into its pores, at most `reach` cells down and never
 * leaving the soil. Returns the row it found (always at column x), or -1 for dry
 * ground; `moistDrinkable` says which of the two kinds it is, and `moistFertile`
 * whether the path ran through 퇴비.
 */
export function findMoisture(x: number, y: number, sim: SimContext, reach: number): number {
  let gaps = 0;
  let fertile = false;
  for (let d = 1; d <= reach; d++) {
    const ny = y + d;
    if (!sim.inBounds(x, ny)) return -1;
    const id = sim.get(x, ny);
    if (isFreshWater(id)) {
      moistDrinkable = true;
      moistFertile = fertile;
      return ny;
    }
    if (id === EMPTY) {
      // A cavity the ground left behind (see GAP_ALLOWANCE) — cross it once.
      if (++gaps > GAP_ALLOWANCE) return -1;
      continue;
    }
    if (!isSoil(id)) return -1; // rock — the root path ends here
    if (isFertile(id)) fertile = true;
    if (sim.getOverlay(x, ny) === WATER.id) {
      moistDrinkable = false; // damp ground: a trickle, not a puddle to drink
      moistFertile = fertile;
      return ny;
    }
  }
  return -1;
}
