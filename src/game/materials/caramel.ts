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

/**
 * 저어 넣기 — 초석 더미 위에 부은 용융 캐러멜이 더미 속으로 파고든다. This is the half of
 * the recipe that decides whether it works *both* ways round, and it exists because
 * the engine only ever handled one of them.
 *
 * Poured the easy way — 초석 dropped into a caramel pool — the mix needs no help at
 * all: niter (4.3) outweighs the melt (3.4), and a Powder is allowed to displace a
 * Liquid, so the grains rain down through the pool and every one of them ends up
 * surrounded by caramel within a few ticks. Contact is renewed everywhere, for free,
 * by ordinary gravity.
 *
 * The other way round there is no such path, and what blocks it is a flat engine
 * rule rather than a density: `SimContext.isDisplaceable` answers **false for every
 * Powder**, whatever it weighs, so a liquid may never displace a grain. A pour onto a
 * pile therefore meets it along one flat seam and nowhere else — the seam converts in
 * the first handful of ticks, the fresh candy stands between the two ingredients, and
 * the mix is over. Measured before this existed: 38 cells of candy by tick 8 and not
 * one more in the following 300, with 92 cells of still-molten caramel sitting on top
 * of 180 cells of untouched niter. That is the whole of the 방향 비대칭 bug.
 *
 * The 겹침 (overlap) soak — this codebase's usual answer for a liquid that has to get
 * into a powder bed (water into sand, water into a cement pile) — cannot be the path
 * here, and it is worth writing down why so nobody re-tries it. A soaked fluid has
 * **no temperature of its own**: it reads its host's, and `enterOverlay` averages the
 * two on the way in, so a 180° melt entering a 20° grain is a ~100° pair the instant
 * it is inside — set toffee, with the recipe's window shut. Tried and measured: 99 of
 * 120 poured cells wicked all the way down to the floor of the pile and made two
 * cells of candy more than doing nothing at all.
 *
 * So the melt is stirred in as a *primary cell*, and by a swap, because a swap is
 * exactly what carries the thing the soak loses — `SimContext.swap` moves each cell's
 * temperature with it, so the melt arrives a row deeper still molten and still inside
 * the window.
 *
 * 접기 (the fold) is what makes it more than a one-row dent. A plain trade with the
 * grain below leaves that grain resting directly on the melt that displaced it, and
 * it simply sinks back through on its next turn: the pair churns in place, the front
 * cools, and the pour stalls two rows in (measured: 49 cells of candy against the
 * easy direction's 87 in the same scene). Instead the grain is carried to the TOP of
 * the molten column above and the whole column slides down one row to fill the gap —
 * one bulk motion, nothing created or destroyed, the same shape as the engine's own
 * column shifts. From there gravity does the rest of the work and does it exactly the
 * way the easy direction does: the grain is denser than the melt, so it sinks back
 * down through the entire pour, warming as it goes and meeting fresh melt the whole
 * way. The pour's heat gets *used* instead of being conducted away from a front that
 * has already set, and the two directions land within a few percent of each other
 * (99 against 95, 93 against 73, 76 against 64 across three pour/pile ratios).
 *
 * What the player sees is a pour that sinks into the pile while grains surface
 * through it, the mixed zone spreading down over a couple of seconds — mixing you
 * watch, not a pile that flips. Same idiom as `diffuseMiscible` (behaviors.ts) and
 * for the same reason: a pair with business together, stirred by an explicit swap
 * because the movement layer's blanket density sort refuses to do it for them.
 */
const STIR_CHANCE = 0.35;
/** How far up the fold reaches. A deep pour is stirred from its top; past this the
 *  column is left alone, so one cell's turn stays O(a few) swaps however deep the
 *  pour is. Well past the depth at which the melt's own heat runs out anyway. */
const MAX_FOLD = 16;

/** The bed the melt digs into: 초석, and the 로켓 캔디 it has already made out of it.
 *  The product has to count, or the melt is walled off by its own candy the moment
 *  the seam converts — the bug again, one row lower. It is the melt's own product,
 *  still half sugar and still wet from the pour it came out of. */
function isBed(id: number): boolean {
  return id === SALTPETER.id || id === ROCKET_CANDY.id;
}

/** One stirring step: straight along gravity first, then the two diagonals to
 *  either side in random order, like every other downward primitive here.
 *  Expressed through the gravity vector rather than screen coordinates, so a pour
 *  mixes into the pile it is resting on whichever way the world is tipped. */
function stirIntoBed(x: number, y: number, sim: SimContext): boolean {
  if (!sim.chance(STIR_CHANCE)) return false;
  const gx = sim.gravityX;
  const gy = sim.gravityY;
  // Only from the top face of the bed — a cell with melt (or open air) above it. A
  // melt cell that already has grains overhead is *inside* a mix, where gravity is
  // stirring correctly on its own: every grain in there outweighs the melt and is
  // working its way down through it. Digging there fights that instead of helping,
  // sorting a pool into melt at the bottom with a raft of grains floating on top —
  // measured as a real loss on the direction that already worked (91 → 77 cells of
  // candy). So this fires only where the engine has nothing: the seam under a pour.
  if (sim.inBounds(x - gx, y - gy) && isBed(sim.get(x - gx, y - gy))) return false;
  // Perpendicular to gravity, sign picked 50/50 — the same "which side first" roll
  // SimContext's own diagonal primitives make.
  const s = sim.chance(0.5) ? 1 : -1;
  const px = -gy * s;
  const py = gx * s;
  return (
    stirSwap(x, y, sim, x + gx, y + gy) ||
    stirSwap(x, y, sim, x + gx + px, y + gy + py) ||
    stirSwap(x, y, sim, x + gx - px, y + gy - py)
  );
}

/** Trade this melt cell for the bed grain at (tx,ty) and fold the grain up to the
 *  top of the molten column above (see the header). A grain already written this
 *  tick is left alone — the same moved-discipline every 2-body rule keeps. The
 *  column above is moved without asking, the way the engine's own column shifts do:
 *  every cell it touches is marked moved by `swap`, so nothing is processed twice
 *  after the fact. */
function stirSwap(x: number, y: number, sim: SimContext, tx: number, ty: number): boolean {
  if (!sim.inBounds(tx, ty)) return false;
  if (!isBed(sim.get(tx, ty)) || sim.hasMoved(tx, ty)) return false;
  sim.swap(x, y, tx, ty); // melt goes into the bed; the grain takes (x,y)
  // Walk against gravity along the contiguous run of *molten* caramel — a set slab
  // stops the fold, so a hot pour on top of toffee still can't drag anything
  // through it.
  const gx = sim.gravityX;
  const gy = sim.gravityY;
  let n = 0;
  while (
    n < MAX_FOLD &&
    sim.inBounds(x - gx * (n + 1), y - gy * (n + 1)) &&
    sim.get(x - gx * (n + 1), y - gy * (n + 1)) === CARAMEL.id &&
    sim.getTemp(x - gx * (n + 1), y - gy * (n + 1)) >= SET_TEMP
  ) {
    n++;
  }
  // Ripple the grain up to the top of that run, sliding every melt cell it passes
  // one step down along gravity.
  for (let i = 0; i < n; i++) {
    sim.swap(x - gx * (i + 1), y - gy * (i + 1), x - gx * i, y - gy * i);
  }
  return true;
}

/**
 * 스며든 캐러멜의 차례 — and the only thing it has to do is the material's oldest rule:
 * 굳으면 멈춘다.
 *
 * The stirring above spends the melt's life *inside a powder bed*, which is exactly
 * where the 겹침 (overlap) soak happens — a grain swallows the drop that has nowhere
 * left to flow. That turned a third of a pour into 겹침 occupants (9 → 38 cells in the
 * niter-pile scene), and a 겹침 occupant has no temperature of its own: it reads its
 * host's, which is the cold pile. So the melt was set toffee the moment it was
 * inside, yet went on percolating, because `SimContext.updateOverlay` knows nothing
 * about `freeze` — it drained to the floor of the pile and sat there as invisible,
 * inert, already-set caramel.
 *
 * Pinning it (markOverlayMoved — the same hold a powered Pump puts on the pores it
 * can't lift) stops it exactly where it stopped being molten. Set toffee that a fire
 * or a fresh pour reheats past SET_TEMP starts moving again on its own, the same way
 * a set slab out on the grid does.
 *
 * Runs only when the declarative pass found nothing (SimContext.updateSoaked), so a
 * grain of 초석 the melt can still react with is converted first and never held.
 */
function updateSoakedCaramel(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) < SET_TEMP) sim.markOverlayMoved(x, y);
}

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

  // 초석 더미 속으로 파고들기 — outside the flow gate, like the void collapse above:
  // FLOW_CHANCE is how sluggishly the melt *flows*, and this is not flowing, it is
  // the mix (see stirIntoBed, which carries its own rate). Runs only inside the
  // recipe's own window, and after the reaction pass has already had its go at
  // this cell (Simulation.updateCell runs `reactions` before `update`), so a melt
  // that could react where it stands does that rather than moving on.
  if (t <= CANDY_MIX_MAX_TEMP && stirIntoBed(x, y, sim)) return;

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
  alsoIn: ['powder', 'food'],
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
  //
  // The bounds are the material's own two thresholds, not free numbers, so the
  // ramp *is* the recipe window rather than merely overlapping it: at `min` the
  // cell has just set (cool toffee, and the niter will no longer take), at `max`
  // it is one degree from charring (full hot amber). Slag pins its ramp to its
  // own set point the same way. Retune either threshold and the readout follows
  // on its own — which is the only reason the header is allowed to claim the
  // colour tells you whether the mix will take.
  glow: { min: SET_TEMP, max: CARBONIZE_TEMP, cool: rgb(96, 46, 20) },
  // Hard toffee below the set point: stops flowing and acts solid, and denser
  // material can no longer sink through the slab.
  freeze: { temp: SET_TEMP },
  update: updateCaramel,
  // …and the same rule for a cell of melt that has soaked into a grain, which
  // `freeze` alone doesn't reach (see updateSoakedCaramel).
  overlapUpdate: updateSoakedCaramel,
});
