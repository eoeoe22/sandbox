import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { GALLIUM } from './gallium';
import { ALUMINUM } from './aluminum';
import { ALUMINUM_POWDER } from './aluminumpowder';
import { ACTIVATED_ALUMINUM } from './activatedaluminum';

// Liquid Gallium — the molten counterpart to solid Gallium, but at a
// theatrically low temperature: Gallium's whole party trick is that it melts
// with the faintest warmth (melt point just above room temperature, see
// GALLIUM_MELT_TEMP), so a silvery bar slumps into a shiny puddle the moment
// anything warm touches it — the classic "metal that melts in your hand". It's
// a proper liquid metal like Mercury: `conductive`, so a Spark runs through a
// gallium puddle exactly as through solid metal, and it beads up a little with
// surface tension. Lighter than Mercury (density 6 vs 9) so it floats where
// Mercury sinks. Like every molten pair (Iron↔Molten Metal, Lava↔Stone) it
// freezes back to solid Gallium once conduction pulls it below the set point.
//
// Melt/freeze use a small hysteresis gap so a cell hovering right at the melt
// point doesn't flicker between solid and liquid every tick.
export const GALLIUM_MELT_TEMP = 30;
const GALLIUM_FREEZE_TEMP = 28;

// Gallium's *other* famous party trick, and the one thing in the game that
// destroys a metal without heat, acid or explosives: **liquid gallium
// embrittles aluminum**. It wicks along the grain boundaries of solid aluminum
// and the metal falls apart in your hands — the aluminum-can-torn-like-paper
// demo. Here that reads as a cast Aluminum cell crumbling into Aluminum Powder
// on contact, which is exactly the right product: the bar doesn't melt or
// dissolve, it turns back into the dust it was poured from (and can be melted
// and recast, so the loop closes).
//
// Three things make this a *mechanic* rather than a second acid:
//
//  • **The gallium is not consumed.** `otherBecomes` transforms the aluminum
//    and `produce` is omitted, so this cell is untouched — the textbook
//    one-sided reaction engine/reactions.ts documents. One drop keeps eating,
//    following the powder down as the wall gives way. That is the real
//    behaviour (gallium alloys into the aluminum rather than being spent) and
//    it's what makes it feel like corrosion rather than a consumable.
//  • **It only works as a liquid**, because only this material declares it —
//    solid Gallium (which is the same metal two degrees colder) does nothing.
//    So the off switch is temperature: chill the puddle under 28° and it
//    freezes mid-meal and stops. Nothing else in the game is disarmed by
//    cooling it.
//  • **It is aluminum-specific.** Acid eats every solid and powder that isn't
//    tagged acid-resistant; this touches exactly one material, so it's a
//    surgical tool for the one metal that is otherwise cheap and everywhere.
//
// Per-tick, per-contact — near Acid's own 0.03 corrosion rate, so a face
// visibly eats away over a beat or two rather than a bar vanishing at once.
const ALUMINUM_EMBRITTLE_CHANCE = 0.03;

// The *other* half of the same real phenomenon, and the reason the first half
// is only a demolition trick: what gallium actually destroys is the passivating
// oxide film, and aluminum without that film is a different material. So the
// same puddle, applied to the powder instead of the bar, doesn't crumble
// anything — it **activates** it, and the dust starts tearing hydrogen out of
// any water it touches (see activatedaluminum.ts).
//
// Structurally it is the embrittlement rule again — `otherBecomes` transforms
// the aluminum, `produce` is omitted so this cell is untouched — and that is
// what makes gallium a genuine catalyst here rather than a consumable: one drop
// converts a whole heap, exactly as it does in the demonstrations this comes
// from. It also means the two rules read as one behaviour with two targets:
// 갈륨은 알루미늄의 산화막을 벗긴다 — 덩어리에 하면 부서지고, 가루에 하면 물과
// 반응하는 연료가 된다.
//
// Slower than the embrittlement (0.03): activation is the film dissolving into
// the grain rather than a wall giving way, and a heap converts grain by grain
// over a beat or two so a player can watch the colour change spread.
const ALUMINUM_ACTIVATE_CHANCE = 0.02;

function updateLiquidGallium(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again
  // (a moving conductor, exactly like Mercury).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (sim.getTemp(x, y) <= GALLIUM_FREEZE_TEMP) {
    // Cooled enough to set. In-place `set` keeps the (now low) temperature so
    // the fresh solid Gallium reads as cold and doesn't instantly re-melt.
    sim.set(x, y, GALLIUM.id);
    return;
  }
  updateLiquid(x, y, sim);
}

export const LIQUID_GALLIUM = register({
  id: 117,
  name: 'Liquid Gallium',
  phase: Phase.Liquid,
  color: rgb(198, 206, 218),
  density: 6,
  conductive: true,
  category: 'liquid',
  // Beads up like Mercury (표면장력) — scattered drops round into shiny balls.
  surfaceTension: 0.5,
  // A smooth mirror-like metal, so it renders as a flat single colour rather
  // than sampling the shimmering background tint field (mirrors Mercury).
  colorVary: 0,
  // A shiny liquid-metal surface is a mirror: a Heat Ray beam reflects cleanly off
  // it (정반사) just like Mercury (see heatray.ts) — this takes priority over the
  // ordinary liquid absorb/scatter path.
  laserReflective: true,
  // Placed just above its melt point so a freshly poured puddle stays liquid;
  // conducts heat well like the other metals.
  thermal: { init: 35, conductivity: 0.7 },
  // Embrittles solid Aluminum into Aluminum Powder without being consumed —
  // see ALUMINUM_EMBRITTLE_CHANCE above for why it's declared on this side.
  reactions: [
    {
      with: ALUMINUM.id,
      otherBecomes: ALUMINUM_POWDER.id,
      probability: ALUMINUM_EMBRITTLE_CHANCE,
    },
    // …and the powder it leaves behind (or any other) is activated by the same
    // drop, on the same one-sided terms — see ALUMINUM_ACTIVATE_CHANCE above.
    // Declared on this side for the same import-graph reason the embrittlement
    // rule is: the aluminum modules never import gallium, so there is no edge
    // coming back and no module-scope mutual dependency to get wrong.
    {
      with: ALUMINUM_POWDER.id,
      otherBecomes: ACTIVATED_ALUMINUM.id,
      probability: ALUMINUM_ACTIVATE_CHANCE,
    },
  ],
  update: updateLiquidGallium,
});
