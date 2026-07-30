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
// to molten iron. Still under Blue Flame's 1800°, keeping Coal the everyday
// smelting fire rather than a cutting torch — until Oxygen is blown against
// it: the flame it throws off then literally becomes Blue Flame, not just
// Fire running hot (see combustion.ts's `oxygenated` branch), reaching full
// 1800° parity at OXY_MAX_PIN. Coal's high 1300° base means it only takes 2
// Oxygen cells to get there (a default 800°-base fuel needs 4).
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
  // Broken rock, drawn the same way Obsidian is: a WIDE brightness spread between
  // 2×2 flakes and a NARROW one inside each (`colorVary` + `tintBlock` +
  // `tintCellVary`). The two levels are the whole point — the blocked level makes
  // faces that are several cells across, which is the size a fracture face actually
  // is, and the fine level puts grit inside them so a face reads as coal rather than
  // as a painted square. Coal used to be one flat near-black on the board and
  // textured only in the palette; it was in the group of materials whose chip was
  // hand-drawn *because* the canvas had nothing to reflect, and now it does.
  //
  // The chip stays the hand-drawn lumps — a 24-cell drawing can show whole chunks
  // with silhouettes, which a repeating world grain cannot, so this is one of the
  // places the two layers are deliberately not the same picture.
  //
  // 14 is a wide spread on a base this dark (channels sit at 24–30, so a flake swings
  // roughly 12–44), and that is intended: coal is high-contrast rubble, not a smooth
  // solid. 4 inside a flake is well below a visible step on its own and only shows as
  // texture on the face.
  colorVary: 14,
  tintBlock: 2,
  tintCellVary: 4,
  // Density is inert for a Solid (solids never move or get displaced); kept for
  // completeness alongside the other materials.
  density: 5,
  combustible: true,
  category: 'fire',
  thermal: { conductivity: 0.2 },
  update: updateCoal,
});
