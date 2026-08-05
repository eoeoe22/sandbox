import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid, collapseVoidBelow } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn } from './combustion';
import { ASH } from './ash';
import { SALTPETER } from './saltpeter';
import { ROCKET_CANDY } from './rocketcandy';

// Caramel (캐러멜) — what Sugar becomes when you *cook* it instead of setting it
// alight. A sugar grain heated past sugar.ts's CARAMELIZE_TEMP stops being a
// grain and turns into this: a hot, dark, syrupy liquid that oozes downhill,
// pools, and then sets hard where it stopped.
//
// It is the middle link of a chain that sugar.ts used to short-circuit. Heated
// sugar went straight to Ash with a comment claiming it "caramelised and then
// charred" — the caramel step existed only in prose. Now the two halves of that
// sentence are two temperatures and two materials:
//
//   Sugar --160°--> Caramel --250°--> Ash
//
// so overshooting the pan is a thing you can actually see happen, and the
// interesting middle state is something you can pour, dam, and build with.
//
// The material's whole personality is that it has TWO states and one id, keyed
// off temperature the way Slag's crust is (slag.ts, the template this follows):
//
//   • Hot (≥ SET_TEMP): a thick liquid. Thicker than Honey — it moves on only
//     FLOW_CHANCE of ticks and levels reluctantly on top of that — so a poured
//     blob strings and slumps rather than splashing.
//   • Cold (< SET_TEMP): hard toffee. The shared `freeze` spec stops it flowing
//     and stops denser material sinking through it, without swapping to a second
//     material, so a set slab that gets reheated melts and runs again. Pour a
//     puddle, let it set, and you have made a solid wall out of a liquid.
//
// The colour follows the same split through `glow` rather than through `freeze`'s
// frost tint: a frosted, icy-blue block is the right picture for chilled oil and
// exactly the wrong one for toffee, and `glow` is checked BEFORE the freeze frost
// in the renderer's branch chain (CanvasRenderer.render), so declaring one
// suppresses the other for free. Hot caramel reads bright amber and darkens into
// its `cool` toffee brown as it sets — the ramp doubles as a "is this still
// workable?" readout, which matters because the propellant recipe below is gated
// on exactly that window.

/** 응고점 — below this the pour stops and the toffee is hard (`freeze` holds it
 *  still). Well under sugar's 160° caramelisation point, so caramel that has just
 *  formed is always molten and has room to actually run somewhere before it
 *  sets. */
const SET_TEMP = 120;
/** 탄화점 — cooked too far. Past this the sugars char and the cell blackens into
 *  Ash, the second half of the burnt-sugar chain (sugar.ts owns the first). */
const CARBONIZE_TEMP = 250;
const CARBONIZE_CHANCE = 0.08;
/** 발화점 — inherited from Sugar, and the cap on the carbonise window above: a
 *  cell hot enough to burn must burn as a fuel rather than short-circuit to inert
 *  Ash (which isn't combustible, so the flame front would die on it). */
const AUTO_IGNITE_TEMP = 300;

// 로켓 캔디 조합 — melt-cast, the way the real thing is made: dissolve the
// oxidizer into the molten sugar and let the mix set. The recipe used to sit on
// Sugar and grind two cold powders together; it lives here now, and it is the
// reason the caramel step is worth a material rather than a colour change —
// making propellant is a *process* (heat the sugar, catch it in the window, pour
// the niter in) instead of a paint stroke.
//
// Declared on Caramel's side, not Saltpeter's, for the same import-direction
// reason sugar.ts documented: Saltpeter never imports Caramel, so reading
// `SALTPETER.id` eagerly in this register literal is safe in this direction and
// would be a live circular-import hazard in the other.
//
// Ratio stays one cell to one — the real mix is ~65:35 KNO₃:sugar, which is not
// something anyone wants to meter out with a pixel brush.
const CANDY_MIX_CHANCE = 0.25; // ~4 ticks from contact — quick, not instant
// The workable window, and it is exactly the window in which the material is
// *molten but not yet ruined*: both bounds are the two thresholds above rather
// than free-floating numbers, so the colour ramp the player is already reading
// tells them whether the mix will take.
//
//   • Below SET_TEMP the caramel has set hard and no longer wets the grains —
//     scrape cold toffee against niter and nothing happens.
//   • Above CARBONIZE_TEMP it is busy charring (250°) or burning (300°), and its
//     partner is on its way to decomposing on its own (Saltpeter, 400°).
//
// Same asymmetry the flash-powder and black-powder recipes document: reactions.ts
// checks the temperature of the *declaring* cell only, so this gates the caramel
// and never its saltpeter partner — cold niter poured into a hot pour still takes.
// That is the intended shape here, not a concession: the melt is what carries the
// heat, and it is self-closing at the top end because conduction from a burning
// neighbour lifts the caramel out of the window within a few ticks.
const CANDY_MIX_MIN_TEMP = SET_TEMP;
const CANDY_MIX_MAX_TEMP = CARBONIZE_TEMP;

/** Per-tick chance a hot cell moves at all. Thicker than Honey's 0.18 and a shade
 *  thicker than Lava's 0.15 — hot sugar syrup strings and slumps. Stacks with
 *  `viscosity` below: this sets how fast it moves, that how reluctantly it
 *  levels. */
const FLOW_CHANCE = 0.12;

function updateCaramel(x: number, y: number, sim: SimContext): void {
  // Direct flame (or self-ignition past 300°) → burns as a sugary fuel.
  if (tryBurn(x, y, sim)) return;

  // Cooked past the point of no return → char. Gated *below* the ignition point
  // for the same reason sugar.ts gates its own: an actually-burning cell is
  // pinned at combustion's 800°, and without the upper bound it would keep
  // short-circuiting to Ash instead of burning. Keeps the cell's temperature so
  // the fresh char reads as hot.
  const t = sim.getTemp(x, y);
  if (t >= CARBONIZE_TEMP && t < AUTO_IGNITE_TEMP && sim.chance(CARBONIZE_CHANCE)) {
    sim.set(x, y, ASH.id);
    return;
  }

  // Set toffee doesn't move. Checked here rather than left to `freeze` alone so
  // the throttle and the set point read as one rule (slag.ts does the same), and
  // so a cold cell skips the movement step outright instead of walking into it
  // and being turned back.
  if (t < SET_TEMP) return;

  // Enclosed holes collapse outside the flow gate — the fourth goo with both a
  // throttle and a high `viscosity`, and it pitted exactly like Slime and Honey
  // did (behaviors.ts's collapseVoidBelow).
  if (collapseVoidBelow(x, y, sim)) return;

  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const CARAMEL = register({
  id: 150,
  name: 'Caramel',
  phase: Phase.Liquid,
  // Hot end of the glow ramp: bright cooked amber. Deliberately redder and
  // deeper than the game's other warm browns (Honey 214/150/34, Amber 210/148/40,
  // Resin 198/120/38, Rocket Candy 222/178/118) so a pour is never mistaken for
  // one of them — and the ramp itself is the bigger tell, since none of those
  // four glow.
  color: rgb(186, 96, 34),
  // Molten sucrose (~1.33 g/cm³) is a touch lighter than honey (~1.42) and than
  // the sugar crystal it came from (1.59), and the game's tiers keep that order:
  // Sugar 3.65 > Honey 3.5 > Caramel 3.4 > Water 3. Still denser than water, so a
  // pour sinks and sets on the bottom of a pool instead of skinning over the top.
  density: 3.4,
  // Burns grudgingly and slowly, like the syrup it is — matched to Honey, the
  // other sugar liquid, rather than to loose Sugar (0.09), which has far more
  // surface per unit of fuel.
  combustion: { burnChance: 0.05, autoIgniteTemp: AUTO_IGNITE_TEMP },
  // 캐러멜 + 초석 → 로켓 캔디, while molten. Runs before `update`
  // (Simulation.updateCell), so a cell that takes up niter this tick doesn't also
  // try to burn, char or flow.
  reactions: [
    {
      with: SALTPETER.id,
      produce: ROCKET_CANDY.id,
      otherBecomes: ROCKET_CANDY.id,
      probability: CANDY_MIX_CHANCE,
      tempMin: CANDY_MIX_MIN_TEMP,
      tempMax: CANDY_MIX_MAX_TEMP,
    },
  ],
  // Filed with the liquids — that is the shelf someone goes to for something to
  // pour. Also listed under 가루 (설탕's tab), because the thing players will be
  // looking for it under is "what happened to my sugar".
  category: 'liquid',
  alsoIn: ['powder'],
  // Very viscous — holds a slumping mound instead of racing flat. A shade past
  // Honey's 0.8, the only other liquid in the game made of the same stuff.
  viscosity: 0.85,
  // Painted straight from the palette it arrives fresh off the heat, molten and
  // ready to work (Slag does the same with its own 1450°) — otherwise every
  // hand-placed cell would land as a hard block and the material's whole liquid
  // half would need a heat brush to see at all. Conducts like sugar, so a pour
  // gives its heat up to the floor and sets at a watchable pace.
  thermal: { init: 180, conductivity: 0.3 },
  // Molten amber cooling to set toffee. Also what suppresses `freeze`'s icy frost
  // tint — see the header.
  glow: { min: 20, max: 200, cool: rgb(96, 46, 20) },
  // Hard toffee below the set point: stops flowing and acts solid, and denser
  // material can no longer sink through the slab.
  freeze: { temp: SET_TEMP },
  update: updateCaramel,
});
