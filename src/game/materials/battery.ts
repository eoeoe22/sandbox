import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { SPARK, packSpark, conductorClass, FULL_STRENGTH, tryArcExplosive } from './spark';
import { FIRE } from './fire';
import { detonate } from './blast';
import { WOOFER, wooferBodyPulse } from './woofer';
import { FAN, energizeFanBody } from './fan';

// Lithium Battery — the power source that makes the electricity subsystem
// self-running (the volatile chemistry; see lfpbattery.ts for the safe one).
// A static solid that, on a fixed cadence, injects a fresh Spark into every
// `conductive` neighbor that's ready for one, so a Battery wired to a loop of
// Iron drives a pulse down it forever with no further input. Point one at a wire
// that ends in Gunpowder or TNT and you've built a repeating detonator; wire a
// ring and you've built a blinking oscillator. Each injected pulse starts at
// full strength (see spark.ts), so it runs the whole length of a metal wire and
// fades out only through a resistive medium like water.
//
// It keeps its pulse cadence in its own `aux` byte — a plain per-tick counter
// (0..PULSE_PERIOD-1). Because a conductor is briefly refractory right after a pulse
// (see spark.ts), PULSE_PERIOD is set comfortably longer than that refractory window
// so each new pulse finds the wire ready.
//
// A Battery is volatile when hot: heated to OVERHEAT_TEMP — a temperature an
// ordinary flame reaches easily — it goes into **thermal runaway**: it first
// *catches fire and burns* for a short while (wreathing itself in flame), then
// **detonates**. Once runaway starts it is committed — tracked by `aux` climbing
// into the BURN_BASE band (so it survives the fire drifting off or the battery
// briefly cooling), and it always follows through to the blast.
/** Ticks between pulses (~0.2 s at 60 Hz, ~0.4 s at the default ×1 speed).
 *  Shared by both battery chemistries (see lfpbattery.ts). */
export const PULSE_PERIOD = 12;
const OVERHEAT_TEMP = 200; // heated to this it ignites — well within a normal flame's reach
const BLAST_RADIUS = 6;
// `aux >= BURN_BASE` marks a battery already in runaway; (aux - BURN_BASE) is how
// many ticks it has been burning. BURN_BASE sits well above the 0..PULSE_PERIOD-1
// cadence range so the two uses of `aux` never collide, and BURN_BASE+BURN_TICKS
// stays within a Uint8.
const BURN_BASE = 100;
const BURN_TICKS = 45; // burn ~0.75 s (60 Hz) / ~1.5 s (30 Hz) before it blows
const BURN_WREATH_CHANCE = 0.35; // per open neighbor per tick — the visible fire
// Passive self-cooling (heat sink / protection circuit): each tick below the
// runaway threshold, the battery sheds this fraction of its excess over
// ambient. Far too weak to matter against direct flame (a fire pours in
// ~60°/tick vs ~4°/tick shed near the threshold — arson and detonator builds
// are untouched), but it buys real headroom against *slow conducted creep*,
// like the Joule heat of a Nichrome element seeping back down its own leads:
// a battery driving a heater shouldn't cook itself in seconds through its own
// wiring, though sustained overdrive can still push it over eventually.
const SELF_COOL_RATE = 0.025;

function updateBattery(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const runaway = aux >= BURN_BASE;

  if (runaway || sim.getTemp(x, y) >= OVERHEAT_TEMP) {
    // Thermal runaway: burn first (wreathe flame in the open air around it),
    // then detonate once it has burned long enough.
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny) && sim.chance(BURN_WREATH_CHANCE)) {
        sim.spawn(nx, ny, FIRE.id);
      }
    }
    const elapsed = runaway ? aux - BURN_BASE : 0;
    if (elapsed + 1 >= BURN_TICKS) {
      detonate(sim, x, y, BLAST_RADIUS);
      return;
    }
    sim.setAux(x, y, BURN_BASE + elapsed + 1);
    return;
  }

  // Not in runaway: shed a little heat (see SELF_COOL_RATE).
  const temp = sim.getTemp(x, y);
  if (temp > AMBIENT_TEMP) {
    sim.setTemp(x, y, temp - (temp - AMBIENT_TEMP) * SELF_COOL_RATE);
  }

  if (aux < PULSE_PERIOD - 1) {
    sim.setAux(x, y, aux + 1);
    return;
  }
  sim.setAux(x, y, 0);
  injectPulses(x, y, sim);
}

/**
 * Energize each ready conductor neighbor at full strength, carrying its heat
 * across and packing the conductor class + strength into the spark's aux — one
 * power-source "beat". Shared by both battery chemistries (Lithium here, LFP in
 * lfpbattery.ts), which differ only in how they respond to heat.
 */
export function injectPulses(x: number, y: number, sim: SimContext): void {
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
    } else if (nid === FAN.id) {
      // Direct contact (배터리 직접 연결), no wire needed: a Fan isn't `conductive`
      // either (it's a one-way "outside → inside" sink like the Woofer — see
      // fan.ts), so a battery flush against a fan face powers the whole connected
      // fan body here by id, exactly like the Woofer special-case below.
      energizeFanBody(sim, nx, ny);
    } else if (nid === WOOFER.id) {
      // Direct contact (배터리 직접 연결), no wire needed: a Woofer isn't a
      // `conductive` material (see woofer.ts's design note — it's a one-way
      // sink, not a wire), so it never reaches the branch above. Special-cased
      // here exactly like the same id-check in spark.ts's arc phase, for the
      // case where the appliance is plugged straight into the battery instead
      // of reached through a relay of ordinary conductors.
      wooferBodyPulse(sim, nx, ny);
    } else {
      // Same direct-contact case for an explosive charge (C4, TNT, Gunpowder,
      // …): none of them are `conductive` either, so a charge plugged straight
      // into the battery (no wire in between) would otherwise never see the
      // arc a relayed Spark gives it in spark.ts's own arc phase. Every
      // terminal gets its own independent beat here (unlike a single
      // travelling Spark, which caps itself to one arc per tick), so a battery
      // wired flush against charges on several faces at once sets off each of
      // them.
      tryArcExplosive(sim, nx, ny, nid);
    }
  }
}

export const BATTERY = register({
  id: 39,
  name: 'Lithium Battery',
  phase: Phase.Solid,
  color: rgb(225, 195, 70),
  density: 1000,
  category: '전기',
  thermal: { conductivity: 0.3 },
  update: updateBattery,
});
