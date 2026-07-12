import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';
import { BLAST, detonate, flashCell, type DetonateOptions } from './blast';
import { launchDebris } from './debris';

// Concussion charge (진탕폭탄) — the low end of the destructive-power spectrum,
// and the showcase for a mass-conserving blast. Where TNT craters everything, a
// concussion barely scratches solid terrain: its shock instead *flings loose
// powder and liquid* — sand, water, salt, gunpowder-piles-worth of grit — up and
// outward as Debris that arcs and rains back down (see debris.ts). So the world
// isn't emptied, it's rearranged: a shaker that scoops a pit in a sand dune and
// dumps it to the sides, or blows a hole in a pool that promptly refills.
//
// It rides entirely on the `detonate` option seam (blast.ts): a custom `onCell`
// decides, per cell the front reaches, whether to flash-consume it (empties and
// any explosive caught in the shock), fling it (powder/liquid → Debris), or
// leave it be (inert solids). Nothing in blast.ts knows about any of this.
const BLAST_RADIUS = 9;
const AUTOIGNITE_TEMP = 240;

/** Per-cell rule for a concussion blast — see DetonateOptions.onCell. Always
 *  claims the cell (returns true): a concussion never drops the default crater
 *  flash except where it explicitly chooses to. */
function concussionCell(
  sim: SimContext,
  x: number,
  y: number,
  prevId: number,
  entryDx: number,
  entryDy: number,
  outB: number,
): boolean {
  if (prevId === EMPTY) {
    // Empty air just shows the shockwave flash, so the blast still reads as a disc.
    flashCell(sim, x, y);
    return true;
  }
  const m = getMaterial(prevId);
  // Any explosive caught in the shock (this charge itself, or connected charges)
  // is consumed/triggered by a normal flash — a source cell left intact would
  // re-detonate every tick forever.
  if (m.explosive) {
    flashCell(sim, x, y);
    return true;
  }
  // The whole point: loose powder and liquid are FLUNG, not erased — hurled out
  // as Debris that arcs up and rains back down. The push rides `outB`, so it's
  // fiercest at the epicenter and gentle at the rim.
  if (m.phase === Phase.Powder || m.phase === Phase.Liquid) {
    launchDebris(sim, x, y, prevId, entryDx, entryDy, outB);
    return true;
  }
  // A weak charge barely marks solid terrain (Stone/Metal/Glass/Wood/Wall stay
  // put) — leaving them intact is exactly what makes this a shaker, not a crater.
  return true;
}

// rimEmberChance 0: a concussion throws no smashing embers — the flung Debris is
// the *entire* ejecta, so nothing it throws destroys terrain. That's what keeps
// the blast mass-conserving (embers would punch out grains they hit).
const CONCUSSION_OPTS: DetonateOptions = { onCell: concussionCell, rimEmberChance: 0 };

function updateConcussion(x: number, y: number, sim: SimContext): void {
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

  if (trigger) detonate(sim, x, y, 0, CONCUSSION_OPTS);
  // Otherwise it just sits there — a Solid has no phase-default movement.
}

export const CONCUSSION = register({
  id: 72,
  name: 'Concussion',
  phase: Phase.Solid,
  // Muted olive so it reads distinctly from TNT's demolition red.
  color: rgb(122, 138, 84),
  density: 1000,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  category: '폭발',
  thermal: { conductivity: 0.3 },
  update: updateConcussion,
});
