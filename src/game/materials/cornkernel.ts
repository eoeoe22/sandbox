import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STEAM } from './steam';
import { POPCORN } from './popcorn';

// Corn Kernel (옥수수 알갱이) — a dense, inert little powder with exactly one
// trick, and it is the loudest thing in the 요리 tab.
//
// A kernel is a sealed hull with a drop of water inside it. Heat it past 180°
// and the water flashes: the hull bursts, the starch turns inside out, and what
// was one heavy grain is suddenly two cells of light, fluffy Popcorn — one of
// them thrown clear of where the kernel was sitting. So a bowl of kernels on a
// hot plate does not simply change colour, it *erupts*: the pile roughly doubles
// in volume, overflows whatever was holding it, and rains puffs over the
// surroundings, with steam hissing out of it the whole time.
//
// The jump is what sells it. A popping kernel looks straight up (against
// gravity) for open air within POP_HOP cells and puts the popcorn *there*,
// leaving a second puff behind in its own cell. Blocked overhead — buried in a
// pile, under a lid — it simply puffs in place and gets no expansion, so a
// covered pot fills and stops rather than exploding out of a sealed box.
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
/** How far up a popping kernel throws its puff, in cells. Three is enough to
 *  clear the lip of a pan and to look like a jump, and short enough that a
 *  popping pile stays a pile rather than a fountain. */
const POP_HOP = 3;
/** Per-pop chance of a hiss of Steam — the moisture that did the work leaving. */
const STEAM_CHANCE = 0.35;

/**
 * The farthest open cell straight "up" (against gravity) within POP_HOP, or -1
 * if the very first step is blocked. Scanning outward and stopping at the first
 * obstruction means a kernel never teleports *through* a lid or through the
 * grains above it — it only ever reaches air it has a clear path to.
 */
function hopTarget(x: number, y: number, sim: SimContext): number {
  const ux = -sim.gravityX;
  const uy = -sim.gravityY;
  let best = -1;
  for (let step = 1; step <= POP_HOP; step++) {
    const nx = x + ux * step;
    const ny = y + uy * step;
    if (!sim.inBounds(nx, ny) || !sim.isEmpty(nx, ny)) break;
    best = step;
  }
  return best;
}

function updateCornKernel(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= POP_TEMP && sim.chance(POP_CHANCE)) {
    const step = hopTarget(x, y, sim);
    if (step > 0) {
      // Clear air overhead: the puff is thrown up there, and a second one is
      // left in the kernel's own cell — the volume increase, and the reason a
      // popping pile overflows its pan.
      sim.spawn(x - sim.gravityX * step, y - sim.gravityY * step, POPCORN.id);
    }
    // Boxed in (or after the hop): the kernel's own cell becomes popcorn. `spawn`
    // rather than `set`, so the fresh puff starts at ambient instead of holding
    // the 180° that popped it — otherwise a popped pile would sit at its own
    // pop temperature and keep bursting the kernels it is resting on long after
    // the heat source was taken away.
    sim.spawn(x, y, POPCORN.id);
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
  thermal: { conductivity: 0.25 },
  update: updateCornKernel,
});
