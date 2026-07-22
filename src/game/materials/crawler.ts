import { EMPTY } from '../engine/types';
import { Phase } from '../engine/types';
import { getMaterial } from './registry';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';

// Shared "surface crawler" behavior for Termite and Nanobot: a small living
// grain that clings to and wanders across the surface of solid/powder terrain
// (never floats free through open air like a gas, never piles up under gravity
// like an ordinary powder), slowly gnaws a specific food material, and every
// so often a bite reproduces instead of just vanishing. Both critters are
// otherwise very different (fire vs. heat, liquid death vs. none, ash vs.
// molten metal), so only this shared crawl-eat-reproduce core lives here; each
// material's own file handles its own death/melt conditions before handing off
// to `updateCrawler`.

/** True if `id` is any crawler (Termite OR Nanobot — see `Material.crawler`),
 *  the type-agnostic check that keeps crawlers from ever treating EACH OTHER
 *  (same kind or not) as ground or as a legal neighbor to move/spawn next to. */
function isCrawler(id: number): boolean {
  return id !== EMPTY && getMaterial(id).crawler === true;
}

/** A cell that counts as "ground" a crawler can grip: any Solid/Powder cell
 *  that isn't itself a crawler (see `isCrawler` — no crawler, of either kind,
 *  is ever terrain to another). */
function isGround(id: number): boolean {
  if (id === EMPTY || isCrawler(id)) return false;
  const phase = getMaterial(id).phase;
  return phase === Phase.Solid || phase === Phase.Powder;
}

/** True if any 8-neighbor of (x,y) is ground, per `isGround`. */
function hasGroundNeighbor(sim: SimContext, x: number, y: number): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isGround(sim.get(nx, ny))) return true;
  }
  return false;
}

/** True if any 8-neighbor of (x,y) is a Liquid cell. */
function hasLiquidNeighbor(sim: SimContext, x: number, y: number): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (id !== EMPTY && getMaterial(id).phase === Phase.Liquid) return true;
  }
  return false;
}

/** True if any 8-neighbor of (x,y), other than (skipX,skipY), is any crawler
 *  — used to keep a crawler from moving/spawning next to another crawler of
 *  EITHER kind (no clumping, no mutual mid-air propping-up — see `isCrawler`).
 *  `skipX/skipY` excludes the mover's own about-to-vacate cell (or the eating
 *  parent, for a reproduction check), which is trivially a neighbor of every
 *  candidate destination. */
function hasCrawlerNeighbor(
  sim: SimContext,
  x: number,
  y: number,
  skipX: number,
  skipY: number,
): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx === skipX && ny === skipY) continue;
    if (!sim.inBounds(nx, ny)) continue;
    if (isCrawler(sim.get(nx, ny))) return true;
  }
  return false;
}

export interface CrawlerSpec {
  /** This material's own id (Termite or Nanobot). */
  selfId: number;
  /** Material ids this crawler slowly gnaws. */
  foodIds: ReadonlySet<number>;
  /** Per-tick, per-adjacent-food-cell chance it takes a bite. */
  eatChance: number;
  /** Chance a bite also spawns a new crawler (at the eaten cell) instead of
   *  just clearing the food away — the eaten cell always disappears either way. */
  reproduceChance: number;
  /** If set, this crawler steers away from liquid and dies into this material
   *  id the moment liquid touches it (Termite → Sawdust). Omit for a crawler
   *  indifferent to liquid (Nanobot). */
  avoidsLiquid?: number;
}

/**
 * One tick of shared crawler behavior: liquid-aversion death, then a chance to
 * eat an adjacent food cell (clearing it, and 30%-by-default also spawning a
 * new crawler there), then crawling to a random empty neighbor that still
 * touches solid/powder ground and isn't next to another crawler — of its own
 * kind OR the other kind (see `isCrawler`), so Termite and Nanobot never prop
 * each other up as if either were solid ground. A crawler that finds itself
 * touching no ground at all (knocked into open air, or buried several cells
 * deep in an over-thick painted blob) just drops with gravity — sinking
 * straight through a same-kind sibling if one is directly below, since that
 * swap is visually a no-op — until it lands somewhere it can grip again,
 * rather than floating or locking rigid forever.
 */
export function updateCrawler(x: number, y: number, sim: SimContext, spec: CrawlerSpec): void {
  if (spec.avoidsLiquid !== undefined && hasLiquidNeighbor(sim, x, y)) {
    sim.set(x, y, spec.avoidsLiquid); // drowned
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (spec.foodIds.has(nid) && sim.chance(spec.eatChance)) {
      // A newborn is unavoidably adjacent to its own parent (it's born right where
      // the parent just ate), so the parent (x,y) is exempt from the no-clump
      // check here — but it must not ALSO land next to some other, unrelated
      // crawler, or reproduction would seed permanent clumps. If it would, just
      // fall through to the plain-disappearance outcome instead.
      if (sim.chance(spec.reproduceChance) && !hasCrawlerNeighbor(sim, nx, ny, x, y)) {
        sim.spawn(nx, ny, spec.selfId); // eaten cell becomes a new crawler
      } else {
        sim.set(nx, ny, EMPTY); // eaten cell just disappears
      }
      return;
    }
  }

  const cxs: number[] = [];
  const cys: number[] = [];
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) !== EMPTY) continue;
    if (spec.avoidsLiquid !== undefined && hasLiquidNeighbor(sim, nx, ny)) continue;
    if (!hasGroundNeighbor(sim, nx, ny)) continue;
    if (hasCrawlerNeighbor(sim, nx, ny, x, y)) continue;
    cxs.push(nx);
    cys.push(ny);
  }
  if (cxs.length > 0) {
    const k = sim.randInt(cxs.length);
    sim.swap(x, y, cxs[k], cys[k]);
    return;
  }

  // No valid surface move (crowded by other crawlers, or simply no ground
  // nearby to grip): if it isn't touching any ground at all, drop with
  // gravity until it lands somewhere it can crawl again.
  if (!hasGroundNeighbor(sim, x, y)) {
    const tx = x + sim.gravityX;
    const ty = y + sim.gravityY;
    if (sim.inBounds(tx, ty) && sim.get(tx, ty) === spec.selfId) {
      // Packed too deep in a thick same-kind pile (a brush blob painted
      // several cells thick) to find open ground of its own: sink through a
      // sibling below instead of locking rigid forever. A same-material swap
      // is visually a no-op (identical cell either way), so this can't
      // jitter/flicker — it just lets an over-thick pile gradually settle,
      // cell by cell each tick, until its members reach real ground.
      sim.swap(x, y, tx, ty);
    } else {
      sim.tryMove(x, y, tx, ty);
    }
  }
}
