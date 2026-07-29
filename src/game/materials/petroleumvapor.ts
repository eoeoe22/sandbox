import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { GASOLINE } from './gasoline';
import { KEROSENE } from './kerosene';
import { DIESEL } from './diesel';
import { ASH } from './ash';
import { ETHYLENE } from './ethylene';
import { CATALYST } from './catalyst';

// The transient fume that boiling crude oil gives off (see oil.ts). One shared
// vapor stands in for all three condensable cuts: which liquid it condenses back
// into is carried in the cell's own `aux` byte (1 = Gasoline, 2 = Kerosene, 3 =
// Diesel), stamped by oil.ts right after it spawns the vapor. Aux rides along on
// every swap (see SimContext.swap), so the fume keeps its identity as it drifts
// up. Like Steam it rises and then condenses on a fixed per-tick chance — higher
// when the cell above is blocked, so vapor pooling under a lid rains out faster
// than vapor still rising freely. The lasting, legible result is the coloured,
// density-stratified liquid layers it leaves behind, so one neutral grey fume
// serves for all three cuts — and it condenses briskly enough that the fume
// turns back to liquid quickly instead of building into a big lingering cloud.
const CONDENSE_CHANCE = 0.01;
const CONDENSE_CHANCE_BLOCKED = 0.04;

// --- Catalytic cracking -------------------------------------------------------
// Vapour touching a Catalyst face breaks apart: its molecules crack into
// Ethylene, the monomer the plastics line runs on (see ethylene.ts), with the
// balance left behind as sooty carbon (Ash).
//
// The catalyst is the ONLY condition — there is no temperature gate. That is a
// correction, not a simplification. This used to crack on heat alone at 850°,
// and that recipe was unreachable in play: vapour conducts at 0.08, so hauling
// a cell from its 110° birth up to 850° takes on the order of a hundred ticks,
// while condensation fires at 1~4% every tick. The fume rained out as liquid cut
// long before it ever got hot, that condensate dropped to ambient and then
// autoignited (gasoline: 400°) inside the very vessel meant to crack it, and the
// charge burned away. Measured in a sealed iron cracker whose lining was pinned
// at temperature forever — a better heat source than any real build — a 60-cell
// naphtha charge returned ZERO ethylene at 900°, 1050° and 1150°. The gate was
// not mistuned, it was unreachable by construction, so it is gone.
//
// Cracking still only ever happens to the *vapour*, never to a pot of liquid
// cut, and that is what keeps the still in the loop: a liquid sitting on a
// catalyst bed does nothing, so the player must still boil their feedstock to
// deliver it. `refluxBoil` flashes every cut to vapour at its boiling point + 60
// (gasoline: 260°), and the vapour rises, so the natural build is a heated pool
// of cut with a catalyst roof over it. The reflux system that keeps a still from
// setting itself on fire doubles, for free, as the thing that routes feedstock
// into the cracker as gas.
//
// Yield follows the aux tag, i.e. which cut this vapour came off as — naphtha
// (the gasoline cut) is the best cracking feedstock, exactly as in a real
// cat cracker, so there's a reason to distil properly and feed the light cut
// rather than shovelling in whatever boiled off.
//
// Per-tick rate on a catalyst face, matching Ethylene's own CATALYST_CHANCE so
// the two halves of the bed run at the same visible pace.
const CATALYST_CRACK_CHANCE = 0.15;

function crackYield(code: number): number {
  if (code === 2) return 0.6; // kerosene
  if (code === 3) return 0.4; // diesel
  return 0.85; // gasoline / naphtha — the intended feedstock
}

function condenseTarget(code: number): number {
  if (code === 2) return KEROSENE.id;
  if (code === 3) return DIESEL.id;
  return GASOLINE.id;
}

/** True if any of the 8 neighbours is a catalyst face. */
function onCatalyst(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === CATALYST.id) return true;
  }
  return false;
}

function updatePetroleumVapor(x: number, y: number, sim: SimContext): void {
  // Checked before condensation: on the bed the vapour is being cracked, not
  // collected, so it must not be able to rain out as a cut first.
  if (onCatalyst(x, y, sim) && sim.chance(CATALYST_CRACK_CHANCE)) {
    const ethylene = sim.chance(crackYield(sim.getAux(x, y)));
    // In-place `set` keeps the temperature, so the fresh monomer comes off the
    // bed as hot as the fume that fed it. That matters: vapour boiled off at
    // 260° cracks to 260° ethylene, which is above the 200° polymerization
    // ceiling and so drifts and cools before it can set (see ethylene.ts) —
    // the temperature gradient does the staging for free, with no special case.
    sim.set(x, y, ethylene ? ETHYLENE.id : ASH.id);
    // Drop the cut tag: it meant "which liquid do I condense back into", and
    // neither product condenses into anything.
    sim.setAux(x, y, 0);
    return;
  }
  const blocked = !sim.inBounds(x, y - 1) || !sim.isEmpty(x, y - 1);
  if (sim.chance(blocked ? CONDENSE_CHANCE_BLOCKED : CONDENSE_CHANCE)) {
    // Condensing means it has shed its heat — drop back to ambient so the fresh
    // liquid doesn't sit hot and immediately re-distil into vapor. In-place set
    // to a non-empty material keeps the temperature we just wrote; the leftover
    // aux code is harmless on a liquid that never reads it.
    const target = condenseTarget(sim.getAux(x, y));
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, target);
    return;
  }
  updateGas(x, y, sim);
}

export const PETROLEUM_VAPOR = register({
  id: 59,
  name: 'Petroleum Vapor',
  phase: Phase.Gas,
  color: rgb(190, 180, 165),
  density: 1.2,
  category: 'oil',
  thermal: { init: 110, conductivity: 0.08 },
  update: updatePetroleumVapor,
});
