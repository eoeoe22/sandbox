import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Solid fuel: a static, rigid lump of coal (like Wall/Stone/Wood it just sits —
// Solid has no phase-default movement, so a heap holds its shape and burns down
// in place instead of tumbling and piling like a powder). The *slowest*-burning
// fuel: a low ignite chance makes a lump smoulder for a long time, creeping in
// from the surface a cell at a time rather than flashing over, and a high
// autoignition point resists catching from stray heat. Just burns; never
// detonates. See combustion.ts for the shared model.
//
// Runs far hotter than every other fuel (`burnTemp` overrides the shared 800°
// default): a coal fire pins at 1300°, past Iron's 1200° melt, so a bare
// smouldering bed — no oxygen blast needed — carries a smelt straight through
// to molten iron. Still well under Blue Flame's 1800°, keeping Coal the
// everyday smelting fire rather than a cutting torch. Oxygen blown against it
// still pushes higher (see combustion.ts), just with less headroom left before
// OXY_MAX_PIN than a fuel starting from the 800° baseline.
const SPEC: Combustible = { burnChance: 0.035, autoIgniteTemp: 580, burnTemp: 1300 };

function updateCoal(x: number, y: number, sim: SimContext): void {
  // Solid: no fall/flow, so combustion is the only behavior — if it doesn't
  // ignite this tick the cell simply stays put (mirrors Wood).
  tryBurn(x, y, sim, SPEC);
}

export const COAL = register({
  id: 25,
  name: 'Coal',
  phase: Phase.Solid,
  color: rgb(26, 24, 30),
  // Density is inert for a Solid (solids never move or get displaced); kept for
  // completeness alongside the other materials.
  density: 5,
  combustible: true,
  category: '불·열',
  thermal: { conductivity: 0.2 },
  update: updateCoal,
});
