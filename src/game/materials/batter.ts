import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { SODA } from './soda';
import { YEAST } from './yeast';
import { CO2 } from './co2';
import { BREAD, CRUST_AUX, CRUMB_AUX } from './bread';
import { spoilStep, SPOIL_MASK } from './spoil';
import { SPOILED_FOOD } from './spoiledfood';

// Batter (반죽) — Flour hydrated by Water (flour.ts declares the reaction: one
// cell of each makes two cells of dough, so nothing is created or lost). A
// thick, sluggish liquid in the mould of Mud: it slumps and oozes on only a
// fraction of ticks, so a poured body holds a soft mound instead of levelling
// out, and you can actually shape a loaf before baking it.
//
// Heat it past 120° and it bakes into Bread (bread.ts). Everything interesting
// about the material is what happens *before* that: whether it was leavened, and
// by what.
//
// ## 팽창제 — two of them, and they are genuinely different
//
//   • **베이킹소다 (Soda).** Chemical, instant, blunt. A grain touching the dough
//     is worked in on contact and sets that cell to SODA_LEAVEN straight away,
//     and the soda travels on through touching dough — quickly, because it is a
//     powder being stirred through a wet mixture. Sprinkle and bake: no waiting,
//     and a modest rise.
//   • **효모 (Yeast).** Biological, slow, and it goes further. A grain is taken
//     up into the dough as a live culture; from then on the cell ferments on its
//     own, climbing one leaven step at a time toward LEAVEN_MAX and burping CO₂
//     as it works — and the culture *spreads* through touching dough, so a pinch
//     of yeast on one corner eventually proofs the whole body. Leave it alone
//     long enough and it out-rises soda by more than double.
//
// Yeast is alive, so the same 60° that kills it in a mash (yeast.ts) stops
// fermentation here — proof the dough at room temperature, then bake. Rushing it
// into the oven cold-proofed is a real and visible mistake: the loaf comes out
// flat.
//
// ## aux
//
// One byte holds both facts, and the split is chosen so the renderer needs to
// know nothing about it:
//
//   bits 0-2  leaven level, 0..LEAVEN_MAX (7)
//   bit  3    cultured — a live yeast colony is in this cell
//   bit  4    soda      — baking soda has been worked into this cell
//
// `Material.auxPalette` indexes with `aux % length`, so an 8-entry ramp reads
// **exactly** the low three bits and both flags fall out of the colour for
// free. The dough visibly pales and lightens as it proofs, the same
// "progress you can see" the Seed's germination ramp gives (seed.ts) — dough that
// never lightens is dough with nothing working in it.

/** Cell temperature at which dough sets into Bread. Above boiling, so a wet
 *  dough sitting in the sun or beside warm stone never bakes by accident — it
 *  takes a real oven (hot plate, coals, heat brush, lava through a wall). */
const BAKE_TEMP = 120;
/** Per-tick chance a hot dough cell bakes, so a loaf browns from its hot face
 *  inward over a visible moment rather than flipping in one frame. */
const BAKE_CHANCE = 0.08;

/** Leaven level (bits 0-2), the live-culture flag (bit 3) and the soda flag
 *  (bit 4). See the note above for why the ramp's length keeps the two flags out
 *  of the colour. */
const LEAVEN_MASK = 0b111;
const CULTURED_BIT = 0b1000;
const SODA_BIT = 0b10000;
/** 부패 카운터는 그 위 셋(비트 5-7)이다 — the first thing in this material's aux
 *  word that this file does not itself maintain (spoil.ts does). Named here as
 *  well as in the `spoil` declaration because the aux rebuild at the bottom of
 *  `updateBatter` has to know to carry it across. */
const SPOIL_SHIFT = 5;
/** Fully proofed. 7 is the largest value the three low bits hold, and the ramp
 *  below has exactly that many steps above plain. */
const LEAVEN_MAX = 7;
/** The ceiling soda alone reaches. Chemical leavening is immediate, and this
 *  modest number is what you pay for that immediacy. */
const SODA_LEAVEN = 3;

/** Per-tick, per-contact chance a Soda grain is worked into the dough (and spent
 *  doing it). Only a cell that hasn't had soda worked in yet will take a grain —
 *  without that guard a surface cell keeps eating grains it can no longer be
 *  leavened by, and a sprinkle is used up on the first row it lands on (measured:
 *  40 grains leavened 21 cells of a 200-cell body). */
const SODA_MIX_CHANCE = 0.3;
/** Per-tick, per-contact chance a Yeast grain is taken up as a live culture. */
const CULTURE_CHANCE = 0.2;
/** Per-tick chance a cultured cell climbs one leaven step. Slow on purpose:
 *  proofing is the thing you wait for, and 발효 that finished as fast as soda
 *  would make soda pointless. */
const FERMENT_CHANCE = 0.02;
/** Per-tick chance a cell hands its leavening agent to a touching dough cell that
 *  hasn't got it yet — how a sprinkle on one face reaches the whole body instead
 *  of leavening only the cells it physically touched. Soda travels faster than
 *  the culture because it is a powder being worked through wet dough, not a
 *  colony that has to grow into it. */
const SODA_SPREAD_CHANCE = 0.2;
const CULTURE_SPREAD_CHANCE = 0.06;
/** Per-tick chance a fermenting cell burps a bubble of CO₂ into open air. The
 *  visible sign that something is working, and the same product Yeast already
 *  makes in a mash (yeast.ts). */
const BURP_CHANCE = 0.03;
/** The culture is killed by heat exactly as it is in a mash — pasteurised at the
 *  same 60° yeast.ts uses. Above this a cell stops fermenting and loses its
 *  colony; the leaven it already built is kept, which is what makes "proof, then
 *  bake" work at all. */
const CULTURE_DIE_TEMP = 60;

/** How far a rising cell will push its new dough, in cells. The expansion travels
 *  *through* the loaf to the nearest open air above it, so an interior cell can
 *  rise even though it has no free neighbour of its own — which is the whole
 *  point, since in any loaf worth baking most cells are interior. Sized to reach
 *  through a thick loaf; a body deeper than this simply rises a little less. */
const RISE_REACH = 16;

/** Plain dough → fully proofed, indexed by the low three bits of `aux`. Raw
 *  batter is a wet, slightly grey beige; as it proofs it pales and warms toward
 *  the airy, floury look of a risen dough. Eight entries so `aux % 8` reads the
 *  leaven level exactly and the culture flag never shifts the colour. */
const PROOF_RAMP = [
  rgb(214, 196, 152),
  rgb(217, 200, 158),
  rgb(220, 204, 165),
  rgb(224, 209, 173),
  rgb(227, 213, 180),
  rgb(230, 217, 187),
  rgb(233, 221, 194),
  rgb(236, 226, 202),
] as const;

/** True for the materials that count as "inside the loaf" when deciding whether
 *  a baking cell is crust or crumb — the dough itself and the bread already
 *  baked out of it. Everything else (air, the pan, water, a neighbouring
 *  material) is an outside face. */
function isDough(id: number): boolean {
  return id === BATTER.id || id === BREAD.id;
}

/**
 * Which face of the loaf this cell is: CRUST_AUX if anything but dough touches
 * it (including the world edge — the grid border is a pan wall), CRUMB_AUX if it
 * is walled in on all eight sides.
 *
 * Evaluated once, at the instant the cell bakes, and never revisited (see
 * bread.ts). A loaf bakes outside-in, so its shell is decided while it is still
 * the outside and its middle while it is still surrounded by dough — which is
 * precisely the split a real loaf has.
 */
function bakeCrustAux(x: number, y: number, sim: SimContext): number {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) return CRUST_AUX;
    if (!isDough(sim.get(nx, ny))) return CRUST_AUX;
  }
  return CRUMB_AUX;
}

/**
 * Hand a leavening agent (`bit`) to one touching dough cell that hasn't got it
 * yet. Both agents use this: it is what turns "sprinkled on one face" into
 * "worked through the body", and without it a leavener only ever reaches the
 * single row of cells it physically landed on.
 *
 * One neighbour per successful roll, so the agent creeps outward through the
 * dough at a rate you can watch rather than flooding it in a tick.
 */
function spreadAgent(x: number, y: number, sim: SimContext, bit: number, chance: number): void {
  if (!sim.chance(chance)) return;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) !== BATTER.id) continue;
    const nAux = sim.getAux(nx, ny);
    if ((nAux & bit) === 0) {
      sim.setAux(nx, ny, nAux | bit);
      return;
    }
  }
}

/** Somewhere the rise can put a new cell of dough: open air, or a gas it simply
 *  shoves aside. Gases have to count, and it is not a detail — a proofing dough
 *  buries itself in the CO₂ it burps out (see BURP_CHANCE), so a rise that only
 *  accepted EMPTY was smothered by its own fermentation. Measured: a fully
 *  proofed 200-cell body that should have doubled came out at 232 cells, while
 *  the identical body with the gas removed came out at exactly 400. */
function isRiseOpen(id: number): boolean {
  return id === EMPTY || getMaterial(id).phase === Phase.Gas;
}

/**
 * 오븐 스프링 — the rise, and it happens as *dough*, in the oven, one tick before
 * the cell bakes. The gas trapped in a leavened cell expands: one new cell of
 * plain dough is pushed out into the nearest open air straight above, and the
 * leaven is spent doing it.
 *
 * Two decisions here are what make the rise actually visible rather than a
 * rounding error.
 *
 *   • **It pushes through the loaf, not just into a free neighbour.** The first
 *     version only expanded into an adjacent empty cell, which meant only the
 *     top face of a body of dough could ever rise — a 20×10 loaf gained two
 *     cells out of two hundred. Searching up through the dough to the surface is
 *     both what a real loaf does (the gas lifts everything above it) and what
 *     lets an interior cell contribute at all. A lid or a pan wall in the way
 *     blocks it, so a sealed tin bakes a dense loaf — correctly.
 *   • **One roll per cell, ever.** The chance is `leaven / LEAVEN_MAX` and the
 *     leaven is cleared whether or not the roll landed, so a cell cannot keep
 *     rolling every tick until it succeeds. That fixes the whole loaf's ceiling
 *     at **double**: soda (3/7) puts on about 40%, a fully proofed dough (7/7)
 *     close to 100%, and plain dough none. The new dough is spawned unleavened,
 *     so it never rises again and the expansion cannot cascade.
 */
function tryRise(x: number, y: number, sim: SimContext, leaven: number, temp: number): void {
  if (!sim.chance(leaven / LEAVEN_MAX)) return;
  const ux = -sim.gravityX;
  const uy = -sim.gravityY;
  for (let step = 1; step <= RISE_REACH; step++) {
    const nx = x + ux * step;
    const ny = y + uy * step;
    if (!sim.inBounds(nx, ny)) return;
    const nid = sim.get(nx, ny);
    if (isRiseOpen(nid)) {
      sim.spawn(nx, ny, BATTER.id);
      // `spawn` resets a fresh cell to ambient; this dough was pushed out of a
      // loaf that is already in the oven and is surrounded by it, so it starts
      // at the temperature of the cell that made it and bakes with the rest.
      sim.setTemp(nx, ny, temp);
      return;
    }
    // Dough and the bread already baked out of it are what the rise lifts; a
    // lid, a pan wall or anything else stops it dead.
    if (!isDough(nid)) return;
  }
}

function updateBatter(x: number, y: number, sim: SimContext): void {
  // 부패 — wet flour goes over fast. Before `aux` is read below, not merely
  // first: `spoilStep` writes the cell's aux when it advances the counter, so
  // reading the word before it runs would hand the rest of this function a stale
  // one and the write at the bottom would put the old counter straight back.
  if (spoilStep(x, y, sim, BATTER.spoil!)) return;
  const aux = sim.getAux(x, y);
  const leaven = aux & LEAVEN_MASK;
  const t = sim.getTemp(x, y);

  // ── Oven ──────────────────────────────────────────────────────────────────
  if (t >= BAKE_TEMP) {
    // 오븐 스프링 first, and it takes the whole tick. A leavened cell rises before
    // it can bake, so the loaf finishes growing before any of it sets — which is
    // also what makes the crust test below see the loaf's *final* surface rather
    // than an intermediate one.
    if (leaven > 0) {
      tryRise(x, y, sim, leaven, t);
      // Spent, landed or not (see tryRise). Clears the culture flag with it: at
      // baking temperature the colony is long dead anyway.
      sim.setAux(x, y, 0);
      return;
    }
    if (sim.chance(BAKE_CHANCE)) {
      const crust = bakeCrustAux(x, y, sim);
      // In-place `set` keeps the cell's oven heat, so a fresh loaf reads as hot
      // and goes on conducting into the dough behind it — which is how the bake
      // front travels inward at all. `set` does not clear aux (see
      // SimContext.set), so the crust value is written explicitly.
      sim.set(x, y, BREAD.id);
      sim.setAux(x, y, crust);
      return;
    }
    // Hot but not set yet — still a liquid, so it goes on slumping.
    updateLiquid(x, y, sim);
    return;
  }

  // ── 팽창제 ─────────────────────────────────────────────────────────────────
  // Too hot for a live culture: the colony dies, the leaven it already built
  // stays. This is what lets a proofed dough survive its own trip to the oven.
  // Soda is a chemical and is unaffected — it keeps its flag through anything.
  let cultured = (aux & CULTURED_BIT) !== 0;
  if (cultured && t >= CULTURE_DIE_TEMP) cultured = false;
  let soda = (aux & SODA_BIT) !== 0;

  let level = leaven;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === SODA.id && !soda) {
      // Chemical leavening: the grain is worked into this cell and spent doing
      // it. Gated on the cell not already having soda in it — a cell that is
      // already leavened cannot be leavened twice, and without the gate it goes
      // on eating grains for nothing.
      if (sim.chance(SODA_MIX_CHANCE)) {
        sim.set(nx, ny, EMPTY);
        soda = true;
      }
    } else if (nid === YEAST.id && !cultured && t < CULTURE_DIE_TEMP) {
      // Biological leavening: the grain is taken up as a colony that lives in
      // this cell from now on. It is consumed as a *grain* but not as an
      // organism — the culture below is what it became.
      if (sim.chance(CULTURE_CHANCE)) {
        sim.set(nx, ny, EMPTY);
        cultured = true;
      }
    }
  }

  if (soda) {
    // Instant, and capped. `Math.max` so soda can top up plain dough but never
    // undoes a dough that fermentation has already carried past its ceiling.
    level = Math.max(level, SODA_LEAVEN);
    spreadAgent(x, y, sim, SODA_BIT, SODA_SPREAD_CHANCE);
  }

  if (cultured && t < CULTURE_DIE_TEMP) {
    // Ferment: climb one step, and show it. Bounded by LEAVEN_MAX, which is also
    // the largest value the three low aux bits can hold.
    if (level < LEAVEN_MAX && sim.chance(FERMENT_CHANCE)) level++;
    // Hand the colony on to touching dough, so a pinch of yeast proofs a whole
    // body over time instead of only the cells it physically touched.
    spreadAgent(x, y, sim, CULTURED_BIT, CULTURE_SPREAD_CHANCE);
    // 발효의 눈에 보이는 신호 — a bubble of the same CO₂ a mash gives off.
    if (sim.chance(BURP_CHANCE)) {
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (sim.inBounds(nx, ny) && sim.isEmpty(nx, ny)) {
          sim.spawn(nx, ny, CO2.id);
          break;
        }
      }
    }
  }

  // Rebuilt from the three things this function owns — and therefore the one
  // place in the file that can silently erase anything else living in the word.
  // The spoilage counter (bits 5-7, see the `spoil` declaration) is carried
  // across explicitly. A field-by-field rebuild like this is the shape that
  // breaks when someone adds a fourth thing to an aux word, so the mask is
  // written in terms of the shift rather than as a literal.
  const keep = aux & (SPOIL_MASK << SPOIL_SHIFT);
  const nextAux = level | (cultured ? CULTURED_BIT : 0) | (soda ? SODA_BIT : 0) | keep;
  if (nextAux !== aux) sim.setAux(x, y, nextAux);

  // Thick and sluggish: `viscosity` holds a soft mound rather than levelling out.
  // The cell's aux rides along on every swap (see SimContext.swap), so a poured
  // dough carries its proofing with it.
  updateLiquid(x, y, sim);
}

export const BATTER = register({
  id: 152,
  name: 'Batter',
  phase: Phase.Liquid,
  // The unproofed end of PROOF_RAMP — a wet, slightly grey beige. The ramp
  // itself is what every cell actually draws; this is the palette chip and the
  // honest "this is what you get when you mix it" colour.
  color: rgb(214, 196, 152),
  // Denser than Water (3), so a dough poured into a pool sinks and sits on the
  // bottom of the pan instead of rafting on it — but under Yeast (3.3), so a
  // sprinkled culture settles *into* the dough rather than floating clear of it.
  density: 3.2,
  category: 'food',
  // Also on the 액체 shelf, next to Honey and Caramel — the three thick,
  // slow-flowing liquids behave as a family and are compared as one.
  alsoIn: ['liquid'],
  // Thicker than Mud (0.82): a dough should barely creep, so a shaped loaf keeps
  // its shape long enough to get an oven under it.
  viscosity: 0.88,
  // Modest, so the leaven ramp stays legible through the ordinary liquid grain
  // (the default for a Liquid would be 22 and would swamp an 8-step ramp).
  colorVary: 10,
  // 발효 진행도를 보여 주는 색 — see PROOF_RAMP.
  auxPalette: PROOF_RAMP,
  // 부패 — wet flour at room temperature is the second-fastest spoiler here, and
  // the only one where rotting competes with something the player actively wants
  // (proofing). That is the tension: a long yeast rise doubles the loaf, and a
  // long yeast rise is also long enough for the dough to be at risk. `auxShift`
  // is 5 because bits 0-4 are already leaven + two agent flags — the tightest aux
  // word in the roster, and the reason the rebuild above has to carry this
  // across by hand.
  spoil: { seconds: 80, auxShift: SPOIL_SHIFT, into: () => SPOILED_FOOD.id },
  thermal: { conductivity: 0.3 },
  update: updateBatter,
});
