import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { launchDebris } from './debris';
import { STEAM } from './steam';
import { POPCORN } from './popcorn';
import { spoilStep } from './spoil';
import { SPOILED_FOOD } from './spoiledfood';

// Corn Kernel (옥수수 알갱이) — a dense, inert little powder with exactly one
// trick, and it is the loudest thing in the 요리 tab.
//
// A kernel is a sealed hull with a drop of water inside it. Heat it past 180°
// and the water flashes: the hull bursts, the starch turns inside out, and what
// was one heavy grain becomes two cells of light, fluffy Popcorn — **launched**,
// not merely placed. So a bowl of kernels on a hot plate does not change colour,
// it *erupts*: puffs fire upward out of the pan, ricochet off whatever is above
// them, rain back down over the surroundings, and steam hisses out the whole
// time while the pile roughly doubles in volume and overflows its container.
//
// The launch is what sells it, and it is not new machinery: a popping kernel
// hands its puff to the same ballistic carrier a blast uses to fling grains
// (`launchDebris`, debris.ts). A fragment carries the material it will become in
// `aux`, flies a real arc under the world's gravity, swaps *through* loose matter
// (so a pan full of popping kernels churns instead of jamming), bounces off
// solids, and deposits its Popcorn when the flight expires. Mass is conserved by
// the carrier itself — every fragment becomes exactly one grain again.
//
// The first version just teleported the puff up to three cells and it read as
// limp: nothing moved, things merely appeared. This is the same event with the
// engine's own projectile behind it.
//
// Blocked overhead — buried in a pile, under a lid — a kernel gets no *second*
// puff (there is nowhere to put it), so a sealed pot stays exactly 1:1 and fills
// rather than exploding out of a closed box. The launched fragment is still
// launched; it simply rattles around inside and settles.
//
// The kernel itself never burns. Its pop point (180°) is far below any fuel's
// autoignition, so heat always bursts it before anything could light it: you
// cannot burn corn, only pop it, and then burn the popcorn (popcorn.ts).

/** 터지는 온도 — the point where the moisture sealed in the hull flashes. Well
 *  under Popcorn's own 250° autoignition, so a kernel always pops before the
 *  thing it becomes could catch fire. */
const POP_TEMP = 180;
/** Per-tick chance a hot kernel goes off, so a pan full of them pops as a
 *  scattered rattle over a second or two rather than all in one frame. */
const POP_CHANCE = 0.22;
/** The "outward budget" handed to `launchDebris`, which sets the launch speed
 *  (its BASE_SPEED_Q + this × GAIN_Q, in quarter-cells/tick, with a ×1.5 boost
 *  and an extra loft on the ~70% of fragments that go straight up). 2 puts a puff
 *  a good handful of cells into the air — a real hop out of the pan — without
 *  turning a bowl of corn into a fountain that clears the screen. */
const POP_FORCE = 2;
/** Per-pop chance of a hiss of Steam — the moisture that did the work leaving.
 *  Raised from the original 0.35: the steam is most of what makes the burst read
 *  as a burst, and at a third of the pops the pan barely smoked. */
const STEAM_CHANCE = 0.8;

/** Somewhere a second puff can be launched from: open air only. It has to be
 *  EMPTY rather than merely passable, because `launchDebris` spawns over
 *  whatever is there and this is the one cell of the pop that is not the
 *  kernel's own — writing it over a neighbour would destroy that neighbour. */
function burstCell(x: number, y: number, sim: SimContext): [number, number] | null {
  // Prefer straight up (against gravity), then the rest of the neighbourhood, so
  // the pair reads as one puff following another out of the pan.
  const ux = x - sim.gravityX;
  const uy = y - sim.gravityY;
  if (sim.inBounds(ux, uy) && sim.isEmpty(ux, uy)) return [ux, uy];
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) return [nx, ny];
  }
  return null;
}

function updateCornKernel(x: number, y: number, sim: SimContext): void {
  // 부패 — before the pop, since a kernel that has gone over is no longer a
  // kernel. It never competes with popping in practice: 180° is far above the
  // 60° at which spoiling stops (spoil.ts), so a kernel in a pan is popping and a
  // kernel in a sack is rotting, never both.
  if (spoilStep(x, y, sim, CORN_KERNEL.spoil!)) return;
  if (sim.getTemp(x, y) >= POP_TEMP && sim.chance(POP_CHANCE)) {
    // The volume increase: a second puff fired from the open air beside the
    // kernel. Done *first*, while that cell is still known to be empty, and
    // skipped entirely when there is nowhere for it to go — which is what keeps
    // a sealed pot at exactly 1:1.
    const burst = burstCell(x, y, sim);
    if (burst !== null) {
      launchDebris(sim, burst[0], burst[1], POPCORN.id, 0, 0, POP_FORCE);
    }
    // …and the kernel's own cell becomes the first puff, launched the same way.
    // The carrier deposits Popcorn at ambient when the flight expires, so a
    // landed puff never holds the 180° that popped it and cannot go on bursting
    // the kernels it lands among after the heat is taken away.
    launchDebris(sim, x, y, POPCORN.id, 0, 0, POP_FORCE);
    if (sim.chance(STEAM_CHANCE)) {
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
          sim.spawn(nx, ny, STEAM.id);
          break;
        }
      }
    }
    return;
  }

  updatePowder(x, y, sim);
}

export const CORN_KERNEL = register({
  id: 157,
  name: 'Corn Kernel',
  phase: Phase.Powder,
  color: rgb(226, 174, 68),
  // A handful of kernels is never one yellow — some are pale, some nearly
  // orange. Matches the powder default (18).
  colorVary: 18,
  // A hard, dense grain (~1.3 g/cm³ packed): heavier than Sugar (3.65) is not
  // needed, but it must sink in Water (3) so a kernel dropped in a pot goes to
  // the bottom where the heat is.
  density: 3.7,
  category: 'food',
  alsoIn: ['powder'],
  // 부패 — the slowest thing on the roster by a wide margin, which is what a
  // dried grain should be: a sack of kernels is the one food you can leave in a
  // corner and mostly forget about. Still finite, so a store room is a thing you
  // maintain rather than a thing you fill once.
  //
  // Bits 0-2: this material keeps nothing else in aux. The counter does not
  // survive popping — `launchDebris` overwrites the cell to carry the puff, and
  // the Popcorn it deposits starts fresh. That is the right reading anyway:
  // 튀긴 것은 새 것이다.
  spoil: { seconds: 1200, auxShift: 0, into: () => SPOILED_FOOD.id },
  thermal: { conductivity: 0.25 },
  update: updateCornKernel,
});
