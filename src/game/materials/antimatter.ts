import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { SMOKE } from './smoke';
import { VOID } from './void';

// Antimatter — matter's mortal enemy. It falls like a powder until it meets a
// piece of ordinary matter, then annihilates: the matter it touched vanishes and
// the antimatter itself is consumed in a hot flash of Fire. The reaction is
// one-for-one — a grain destroys a single neighbor and dies — so a pocket of
// antimatter and a pocket of matter eat into each other at their shared edge
// rather than one instantly erasing the other, and the flashes of fire it
// leaves can set the surroundings alight.
//
// **Nothing is antimatter-proof.** Every phase annihilates — solid, powder,
// liquid and gas alike — and armor doesn't help: blast-proof Diamond, the
// 방폭 uranium series, and even the "truly indestructible" Clone all go. The
// only two survivors are the container Wall and the Void, and they survive for
// the same structural reason they survive everything else: the Wall is the
// world boundary, and the Void is the sink that antimatter would otherwise be
// deleted by anyway (the two exotics simply ignore each other). Free objects are
// destroyed whole on contact too — see footprintHazards in engine/objects.ts.
const FLASH_TEMP = 1200;

/**
 * `aux` stamp carried by the Fire an annihilation leaves behind, so a neighboring
 * grain can tell this reaction's own flash from ordinary Fire and skip it.
 *
 * Without it, letting gases annihilate makes a body of antimatter cannibalize
 * itself: grain A annihilates a piece of matter and flashes to Fire, grain B
 * (touching that Fire) annihilates it and flashes to a *new* Fire, C eats B's,
 * and the whole pocket burns inward one row per tick while destroying almost no
 * real matter. Marking the flash confines that to a clean 1:1 swap of one grain
 * for one cell of matter, while every *other* flame — the Fire spread by
 * fire.ts, a burning fuel, a torch — is annihilated normally like any other
 * material. Deliberately > 255 so it can never be confused with the material ids
 * other systems park in `aux` (Clone's adopted id, a ray's stored host).
 *
 * The stamp survives the one in-place transform a flash can make — Fire burning
 * out to a wisp of Smoke (fire.ts keeps `aux` on a non-empty write) — which is
 * why the skip below accepts Smoke as well: otherwise ~30% of flashes
 * (FIRE_SMOKE_CHANCE) would come back as smoke the pocket eats, leaking the
 * cannibalism back in through the side door. Every other exit clears it
 * (SimContext.set to Empty, spawn, and the brush all zero `aux`), so the mark
 * can never strand antimatter-immunity on some unrelated material.
 */
const FLASH_MARK = 0xa17;

function updateAntimatter(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY || nid === ANTIMATTER.id) continue;
    // Only the container Wall and the Void survive contact (see header).
    const nm = getMaterial(nid);
    if (nm.isWall || nid === VOID.id) continue;
    // ...plus this reaction's own flash (and the wisp of smoke it settles into),
    // which is the annihilation itself rather than a piece of matter to
    // annihilate (see FLASH_MARK).
    if ((nid === FIRE.id || nid === SMOKE.id) && sim.getAux(nx, ny) === FLASH_MARK) continue;
    // Mutual annihilation: the matter is destroyed, this cell flashes to Fire.
    sim.set(nx, ny, EMPTY);
    sim.set(x, y, FIRE.id);
    sim.setTemp(x, y, FLASH_TEMP);
    sim.setAux(x, y, FLASH_MARK);
    return;
  }
  updatePowder(x, y, sim);
}

export const ANTIMATTER = register({
  id: 51,
  name: 'Antimatter',
  phase: Phase.Powder,
  color: rgb(196, 128, 236),
  density: 5,
  category: 'exotic',
  thermal: { conductivity: 0.2 },
  update: updateAntimatter,
});
