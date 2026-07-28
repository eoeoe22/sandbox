import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STONE } from './stone';
import { FIRE } from './fire';
import { WATER } from './water';
import { STEAM } from './steam';
import { OBSIDIAN } from './obsidian';

// Liquid: flows like water but gated behind a per-tick probability so it
// visibly moves slower/thicker (density > water, so water floats and sand
// sinks). Lava is placed molten-hot; it solidifies to Stone once it has *cooled*
// past a threshold rather than the instant it touches water. Cooling is driven
// entirely by the heat-conduction system: water poured on top boils away and
// carries heat off, and — crucially — heat keeps conducting *through* the Stone
// crust that forms at the interface, so the lava underneath keeps losing heat
// and freezes too. The crust slows solidification but never fully blocks it.
//
// Because Empty (air) conducts no heat, a lava blob with nothing cold touching
// it never cools below the freeze point, so isolated lava stays molten forever
// (matching its original behavior) — it's specifically a cold sink like water
// that lets it set. (A cold solid within a couple of cells, even without
// touching, does draw a little heat away via the near-field radiative pass —
// see RADIANT_HEAT_RANGE in config.ts — but a truly isolated blob with nothing
// in range stays molten exactly as before.)
//
// That slow crust is the *cooling* path. Lava that touches Water head-on takes
// a second, much faster path instead: it quenches to Obsidian four cells deep on
// the spot (see tryQuenchToObsidian below), which is what a water splash on a
// lava lake now produces rather than a gradual grey skin.
const IGNITE_CHANCE = 0.15;
const FLOW_CHANCE = 0.15;

// Placement temperature and the point it hardens at. The wide gap between them
// is what makes crusting gradual: the surface has to shed a lot of heat before
// it sets, so a lava/water interface skins over across many ticks.
const LAVA_TEMP = 1500;
const LAVA_FREEZE_TEMP = 560;

// --- Water quench → Obsidian ------------------------------------------------
// The gradual crust above is what happens when lava merely *cools*. Lava that
// touches Water head-on is a different event: the melt is chilled far too fast
// to set as crystalline rock, so it freezes as black volcanic glass instead —
// Obsidian (see obsidian.ts). Minecraft's water+lava recipe, and by far the
// most fun way to get the game's one buildable blast-proof block.
//
// The quench reaches FOUR cells in from the contact face (접촉 부위에서 4칸
// 깊이): the lava cell actually touching the water, plus the three lava cells
// lined up directly behind it along the same direction. One tick of contact
// therefore lays down a four-thick slab rather than a skin, so a single splash
// gives you a wall with real substance instead of a film the pool immediately
// re-melts — and a thick slab is what makes the material survivable at all,
// since only the innermost layer is exposed to the molten pool while the outer
// three are free to keep shedding heat. Deeper lava is untouched: it has to be
// reached by its own contact with water (or by the next splash) to set.
const OBSIDIAN_QUENCH_DEPTH = 4;

// The temperature the quenched cells are left at. It has to be *well* below
// Obsidian's 1100° melting point, not just below it: the innermost quenched
// cell is still touching molten 1500° lava on its far side, and conduction
// starts pulling it back up the moment it forms. Leaving it this cold gives the
// fresh slab the headroom to survive that (and to keep drawing heat out of the
// pool behind it) instead of melting straight back into the lava it came from.
const OBSIDIAN_QUENCH_TEMP = 300;

// The water doesn't survive the exchange — it's the heat sink that made the
// quench possible, so it flashes off as a puff of Steam (and is consumed, which
// is what keeps one puddle from converting an unbounded amount of lava; cf.
// Cement curing on the water that sets it). The steam is left hot to read as a
// proper quench flash rather than a lukewarm cloud; the swap still removes far
// more heat than it adds, since a whole column just dropped from 1500° to 300°.
const QUENCH_STEAM_TEMP = 300;

/** Water touching this lava cell? Then quench: this cell and the run of lava
 *  behind it (away from the water) set as Obsidian, and the water flashes to
 *  Steam. Returns true if the cell was consumed — the caller must stop touching
 *  it.
 *
 *  DIR4, not DIR8, and that matters for more than pedantry about what "직접
 *  접촉" means: the quench walks *inward along the contact direction*, so a
 *  diagonal match would drive the slab off at 45° and, worse, would
 *  let a lava cell one to the side reach up and claim the water first (scan
 *  order runs left to right), leaving the shell visibly offset from the splash
 *  that made it. Face contact only keeps the slab square under the water. */
function tryQuenchToObsidian(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) !== WATER.id) continue;

    // Walk inward from the contact face, away from the water, converting the
    // lava we find. Stop at the first non-lava cell: the shell should trace the
    // molten body, not punch through a wall behind it into a second pool.
    for (let d = 0; d < OBSIDIAN_QUENCH_DEPTH; d++) {
      const cx = x - dx * d;
      const cy = y - dy * d;
      if (!sim.inBounds(cx, cy) || sim.get(cx, cy) !== LAVA.id) break;
      sim.set(cx, cy, OBSIDIAN.id);
      // `set` on a non-empty write keeps the cell's temperature, so the quench
      // has to be stamped explicitly — otherwise the new Obsidian would inherit
      // lava's 1500° and melt right back on its own update this same tick.
      sim.setTemp(cx, cy, OBSIDIAN_QUENCH_TEMP);
    }

    sim.set(nx, ny, STEAM.id);
    sim.setTemp(nx, ny, Math.max(sim.getTemp(nx, ny), QUENCH_STEAM_TEMP));
    return true;
  }
  return false;
}

function updateLava(x: number, y: number, sim: SimContext): void {
  // Direct water contact wins over the slow cool-to-Stone path below: a cell
  // that has already chilled to the freeze point but is still touching water
  // sets as glass, not rock.
  if (tryQuenchToObsidian(x, y, sim)) return;

  if (sim.getTemp(x, y) <= LAVA_FREEZE_TEMP) {
    // Cooled enough to set. In-place `set` keeps the cell's (now low)
    // temperature, so the fresh Stone reads as cold rock and keeps conducting
    // heat out of whatever molten lava is still beneath it.
    sim.set(x, y, STONE.id);
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (getMaterial(nid).flammable && sim.chance(IGNITE_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }

  // No `return` above (intentionally — lets several neighbors ignite in one
  // tick), so a just-ignited Fire neighbor is live grid state by the time we
  // reach here: if the flow gate fires and picks that direction, Lava (denser
  // than Fire) can immediately swap into the cell it just ignited, pushing
  // the Fire out to Lava's old position. Both cells end up `moved`, so this
  // isn't a same-tick runaway — just a legitimate density-sorted swap that
  // makes ignition-then-displacement visually chase itself forward.
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const LAVA = register({
  id: 10,
  name: 'Lava',
  phase: Phase.Liquid,
  color: rgb(220, 70, 20),
  density: 4.5,
  category: 'fire',
  thermal: { init: LAVA_TEMP, conductivity: 0.6 },
  // Molten lava glows bright orange (base color); as conduction cools it toward
  // the freeze point it darkens to a dull ember, so the crust and the cooling
  // front beneath it are visible before they turn to grey Stone.
  glow: { min: LAVA_FREEZE_TEMP, max: LAVA_TEMP, cool: rgb(120, 28, 12) },
  update: updateLava,
});
