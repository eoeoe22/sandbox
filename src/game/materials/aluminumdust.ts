import type { SimContext } from '../engine/SimContext';
import { getMaterial } from './registry';
import { flameAdjacent } from './combustion';
import { tryDustExplosion as tryDustExplosionShared, type DustFlash } from './dustexplosion';
import { MOLTEN_ALUMINUM, ALUMINUM_MELT_TEMP } from './moltenaluminum';

// Shared behaviour for the two aluminum *dusts* — Aluminum Powder and its
// gallium-activated form (aluminumpowder.ts / activatedaluminum.ts). Both are
// the same metal ground to the same grain, so both answer heat the same way and
// both can go off as a suspended cloud; only their reaction tables and their
// ignition points differ. The two rules live here rather than being copied into
// each file, so a change to "how aluminum dust behaves" lands on both at once.

// ── 1. Melt vs burn ─────────────────────────────────────────────────────────
//
// Aluminum's real melting point (660°, see moltenaluminum.ts) is far *below*
// the autoignition point of its dust, so heat alone has two possible answers and
// the cell has to pick one. It picks the same way the petroleum fuels do (see
// `flameAdjacent` / petroleumdistill.ts): **direct flame contact wins**.
//
//   • A flame actually touching the grain — Fire, Lava or Blue Flame — means it
//     burns: `tryBurn` rolls `burnChance` and the melt path is vetoed while any
//     flame is adjacent, so the grain heats on toward its autoignition point and
//     catches instead of quietly slumping into a puddle first.
//   • Heat with no flame on it — a coal bed through a wall, a molten iron pool,
//     a hot pipe — melts it at 660°, and it never reaches autoignition at all.
//
// That reads as one rule ("불을 대면 타고, 그냥 데우면 녹는다") and it is the
// physically honest one too: bulk aluminum melts, and it is fine aluminum *dust
// in a flame* that burns. It also produces a nice split inside a single heap
// resting on lava — the face in contact with the flame lights while the grains
// behind it, heated only by conduction, run down into melt.
//
// The upper bound matters as much as the lower one: a cell at or above the
// autoignition point is either already burning (its heat pinned at the fuel's
// burn temperature by combustion.ts) or about to, and a burning grain only
// wreathes itself in Fire on a WREATH_CHANCE roll — so on the ticks where no
// flame happens to be beside it, an unbounded melt check would yank a mid-burn
// grain out of the fire and turn it into a puddle. Melting strictly below the
// autoignition point leaves every burning cell to `tryBurn`.
export function tryMeltAluminumDust(x: number, y: number, sim: SimContext): boolean {
  // The dust's own autoignition point, read off the cell (Material.combustion) the
  // same way `tryBurn` reads it — the two dusts differ here (1000° vs 700°) and
  // the upper bound below has to be each one's own, not a number handed in from
  // the call site and liable to drift from the spec it is supposed to mirror.
  const autoIgniteTemp = getMaterial(sim.get(x, y)).combustion?.autoIgniteTemp;
  if (autoIgniteTemp === undefined) return false;
  const t = sim.getTemp(x, y);
  if (t < ALUMINUM_MELT_TEMP || t >= autoIgniteTemp) return false;
  if (flameAdjacent(x, y, sim)) return false;
  // In-place `set` keeps the (now high) temperature so the fresh Molten Aluminum
  // reads as molten instead of instantly re-freezing next tick.
  sim.set(x, y, MOLTEN_ALUMINUM.id);
  return true;
}


// ── 2. 분진 폭발 (dust explosion) ────────────────────────────────────────────
//
// Aluminum dust is the textbook dust-explosion material: a heap of it is the
// most stubborn fuel in the palette (autoignition 1000°, and even then only with
// a flame held against it), but the *same grains* thrown into the air are a
// bomb. The rule itself is shared — every powder whose pile is stubborn and
// whose cloud is a bomb runs the same gate (dustexplosion.ts) — so all that
// lives here is aluminum's own three numbers.

/** Aluminum dust's flash numbers (see DustFlash). The flash point sits far under
 *  the 1000° a packed heap needs, because that number exists to model the
 *  passivating oxide skin on grains buried in a pile; a grain hanging in air with
 *  oxygen on every side has no such excuse. It is kept well below the 660° melt
 *  point too, so an airborne grain always flashes rather than melting. The pin is
 *  the same 1700° a burning aluminum grain holds (aluminumpowder.ts), because
 *  that is what this is: the whole grain burning at once instead of from its
 *  surface inward. No residue — a metal dust burns to an oxide this world doesn't
 *  model. */
const ALUMINUM_DUST_FLASH: DustFlash = { flashTemp: 400, pinTemp: 1700 };

/** Flash a suspended aluminum-dust grain — the shared rule with aluminum's own
 *  numbers. Both dusts (Aluminum Powder and Activated Aluminum) call this. */
export function tryDustExplosion(x: number, y: number, sim: SimContext): boolean {
  return tryDustExplosionShared(x, y, sim, ALUMINUM_DUST_FLASH);
}
