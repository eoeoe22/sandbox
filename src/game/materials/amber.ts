import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { RESIN } from './resin';

// Amber (호박) — fossilised resin: the hard, translucent gold solid that a pool
// of Resin cures into over time (see resin.ts). It's a static decorative Solid
// (build with it, seal things behind it — the "insect trapped in amber" gag), but
// it never forgot it was tree sap: it's still combustible, catching slowly and
// burning with a low, resinous flame if you hold fire to it. Like Wood it has no
// movement of its own — it just burns where it sits.
//
// But fossilised resin remembers it was sap: while a cell is *burning* (pinned to
// the 800° burn temperature, well past MELT_TEMP), it has a small per-tick chance
// to *un-cure* — liquefying back into a droplet of sticky Resin (see resin.ts)
// instead of charring away. It's only a chance, so most of a burning amber block
// just chars to Fire like Wood and only a small fraction (~1 in 10) softens and
// drips as burning, tarry sap. The set is in place and keeps the cell's heat, so
// that fresh Resin is already glowing and oozes/burns on. Left cold, molten Resin
// re-cures to Amber, so the pair still loops — this just makes the melt an
// occasional flourish of a fire rather than the whole block flashing to liquid.
const SPEC: Combustible = { burnChance: 0.03, autoIgniteTemp: 400 };

// Only *burning* amber melts, and only sometimes:
//   • MELT_TEMP sits well above Resin's cure/autoignition threshold (400°, see
//     resin.ts) so mere warmth never melts it — a cell has to actually be alight
//     (burning pins it to 800°) to soften. The gap between 400° and MELT_TEMP is
//     stable for both materials (amber won't melt, resin won't re-cure), so there
//     is still no flip-flop band.
//   • MELT_CHANCE is the per-tick chance a burning cell drips rather than chars.
//     A burning amber cell is consumed to Fire at burnChance·CONSUME_RATIO ≈
//     0.009/tick (see combustion.ts); pitting this melt roll against that as a
//     race, the fraction that ends up as Resin is ≈ MELT_CHANCE / (MELT_CHANCE +
//     0.009) ≈ 0.1 — about a tenth of a burning block melts, the rest burns away.
const MELT_TEMP = 700;
const MELT_CHANCE = 0.001;

function updateAmber(x: number, y: number, sim: SimContext): void {
  // Burn like Wood: catch from adjacent flame, self-ignite when hot enough,
  // wreath in fire, spread to amber neighbors, and eventually char to Fire. If
  // this consumed the cell to Fire, stop — it's no longer amber.
  if (tryBurn(x, y, sim, SPEC)) return;
  // Still burning amber: a small chance it un-cures to a Resin droplet instead of
  // charring on. Only fires while genuinely alight (temp past MELT_TEMP), and only
  // occasionally, so a burning block mostly chars and just weeps a little molten
  // sap. In-place `set` keeps the cell's burning heat, so the Resin oozes and
  // burns from the moment it forms.
  if (sim.getTemp(x, y) >= MELT_TEMP && sim.chance(MELT_CHANCE)) {
    sim.set(x, y, RESIN.id);
  }
}

export const AMBER = register({
  id: 93,
  name: 'Amber',
  phase: Phase.Solid,
  color: rgb(210, 148, 40),
  density: 1000,
  combustible: true,
  category: '고체',
  thermal: { conductivity: 0.2 },
  update: updateAmber,
});
