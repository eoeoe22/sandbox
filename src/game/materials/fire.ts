import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP, FIRE_SMOKE_CHANCE } from '../config';
import { WATER_SURFACE_CAP, burningPetroleumAdjacent } from './water';
import { SMOKE } from './smoke';
import { coolNeighbourWater, isDousingAgent, spendDousingAgent } from './suppress';

// Gas: rises/flickers like the default gas behavior. Each tick: the first
// water-family neighbour (Water/Saltwater/Sugar Water/Snow/Ice) extinguishes it —
// self -> Empty and that *one* neighbour is spent, deterministically ("물 인접 시
// 즉시 소화"); otherwise any `flammable`
// neighbor has a low per-tick chance to ignite (spread is deliberately slow —
// see comment on IGNITE_CHANCE); otherwise a small chance to burn out to
// Smoke each tick.
const IGNITE_CHANCE = 0.04; // ~50% ignited after ~17 ticks (~0.3s@60Hz) — a
// visible crawl, not an instant flash. A value like 0.35 ignites within 1-2
// ticks (~30ms), which reads as instantaneous and defeats a watchable spread.
const BURNOUT_CHANCE = 0.1; // flames snuff quickly (was 0.02) — ~10-tick life
// (~0.17s@60Hz) so a fire front flares and vanishes almost as fast as it appears.

function updateFire(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (isDousingAgent(nid)) {
      // A wisp of flame wreathing off a burning oil slick (burnStep's
      // WREATH_CHANCE, combustion.ts) sits right at the oil/water interface;
      // without this it would douse itself and flash-steam the very water the
      // slick floats on the instant it drifted there, undoing burnStep's
      // "burning petroleum doesn't steam the water below it" protection. Skip
      // dousing against water that's already shielded by adjacent burning
      // petroleum (see burningPetroleumAdjacent) — every other water contact
      // still extinguishes normally.
      if (burningPetroleumAdjacent(nx, ny, sim)) {
        // Also re-cap it, the same as burnStep does from the fuel's own side —
        // this Fire cell is just as hot (1000° vs the fuel's 800°) and touches
        // the water directly too, so leaving it unclamped would let it conduct
        // the water past boiling on its own.
        sim.setTemp(nx, ny, Math.min(sim.getTemp(nx, ny), WATER_SURFACE_CAP));
        continue;
      }
      // One flame costs exactly *one* cell of water, and the flame dies with it.
      // This loop used to run to completion, steaming every water neighbour it
      // had — up to eight cells spent on a single lick of flame. Since a burning
      // body re-wreaths flame for free every tick (combustion.ts WREATH_CHANCE)
      // while the water poured on it is finite, that 8:1 exchange was the single
      // largest reason water never put anything out: measured on a burning wood
      // bed, 79 of 80 poured water cells died to flame gas and only 21 contacts
      // ever reached the fuel. Spending 1:1 and stopping is what lets a poured
      // column survive its way down to the fuel.
      spendDousingAgent(nx, ny, sim);
      sim.set(x, y, EMPTY);
      // The flame's heat went into the cell it just flashed off, so the rest of
      // the water it was touching must not boil on it too. Without this the
      // exchange is only nominally 1:1 — a 1000° flame heats every water cell
      // around it past boiling in the same tick's diffusion pass, and the two or
      // three sitting where the scan reaches them *after* the flame is already
      // gone see no flame to shield them and evaporate anyway.
      coolNeighbourWater(x, y, sim);
      return;
    }
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (getMaterial(nid).flammable && sim.chance(IGNITE_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }

  if (sim.chance(BURNOUT_CHANCE)) {
    // Burning out means the heat is spent, so drop to ambient (and only
    // sometimes leave Smoke behind — mirrors Steam condensing). This is the
    // 'high' (unthinned) rate; the SimContext smoke-level seam thins it further
    // at 'medium'/'off', so the net smoke on screen tracks the chosen level.
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, sim.chance(FIRE_SMOKE_CHANCE) ? SMOKE.id : EMPTY);
    return;
  }
  updateGas(x, y, sim);
}

export const FIRE = register({
  id: 9,
  name: 'Fire',
  phase: Phase.Gas,
  color: rgb(255, 120, 40),
  density: 1,
  category: 'fire',
  // Burns hot, so it heats what it touches. Heat exchange across any interface is
  // gated by min(두 전도도), so Fire's own conductivity is the ceiling on how fast
  // it warms *anything* — at the old 0.1 it was the shared bottleneck that made
  // heating a solid container (Iron/Diamond/Stone, all far more conductive) crawl
  // no matter which solid you picked, since min(0.1, 0.85) = 0.1 clamps it. Set to
  // the material default (0.3) so a flame actually drives heat into what it licks
  // (e.g. melting an ore charge through a crucible wall in a sane time). This only
  // speeds the *rate*; Fire still can't push anything past its own ~1000°, so it
  // still won't melt Stone (1100°) — that stays Blue Flame/Lava's job.
  thermal: { init: 1000, conductivity: 0.3 },
  update: updateFire,
});
