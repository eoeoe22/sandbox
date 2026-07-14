import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { NUKE_WASTE } from './nukewaste';

// Molten U238 — a U238 mass past its melt point (see u238.ts). This is where the
// two uranium isotopes part ways. Molten U235 (moltenuranium.ts) *accelerates*:
// it keeps self-heating, goes prompt-critical, and burns off in a Heat-Ray sweep.
// Molten U238 does the opposite — the meltdown itself is the end of its reaction.
// The chain reaction STOPS here: this pool has no per-neighbor self-heating, never
// reaches criticality, and never emits a Heat Ray. It simply sits and cools.
//
// And it never sets back into solid U238. The meltdown is irreversible: once the
// pool cools below FREEZE_TEMP it solidifies into Nuke Waste (nukewaste.ts) — the
// dull, spent-fuel powder — not fresh fuel. So the whole U238 story is a one-way
// street: solid U238 self-heats → melts down → the molten pool cools → Nuke Waste
// forever. (Compare U235's reversible melt ↔ freeze round trip.)
//
// Water/Saltwater on the surface still boils to Steam and pulls heat out, exactly
// like the U235 reactor — here it just hurries the pool toward its Nuke-Waste set
// point instead of holding a live reactor sub-critical.
const FREEZE_TEMP = 1400; // hysteresis below the 1500° melt point (u238.ts)
const COOL_CHANCE = 0.12;
const COOL_AMOUNT = 25;
// Passive "radiative" cooldown per tick. Molten U235 stays hot forever in open
// air because it self-heats (and because air is a perfect insulator, so a pool
// loses nothing to it) — that's what keeps a meltdown critical. Molten U238 has
// no reaction left to hold its heat, so instead it slowly bleeds warmth on its
// own and settles into Nuke Waste over time even with no coolant nearby: the
// "dirty fuel cooks itself down into a pile of waste" arc. Small enough that a
// fresh pool still flows and glows for a good while first; water makes it far
// quicker.
const RADIATE_COOL = 0.2;
// A painted pool starts hot with headroom above the freeze point, so a fresh
// puddle flows and glows for a while before it cools out into waste.
const MOLTEN_U238_TEMP = 1600;

function updateMoltenU238(x: number, y: number, sim: SimContext): void {
  let temp = sim.getTemp(x, y);
  if (temp <= FREEZE_TEMP) {
    // Cooled below the set point: the spent melt solidifies into Nuke Waste —
    // permanently. The in-place `set` keeps the (now low) temperature, so the
    // fresh waste reads as cool rather than re-melting on its next turn.
    sim.set(x, y, NUKE_WASTE.id);
    return;
  }

  // No chain reaction: the pool never adds heat to itself. It only loses it —
  // a steady radiative bleed plus any coolant boiling off its surface — so it
  // always trends downward toward Nuke Waste.
  temp -= RADIATE_COOL;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id) {
      if (sim.chance(COOL_CHANCE)) {
        sim.spawn(nx, ny, STEAM.id);
        temp -= COOL_AMOUNT;
      }
    }
  }
  sim.setTemp(x, y, temp);

  // Oozes rather than racing flat like Molten U235's free-flowing corium — a
  // thicker, cooling slag (viscosity read by updateLiquid).
  updateLiquid(x, y, sim);
}

export const MOLTEN_U238 = register({
  id: 107,
  name: 'Molten U238',
  phase: Phase.Liquid,
  color: rgb(200, 220, 120),
  density: 10, // as dense as Molten U235 — sinks through everything liquid
  category: '방사성',
  explosionProof: true, // 방폭 — see uranium.ts
  viscosity: 0.5,
  thermal: { init: MOLTEN_U238_TEMP, conductivity: 0.5 },
  // Glows warm olive-green from the freeze point up to its molten init temp, so a
  // pool visibly darkens as it cools toward setting into Nuke Waste.
  glow: { min: FREEZE_TEMP, max: MOLTEN_U238_TEMP, cool: rgb(110, 120, 70) },
  update: updateMoltenU238,
});
