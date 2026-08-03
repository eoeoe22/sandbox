import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { VIRUS } from './virus';
import { BUBBLE } from './bubble';
import { WATER } from './water';
import { OIL } from './oil';
import { GASOLINE } from './gasoline';
import { KEROSENE } from './kerosene';
import { DIESEL } from './diesel';

// Soapy Water (비눗물) — water with soap dissolved in it (drop Soap into Water, or
// pour water over a Soap pile). Two things make it special, and it's the ONLY
// material in the sandbox that does either:
//
//  • It FIZZES. Every so often a submerged cell releases an air Bubble that rises
//    through the body and pops at the surface (see bubble.ts) — nothing else
//    produces bubbles, so a foaming, popping pool reads instantly as soapy.
//  • It's a DISINFECTANT on par with rubbing Alcohol: an adjacent Virus cell is
//    scrubbed away outright (contact only — no spreading cure like H₂O₂, so you
//    have to soak the whole colony), at the same per-tick rate Alcohol kills at.
//  • It EMULSIFIES OIL. Soap is a surfactant, and this is the whole reason the
//    stuff exists: it is `miscible` with the petroleum liquids (Crude Oil,
//    Gasoline, Kerosene, Diesel — see types.ts), so an oil slick that would ride
//    on plain Water in a hard, flat layer instead gets pulled apart and stirred
//    through the puddle. Nothing transforms — the oil is still oil, and still
//    burns — it just stops being a separate layer. Plain Water deliberately does
//    NOT do this: 물에 기름은 안 섞이지만 비눗물에는 섞인다 is the point, and it's
//    what makes a bar of Soap worth fetching.
//
// It's plain water otherwise: it flows and levels (and mixes freely with Water,
// which it mostly is) and beads a little at its edges.
const STERILIZE_CHANCE = 0.4; // per-tick chance to kill a touched Virus cell (알콜 수준)
const BUBBLE_CHANCE = 0.006; // per-tick chance a submerged cell births a rising bubble

function updateSoapyWater(x: number, y: number, sim: SimContext): void {
  // Antiseptic: scrub an adjacent Virus (EMPTY writes are always safe), like Alcohol.
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === VIRUS.id && sim.chance(STERILIZE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
    }
  }

  // Fizz: a submerged cell (soapy water directly "above" it, against gravity)
  // occasionally becomes a rising air Bubble. Turning *this* cell into the bubble
  // (rather than spawning one elsewhere) conserves mass — the bubble is just this
  // water in gaseous form, and it pops back to soapy water at the surface
  // (bubble.ts), so the pool churns without ever depleting.
  if (sim.chance(BUBBLE_CHANCE)) {
    const ux = x - sim.gravityX;
    const uy = y - sim.gravityY;
    if (sim.inBounds(ux, uy) && sim.get(ux, uy) === SOAPY_WATER.id) {
      sim.set(x, y, BUBBLE.id);
      return;
    }
  }

  updateLiquid(x, y, sim);
}

export const SOAPY_WATER = register({
  id: 102,
  name: 'Soapy Water',
  phase: Phase.Liquid,
  // A milky, pale blue — water with a soapy sheen.
  color: rgb(176, 212, 226),
  density: 3,
  // A little surface tension like water, so stray droplets bead.
  surfaceTension: 0.12,
  // 물과도, 기름과도 섞인다 (see the header). Water is the trivial half — it *is*
  // water — and would layer against nothing anyway at the same density, but the
  // pair still needs declaring for the interdiffusion that blends a fresh pour
  // into the pool instead of leaving a visible seam. The four petroleum liquids
  // are the surfactant half, and the only ones listed: Napalm and Asphalt are
  // Solid-phase sludges that never flow as liquids in the first place, and
  // Alcohol has no oil to be lifted (it already mixes with the water half).
  miscible: [WATER.id, OIL.id, GASOLINE.id, KEROSENE.id, DIESEL.id],
  thermal: { conductivity: 0.5 },
  category: 'liquid',
  update: updateSoapyWater,
});
