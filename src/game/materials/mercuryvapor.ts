import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { MERCURY } from './mercury';

// Mercury Vapor — the gaseous half of Mercury. Heated past its boiling point a
// puddle of Mercury flashes to this vapor (see mercury.ts), which rises and
// diffuses like any gas and — the mirror of Steam↔Water — condenses back to
// liquid Mercury once it cools below boiling, noticeably faster when it pools
// under a ceiling. So boiling a pool of quicksilver sends a silvery haze up to
// the ceiling that then drips back down as Mercury: boil → rise → condense
// always relocates it rather than destroying it.
const CONDENSE_CHANCE = 0.003;
const CONDENSE_CHANCE_BLOCKED = 0.02;

function updateMercuryVapor(x: number, y: number, sim: SimContext): void {
  const blocked = !sim.inBounds(x, y - 1) || !sim.isEmpty(x, y - 1);
  if (sim.chance(blocked ? CONDENSE_CHANCE_BLOCKED : CONDENSE_CHANCE)) {
    // Shed its heat as it condenses so the fresh Mercury doesn't sit above
    // boiling and instantly flash back to vapor (mirrors Steam→Water).
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, MERCURY.id);
    return;
  }
  updateGas(x, y, sim);
}

export const MERCURY_VAPOR = register({
  id: 118,
  name: 'Mercury Vapor',
  phase: Phase.Gas,
  color: rgb(198, 200, 208),
  density: 1,
  // Boils off scorching hot; conducts poorly like the other gases, so it mostly
  // carries heat by physically rising rather than by conduction.
  thermal: { init: 360, conductivity: 0.08 },
  update: updateMercuryVapor,
});
