import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { URANIUM } from './uranium';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { SMOKE } from './smoke';
import { FIRE } from './fire';
import { emitNuclearRay, NUCLEAR_RAY } from './nuclearray';

// Molten Uranium — a solid uranium mass past its melting point (see
// uranium.ts). Unlike Lava or Molten Metal it is deliberately *not* viscous:
// there's no flow-chance gate, so it slumps and spreads like ordinary water —
// a meltdown visibly escapes its containment instead of oozing. It's also the
// densest liquid in the game (10, above Mercury's 9), so it sinks through
// absolutely everything liquid on its way down — corium behavior.
//
// The chain reaction doesn't stop at melting; it *accelerates*: molten cells
// heat per uranium neighbor faster than solid ones did, so an uncooled pool
// keeps climbing past the melt point. Two ways back down, two ways forward:
//  • Cool it below the freeze point (water boiled off the surface still works,
//    exactly like the solid-phase reactor) and it sets back into solid
//    Uranium — the full melt ↔ freeze round trip, like Iron ↔ Molten Metal.
//  • Let it keep heating and at CRITICAL_TEMP the mass goes prompt-critical.
//
// Criticality is NOT the old instant detonation. The pool *burns*: each
// critical cell keeps flash-emitting Nuclear Rays (see nuclearray.ts) from any
// face not blocked by more fuel — a surface burn, eating inward layer by
// layer, that punches straight through rubble burying the pool — and after
// BURN_EMISSIONS emissions the spent cell burns away to a wisp of smoke. The
// rays ricochet around the world shredding whatever they cross, and any other
// uranium they strike is heated toward its own meltdown, so a small critical
// puddle sweeps the whole screen over a few seconds instead of one flash.
// Per-cell burn progress lives in `aux` (cleared if the cell refreezes).
const FREEZE_TEMP = 1400; // hysteresis below the 1500° melt point (uranium.ts)
export const CRITICAL_TEMP = 2000;
const HEAT_PER_NEIGHBOR = 3; // molten chain reaction runs hotter than solid's 1
const COOL_CHANCE = 0.12;
const COOL_AMOUNT = 25;
const IGNITE_CHANCE = 0.12;
// Per-tick chance a critical cell tries to emit. Doubled from 0.35 so a cell
// reaches its BURN_EMISSIONS quota — and burns away — in roughly half the
// ticks: the same total ray output delivered in a shorter, fiercer burst, so
// a meltdown wipes the screen and then clears out about twice as fast.
const EMIT_CHANCE = 0.7;
const BURN_EMISSIONS = 10; // rays each cell fires before it's spent fuel
const SPENT_SMOKE_CHANCE = 0.5;
// A critical cell buried in fuel can't vent a ray out of any face, so on its own
// it would never burn out — a big packed mass smoulders far too long. A cell
// with at least this many uranium neighbours (mostly surrounded) instead decays
// *internally*, so a dense clump burns from the inside as well as the surface.
const CLUMP_THRESHOLD = 6;
const CLUMP_DECAY_CHANCE = 0.4;
// A Nuclear Ray striking molten uranium advances that cell's burn by this much, so
// a beam sweeping a critical pool actively eats it away (see triggerMeltdownDecay).
const RAY_DECAY_AMOUNT = 2;
// Painted molten uranium starts above the freeze point with headroom below
// critical, so a fresh pool is stable until its own chain reaction (or the
// heat brush) pushes it over the edge.
const MOLTEN_URANIUM_TEMP = 1600;

/**
 * Advance a molten-uranium cell's meltdown burn progress (in `aux`) by `amount`.
 * When it reaches the burn quota the cell is spent — a wisp of Smoke, else it
 * clears to Empty. Returns true iff the cell was consumed this call, so the
 * caller stops touching it. Shared by the surface ray-emission burn, the clumped
 * interior decay, and Heat-Ray-triggered decay.
 */
function spendMeltdown(x: number, y: number, sim: SimContext, amount: number): boolean {
  const burned = sim.getAux(x, y) + amount;
  if (burned >= BURN_EMISSIONS) {
    if (sim.chance(SPENT_SMOKE_CHANCE)) sim.spawn(x, y, SMOKE.id);
    else sim.set(x, y, EMPTY);
    return true;
  }
  sim.setAux(x, y, burned);
  return false;
}

/**
 * A Nuclear Ray striking Molten Uranium doesn't just feed it heat — it *triggers
 * its decay*: the beam advances that cell's burn progress, so a swarm of rays
 * sweeping a critical pool actively burns it away instead of only heating it.
 * This is what keeps a big meltdown from dragging on: rays ricocheting through
 * the pool eat it from within. Called from nuclearray.ts on impact; spends the cell
 * if the quota is reached.
 */
export function triggerMeltdownDecay(sim: SimContext, x: number, y: number): void {
  spendMeltdown(x, y, sim, RAY_DECAY_AMOUNT);
}

function updateMoltenUranium(x: number, y: number, sim: SimContext): void {
  let temp = sim.getTemp(x, y);
  if (temp <= FREEZE_TEMP) {
    // Cooled enough to set back into solid fuel. Burn progress doesn't survive
    // refreezing; the in-place `set` keeps the (now low) temperature, matching
    // every other freeze in the game.
    sim.setAux(x, y, 0);
    sim.set(x, y, URANIUM.id);
    return;
  }

  let neighbors = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === URANIUM.id || nid === MOLTEN_URANIUM.id) {
      neighbors++;
    } else if (nid === WATER.id || nid === SALTWATER.id) {
      // The reactor still works after a meltdown: boiling coolant off the
      // surface is what can drag the pool back below the freeze point.
      if (sim.chance(COOL_CHANCE)) {
        sim.spawn(nx, ny, STEAM.id);
        temp -= COOL_AMOUNT;
      }
    } else if (getMaterial(nid).flammable && sim.chance(IGNITE_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }
  temp += neighbors * HEAT_PER_NEIGHBOR;
  sim.setTemp(x, y, temp);

  if (temp >= CRITICAL_TEMP) {
    // Clumped interior cells (mostly buried in fuel) can't vent a ray out of any
    // open face, so without this a big packed mass would only burn from its
    // surface inward and take far too long. A heavily-surrounded critical cell
    // instead decays internally, and the more buried it is the faster it goes
    // (amount scales with the neighbour count past the threshold) — so a dense
    // core burns out quickly rather than dragging the meltdown on.
    if (neighbors >= CLUMP_THRESHOLD && sim.chance(CLUMP_DECAY_CHANCE)) {
      if (spendMeltdown(x, y, sim, neighbors - (CLUMP_THRESHOLD - 1))) return;
    }

    if (sim.chance(EMIT_CHANCE)) {
      // Prompt-critical: fire a Nuclear Ray out of one randomly chosen face.
      // Only faces blocked by more fuel (or the indestructible Wall, or a ray
      // already in flight) can't emit — so the burn eats the pool from its
      // surface inward, but a pool buried under rubble or its own melted-rock
      // lava still blasts rays straight through whatever entombs it (the
      // emission itself vaporizes the covering cell). Without that, a critical
      // pool would smother itself: its heat melts surrounding stone into lava
      // that seals every face, and the burn would silently stall. Each emission
      // spends fuel until the cell burns away entirely.
      const [dx, dy] = DIR8[sim.randInt(8)];
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny)) {
        const nid = sim.get(nx, ny);
        const blocked =
          nid === URANIUM.id ||
          nid === MOLTEN_URANIUM.id ||
          nid === NUCLEAR_RAY.id ||
          getMaterial(nid).isWall === true;
        if (!blocked) {
          emitNuclearRay(sim, nx, ny, dx, dy);
          if (spendMeltdown(x, y, sim, 1)) return;
        }
      }
    }
  }

  // No viscosity gate (compare Lava/Molten Metal's FLOW_CHANCE): a meltdown
  // flows like ordinary water, every tick.
  updateLiquid(x, y, sim);
}

export const MOLTEN_URANIUM = register({
  id: 65,
  name: 'Molten U235',
  phase: Phase.Liquid,
  color: rgb(235, 255, 90),
  density: 10, // densest liquid in the game — sinks through even Mercury (9)
  category: '방사성',
  explosionProof: true, // 방폭 — see uranium.ts (Nuclear Ray still feeds it as before)
  thermal: { init: MOLTEN_URANIUM_TEMP, conductivity: 0.5 },
  // Glows from dull radioactive olive at the freeze point up to blazing
  // yellow-green as it approaches criticality, so how close a pool is to
  // burning is readable at a glance.
  glow: { min: FREEZE_TEMP, max: CRITICAL_TEMP, cool: rgb(110, 125, 40) },
  update: updateMoltenUranium,
});
