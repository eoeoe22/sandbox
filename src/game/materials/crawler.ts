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
//
// Termite and Nanobot are free to move/spawn right next to each other (and
// each other's own kind) and to climb over one another — there's no anti-clump
// rule here. What they can't do is defy gravity: a crawler only counts as
// "grounded" if it's touching real terrain directly, or touching another
// crawler that's itself grounded, all the way back to some real terrain
// somewhere. That chain is tracked as a hop-count cached in each crawler's aux
// cell (see `computeGroundHop`) rather than re-flood-filled from scratch every
// tick, so it's cheap even for a big colony. A capped hop count also means a
// colony that eats away its own support doesn't get stuck forever quietly
// referencing its equally-stranded neighbors' stale "I'm grounded" state (the
// classic distance-vector "count to infinity" trap) — a severed chain's hop
// count climbs by roughly one per tick until it blows past the cap, at which
// point it's correctly reclassified ungrounded and starts to fall. That
// resolution can take up to MAX_HOPS ticks, but it always resolves.

/** True if `id` is any crawler (Termite OR Nanobot — see `Material.crawler`). */
function isCrawler(id: number): boolean {
  return id !== EMPTY && getMaterial(id).crawler === true;
}

/** Real, non-crawler Solid/Powder terrain — the only thing that can anchor a
 *  crawler chain to the ground "from scratch" (hop 0). */
function isRealGround(id: number): boolean {
  if (id === EMPTY || isCrawler(id)) return false;
  const phase = getMaterial(id).phase;
  return phase === Phase.Solid || phase === Phase.Powder;
}

/** Any Solid/Powder cell a crawler can grip to move onto or spawn next to —
 *  real terrain OR another crawler of either kind. Termite and Nanobot are
 *  themselves Powder-phase, so nothing stops them clinging to and climbing
 *  over each other; whether the resulting position stays up under gravity is
 *  a separate question, handled by the grounded hop-count below. */
function isStructure(id: number): boolean {
  if (id === EMPTY) return false;
  const phase = getMaterial(id).phase;
  return phase === Phase.Solid || phase === Phase.Powder;
}

/** True if any 8-neighbor of (x,y) is structure, per `isStructure`. */
function hasStructureNeighbor(sim: SimContext, x: number, y: number): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isStructure(sim.get(nx, ny))) return true;
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

/** Cap on the "grounded" hop count (see the file header). Bounds how long a
 *  severed support chain takes to notice it's lost (worst case MAX_HOPS
 *  ticks) — high enough that no realistically-sized colony ever falsely reads
 *  as unsupported while genuinely still connected to real terrain. */
const MAX_HOPS = 128;

/** aux value meaning "no known path to real ground" — also what a freshly
 *  spawned crawler's aux defaults to (see SimContext.spawn), so a newborn
 *  starts out conservatively ungrounded until its own next update verifies
 *  it (almost always immediately true, since it's born right next to its
 *  parent). */
const UNGROUNDED = 0;

/**
 * Recomputes this tick's grounded hop count for (x,y): 1 if it touches real
 * terrain directly, otherwise one more than the smallest hop count among its
 * crawler neighbors (their aux value, cached from their own most recent
 * update), capped at MAX_HOPS and read as UNGROUNDED (0) past that cap. This
 * is a one-hop-per-tick relaxation of the whole crawler graph's distance to
 * real ground, not a full flood-fill — cheap, self-stabilizing for any
 * genuinely-supported structure, and guaranteed (via the cap) to eventually
 * un-stick a structure whose real support got eaten/blown/melted away instead
 * of leaving it floating on stale neighbor state forever.
 */
function computeGroundHop(sim: SimContext, x: number, y: number): number {
  let best = 0; // smallest neighbor hop count seen so far (0 = none yet)
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (isRealGround(id)) return 1; // directly on terrain — the best possible case
    if (!isCrawler(id)) continue;
    const hop = sim.getAux(nx, ny);
    if (hop === UNGROUNDED) continue;
    if (best === 0 || hop < best) best = hop;
  }
  if (best === 0 || best >= MAX_HOPS) return UNGROUNDED;
  return best + 1;
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
 * One tick of shared crawler behavior: liquid-aversion death, then refreshing
 * this cell's grounded hop count (see `computeGroundHop`), then a chance to
 * eat an adjacent food cell (clearing it, and 30%-by-default also spawning a
 * new crawler there — free to land right next to any other crawler now, no
 * anti-clump gate), then either crawling to a random empty neighbor that
 * still touches some structure (real ground or another crawler — climbing
 * over and clustering with other crawlers is fine) if grounded, or falling
 * one step with gravity if not. A crawler with nothing under it — knocked
 * into open air, or its whole support chain severed — keeps falling until it
 * lands somewhere with a real path back to solid ground.
 */
export function updateCrawler(x: number, y: number, sim: SimContext, spec: CrawlerSpec): void {
  if (spec.avoidsLiquid !== undefined && hasLiquidNeighbor(sim, x, y)) {
    sim.set(x, y, spec.avoidsLiquid); // drowned
    return;
  }

  const hop = computeGroundHop(sim, x, y);
  sim.setAux(x, y, hop);
  const grounded = hop !== UNGROUNDED;

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (spec.foodIds.has(nid) && sim.chance(spec.eatChance)) {
      if (sim.chance(spec.reproduceChance)) {
        sim.spawn(nx, ny, spec.selfId); // eaten cell becomes a new crawler
      } else {
        sim.set(nx, ny, EMPTY); // eaten cell just disappears
      }
      return;
    }
  }

  if (!grounded) {
    // No verified path back to real ground: fall. tryMove only succeeds into
    // EMPTY (crawlers are Powder-phase, so one crawler can't displace
    // another) — a cell resting on other still-ungrounded crawlers simply
    // waits its turn, and as the ones below it fall out from under it on
    // later ticks it inherits an empty cell below and falls too, cascading
    // like any unsupported pile collapsing.
    sim.tryMove(x, y, x + sim.gravityX, y + sim.gravityY);
    return;
  }

  const cxs: number[] = [];
  const cys: number[] = [];
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) !== EMPTY) continue;
    if (spec.avoidsLiquid !== undefined && hasLiquidNeighbor(sim, nx, ny)) continue;
    if (!hasStructureNeighbor(sim, nx, ny)) continue;
    cxs.push(nx);
    cys.push(ny);
  }
  if (cxs.length > 0) {
    const k = sim.randInt(cxs.length);
    sim.swap(x, y, cxs[k], cys[k]);
  }
}
