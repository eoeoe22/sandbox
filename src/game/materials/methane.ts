import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { BLAST, seedBlast } from './blast';

// Gas: rises/diffuses like the default gas behavior, but it's a *fuel-air
// explosive*. Rather than merely burning, a methane cell detonates — it seeds a
// Blast core (see blast.ts), the same destructive shockwave Gunpowder/Nitro
// produce. Because a cloud spreads to fill a volume and every cell detonates,
// igniting one corner sets off the whole pocket in a chain: the Blast wave
// passes *around* explosive cells (it never vaporizes them), so each remaining
// methane cell gets its own turn to detect the adjacent Blast and go off too.
//
// Trigger detection is by id (Fire/Lava/Blue Flame/Blast), NOT the generic
// `flammable` tag — same reasoning as Gunpowder: a flammable tag would let
// Fire's ignite pass quietly convert methane to plain Fire before its own turn
// runs, defeating the explosion depending on scan order. It also self-ignites
// once heated past an autoignition point, so the heat brush or a nearby
// Blue Flame's radiant heat can touch it off without direct flame contact.
const BLAST_RADIUS = 7;
const AUTOIGNITE_TEMP = 300;

function updateMethane(x: number, y: number, sim: SimContext): void {
  let trigger = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  if (!trigger) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (nid === FIRE.id || nid === LAVA.id || nid === BLUE_FLAME.id || nid === BLAST.id) {
        trigger = true;
        break;
      }
    }
  }

  if (trigger) {
    sim.spawn(x, y, BLAST.id);
    sim.setTemp(x, y, seedBlast(BLAST_RADIUS));
    return;
  }
  updateGas(x, y, sim);
}

export const METHANE = register({
  id: 20,
  name: 'Methane',
  phase: Phase.Gas,
  color: rgb(224, 224, 168),
  density: 1,
  explosive: true,
  category: '폭발',
  // A gas: conducts poorly, so autoignition by conduction takes real sustained
  // heat rather than a single brief brush of it.
  thermal: { conductivity: 0.07 },
  update: updateMethane,
});
