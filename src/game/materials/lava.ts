import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { STONE } from './stone';
import { FIRE } from './fire';

// Liquid: flows like water but gated behind a per-tick probability so it
// visibly moves slower/thicker. Each tick: a Water/Saltwater neighbor has a
// chance to react (self -> Stone, that neighbor -> Steam) — probabilistic
// rather than deterministic so a lava/water interface crusts over gradually
// across several ticks instead of solidifying in one frame. A `flammable`
// neighbor has a separate, higher chance to ignite (single point-contact
// reactions read better as fast/dramatic, unlike Fire's own slow spread).
const WATER_REACT_CHANCE = 0.4;
const IGNITE_CHANCE = 0.15;
const FLOW_CHANCE = 0.15;

function updateLava(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if ((nid === WATER.id || nid === SALTWATER.id) && sim.chance(WATER_REACT_CHANCE)) {
      sim.spawn(nx, ny, STEAM.id);
      sim.set(x, y, STONE.id);
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

  // No `return` above (intentionally — lets several neighbors ignite in one
  // tick), so a just-ignited Fire neighbor is live grid state by the time we
  // reach here: if the flow gate fires and picks that direction, Lava (denser
  // than Fire) can immediately swap into the cell it just ignited, pushing
  // the Fire out to Lava's old position. Both cells end up `moved`, so this
  // isn't a same-tick runaway — just a legitimate density-sorted swap that
  // makes ignition-then-displacement visually chase itself forward.
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const LAVA = register({
  id: 10,
  name: 'Lava',
  phase: Phase.Liquid,
  color: rgb(220, 70, 20),
  density: 4.5,
  update: updateLava,
});
