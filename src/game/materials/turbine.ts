import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';
import { SPARK, packSpark, conductorClass, FULL_STRENGTH } from './spark';

// Turbine — a steam-driven generator. Like the Mesh it's a porous solid that
// fluids pass straight through via the 겹침 overlap layer (see Grid.overlay),
// and while a puff of *Steam* is blowing through the blades it injects a fresh
// Spark into each ready conductive neighbor — exactly the pulse a Battery
// emits, except the power comes from the steam flow rather than a fixed
// cadence. Boil water beneath a turbine and wire its output into a circuit and
// you've built a steam power plant: heat → steam → turbine → electricity.
// Condensed water drains back down through it (it passes liquids too), so a
// sealed boiler loop can keep the pulses coming.

/** Inject a full-strength Spark into every ready conductive neighbor — the same
 *  hand-off a Battery does, but triggered by steam passing through. */
function energize(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (getMaterial(nid).conductive && sim.getAux(nx, ny) === 0) {
      const cls = conductorClass(nid);
      if (cls === 0) continue;
      const heat = sim.getTemp(nx, ny);
      sim.spawn(nx, ny, SPARK.id);
      sim.setTemp(nx, ny, heat); // carry the wire's heat across the spawned spark
      sim.setAux(nx, ny, packSpark(FULL_STRENGTH, cls));
    }
  }
}

function updateTurbine(x: number, y: number, sim: SimContext): void {
  // Steam in the 겹침 slot is steam mid-passage through the blades — it blew in
  // from a neighbor and will bubble on out within a tick or two. Make power
  // while it's inside; each neighbor's post-spark refractory keeps the repeated
  // pulses from stacking into a runaway.
  if (sim.getOverlay(x, y) === STEAM.id) energize(x, y, sim);
}

export const TURBINE = register({
  id: 84,
  name: 'Turbine',
  phase: Phase.Solid,
  color: rgb(150, 160, 172),
  density: 1000,
  category: '전기',
  // Porous like the Mesh — fluids (and its working steam) pass through any
  // thickness via the 겹침 overlap layer.
  porous: true,
  thermal: { conductivity: 0.5 },
  update: updateTurbine,
});
