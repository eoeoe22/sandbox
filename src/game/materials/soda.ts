import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { FIRE } from './fire';
import { ACID } from './acid';
import { ACID_VAPOR } from './acidvapor';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';

// Soda (베이킹소다, NaHCO₃) — the world's powder fire extinguisher and acid
// neutralizer. Falls and piles like salt, but instead of dissolving it *reacts*:
//
//  • Fire suppression: adjacent Fire is snuffed outright (like water, but dry),
//    and a *burning* fuel cell next to it is cooled back below its ignition
//    band — so dumping soda on a burning oil slick or wood pile actually puts
//    the fire out instead of only killing the visible flames. Each tick of
//    firefighting has a chance to spend the grain (it decomposes doing the
//    work), fizzing away as a puff of Steam — a pile smothers a blaze but
//    visibly shrinks doing it.
//  • Acid neutralization: an Acid neighbor is converted to Saltwater — the real
//    reaction's products, salt + water, in one existing material — with a fizzy
//    puff of gas, consuming the grain (one grain neutralizes one acid cell).
//    Acid Vapor is scrubbed from the air the same way.
//  • Heat decomposition: held past DECOMPOSE_TEMP it breaks down and fizzes
//    away as Steam, so soda left baking on hot stone or lava boils off rather
//    than sitting there fireproof forever. Crucially, decomposition is
//    *endothermic*: a grain that actually did firefighting work this tick
//    absorbs the heat it soaked up (its temperature resets to ambient), so the
//    powder survives contact with the very flames it's smothering instead of
//    flashing off before it can act — that heat-soak IS how a real dry-chem
//    extinguisher works.
const DECOMPOSE_TEMP = 150;
// Decomposition is a per-tick chance, not instant, so a pile subjected to heat
// visibly fizzes away front-first instead of vanishing in one frame.
const DECOMPOSE_CHANCE = 0.3;
// Per-tick chance an acid neighbor is neutralized. Modest so the fizzing front
// crawls visibly along the soda/acid interface instead of flashing over.
const NEUTRALIZE_CHANCE = 0.15;
// A burning fuel cell (see combustion.ts: burning pins at 800°) adjacent to
// soda is cooled back to this per-tick chance — high, so a coating of soda
// reliably beats the fuel's re-ignition rolls and the fire actually dies.
const SMOTHER_CHANCE = 0.5;
// Any neighbor this hot is treated as "on fire" for smothering purposes: above
// every fuel's autoignition point (highest is Coal at 580) but safely below
// the burning pin (800), so it catches burning cells without touching merely
// warm material.
const SMOTHER_TEMP = 600;
// Per tick in which the grain did any firefighting, the chance it is spent.
// Low: an extinguisher grain kills dozens of flame licks before it's used up —
// wreathing fire respawns every tick from each burning fuel cell (see
// combustion.ts), so a grain that died after a handful of kills would lose the
// whack-a-mole race and a whole dumped pile would vanish before the smother
// (cooling the fuel itself) could win the fire.
const SPEND_CHANCE = 0.03;

/** Fizz this cell away as a puff of Steam (spawn gives it Steam's own hot
 *  starting temperature, so the puff actually rises instead of instantly
 *  condensing back to a droplet). */
function fizzAway(x: number, y: number, sim: SimContext): void {
  sim.spawn(x, y, STEAM.id);
}

function updateSoda(x: number, y: number, sim: SimContext): void {
  // Held past decomposition → breaks down, fizzing off as gas.
  if (sim.getTemp(x, y) >= DECOMPOSE_TEMP && sim.chance(DECOMPOSE_CHANCE)) {
    fizzAway(x, y, sim);
    return;
  }

  // Acid neutralization: acid → saltwater (salt + water, the real products),
  // acid vapor → scrubbed to nothing. Either way this grain is consumed.
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === ACID.id && sim.chance(NEUTRALIZE_CHANCE)) {
      sim.spawn(nx, ny, SALTWATER.id);
      fizzAway(x, y, sim);
      return;
    }
    if (nid === ACID_VAPOR.id && sim.chance(NEUTRALIZE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      fizzAway(x, y, sim);
      return;
    }
  }

  // Fire suppression: snuff adjacent flames outright and cool any burning fuel
  // cell back out of its ignition band (see combustion.ts — a burning fuel is
  // fuel pinned hot, so cooling it *is* putting it out).
  let fought = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === FIRE.id) {
      sim.set(nx, ny, EMPTY);
      fought = true;
    } else if (
      nid !== EMPTY &&
      getMaterial(nid).combustible &&
      sim.getTemp(nx, ny) >= SMOTHER_TEMP &&
      sim.chance(SMOTHER_CHANCE)
    ) {
      sim.setTemp(nx, ny, AMBIENT_TEMP);
      fought = true;
    }
  }
  if (fought) {
    // Endothermic decomposition: the grain absorbs the heat it soaked up doing
    // the work, so active firefighting doesn't cook it past DECOMPOSE_TEMP —
    // it's spent by the SPEND_CHANCE roll below instead of by its own success.
    sim.setTemp(x, y, AMBIENT_TEMP);
    if (sim.chance(SPEND_CHANCE)) {
      fizzAway(x, y, sim);
      return;
    }
  }

  updatePowder(x, y, sim);
}

export const SODA = register({
  id: 80,
  name: 'Soda',
  phase: Phase.Powder,
  color: rgb(244, 247, 252),
  // Same weight class as Salt: sinks through water and settles.
  density: 5,
  thermal: { conductivity: 0.35 },
  update: updateSoda,
});
