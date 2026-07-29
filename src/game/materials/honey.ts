import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid, diffuseWith } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { WATER } from './water';

// Honey — a thick, sticky, amber liquid. It's much more viscous than water: like
// Lava it moves only on a fraction of ticks (FLOW_CHANCE below), so it oozes down
// in a slow drip instead of splashing, and a poured blob holds a rounded,
// slumping mound before it slowly levels. Denser than the fuels but lighter than water,
// so it settles above water and below oil. It's a slow-burning fuel: it catches
// grudgingly and burns for a while (see combustion.ts's shared surface-front
// model) — think of it as a sugary, caramelizing candle.
//
// Honey is water-soluble, so it slowly interdiffuses with adjacent Water into a
// mixed "honey water" instead of sitting in a hard layer — the same gradual
// boundary swap Acid shares with Water (see diffuseWith / acid.ts).
const SPEC: Combustible = { burnChance: 0.05, autoIgniteTemp: 360 };
const DIFFUSE_CHANCE = 0.03;

// True viscosity, the way Lava does it (and most of the molten liquids with it —
// Molten Metal, Molten Glass, Molten Iron Ore, Molten Salt; the corium melts and
// Liquid Gallium deliberately run ungated so they flow like water): the whole
// movement step — the straight fall included — only runs on a fraction of ticks,
// so honey *oozes* downward instead of dropping at water speed. The `viscosity`
// tag below can't do this on its own: by design it gates only the lateral
// leveling and never the fall (see engine/types.ts), which left honey pouring
// like water and merely refusing to flatten once it landed. The two stack —
// this sets how fast honey moves at all, `viscosity` how reluctantly it levels.
//
// Pinned to Resin's 0.18 — resin.ts tuned that value as "sticky and viscous,
// like Honey", so honey matching it makes the comparison honest in both
// directions. A shade looser than Lava's 0.15 — not the roster's floor either
// way (hot Slag creeps at 0.1 and softened Asphalt at 0.08), just thick enough
// to string a visible drip instead of pouring.
const FLOW_CHANCE = 0.18;

function updateHoney(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  if (diffuseWith(x, y, sim, WATER.id, DIFFUSE_CHANCE)) return;
  // Reactions above run every tick; only the movement is throttled, so a stalled
  // honey cell still burns and still mixes with the water it's sitting in.
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const HONEY = register({
  id: 41,
  name: 'Honey',
  phase: Phase.Liquid,
  color: rgb(214, 150, 34),
  density: 3.5,
  combustible: true,
  category: 'liquid',
  // Very viscous — holds a mound instead of racing flat like water. Stacks on
  // top of FLOW_CHANCE above (which is what slows the *fall*): this is the extra
  // reluctance to level out sideways once it has landed.
  viscosity: 0.8,
  thermal: { conductivity: 0.25 },
  // Chilled honey crystallizes stiff — freezes in place a touch below room
  // temperature (candied honey) until it warms back up.
  freeze: { temp: 5 },
  update: updateHoney,
});
