import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';

// Polyethylene (폴리에틸렌) — the product of the plastics line: the milky resin
// powder an ethylene reactor drops out of its catalyst bed (see ethylene.ts).
//
// It comes out as a POWDER, not a solid block, and that's the load-bearing
// choice: a real polymerization reactor discharges resin powder/pellets which
// are only later melted and moulded, and in this sandbox a powder is the phase
// that a Conveyor Belt will carry (see conveyor.ts's `isLoose`). So a reactor
// can actually be *emptied* — belt the resin out from under the catalyst and
// the bed keeps producing instead of choking on its own output.
//
// Density 2.75 sits just under Water (3) and above every petroleum cut, which
// is real polyethylene's whole party trick: a scoop of it floats on water but
// sinks in gasoline. Being under water's density it also inherits updatePowder's
// buoyancy check, so resin buried by a pool bubbles back up to the surface
// instead of sitting pinned on the bottom (same as Sawdust/Ash).
//
// It burns — slowly, and dirtier than wood: a low ignite chance and a fairly
// high autoignition point (380°, well clear of the 200° polymerization ceiling
// so a running reactor can never light its own product), leaving sooty Ash
// behind more often than the wood fuels do.
const SPEC: Combustible = { burnChance: 0.05, autoIgniteTemp: 380, ashChance: 0.2 };

/**
 * How many further cells a chain started at the catalyst face can propagate
 * through (see ethylene.ts). A cell polymerized against the catalyst is stamped
 * with this many generations in its `aux`; each cell it goes on to nucleate gets
 * one less, and a cell at 0 is dead resin that seeds nothing.
 *
 * This is what stops a single stray grain of resin from converting an entire
 * map of ethylene: growth is always anchored to a catalyst bed and reaches a
 * bounded distance from it, so the bed's surface area — not luck — sets the
 * production rate, and burying the bed in its own output stops it.
 */
export const CHAIN_GENERATIONS = 4;

function updatePolyethylene(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  updatePowder(x, y, sim);
}

export const POLYETHYLENE = register({
  id: 141,
  name: 'Polyethylene',
  phase: Phase.Powder,
  color: rgb(232, 234, 228),
  density: 2.75,
  combustible: true,
  category: 'polymer',
  // A plastic is a thermal insulator — a heaped pile holds the polymerization
  // exotherm in rather than shedding it, which is exactly why a reactor needs
  // its output taken away as well as its heat.
  thermal: { conductivity: 0.1 },
  update: updatePolyethylene,
});
