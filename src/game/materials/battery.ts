import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { SPARK, packSpark, conductorClass, FULL_STRENGTH } from './spark';
import { detonate } from './blast';

// Battery — the power source that makes the electricity subsystem self-running.
// A static solid that, on a fixed cadence, injects a fresh Spark into every
// `conductive` neighbor that's ready for one, so a Battery wired to a loop of
// Iron drives a pulse down it forever with no further input. Point one at a wire
// that ends in Gunpowder or TNT and you've built a repeating detonator; wire a
// ring and you've built a blinking oscillator. Each injected pulse starts at
// full strength (see spark.ts), so it runs the whole length of a metal wire and
// fades out only through a resistive medium like water.
//
// It keeps its pulse cadence in its own `aux` byte — a plain per-tick counter
// that fires and resets every PERIOD ticks. Because a conductor is briefly
// refractory right after a pulse (see spark.ts), PERIOD is set comfortably
// longer than that refractory window so each new pulse finds the wire ready.
//
// A Battery is volatile when hot: heated to EXPLODE_TEMP — a temperature an
// ordinary flame reaches easily — it detonates (thermal runaway), so setting a
// fire against a battery (or overheating it) blows it up.
const PERIOD = 12; // ticks between pulses (~0.2 s at 60 Hz, ~0.4 s at the default ×1 speed)
const EXPLODE_TEMP = 200; // heated to this it goes off — well within a normal flame's reach
const BLAST_RADIUS = 6;

function updateBattery(x: number, y: number, sim: SimContext): void {
  // Thermal runaway: an overheated battery detonates. Reachable by an ordinary
  // flame's conducted heat, not just extreme temperatures.
  if (sim.getTemp(x, y) >= EXPLODE_TEMP) {
    detonate(sim, x, y, BLAST_RADIUS);
    return;
  }

  const t = sim.getAux(x, y);
  if (t < PERIOD - 1) {
    sim.setAux(x, y, t + 1);
    return;
  }
  sim.setAux(x, y, 0);

  // Fire: energize each ready conductor neighbor at full strength, carrying its
  // heat across and packing the conductor class + strength into the spark's aux.
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
      sim.setTemp(nx, ny, heat);
      sim.setAux(nx, ny, packSpark(FULL_STRENGTH, cls));
    }
  }
}

export const BATTERY = register({
  id: 39,
  name: 'Battery',
  phase: Phase.Solid,
  color: rgb(225, 195, 70),
  density: 1000,
  category: '전기',
  thermal: { conductivity: 0.3 },
  update: updateBattery,
});
