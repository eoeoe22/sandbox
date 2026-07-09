import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { AMBIENT_TEMP } from '../config';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { BLAST } from './blast';
import { STONE } from './stone';
import { SAND } from './sand';
import { GLASS } from './glass';
import { IRON } from './iron';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';

// Thermite — a powder that, once lit, burns hotter than anything else in the
// game and *melts its way through terrain*. Its life is a three-beat arc:
//
//   1. Ignite — a flame/blast/hot neighbor, or enough radiant heat, lights it.
//   2. Molten burn — for BURN_TICKS it pins itself to a blistering BURN_TEMP,
//      glows white-hot, and cuts: Stone→Lava, Sand/Glass→Molten Glass,
//      Iron→Molten Metal, flammables→Fire, wreathing itself in flame. This is
//      the "cutting torch" window, and lasts the same ~BURN_TICKS as ever.
//   3. Fade — when the burn timer runs out it does NOT blink out instantly.
//      It becomes a spent but still-molten blob that stops re-heating itself
//      and slowly evaporates, leaving nothing behind. While still hot it fades
//      only a little each tick; as conduction bleeds its heat away (into terrain
//      it rests on) it cools and vanishes much faster. A blob hanging in open
//      air — which conducts no heat — stays hot and lingers longest, still
//      slowly winking out.
//
// The molten/fading heat is shown by a temperature glow (see `glow` below):
// blazing near BURN_TEMP and darkening to the dull tan powder color as it cools,
// so the burn and the slow cooling-fade are both visible. Unlit, it's just a
// dense powder that falls and piles.
//
// It uses its per-cell `aux` byte as its whole state: 0 = unlit, 1..BURN_TICKS =
// the molten-burn countdown, and AUX_FADING = the spent cooling blob. It lights
// the way the explosives detect their triggers — scanning for flame/blast ids,
// not via the `flammable` tag — plus an autoignition point so radiant heat alone
// sets it off. A burning (or still-hot fading) cell chains the reaction through
// a whole pile via its wreath-Fire and its pinned/residual heat.
const AUTOIGNITE_TEMP = 900;
const BURN_TEMP = 2800; // hotter than Blue Flame (1800) → melts everything it touches
const BURN_TICKS = 30; // ~0.5–1 s of cutting (fits in aux's 0..255 range)
const MELT_CHANCE = 0.3; // per-tick chance to melt one adjacent meltable cell
const WREATH_CHANCE = 0.25; // …and to drop a lick of Fire into open air

// Spent-blob marker. 255 can't collide with the 1..BURN_TICKS burn countdown, so
// a fading cell is never mistaken for "unlit" (aux 0) and re-ignited by its own
// residual heat — which would otherwise trap it in an endless burn.
const AUX_FADING = 255;
// Fade-out chance per tick: small while molten-hot (evaporates only a little at a
// time), ramping up as it cools toward ambient (cools → vanishes faster).
const FADE_HOT_TEMP = 1200; // at/above this it's still fully molten → fades slowly
const FADE_SLOW_CHANCE = 0.03; // per-tick vanish while hot
const FADE_FAST_CHANCE = 0.28; // per-tick vanish once cooled

function isIgniter(id: number): boolean {
  return (
    id === FIRE.id ||
    id === LAVA.id ||
    id === BLUE_FLAME.id ||
    id === BLAST.id ||
    id === MOLTEN_METAL.id ||
    id === MOLTEN_GLASS.id
  );
}

function shouldIgnite(x: number, y: number, sim: SimContext): boolean {
  if (sim.getTemp(x, y) >= AUTOIGNITE_TEMP) return true;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    // A neighboring flame/blast, or an already-hot Thermite cell (burning, or
    // still molten while fading), lights this grain — the latter is what chains
    // the reaction fast through a pile even where no Fire licks between two
    // touching grains.
    if (isIgniter(nid) || (nid === THERMITE.id && sim.getTemp(nx, ny) >= AUTOIGNITE_TEMP)) {
      return true;
    }
  }
  return false;
}

function burnInPlace(x: number, y: number, sim: SimContext, timer: number): void {
  // Re-pin heat so diffusion into cooler neighbors can't quietly cool the front
  // below its own autoignition and stall it.
  sim.setTemp(x, y, BURN_TEMP);

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      if (sim.chance(WREATH_CHANCE)) sim.spawn(nx, ny, FIRE.id);
    } else if (nid === STONE.id) {
      if (sim.chance(MELT_CHANCE)) sim.spawn(nx, ny, LAVA.id);
    } else if (nid === SAND.id || nid === GLASS.id) {
      if (sim.chance(MELT_CHANCE)) sim.spawn(nx, ny, MOLTEN_GLASS.id);
    } else if (nid === IRON.id) {
      if (sim.chance(MELT_CHANCE)) sim.spawn(nx, ny, MOLTEN_METAL.id);
    } else if (getMaterial(nid).flammable && sim.chance(MELT_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }

  if (timer <= 1) {
    // Active burn spent → hand off to the fading state: a still-molten blob that
    // cools and slowly evaporates (it does NOT vanish this instant). Keep the hot
    // temp so it reads as molten and keeps chaining/cutting by conduction until
    // it cools. The swap in updatePowder carries the fading marker + heat along.
    sim.setAux(x, y, AUX_FADING);
    updatePowder(x, y, sim);
    return;
  }
  sim.setAux(x, y, timer - 1);
  // Keep settling while it burns: an ignited grain still falls/piles like the
  // powder it is, so a lit clump doesn't freeze in mid-air (which read as a
  // glitch). Where it rests on terrain it melts and then sinks into the puddle,
  // drilling downward. The swap carries its hot temp and burn timer along.
  updatePowder(x, y, sim);
}

function fadeInPlace(x: number, y: number, sim: SimContext): void {
  // Spent, cooling molten residue: it evaporates a little each tick while hot and
  // much faster as it cools, then leaves nothing behind. It no longer pins its own
  // heat, so a blob resting on terrain sheds heat into it and vanishes quickly,
  // while one hanging in open air (which conducts nothing) stays hot and lingers,
  // still slowly winking out.
  const t = sim.getTemp(x, y);
  let f = (FADE_HOT_TEMP - t) / (FADE_HOT_TEMP - AMBIENT_TEMP);
  if (f < 0) f = 0;
  else if (f > 1) f = 1;
  const chance = FADE_SLOW_CHANCE + (FADE_FAST_CHANCE - FADE_SLOW_CHANCE) * f;
  if (sim.chance(chance)) {
    // Fully consumed. set(EMPTY) also scrubs the fading marker (aux) and resets
    // temp to ambient, so no stale state or leftover warmth lingers where it burned.
    sim.set(x, y, EMPTY);
    return;
  }
  updatePowder(x, y, sim); // the shrinking blob still settles as it fades
}

function updateThermite(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);

  if (aux === AUX_FADING) {
    fadeInPlace(x, y, sim);
    return;
  }

  if (aux === 0) {
    // Unlit powder — ignite this tick, or just fall and pile.
    if (!shouldIgnite(x, y, sim)) {
      updatePowder(x, y, sim);
      return;
    }
    // Caught → start the molten burn (BURN_TICKS of cutting; burnInPlace pins the
    // heat and steps the countdown down from here).
    burnInPlace(x, y, sim, BURN_TICKS);
    return;
  }

  // Molten-burn countdown (aux in 1..BURN_TICKS).
  burnInPlace(x, y, sim, aux);
}

export const THERMITE = register({
  id: 54,
  name: 'Thermite',
  phase: Phase.Powder,
  // Base color is the white-hot molten end of the glow ramp; unlit (at ambient)
  // it renders as the dull tan `glow.cool` powder color instead.
  color: rgb(255, 190, 90),
  density: 5,
  category: '폭발',
  // Conducts moderately so a burning grain's heat reaches and lights the next
  // grain in a pile even without a Fire cell between them.
  thermal: { conductivity: 0.4 },
  // Glows blazing while molten and darkens to a dull tan as conduction cools it,
  // so the burn and the slow cooling-fade are both visible before it evaporates.
  glow: { min: AMBIENT_TEMP, max: BURN_TEMP, cool: rgb(120, 110, 90) },
  update: updateThermite,
});
