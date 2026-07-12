import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { BLAST, detonate, type DetonateOptions } from './blast';

// Depth charge (심도폭뢰) — the underwater special that flips water from an
// explosion's killjoy into its star. A dense canister that *sinks* through water
// and, once it's been submerged deep enough, fires a depth fuze: the blast
// doesn't erase the surrounding water, it flashes it to a hot steam bubble that
// expands and punches a column up through the surface. Above water it's an
// ordinary contact charge (flame/blast/heat sets it off); the magic only happens
// when it goes deep. Rides the `detonate` onCell seam (blast.ts): water → hot
// Steam, everything else → the normal crater.
const REACH = 10;
const AUTOIGNITE_TEMP = 240;
// Ticks fully submerged before the depth fuze fires — long enough that it has to
// actually sink to depth first, so a charge dropped in a shallow puddle never
// arms (it needs to be surrounded by water on the way down).
const ARM_TICKS = 45;
// How many of the 8 neighbors must be water to count as "underwater". ≥5 means
// it's genuinely inside a body of water, not just splashed at the surface.
const SUBMERGED_NEIGHBORS = 5;
// Temperature the flashed steam starts at — hot and buoyant, so the bubble
// expands and drives the water column up before it cools and rains back.
const STEAM_TEMP = 260;

function isWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

/** Per-cell rule for a depth-charge blast — see DetonateOptions.onCell. */
function depthCell(sim: SimContext, x: number, y: number, prevId: number): boolean {
  if (isWater(prevId)) {
    // The shock flashes water to a hot steam bubble instead of erasing it — the
    // expanding steam is what makes the underwater plume and surface column.
    sim.spawn(x, y, STEAM.id);
    sim.setTemp(x, y, STEAM_TEMP);
    return true;
  }
  return false; // seabed / hull / the charge itself: the ordinary crater flash
}

// rimEmberChance 0: the star of an underwater blast is the steam plume, not a
// spray of embers (which would quench in the water anyway) — so it throws none.
const DEPTH_OPTS: DetonateOptions = { reach: REACH, onCell: depthCell, rimEmberChance: 0 };

function updateDepthCharge(x: number, y: number, sim: SimContext): void {
  let trigger = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  let waterCount = 0;
  if (!trigger) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (
        nid === FIRE.id ||
        nid === LAVA.id ||
        nid === BLUE_FLAME.id ||
        nid === BLAST.id ||
        nid === MOLTEN_METAL.id ||
        nid === MOLTEN_GLASS.id
      ) {
        trigger = true;
        break;
      }
      if (isWater(nid)) waterCount++;
    }
  }

  if (trigger) {
    detonate(sim, x, y, 0, DEPTH_OPTS);
    return;
  }

  // Depth fuze: once it's surrounded by water, a submersion counter (aux) climbs
  // each tick; when it's been under long enough it fires. Lifted back out before
  // arming resets the counter.
  if (waterCount >= SUBMERGED_NEIGHBORS) {
    const armed = sim.getAux(x, y) + 1;
    if (armed >= ARM_TICKS) {
      detonate(sim, x, y, 0, DEPTH_OPTS);
      return;
    }
    sim.setAux(x, y, armed);
  } else if (sim.getAux(x, y) !== 0) {
    sim.setAux(x, y, 0);
  }

  // A dense canister: it sinks through water (and lighter powders) toward the
  // depths, carrying its submersion counter along on each swap.
  updatePowder(x, y, sim);
}

export const DEPTH_CHARGE = register({
  id: 76,
  name: 'Depth Charge',
  phase: Phase.Powder,
  color: rgb(40, 72, 96), // deep naval blue
  density: 6, // heavier than water (3) and sand (5) → sinks to the bottom
  explosive: true,
  blastRadius: REACH,
  category: '폭발',
  thermal: { conductivity: 0.3 },
  update: updateDepthCharge,
});
