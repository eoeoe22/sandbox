import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { igniterAdjacent } from './deflagrate';
import { FIRE } from './fire';
import { SMOKE } from './smoke';

// Rocket Candy (로켓 캔디, KNO₃ + 설탕) — the fastest-burning matter in the game
// that isn't an explosive.
//
// It is made, not painted: cold Saltpeter poured against cold Sugar grinds
// together into this (the rule lives on Sugar's `reactions` table — see
// sugar.ts). That makes it the palette's second craftable propellant, and the
// deliberate counterpart to the black-powder recipe: Sulfur + Saltpeter + Coal
// Powder gives you Gunpowder, which *detonates*, while Saltpeter + Sugar gives
// you this, which *burns* — very fast, and hugely dirty. Two recipes, one shared
// oxidizer, opposite payoffs.
//
// The single thing that makes it worth its own material is the FRONT SPEED. Real
// candy propellant deflagrates: it carries its own oxygen (that's the saltpeter),
// so the flame front doesn't have to wait for air to reach the next grain, and a
// cast grain burns down its whole length in a blink while a sugar cube of the
// same size would smoulder. Modelled here as a *chained* ignition: a burning
// grain lights every touching unlit grain outright, with no probability roll —
//
//   • 1 cell per tick from the chain, in all 8 directions, deterministically,
//   • occasionally one more, where the lick of flame it throws off lands
//     diagonally ahead of the grains and arms the cell past the front.
//
// which is some 7× the pace of Alcohol (the quickest `combustion` fuel, whose
// ~0.15/tick per-neighbour roll takes ~7 ticks to hand the front one cell along)
// and far more against the solid fuels — measured at 39 ticks to run a 40-cell
// line, against the same line in Sugar (the material it is half made of) not
// finishing inside 2000 (test/rocketcandy.ts). A poured line of candy is a fuse
// that reads as instantaneous at a glance but is still a visible travelling
// front in slow motion.
//
// Chained-but-DEFERRED is the whole trick, and it is deferred twice over:
//
//   • the grain a burning cell lights is marked moved, so it cannot take its own
//     turn until the next tick no matter where the scan currently is, and
//   • a grain that catches on its own turn (from a flame, or from radiant heat)
//     only arms its countdown — it does not burn until its *next* turn.
//
// Either one alone leaks. Without the first, a burning cell's chain walks the
// whole pile inside one scan. Without the second, the lick of Fire a burning
// grain drops into the open air beside it is itself an igniter, one cell
// diagonally ahead of the front — so the grain past the front lights, burns,
// licks another flame one further along, and the pile still goes up in a single
// frame, in whichever direction the scan happened to run. With both, the worst
// case is a bounded ~2 cells per tick and the result no longer depends on scan
// order: the same "same-tick runaway" discipline combustion.ts and reactions.ts
// are built around, paid here at the ignition step instead of with a dice roll.
//
// (Thermite went the other way and dropped its instant chain entirely, spreading
// only by conducted heat — that is what a slow cutting charge wants. A
// propellant wants the opposite, bounded to a cell or two a tick.)
//
// Being self-oxidizing has a second consequence, and it is free: water is not an
// answer to it. There is no douse branch below at all, so a lit grain keeps
// burning submerged — the same bargain Thermite makes, for the same reason. What
// *does* stop it is that the burn is over almost immediately anyway.
//
// It is not tagged `combustion`, because `tryBurn`'s economy can't express any of
// the above (its own header notes that a fuel much past burnChance 0.25 would
// need rethinking, and this is far past it). Ignition is detected the way the
// explosives and Thermite do it — scanning neighbour ids for flame, plus an
// autoignition point so radiant heat alone sets it off — which is scan-order
// independent.

// 발화점 — inherited from its sugar half (sugar.ts's AUTO_IGNITE_TEMP), which is
// the component that actually decides when the mix takes off. Well under the
// 400° at which loose Saltpeter would rather decompose on its own.
const AUTOIGNITE_TEMP = 300;
// Running temperature of a burning grain. Hotter than an ordinary fuel's 800°
// and level with Fire itself, but deliberately under Stone's 1100° and Iron's
// 1200° melt: candy propellant is a fast, smoky, dirty burn, not a cutting torch
// (that is Thermite's job, at 2800°).
const BURN_TEMP = 1000;
// Ticks a lit grain burns before it is spent. Short by design — with the front
// moving a cell a tick, a grain that lingered would leave a wide burning band
// instead of the thin travelling flash a deflagration actually looks like.
const BURN_TICKS = 5;
// Per open neighbour per tick. The exhaust: KNO₃/sucrose is notorious for the
// sheer volume of white smoke it makes, which is why the same mix doubles as a
// smoke screen in real use. Rolled *after* the flame lick, so the two never
// contend for the same cell.
const SMOKE_CHANCE = 0.5;
// Per open neighbour per tick. Lower than the smoke: enough flame to set off
// whatever the line was drawn to (Gunpowder and the other explosives trigger on
// an adjacent Fire cell) and to carry the front across a gap in the pile, without
// burying the burn in flame gas.
const FIRE_CHANCE = 0.18;

/** `aux` is the grain's whole state: 0 = unlit, 1..BURN_TICKS = the burn
 *  countdown. It rides along on every swap, so a lit grain keeps falling and
 *  piling while it burns (see updatePowder at the end of `burnInPlace`). */
const AUX_UNLIT = 0;

function updateRocketCandy(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  if (aux !== AUX_UNLIT) {
    burnInPlace(x, y, sim, aux);
    return;
  }
  // Unlit: an adjacent flame/blast/molten cell lights it, or its own temperature
  // reaches the autoignition point (radiant heat, a hot neighbour conducting in).
  // Catching only *arms* the countdown — the burn itself waits for the next tick
  // (see the header: a grain that both caught and burned in one turn would let
  // its own flame lick light the grain past it, and so on down the pile, inside
  // a single frame). It still falls this tick, carrying the armed countdown.
  if (sim.getTemp(x, y) >= AUTOIGNITE_TEMP || igniterAdjacent(x, y, sim)) {
    sim.setAux(x, y, BURN_TICKS);
  }
  updatePowder(x, y, sim);
}

function burnInPlace(x: number, y: number, sim: SimContext, timer: number): void {
  // Re-pin every tick so heat bleeding into cold neighbours can't drop the grain
  // back under its own autoignition point mid-burn.
  sim.setTemp(x, y, BURN_TEMP);

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.isEmpty(nx, ny)) {
      // Flame first, then smoke — one cell can only hold one of them, and the
      // flame is what keeps the reaction able to reach things across a gap.
      if (sim.chance(FIRE_CHANCE)) sim.spawn(nx, ny, FIRE.id);
      else if (sim.chance(SMOKE_CHANCE)) sim.spawn(nx, ny, SMOKE.id);
      continue;
    }
    // The deflagration chain: every touching unlit grain catches outright, no
    // roll. `markMoved` is what keeps it to one cell per tick — see the header.
    if (sim.get(nx, ny) === ROCKET_CANDY.id && sim.getAux(nx, ny) === AUX_UNLIT) {
      sim.setAux(nx, ny, BURN_TICKS);
      sim.markMoved(nx, ny);
    }
  }

  if (timer <= 1) {
    // Spent. The grain leaves as the exhaust it turned into, still hot: hot smoke
    // rises off the burn instead of the cell simply blinking out, and Smoke's own
    // ~37-tick life clears it without accumulating (see smoke.ts).
    //
    // Clear the countdown by hand first. `set` only scrubs aux on a transform to
    // EMPTY, so without this the fresh Smoke cell inherits this grain's leftover
    // `1`. Smoke reads no aux today, so nothing observes it — but a stale byte
    // riding a material change is the shape of bug this codebase keeps paying
    // for (Debris renders *by* aux, Clone stores a target id in it), and it is
    // one line to not leave one behind.
    sim.setAux(x, y, AUX_UNLIT);
    sim.set(x, y, SMOKE.id);
    sim.setTemp(x, y, BURN_TEMP);
    return;
  }
  sim.setAux(x, y, timer - 1);
  // A burning grain is still a powder: it keeps falling and piling, carrying its
  // countdown and its pinned heat along on the swap, so a lit stream doesn't
  // freeze in mid-air.
  updatePowder(x, y, sim);
}

export const ROCKET_CANDY = register({
  id: 149,
  name: 'Rocket Candy',
  phase: Phase.Powder,
  // Pale toffee — caramelised sugar cut with white oxidizer. Kept lighter and
  // greyer than the game's other warm browns (Amber 210/148/40, Honey 214/150/34,
  // Resin 198/120/38, Sawdust 184/146/92) so a pile of it is never mistaken for
  // one of them at chip size.
  color: rgb(222, 178, 118),
  // Between its two ingredients (Sugar 3.65, Saltpeter 4.3), which is where the
  // real mix lands too (~1.8 g/cm³ against sucrose's 1.59 and KNO₃'s 2.1).
  density: 4.0,
  // Cooked sugar clumps: it piles at a steeper angle than either loose
  // ingredient (Saltpeter 0.38).
  friction: 0.45,
  // Filed with the propellants and charges — the shelf you go to when you want
  // something to go off — next to Fuse, which is the slow answer to the same
  // question. Also listed under 불·열, because what it actually *does* is burn:
  // someone looking for something to set alight is looking for this, and that is
  // the shelf its oxidizer half (Saltpeter) sits on too. Deliberately NOT in
  // 가루 — being a powder is the least interesting thing about it.
  category: 'explosive',
  alsoIn: ['fire'],
  thermal: { conductivity: 0.3 },
  update: updateRocketCandy,
});
