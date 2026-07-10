import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid, diffuseWith } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { WATER } from './water';

// Honey — a thick, sticky, amber liquid. It's much more viscous than water,
// oozing only on a fraction of ticks so a poured blob holds a rounded, slumping
// mound before it slowly levels. Denser than the fuels but lighter than water,
// so it settles above water and below oil. It's a slow-burning fuel: it catches
// grudgingly and burns for a while (see combustion.ts's shared surface-front
// model) — think of it as a sugary, caramelizing candle.
//
// Honey is water-soluble, so it slowly interdiffuses with adjacent Water into a
// mixed "honey water" instead of sitting in a hard layer — the same gradual
// boundary swap Acid shares with Water (see diffuseWith / acid.ts).
const SPEC: Combustible = { burnChance: 0.05, autoIgniteTemp: 360 };
const FLOW_CHANCE = 0.25;
const DIFFUSE_CHANCE = 0.03;

function updateHoney(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  if (diffuseWith(x, y, sim, WATER.id, DIFFUSE_CHANCE)) return;
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const HONEY = register({
  id: 41,
  name: 'Honey',
  phase: Phase.Liquid,
  color: rgb(214, 150, 34),
  density: 3.5,
  combustible: true,
  category: '액체',
  thermal: { conductivity: 0.25 },
  // Chilled honey crystallizes stiff — freezes in place a touch below room
  // temperature (candied honey) until it warms back up.
  freeze: { temp: 5 },
  update: updateHoney,
});
