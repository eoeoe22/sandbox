import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { ACID } from './acid';

// The gaseous half of Acid — corrosive fumes. Boiling Acid flashes to Acid Vapor
// (see acid.ts), the vapor rises/diffuses like any gas, eats away at solids and
// powders it touches (weaker than the liquid, and never at acid-resistant
// materials), and — the mirror of Steam↔Water — condenses back to liquid Acid,
// noticeably faster when it pools under a ceiling. So heating a puddle of acid
// sends corrosive fumes up to etch a ceiling, which then drip back down as acid.
// It never just vanishes on its own — boil → rise → corrode → condense always
// relocates it back to liquid Acid rather than destroying it.
const CORRODE_CHANCE = 0.015; // vs the liquid's 0.03 — fumes bite more slowly
const SELF_CONSUME_CHANCE = 0.05; // a puff that corroded may be used up doing so
const CONDENSE_CHANCE = 0.006; // drifting fumes mostly find their way back to acid…
const CONDENSE_CHANCE_BLOCKED = 0.03; // pooled under a ceiling → condenses faster

function isCorrodible(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.acidResistant) return false;
  return m.phase === Phase.Solid || m.phase === Phase.Powder;
}

function updateAcidVapor(x: number, y: number, sim: SimContext): void {
  let corroded = false;
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isCorrodible(sim.get(nx, ny)) && sim.chance(CORRODE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      corroded = true;
    }
  }
  if (corroded && sim.chance(SELF_CONSUME_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }
  const blocked = !sim.inBounds(x, y - 1) || !sim.isEmpty(x, y - 1);
  if (sim.chance(blocked ? CONDENSE_CHANCE_BLOCKED : CONDENSE_CHANCE)) {
    // Shed its heat as it condenses so the fresh Acid doesn't sit above boiling
    // and instantly flash back to vapor (mirrors Steam→Water).
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, ACID.id);
    return;
  }
  updateGas(x, y, sim);
}

export const ACID_VAPOR = register({
  id: 16,
  name: 'Acid Vapor',
  phase: Phase.Gas,
  color: rgb(190, 225, 120),
  density: 1,
  // Boils off hot; conducts poorly like the other gases (carries heat by rising).
  thermal: { init: 100, conductivity: 0.08 },
  update: updateAcidVapor,
});
