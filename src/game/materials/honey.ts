import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Honey — a thick, sticky, amber liquid. It's much more viscous than water,
// oozing only on a fraction of ticks so a poured blob holds a rounded, slumping
// mound before it slowly levels. Denser than the fuels but lighter than water,
// so it settles above water and below oil. It's a slow-burning fuel: it catches
// grudgingly and burns for a while (see combustion.ts's shared surface-front
// model) — think of it as a sugary, caramelizing candle.
const SPEC: Combustible = { burnChance: 0.05, autoIgniteTemp: 360 };
const FLOW_CHANCE = 0.25;

function updateHoney(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
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
  update: updateHoney,
});
