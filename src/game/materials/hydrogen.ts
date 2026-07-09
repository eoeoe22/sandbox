import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';
import { OXYGEN } from './oxygen';
import { STEAM } from './steam';
import { BLAST, detonate } from './blast';

// Hydrogen — the lightest, most violently explosive gas. It behaves like Methane
// (a fuel-air explosive: a cloud that fills a volume and, when any corner is
// touched off, chain-detonates cell by cell as the Blast wave passes around the
// remaining explosive cells), but it catches far more easily — a low
// autoignition point and a bigger blast radius. Fill a chamber with it and it
// pools against the ceiling; a lone spark's flame, or the flash-front from an
// Oxygen pocket, sets the whole thing off at once.
//
// Trigger detection is by id, not the `flammable` tag — the same reasoning as
// Gunpowder/Methane: a `flammable` tag would let Fire's ignite pass quietly turn
// it to plain Fire before its own turn, defeating the detonation depending on
// scan order. It also self-ignites once heated past its autoignition point.
const BLAST_RADIUS = 9;
const AUTOIGNITE_TEMP = 200;

function updateHydrogen(x: number, y: number, sim: SimContext): void {
  let trigger = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  if (!trigger) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (
        nid === FIRE.id ||
        nid === LAVA.id ||
        nid === BLUE_FLAME.id ||
        nid === BLAST.id ||
        nid === MOLTEN_METAL.id ||
        nid === MOLTEN_GLASS.id
      ) {
        trigger = true;
        break;
      }
    }
  }

  if (trigger) {
    // 2H₂ + O₂ → water: any oxygen mixed in burns with the hydrogen into hot
    // water vapor (Steam), which condenses into Water (see steam.ts). So a
    // detonating H₂+O₂ mix leaves a steam cloud that rains down as water on top
    // of the blast. (Oxygen not consumed here flashes to Steam on its own turn
    // via the blast — see oxygen.ts — so the reaction fills the whole cloud.)
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (sim.inBounds(nx, ny) && sim.get(nx, ny) === OXYGEN.id) sim.spawn(nx, ny, STEAM.id);
    }
    detonate(sim, x, y, BLAST_RADIUS);
    return;
  }
  updateGas(x, y, sim);
}

export const HYDROGEN = register({
  id: 37,
  name: 'Hydrogen',
  phase: Phase.Gas,
  color: rgb(214, 228, 238),
  density: 1,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  category: '폭발',
  // Very low conductivity, but a low autoignition point, so even a little
  // sustained heat sets it off.
  thermal: { conductivity: 0.05 },
  update: updateHydrogen,
});
