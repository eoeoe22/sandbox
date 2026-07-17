import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { IRON_ORE } from './ironore';
import { MOLTEN_IRON_ORE, tryRiseThroughFlux } from './moltenironore';
import { MOLTEN_METAL } from './moltenmetal';

// Powdered coal — the pourable form of Coal. Solid Coal (id 25) is a rigid lump
// that holds its shape (Solid has no default movement), so a heap of it can't be
// mixed into an ore charge; Coal Powder falls and piles like Sand, so it can be
// poured into (or dusted onto) iron ore. It burns with the *exact same* spec as
// solid Coal — the slowest, longest-smouldering fuel, and (via `burnTemp`) the
// same 1300° running heat, past Iron's 1200° melt but under Blue Flame's 1800°
// — so the general fuel economy is unchanged: this is just Coal you can pour.
// Just burns; never detonates. See combustion.ts for the shared surface-front
// model.
const SPEC: Combustible = { burnChance: 0.035, autoIgniteTemp: 580, burnTemp: 1300 };

// Carbon in contact with the smelting hearth — iron ore (solid or molten) or the
// molten iron just reduced out of it — sits in a reducing pocket, so it acts as
// the ore's *reductant* rather than as fuel and must not combust. Without this,
// mixed-into-a-charge coal would auto-ignite (580°) and burn away before the ore
// even reaches its 850° melt (unusable), and coal dusted on a pool would flash
// off before it could sink in and reduce the depth — as the surface it touches
// reduces to hot Molten Metal, that metal (which isn't ore) would otherwise
// unshield and immediately burn the carbon that's meant to reduce the next
// layer, so the pool only ever crusts at the top. Including Molten Metal keeps
// the carbon alive through the churn (the reduced iron sinks away to the floor
// while fresh ore stays around the carbon), so a dusted pool keeps reducing. Only coal
// *immediately* touching the hearth
// is shielded — coal a cell or more away still burns, so a charcoal bed heaped
// around a crucible still smoulders and heats it.
function touchingMelt(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (id === IRON_ORE.id || id === MOLTEN_IRON_ORE.id || id === MOLTEN_METAL.id) return true;
  }
  return false;
}

// Chance per tick that carbon dusted on a molten pool stirs one cell deeper into
// it. Light coal (density 5) floats on the denser melt (7), so on its own it only
// ever reduces the thin top surface — and the iron reduced there cools and
// freezes into a solid plug that traps the ore beneath. Forcing the carbon to
// sink disperses it through the pool so the whole body reduces at once (before
// any solid iron can wall it off), modelling stirring the charge into the melt.
// It's spent by the reduction as it descends, so it doesn't just pile on the floor.
const MIX_CHANCE = 0.5;

function mixIntoMelt(x: number, y: number, sim: SimContext): boolean {
  if (!sim.chance(MIX_CHANCE)) return false;
  if (sim.inBounds(x, y + 1) && sim.get(x, y + 1) === MOLTEN_IRON_ORE.id) {
    sim.swap(x, y, x, y + 1); // sink straight into the pool
    return true;
  }
  const dir = sim.chance(0.5) ? 1 : -1;
  for (const d of [dir, -dir]) {
    if (sim.inBounds(x + d, y + 1) && sim.get(x + d, y + 1) === MOLTEN_IRON_ORE.id) {
      sim.swap(x, y, x + d, y + 1); // …or diagonally down into it
      return true;
    }
  }
  return false;
}

function updateCoalPowder(x: number, y: number, sim: SimContext): void {
  // Reductant against the hearth (ore/molten iron): don't burn — it's spent by
  // the ore's reduction (see moltenironore.ts), so mixed-in coal survives being
  // heated instead of flashing off, and dusted coal reduces the melt instead of
  // burning away. Coal a cell or more from the hearth still burns, so a charcoal
  // bed heaped around a crucible still smoulders and heats it.
  if (!touchingMelt(x, y, sim) && tryBurn(x, y, sim, SPEC)) return;
  // Dusted onto a molten pool, stir down into it so the whole depth reduces, not
  // just the crust-prone surface (mixIntoMelt wins the tie so stirring isn't
  // fought every time it rolls). Once a grain has stirred past the ore layer —
  // or never finds ore to stir into at all — it's spent leftover carbon sitting
  // in the melt with nothing left to react; let it float back to the surface
  // like Limestone (tryRiseThroughFlux, shared in moltenironore.ts) instead of
  // staying stranded at the bottom of the pool forever.
  if (mixIntoMelt(x, y, sim)) return;
  if (tryRiseThroughFlux(x, y, sim)) return;
  updatePowder(x, y, sim);
}

export const COAL_POWDER = register({
  id: 70,
  name: 'Coal Powder',
  phase: Phase.Powder,
  // A touch lighter than solid Coal's near-black so a loose pile reads as grainy
  // dust rather than a solid block.
  color: rgb(40, 36, 46),
  density: 5,
  combustible: true,
  category: '제련',
  // Angular, dusty grains grip hard — a coal-dust heap piles steeply (마찰).
  friction: 0.48,
  thermal: { conductivity: 0.2 },
  update: updateCoalPowder,
});
