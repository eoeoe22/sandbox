import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { BLUE_FLAME } from './blueflame';
import { chillThroughFuel, CRYO_CHILL, suppressible } from './suppress';

// Liquid Nitrogen — the cryogenic mirror of Lava: placed at a brutal -196° and,
// like isolated Lava never cooling, an isolated pool never warms (air conducts
// no heat), so it holds its chill until something warmer bridges heat into it.
// It's a *cold sink* the way Lava/Fire are heat sources: its cold conducts into
// neighbors and, via the ordinary heat system, freezes Water into Snow and Ice
// and flash-cools whatever it touches. Reaching anything hot, it also instantly
// snuffs open flame — the fire's heat flash-boils the LN₂ away. Warmed past its
// boiling point it likewise boils off, evaporating into thin air.
//
// Lighter than water (density 2.5), so it floats on top of a pool it's busy
// freezing from above.
const LN2_BOIL_TEMP = -100;
// A fuel neighbour this warm is worth spending a cell on — the same "trigger on
// warm, cool the burning" split CO₂ and Soda use, so LN₂ keeps reaching into a
// mass whose chilled crust is being rewarmed by the core behind it.
const CRYO_TRIGGER_TEMP = 150;

function updateLiquidNitrogen(x: number, y: number, sim: SimContext): void {
  // Firefighting comes *before* the boil-off check, deliberately. A cryogen
  // poured onto a fire is over its own -100° boiling point long before it lands,
  // so checking that first meant every cell of it evaporated in mid-air and a
  // whole dumped flask achieved nothing — the cell was deleted by the
  // temperature system for the very heat it was there to absorb. Doing the work
  // first means a cell that actually reaches the fire spends itself on it; one
  // that reaches nothing still boils away on the line below.
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === FIRE.id || nid === BLUE_FLAME.id) {
      // Snuff the flame and flash-boil this cell away absorbing its heat.
      sim.set(nx, ny, EMPTY);
      sim.set(x, y, EMPTY);
      return;
    }
    // Reaching the *fuel* is what actually ends a fire — a burning cell is fuel
    // pinned hot that re-wreaths flame every tick, so killing licks one at a time
    // is a race LN₂ loses while spending itself 1:1 (see suppress.ts). Dump it on
    // a coal bed and its cold now sinks in as deep as CO₂'s, which is fair: it is
    // by far the coldest thing in the box and conducts that cold well. The price
    // is that the cell flash-boils away doing it, so LN₂ is a one-shot dump
    // rather than a blanket that keeps working — and CLASS-A only, because a
    // cryogen on a metal fire is no better than water.
    if (suppressible(nid, CRYO_CHILL) && sim.getTemp(nx, ny) >= CRYO_TRIGGER_TEMP) {
      chillThroughFuel(nx, ny, sim, CRYO_CHILL);
      sim.set(x, y, EMPTY);
      return;
    }
  }

  if (sim.getTemp(x, y) >= LN2_BOIL_TEMP) {
    // Warmed enough to boil off with no fire to spend itself on — evaporates
    // away into the air.
    sim.set(x, y, EMPTY);
    return;
  }

  updateLiquid(x, y, sim);
}

export const LIQUID_NITROGEN = register({
  id: 33,
  name: 'Liquid N₂',
  phase: Phase.Liquid,
  color: rgb(200, 232, 240),
  density: 2.5,
  category: 'cooling',
  // Conducts its cold readily, so it acts as a real cold sink like Water/Ice.
  thermal: { init: -196, conductivity: 0.6 },
  update: updateLiquidNitrogen,
});
