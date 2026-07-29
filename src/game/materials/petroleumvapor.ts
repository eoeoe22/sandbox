import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { GASOLINE } from './gasoline';
import { KEROSENE } from './kerosene';
import { DIESEL } from './diesel';
import { ASH } from './ash';
import { ETHYLENE } from './ethylene';

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

// --- Steam cracking -----------------------------------------------------------
// Driven far past any distillation temperature, the vapour stops being a cut
// waiting to condense and breaks apart instead: its molecules crack into
// Ethylene, the monomer the plastics line runs on (see ethylene.ts), with the
// balance left behind as sooty carbon (Ash).
//
// CRACK_TEMP sits at the same 850° as the smelting line's ore melt, which is a
// deliberate reuse of a rung the player already knows: a bare wood/oil fire
// (pinned 800°) can drive a still but can NOT reach this, so cracking is the
// point where the petroleum line has to borrow the furnace techniques — one cell
// of Oxygen on the fire (1050°, still under Iron's 1200° melt so an iron furnace
// survives), or a coal fire in a Diamond/Heatpipe vessel.
//
// This is also why cracking can only ever happen to the *vapour*, never to a
// pot of liquid cut: `refluxBoil` flashes every cut to vapour for certain at its
// boiling point + 60° (gasoline: 260°), so a liquid physically cannot be carried
// up to 850° in the first place. The reflux system that keeps a still from
// setting itself on fire doubles, for free, as the thing that routes feedstock
// into the cracker as gas.
//
// Yield follows the aux tag, i.e. which cut this vapour came off as — naphtha
// (the gasoline cut) is the best cracking feedstock, exactly as in a real
// steam cracker, so there's a reason to distil properly and feed the light cut
// rather than shovelling in whatever boiled off.
const CRACK_TEMP = 850;

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

function updatePetroleumVapor(x: number, y: number, sim: SimContext): void {
  // Checked before condensation: in the cracker's hot zone the vapour is being
  // destroyed, not collected, so it must not be able to rain out as a cut first.
  if (sim.getTemp(x, y) >= CRACK_TEMP) {
    const ethylene = sim.chance(crackYield(sim.getAux(x, y)));
    // In-place `set` keeps the (very hot) temperature, so the fresh monomer
    // comes out of the furnace at furnace heat and has to be quenched before it
    // is any use — that quench is the challenge (see ethylene.ts).
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
