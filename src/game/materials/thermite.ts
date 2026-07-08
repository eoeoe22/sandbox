import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
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
// game and *melts its way through terrain*, leaving a puddle of Molten Metal
// where it was (the real reaction reduces iron oxide to molten iron). It's the
// game's cutting torch: drop it on a Stone wall or an Iron plate and it eats a
// hole clean through, turning what it touches molten.
//
// It uses its per-cell `aux` byte as a burn countdown — the first material here
// to need a real timed state, which is exactly what `aux` was added for. While
// aux > 0 the cell is burning: it pins itself to a blistering BURN_TEMP (so its
// conducted heat alone melts neighbors), turns adjacent Stone→Lava,
// Sand/Glass→Molten Glass and Iron→Molten Metal, wreathes itself in Fire, and
// counts down; when the timer runs out the cell collapses into the Molten Metal
// it "smelted". Unlit, it's just a dense powder that falls and piles.
//
// It lights the way the explosives detect their triggers — by scanning for
// flame/blast ids, not via the `flammable` tag — plus an autoignition point so
// enough radiant heat sets it off with no direct contact. A burning cell's
// wreath-Fire and its pinned heat together chain the reaction through a whole
// pile.
const AUTOIGNITE_TEMP = 900;
const BURN_TEMP = 2800; // hotter than Blue Flame (1800) → melts everything it touches
const BURN_TICKS = 30; // ~0.5 s of cutting at 60 Hz (fits in aux's 0..255 range)
const MELT_CHANCE = 0.3; // per-tick chance to melt one adjacent meltable cell
const WREATH_CHANCE = 0.25; // …and to drop a lick of Fire into open air

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
    // Spent: collapse into the Molten Metal it smelted (keeps the hot temp via
    // in-place set, so it reads as molten and flows before cooling to Iron).
    sim.setAux(x, y, 0);
    sim.set(x, y, MOLTEN_METAL.id);
    return;
  }
  sim.setAux(x, y, timer - 1);
}

function updateThermite(x: number, y: number, sim: SimContext): void {
  const timer = sim.getAux(x, y);
  if (timer > 0) {
    burnInPlace(x, y, sim, timer);
    return;
  }

  let ignite = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  if (!ignite) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      // A neighboring flame/blast, or an already-burning Thermite cell (pinned
      // hot), lights this grain — the latter is what chains the reaction fast
      // through a pile even where no Fire licks between two touching grains.
      if (isIgniter(nid) || (nid === THERMITE.id && sim.getTemp(nx, ny) >= AUTOIGNITE_TEMP)) {
        ignite = true;
        break;
      }
    }
  }

  if (ignite) {
    // Arm the burn timer and pin hot; it burns in place from next tick.
    sim.setAux(x, y, BURN_TICKS);
    sim.setTemp(x, y, BURN_TEMP);
    return;
  }

  updatePowder(x, y, sim);
}

export const THERMITE = register({
  id: 54,
  name: 'Thermite',
  phase: Phase.Powder,
  color: rgb(120, 110, 90),
  density: 5,
  category: '폭발',
  // Conducts moderately so a burning grain's heat reaches and lights the next
  // grain in a pile even without a Fire cell between them.
  thermal: { conductivity: 0.4 },
  update: updateThermite,
});
