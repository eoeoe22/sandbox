import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { GUNPOWDER } from './gunpowder';
import { SULFUR } from './sulfur';
import { SALTPETER } from './saltpeter';
import { COAL_POWDER } from './coalpowder';

// 흑색화약 조합 — the game's one *three-body* recipe: Sulfur + Saltpeter + Coal
// Powder touching each other turn into Gunpowder. Black powder is exactly those
// three ingredients ground together, so this is the one crafting step the
// palette really wanted: instead of Gunpowder only ever coming out of the
// palette, you can now *make* it out of three ordinary powders you poured into
// the same pile.
//
// Why it lives in its own module rather than in any one ingredient's file: the
// recipe is symmetric — a grain of *any* of the three drives it — so all three
// updates call this same helper as their first step. Putting it in one of them
// would make the other two import a peer ingredient for a rule that isn't
// really theirs.
//
// The declarative reaction table (engine/reactions.ts) can't express this: it's
// strictly 2-body (`with` + `otherBecomes`), and a chain of pairwise rules would
// let two ingredients convert without the third ever being present — the whole
// point is that all three must meet.
//
// Ratio: real black powder is ~75:15:10 saltpeter:charcoal:sulfur, but the
// recipe here is one grain of each (three cells in → three Gunpowder cells out,
// mass-conserving and trivially readable in a pile). That's a deliberate
// 편의성 concession — metering out a 75:15:10 mix by hand with a pixel brush
// would be tedious rather than fun.
const MIX_CHANCE = 0.25; // ~4 ticks from contact to powder — quick, not instant

// Grinding, not burning: a grain hot enough to be reacting on its own (Sulfur
// autoignites at 250°, Saltpeter decomposes at 400°) is busy doing that instead.
// Set below both so a pile that's caught fire burns rather than quietly turning
// into Gunpowder mid-flame.
const MIX_MAX_TEMP = 150;

// Ingredient ids, resolved lazily on first use. Sulfur/Saltpeter/Coal Powder all
// import this module and this module imports them back, so reading `.id` at
// module scope would run while one of those files is still initializing (the
// same circular-import trap coalpowder.ts's `mixIds` documents). Inside a
// function it's always long after every module has finished loading.
let ids: { sulfur: number; saltpeter: number; coal: number } | undefined;

/**
 * Try the black-powder recipe from the grain at (x,y), which must be one of the
 * three ingredients. Looks for the other two among its 8 neighbors and, on a
 * MIX_CHANCE roll, turns all three cells into Gunpowder. Returns true if it
 * fired (the caller must stop — this cell is Gunpowder now, not its own
 * material), false to carry on with the ingredient's normal behavior.
 */
export function tryMixGunpowder(x: number, y: number, sim: SimContext): boolean {
  const { sulfur, saltpeter, coal } = (ids ??= {
    sulfur: SULFUR.id,
    saltpeter: SALTPETER.id,
    coal: COAL_POWDER.id,
  });

  if (sim.getTemp(x, y) > MIX_MAX_TEMP) return false;

  // Slot the calling cell into its own ingredient position, then fill the two
  // empty slots from the neighborhood. -1 = not found yet.
  const selfId = sim.get(x, y);
  let sx = -1;
  let sy = -1;
  let px = -1;
  let py = -1;
  let cx = -1;
  let cy = -1;
  if (selfId === sulfur) {
    sx = x;
    sy = y;
  } else if (selfId === saltpeter) {
    px = x;
    py = y;
  } else {
    cx = x;
    cy = y;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    // Already processed this tick — it may have swapped elsewhere, and writing
    // it would be a same-tick double transform. It'll be pickable next tick.
    if (sim.hasMoved(nx, ny)) continue;
    if (sim.getTemp(nx, ny) > MIX_MAX_TEMP) continue;
    const nid = sim.get(nx, ny);
    if (nid === sulfur && sx < 0) {
      sx = nx;
      sy = ny;
    } else if (nid === saltpeter && px < 0) {
      px = nx;
      py = ny;
    } else if (nid === coal && cx < 0) {
      cx = nx;
      cy = ny;
    }
  }

  if (sx < 0 || px < 0 || cx < 0) return false;
  if (!sim.chance(MIX_CHANCE)) return false;

  // All three become Gunpowder. `set` keeps each cell's temperature (no heat of
  // mixing — grinding powder together doesn't light it), and every cell is
  // marked moved so no participant re-reacts or gets picked up as an ingredient
  // again later in this same scan (the same discipline engine/reactions.ts
  // applies to its two-body reactions).
  becomeGunpowder(sx, sy, sim);
  becomeGunpowder(px, py, sim);
  becomeGunpowder(cx, cy, sim);
  return true;
}

function becomeGunpowder(x: number, y: number, sim: SimContext): void {
  sim.set(x, y, GUNPOWDER.id);
  sim.markMoved(x, y);
}
