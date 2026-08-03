import { DIR8 } from '../engine/directions';
import { EMPTY, Phase } from '../engine/types';
import type { SimContext } from '../engine/SimContext';
import { getMaterial } from './registry';
import { flameAdjacent } from './combustion';
import { igniterAdjacent } from './deflagrate';
import { FIRE } from './fire';
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
// bomb. The difference is real and it is entirely about surface area meeting
// oxygen: a grain in a pile is shielded by the grains around it, a grain
// suspended in air is not.
//
// So the rule is gated strictly on suspension, and nothing else changes. A pile
// behaves exactly as it always did — this is checked *before* `tryBurn`, but
// only ever fires for a grain that is genuinely falling through open air, which
// no cell in a heap ever is. That gate is what keeps the material's identity
// ("팔레트에서 제일 안 붙는 연료") intact while giving it the one scene it was
// missing.
//
// What makes it playable is that the game already has the disperser: the Fan
// (fan.ts) blows loose powder around, so **팬 + 알루미늄 가루 + 불씨** is a
// complete build out of materials that were all already here. A Spark is
// deliberately not a trigger — electricity in this game never lights an ordinary
// fuel directly (see spark.ts's arc phase), so the electric route is the honest
// one: heat a Nichrome coil or point a Heat Ray into the cloud.

/** Of the 8 neighbours, how many must be open (see `isOpen`) before a grain counts as
 *  suspended rather than part of a heap. The "nothing underneath it" test below
 *  is what actually does the work — every grain in a heap is supported, so this
 *  second gate only rules out matter packed *around* a falling grain: a pour
 *  running down a one-cell shaft, or a column of dust dropping as a block. Four
 *  is deliberately loose enough to admit a dense cloud (a grain with open air N/
 *  S/E/W and other grains on the diagonals is very much airborne) while still
 *  needing half of the neighbourhood to be air. */
const SUSPENDED_MIN_EMPTY = 4;
/** Self temperature at which a *suspended* grain flashes with no flame on it.
 *  Far under the 1000° a packed heap needs, because that number exists to model
 *  the passivating oxide skin on grains buried in a pile; a grain hanging in air
 *  with oxygen on every side has no such excuse. Kept well below the 660° melt
 *  point too, so an airborne grain always flashes rather than melting. */
const DUST_FLASH_TEMP = 400;
/** Temperature the flame left behind starts at — the same 1700° a burning
 *  aluminum grain pins at (aluminumpowder.ts), because that is what this is:
 *  the whole grain burning at once instead of from its surface inward. */
const DUST_FLASH_TEMP_PIN = 1700;
/** Per open neighbouring cell, the chance a flashing grain throws Fire into it.
 *  Well under 1 so a cloud costs a bounded number of extra cells (a grain has at
 *  most 8 open neighbours and most of them are shared with the next grain over),
 *  but high enough that the front reliably jumps the gaps in a loose cloud. */
const FIREBALL_CHANCE = 0.4;
/** How far the flash hands itself on, in cells (a (2·R+1)² box). See the note in
 *  `tryDustExplosion` — the front travels through the burning air between grains,
 *  so it has to be able to cross the gaps in a dispersed cloud. */
const FRONT_REACH = 2;

/** True when a cell is something a grain falls straight through: empty, or any
 *  gas. Gases have to count — the moment the first grain goes off, the cloud is
 *  full of Fire and Smoke, and a test that read those as *support* would decide
 *  the rest of the cloud had landed and stop the chain dead in the middle of its
 *  own fireball. Liquids deliberately do NOT count: dust sinking through water
 *  is wet dust, not a suspension, and it should not go off. */
function isOpen(x: number, y: number, sim: SimContext): boolean {
  if (sim.isEmpty(x, y)) return true;
  return getMaterial(sim.get(x, y)).phase === Phase.Gas;
}

/** True when the grain at (x,y) is airborne — nothing supporting it downhill of
 *  gravity, and open air all around. Both halves matter: the support test alone
 *  would count a grain sliding down the face of a heap, and the open-air count
 *  alone would count the top grain of a one-cell tower. */
function isSuspended(x: number, y: number, sim: SimContext): boolean {
  const bx = x + sim.gravityX;
  const by = y + sim.gravityY;
  // Out of bounds counts as support: with the default `wall` border the grid
  // edge *is* the floor, so a grain resting on it is piled, not flying.
  if (!sim.inBounds(bx, by) || !isOpen(bx, by, sim)) return false;
  let open = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && isOpen(nx, ny, sim)) open++;
  }
  return open >= SUSPENDED_MIN_EMPTY;
}

/**
 * Flash a suspended dust grain, and hand the front to every suspended grain
 * touching it. Returns true if the cell went off (it is Fire now, so the caller
 * must stop); false for a grain that is piled, unlit, or both.
 *
 * The chain is deliberately deterministic rather than a `burnChance` roll — a
 * dust explosion propagates through a cloud in a blink, which is the entire
 * difference between it and the slow surface front `combustion.ts` models. It
 * stays bounded because it only ever reaches *airborne* neighbours: the front
 * dies the instant it runs into a heap, so a cloud consumes itself and nothing
 * more.
 */
export function tryDustExplosion(x: number, y: number, sim: SimContext): boolean {
  if (!isSuspended(x, y, sim)) return false;
  if (sim.getTemp(x, y) < DUST_FLASH_TEMP && !igniterAdjacent(x, y, sim)) return false;

  // Pass the front on before consuming this cell, two ways.
  //
  //  • Every *airborne* grain of the same dust within FRONT_REACH is pinned hot
  //    enough that its own turn flashes it. Piled grains are skipped outright — a
  //    cloud going off over a heap must not light the heap by this path (it can
  //    still catch the ordinary way, from the flames left behind).
  //
  //    The reach is 2 rather than the usual 8-neighbourhood on purpose, and it is
  //    the difference between the rule working and not: what burns in a dust
  //    explosion is the *air between the grains*, so the front crosses gaps that
  //    a grain-to-grain rule cannot. A cloud loose enough to be interesting has a
  //    cell or two of air between grains, and with a touching-only chain the
  //    best-dispersed cloud — the one that should go off hardest — was the one
  //    that barely burned (measured: a front that stalled with ~40% of the cloud
  //    still unlit and drifting through its own fire).
  //  • The open air immediately around it takes a lick of Fire — the fireball,
  //    and the thing that lights whatever the cloud was hanging over.
  const id = sim.get(x, y);
  for (let dy = -FRONT_REACH; dy <= FRONT_REACH; dy++) {
    for (let dx = -FRONT_REACH; dx <= FRONT_REACH; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (nid === id) {
        if (!isSuspended(nx, ny, sim)) continue;
        if (sim.getTemp(nx, ny) < DUST_FLASH_TEMP) sim.setTemp(nx, ny, DUST_FLASH_TEMP);
      } else if (nid === EMPTY && dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1) {
        if (sim.chance(FIREBALL_CHANCE)) sim.spawn(nx, ny, FIRE.id);
      }
    }
  }

  // The grain itself is gone in one flash — not a fuel cell that smoulders, the
  // way `combustion.ts` keeps a lit heap burning. In-place `set` on the cell's
  // own turn, so nothing re-processes it this tick.
  sim.set(x, y, FIRE.id);
  sim.setTemp(x, y, DUST_FLASH_TEMP_PIN);
  return true;
}
