import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { ASH } from './ash';
import { CATALYST } from './catalyst';
import { POLYETHYLENE, CHAIN_GENERATIONS } from './polyethylene';
import { igniterAdjacent } from './deflagrate';

// Ethylene (에틸렌) — the monomer, and the middle link of the plastics line:
// cracked off petroleum vapour on a catalyst bed (see petroleumvapor.ts), then
// polymerized on that same catalyst into Polyethylene resin.
//
// Both halves of the line run on the one bed, and what separates them is
// temperature — but only on the polymerization side. Cracking has no thermal
// condition at all; polymerization has a 40~200° window. So a bed that is too
// hot still cracks and simply stops setting, and monomer piles up as gas until
// the bed is cooled. The player's job is therefore not to build a furnace and a
// fridge at once (the old design, which asked for 850° and was unreachable —
// see petroleumvapor.ts for the measurements that killed it); it is to keep the
// bed cool enough to convert what it is already making.
//
// The staging that used to need a quench stage now falls out of the gradient on
// its own: vapour boiled off a 260° pool cracks into 260° ethylene, which is
// over the ceiling, so it drifts and cools before it sets — usually on a cooler
// part of the same bed.
//
// --- Why it doesn't just burn on a hot bed -----------------------------------
// Ethylene has NO autoignition point at all — unlike LPG (400°) it will sit in
// a 1000° sealed vessel indefinitely without catching. That's deliberate and it
// is also the honest reading: a cracker is an oxygen-free tube, and what it does
// to hydrocarbons is crack them, not burn them. The danger is still fully there,
// it's just gated on *contact*: a flame, lava or molten metal touching the cloud
// flashes it over at once, cell to cell, the same deflagration LPG does (shared
// igniter roster in deflagrate.ts). Vent your reactor into an open flame and the
// whole cloud goes up; keep it sealed and it's inert.
//
// What overheating does instead is COKE it: past COKE_TEMP the monomer breaks
// down to sooty carbon (Ash) and the batch is simply lost. Nothing in the line
// needs that much heat any more, so coking is no longer a working-band ceiling
// the player has to respect — it is what happens if you park a cloud of monomer
// in a smelter, and the penalty is a dead loss rather than an explosion.
//
// --- Polymerization ----------------------------------------------------------
// A cell touching a Catalyst face (or an active resin grain, see below) and
// sitting inside the polymerization window converts itself, in place, into a
// grain of Polyethylene powder. The window's ceiling is the whole game: the
// reaction is strongly EXOTHERMIC, so a running bed heats itself and everything
// around it, and left alone it walks its own temperature straight past the
// ceiling and stops. It isn't a runaway explosion — it's a stall. Cool it (a
// water jacket parks the reactor at water's 100° boiling point, dead centre of
// the window) and it restarts, which in practice makes an uncooled bed pulse:
// produce, overheat, stall, cool, produce. Heat removal *is* the gameplay, the
// same way it's the engineering problem in a real PE reactor.
//
// The floor of the window (POLY_MIN_TEMP, just above the 20° ambient) is a much
// lighter touch: it keeps a frozen cloud inert, but because the reaction is
// exothermic, once a bed catches it holds itself above the floor with no help.
// Freshly painted ethylene starts at 60° — inside the window — so a player can
// drop catalyst and ethylene side by side straight from the palette and watch
// resin grow, without first having to build the whole refinery upstream.
const COKE_TEMP = 1250;
const POLY_MIN_TEMP = 40;
const POLY_MAX_TEMP = 200;

// Per-tick chance to polymerize on a catalyst face, and (lower) on an active
// resin grain — growth is fastest right at the bed and tapers off as the chain
// runs away from it.
const CATALYST_CHANCE = 0.15;
const CHAIN_CHANCE = 0.06;

// Heat of polymerization, in degrees dumped by each grain formed: onto the new
// grain itself, and a smaller share onto each non-empty neighbour (Empty is a
// perfect insulator in this engine, so heating air would do nothing).
//
// Sized by measurement, not taste. There are two things that can stop a bed —
// the exotherm walking it out of its window, and the bed simply burying its own
// catalyst under resin — and the exotherm has to be the one that bites FIRST,
// or cooling is decorative and the whole challenge collapses into "wait". At
// half these values a sealed 14×10 test reactor stalled on burial at 70 grains
// with its gas still at 187°, and cooling it did nothing; at these values it
// stalls thermally well before that and restarts the moment heat is pulled out.
// Still far under Polyethylene's 380° autoignition, so a stalling reactor gets
// hot, never alight.
const POLY_HEAT = 80;
const POLY_HEAT_NEIGHBOR = 40;

/** Spread the exotherm of one newly formed grain. Skips `packedTemp` materials
 *  (Ember, Blast, Bomblet, Debris, Napalm Gel, Firework Star, Nuclear/Heat Ray):
 *  their `temp` is packed flight bookkeeping, not a reading, so adding degrees
 *  to it would corrupt them. */
function releaseHeat(x: number, y: number, sim: SimContext): void {
  sim.setTemp(x, y, sim.getTemp(x, y) + POLY_HEAT);
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny) || sim.isEmpty(nx, ny)) continue;
    if (getMaterial(sim.get(nx, ny)).packedTemp) continue;
    sim.setTemp(nx, ny, sim.getTemp(nx, ny) + POLY_HEAT_NEIGHBOR);
  }
}

/**
 * Try to convert this cell to a grain of resin. Returns true only if it did (the
 * caller must then stop — the cell is powder now, not gas to drift).
 *
 * A catalyst face always wins over a resin neighbour: it seeds a full-strength
 * chain and it does so on the higher per-tick chance, so growth stays anchored
 * to and fastest at the bed.
 */
function tryPolymerize(x: number, y: number, sim: SimContext): boolean {
  let onCatalyst = false;
  let chainGen = -1; // -1 = no polymerization site touching this cell
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (id === CATALYST.id) {
      onCatalyst = true;
      break;
    }
    if (id === POLYETHYLENE.id) {
      // Defensive clamp on the generation read. No live mechanic is known to
      // produce an out-of-range aux here — a grain flung by a blast rides as
      // Debris (a different id, so this branch never sees it) and lands via
      // `sim.spawn`, which zeroes aux — but a hand-edited save, or any future
      // system that writes aux without gating on the cell's id, would hand us
      // an arbitrary number, and an unclamped generation count seeds a chain
      // deep enough to convert a whole cloud. One `min` buys that off.
      const g = Math.min(sim.getAux(nx, ny), CHAIN_GENERATIONS);
      if (g >= 1 && g - 1 > chainGen) chainGen = g - 1;
    }
  }
  if (onCatalyst) chainGen = CHAIN_GENERATIONS;
  else if (chainGen < 0) return false;

  if (!sim.chance(onCatalyst ? CATALYST_CHANCE : CHAIN_CHANCE)) return false;

  // In-place `set` keeps the cell's temperature, so the fresh grain carries the
  // reactor's heat and the exotherm piles on top of it rather than resetting it.
  sim.set(x, y, POLYETHYLENE.id);
  sim.setAux(x, y, chainGen);
  releaseHeat(x, y, sim);
  return true;
}

function updateEthylene(x: number, y: number, sim: SimContext): void {
  // Flame/melt contact flashes the cloud over, cell to cell — a deflagration
  // front, not a detonation. `spawn` seeds the cell at Fire's own temperature
  // and marks it moved so it isn't reprocessed this tick.
  if (igniterAdjacent(x, y, sim)) {
    sim.spawn(x, y, FIRE.id);
    return;
  }
  const t = sim.getTemp(x, y);
  if (t >= COKE_TEMP) {
    // Over-fired: the monomer breaks down to sooty carbon and the batch is lost.
    sim.set(x, y, ASH.id);
    return;
  }
  if (t >= POLY_MIN_TEMP && t <= POLY_MAX_TEMP && tryPolymerize(x, y, sim)) return;
  updateGas(x, y, sim);
}

export const ETHYLENE = register({
  id: 139,
  name: 'Ethylene',
  phase: Phase.Gas,
  color: rgb(170, 205, 200),
  // Between LPG (0.8) and Petroleum Vapor (1.2), so in a still's headspace the
  // gas cut still races above it and the raw fume still settles below it.
  density: 1.0,
  category: 'polymer',
  // Starts inside the polymerization window so a palette-painted cloud reacts on
  // a catalyst immediately (see the note above); conducts a little better than
  // the other petroleum gases so a cracked charge can actually be quenched
  // against a cold wall in reasonable time.
  thermal: { init: 60, conductivity: 0.15 },
  update: updateEthylene,
});
