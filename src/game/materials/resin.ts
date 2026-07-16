import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { AMBER } from './amber';

// Resin (송진/수지) — sticky pine sap: a thick, slow-oozing amber liquid that
// floats on water. It's flammable but reluctant and tarry: it doesn't catch as
// eagerly as the volatile fuels, and once alight it creeps very slowly and
// smoulders for a long time rather than flashing off — a very low burn chance
// stretches both the spread and the burn life (a lit runnel oozes flame along
// itself for ages, the slowest-spreading, longest-smouldering of the fuels).
// Left to itself it slowly cures: each tick a small chance to harden in place into
// solid Amber (see amber.ts), so a poured runnel of resin gradually sets into a
// glassy gold solid — drip it over something and it freezes the moment into amber.
// Heat it and it burns before it can set; leave it cold and it hardens. The cure
// is reversible: a *burning* Amber cell has a small chance to melt back into Resin
// (see amber.ts's MELT_TEMP/MELT_CHANCE) — not the whole block at once, just an
// occasional droplet weeping out of the fire — so the pair loops: cold sets to
// solid, and a fraction of burning solid un-cures to sap.
const SPEC: Combustible = { burnChance: 0.017, autoIgniteTemp: 400, easyDouse: true };
const FLOW_CHANCE = 0.18; // sticky and viscous, like Honey
const HARDEN_CHANCE = 0.004; // slow cure into Amber

function updateResin(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  // Cure to Amber — but not while it's burning (a lit cell is pinned at 800°,
  // above the ignition point), so "데우면 굳기 전에 탄다" holds: heat makes it burn,
  // only cooler resin sets. In-place `set` keeps the temperature; the fresh Amber
  // can then still be burned if a flame reaches it.
  if (sim.getTemp(x, y) < SPEC.autoIgniteTemp && sim.chance(HARDEN_CHANCE)) {
    sim.set(x, y, AMBER.id);
    return;
  }
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const RESIN = register({
  id: 92,
  name: 'Resin',
  phase: Phase.Liquid,
  color: rgb(198, 120, 38),
  // Lighter than water (3), so a resin slick floats and pools on a puddle's
  // surface before it sets.
  density: 2.6,
  combustible: true,
  category: '액체',
  thermal: { conductivity: 0.2 },
  update: updateResin,
});
