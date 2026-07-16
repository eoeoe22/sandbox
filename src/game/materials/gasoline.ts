import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { refluxBoil, REFLUX_GASOLINE } from './petroleumdistill';

// Liquid fuel: flows/pools like water but lighter than it (density < 3), so a
// poured layer floats on top of water — and lighter still than Crude Oil, so
// gasoline floats on oil too. The *fastest*-burning fuel — still tuned to creep
// in from the surface rather than flash the whole pool at once, just quicker
// than the rest: the highest per-tick ignite chance of the fuels. Just burns —
// it never detonates (that's Methane/Nitro). See combustion.ts.
//
// The lightest distillation cut, so it also *re-boils* the readiest: heated past
// its low boiling point it flashes back to vapour and refluxes upward (see
// petroleumdistill.ts). It stays properly flammable — a flame touching it
// ignites it fast (the flame's heat drives it to autoignition, and reflux is
// skipped while a flame is adjacent). Its boiling point (200) plus the reflux
// superheat cap (60) stays below this autoignition, so in a *flameless* still
// it boils/refluxes away before it could ever get hot enough to self-ignite.
const SPEC: Combustible = { burnChance: 0.25, autoIgniteTemp: 400 };
const BOIL_TEMP = 200;

function updateGasoline(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  if (refluxBoil(x, y, sim, BOIL_TEMP, REFLUX_GASOLINE)) return;
  updateLiquid(x, y, sim);
}

export const GASOLINE = register({
  id: 24,
  name: 'Gasoline',
  phase: Phase.Liquid,
  color: rgb(214, 190, 96),
  density: 2.2,
  combustible: true,
  petroleum: true, // flat single-colour render; burns on water without steaming it
  category: '석유',
  thermal: { conductivity: 0.2 },
  freeze: { temp: -40 },
  update: updateGasoline,
});
