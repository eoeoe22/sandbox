import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updateLiquid, diffuseWith } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { ACID_VAPOR } from './acidvapor';
import { WATER } from './water';

// Liquid: flows like water, but each tick has a chance to corrode any
// non-resistant Solid/Powder neighbor (dissolving it to Empty). If it
// corroded anything this tick, it also has a chance to consume itself —
// bounds how much a given puddle of acid can eat through before running out.
// With no corrodible neighbor, it just sits there — acid only ever shrinks
// as a byproduct of actually corroding something, never on its own.
// Heated past its boiling point it flashes to Acid Vapor (corrosive fumes), the
// gaseous counterpart that rises, etches, and condenses back to acid — the same
// pattern as Water↔Steam (see acidvapor.ts).
//
// Same density as Water, so a poured-in layer of either sits on top of the
// other instead of sinking through — but same-density fluids never trade
// places via the normal density-sorted flow, so left alone they'd stay in
// perfectly flat layers forever. DIFFUSE_CHANCE gives their shared boundary a
// slow, occasional swap with a neighboring Water cell instead, so the two
// gradually interdiffuse across the interface like miscible liquids.
const CORRODE_CHANCE = 0.03;
const SELF_CONSUME_CHANCE = 0.08;
const ACID_BOIL_TEMP = 100;
const DIFFUSE_CHANCE = 0.02;

function isCorrodible(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.acidResistant) return false;
  return m.phase === Phase.Solid || m.phase === Phase.Powder;
}

function updateAcid(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= ACID_BOIL_TEMP) {
    // Boil in place: the resulting Vapor keeps the (hot) temperature, then
    // rises and corrodes/condenses on its own (see acidvapor.ts).
    sim.set(x, y, ACID_VAPOR.id);
    return;
  }

  let corroded = false;
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (isCorrodible(nid) && sim.chance(CORRODE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      corroded = true;
    }
  }
  if (corroded && sim.chance(SELF_CONSUME_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }
  if (diffuseWith(x, y, sim, WATER.id, DIFFUSE_CHANCE)) return;
  updateLiquid(x, y, sim);
}

export const ACID = register({
  id: 11,
  name: 'Acid',
  phase: Phase.Liquid,
  color: rgb(150, 225, 70),
  density: 3,
  thermal: { conductivity: 0.5 },
  update: updateAcid,
});
