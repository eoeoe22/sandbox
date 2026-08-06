import { DIR8 } from '../engine/directions';
import { getMaterial } from './registry';
import { EMPTY, type Combustible } from '../engine/types';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { WATER_SURFACE_CAP } from './water';
import { OXYGEN } from './oxygen';
import { chillThroughFuel, fireClassOf, isDousingAgent, spendDousingAgent, WATER_CHILL } from './suppress';
import { ASH } from './ash';
import { AMBIENT_TEMP } from '../config';

// Shared burning behavior for the simple fuels — Crude Oil, Gasoline, Alcohol,
// Honey, Coal, Wood, Sawdust, Fuse. Unlike the explosives (Methane/Gunpowder/
// Nitro), a fuel never detonates: it catches fire and is consumed over time,
// giving off ordinary Fire that then burns out on its own.
//
// The point of this model is a *self-sustaining surface front*: a stray spark
// touching one cell must creep through the whole body and consume almost all of
// it, slowly, rather than eating only the cells it directly touched and dying
// out. The earlier model failed at that because a lit fuel cell turned straight
// into Fire — a gas that rises *away* from the fuel and burns out in a handful
// of ticks, so the flame escaped the front before the next cell's low per-tick
// catch chance could roll. With no flame anchored to the fuel, the burn
// fizzled after the first cell or two.
//
// So a lit fuel now *stays fuel while it burns* instead of flashing to gas. When
// a cell catches it doesn't vanish: it stays fuel but marked burning (its
// temperature pinned to FUEL_BURN_TEMP), and each tick it (1) wreaths itself in a
// lick of Fire in the open air around it — the visible flame, and the handle
// Water uses to put it out — and (2) rolls to light each of its still-unlit fuel
// neighbors, handing the front one cell further. Only after a while (a
// memoryless per-tick chance) is the cell itself spent, collapsing into rising
// Fire. Because the burning cell persists as an ignition source for many ticks,
// even a small per-tick spread chance reliably carries the front to every
// neighbor — slow, but near-total.
//
// Crucially the burning cell keeps *moving*: after its burn step it still falls
// and flows exactly like its unlit self (the caller runs the normal
// powder/liquid movement), so a lit stream of Sawdust tumbles on down and a
// burning slick of Oil/Gasoline/Alcohol drops at the same speed as the cold
// liquid around it, instead of freezing the instant it catches. Its material id
// and pinned heat ride along on every swap, so a coherent body — a falling
// column, a settling pile, a spreading pool — carries the front with it and
// keeps lighting the neighbors it moves alongside. Only a cell already consumed
// into Fire this tick stops, because it is no longer fuel to move.
//
// `burnChance` still sets each fuel's pace, now doing double duty: the per-tick
// chance to catch from an adjacent flame *and* the per-tick chance a burning
// cell lights each fuel neighbor. Its old meaning (relative burn speed) carries
// straight over — the volatile liquids race, the loose solids creep, dense Coal
// smoulders. Each fuel also self-ignites once its own temperature passes an
// autoignition point, so radiant heat from something very hot (Lava, Blue
// Flame) can set it off with no flame cell touching it.
//
// Fuels deliberately are NOT tagged `flammable`: that tag hands ignition to
// Fire's single global-rate ignite pass (see fire.ts), which would erase the
// per-fuel speed differences. Instead each fuel drives its own rate here by
// detecting the flame itself — the same id-based, scan-order-independent
// approach the explosives use.
//
// Each fuel's own numbers live on its material as `Material.combustion` (see
// Combustible in engine/types.ts), so `tryBurn` reads them off the cell it was
// handed and a fuel's `update` just says `tryBurn(x, y, sim)`. They used to be a
// `const SPEC` inside each fuel's module, passed back in as an argument — which
// meant the one place that knew Coal smoulders at 0.035 and lights itself at
// 580° was invisible to everything that wasn't Coal: the palette, a codex page,
// a test sweeping the registry for every fuel's 발화점.
//
// "Ordinary Fire" above is the unoxygenated case. Once Oxygen is blown against
// a burning cell (forced draught, below), the flame it wreaths itself in and
// finally collapses into is Blue Flame instead of Fire — an oxygen torch
// isn't just hotter, it's a genuinely different, hotter-burning flame.

// Temperature a burning fuel cell holds by default, and the temperature the
// Fire it finally collapses into starts at. Sits above every fuel's
// autoignition point (the highest, Coal, is 580), so pinning a catching cell
// here always reads as "burning" on its next turn regardless of which fuel it
// is. A fuel can run hotter than this via `Combustible.burnTemp` (see Coal).
export const FUEL_BURN_TEMP = 800;

// Per-tick chance a burning cell is spent and collapses to Fire, expressed as a
// multiple of that fuel's own `burnChance`. Keeping it *below* the spread
// chance (ratio < 1) is what guarantees a cell almost always lights its
// neighbors before it burns out, so the front propagates to near-completion
// instead of stalling. Deriving it from `burnChance` also means a fuel's whole
// character falls out of that one number: a quick fuel (high burnChance) both
// spreads and is consumed fast — a brief flare — while Coal (low burnChance)
// both creeps and smoulders for a long time. Mean cell burn life is
// 1/(burnChance·CONSUME_RATIO) ticks: ~28 for Gasoline, ~95 for Coal.
const CONSUME_RATIO = 0.3;

// Per-tick chance a burning cell drops a lick of Fire into an adjacent open
// cell. Low so the body is fringed with flickering flame rather than buried in
// it (which would also choke the sim with Fire/Smoke).
const WREATH_CHANCE = 0.25;

// Per-tick chance that the water cell which just doused a burning fuel cell is
// spent (flashed to Steam, or melted if it was Snow/Ice). Deliberately *not* 1 —
// a bucket thrown on embers hisses off some of itself, not all of it, and the
// difference decides whether water works at all. A burning bed presents a face
// dozens of cells wide, so at 1.0 a poured column pays one cell per contact per
// tick and is gone in about four ticks — long before it can walk the mass cold —
// while the Fire already loose in the air above re-lights everything it chilled.
// At 0.25 the same column survives long enough both to finish the chill and to
// snuff that leftover flame, which is what "물을 부으면 꺼진다" actually requires.
// `easyDouse` fuels (Amber, Resin) still spend nothing at all.
const DOUSE_STEAM_CHANCE = 0.25;

// Oxygen forced draught. A burning fuel cell normally pins at its own
// `burnTemp` (FUEL_BURN_TEMP, 800°, for most fuels); Oxygen (id 36) blown against
// it makes the fire run hotter — each adjacent Oxygen cell adds OXY_BOOST to
// the pinned temperature up to OXY_MAX_PIN, and the drawn-in oxygen is
// consumed with probability OXY_CONSUME per tick. OXY_MAX_PIN is set to Blue
// Flame's own temperature (1800°): a fully oxygenated fire — any fuel, not
// just Coal — becomes a cutting torch as hot as Blue Flame itself. For a
// default 800°-base fuel the pin steps land on the world's melt points:
// 0 oxygen = 800° (reduces iron ore but can't melt iron, and stays under
// Stone's 1100° so furnace walls are safe), 1 = 1050° (a safe low blast,
// still below stone), 2 = 1300° (past Iron's 1200° melt, but also past
// Stone's 1100° so a stone crucible slumps), 3 = 1550°, 4+ = 1800° (Blue
// Flame parity). Coal instead runs its bare fire at 1300° via `burnTemp`
// (see coal.ts) — no oxygen needed to melt iron — so it only takes 2 Oxygen
// cells to reach the same 1800° ceiling.
const OXY_BOOST = 250;
const OXY_MAX_PIN = 1800;
const OXY_CONSUME = 0.5;

export function isFlame(id: number): boolean {
  return id === FIRE.id || id === LAVA.id || id === BLUE_FLAME.id;
}

/** True if any 8-neighbour is an open flame (Fire/Lava/Blue Flame). Petroleum
 *  materials use this to let *direct flame contact* win over distillation — touch
 *  fire and the fuel burns; heat it through a wall and it distils. */
export function flameAdjacent(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && isFlame(sim.get(nx, ny))) return true;
  }
  return false;
}

/**
 * Run the burn step for a cell that is already burning (temperature pinned at
 * FUEL_BURN_TEMP): put it out if Water reached it, otherwise re-pin its heat so it
 * stays a burning source, fringe it with flame, spread to fuel neighbors, and
 * roll to be consumed. Returns true only if the cell was consumed into Fire this
 * tick (so the caller must not then move it as fuel); false if it is still
 * unconsumed fuel — burning or freshly smothered — that the caller carries on
 * falling/flowing.
 */
function burnStep(x: number, y: number, sim: SimContext, spec: Combustible): boolean {
  sim.fireSeen = true; // this cell is alight — see SimContext.fireActive
  // This fuel's own running temperature — FUEL_BURN_TEMP (800°) unless it overrides
  // via `burnTemp` (Coal runs hotter; see Combustible.burnTemp).
  const myBurnTemp = spec.burnTemp ?? FUEL_BURN_TEMP;
  // Petroleum fuels (Crude Oil, Gasoline, …) float on water and keep burning as
  // a surface fire: water below them neither douses the flame nor flashes to
  // Steam, so a lit slick on a pool reproduces an oil fire instead of snuffing
  // itself out on the water it's floating on (see Material.petroleum / water.ts).
  const isPetroleum = getMaterial(sim.get(x, y)).petroleum === true;
  // 화재 등급 of the fuel under the water — what class of extinguisher answers it.
  // B (유류, derived from `petroleum`) floats and keeps burning; D (금속, the
  // aluminum line) ignores water here so its own violent water/steam chemistry is
  // what the player gets; A is everything else and is what water is *for*.
  const cls = fireClassOf(sim.get(x, y));
  let onWater = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    // A water-family neighbour (Water/Saltwater/Sugar Water/Snow/Ice) smothers a
    // class-A fuel: the fuel survives (unlit, back to ambient) and the one cell it
    // touched is spent — mirroring Fire's own "물 인접 시 즉시 소화, 닿은 물은
    // 수증기로" rule.
    if (isDousingAgent(nid)) {
      if (cls === 'B') {
        onWater = true; // oil fire on water: not doused, water not steamed
        // Second line of defense against the water below cooking off: Water/
        // Saltwater/Sugar Water already refuse to boil next to a burning
        // petroleum neighbor and cap themselves here on their own turn (see
        // burningPetroleumAdjacent in water.ts), but that check only runs once
        // per tick on the water cell's own turn. Applying the same cap from the
        // fuel's side too means the water is never left sitting above the cap
        // for a whole extra tick between diffusion passes.
        sim.setTemp(nx, ny, Math.min(sim.getTemp(nx, ny), WATER_SURFACE_CAP));
        continue;
      }
      // 금속화재: water is not the answer, and this world already models *why* —
      // burning aluminum cracks water and steam into Hydrogen (aluminumpowder.ts).
      // Bailing out here leaves that reaction as the thing that happens, instead
      // of quietly putting the fire out first.
      if (cls === 'D') continue;
      // Cell stays fuel (its id is untouched); cool it back out of the burning
      // band and spend the one cell that did it. Not consumed, so the caller
      // still lets the now-unlit fuel fall/flow.
      sim.setTemp(x, y, AMBIENT_TEMP);
      // …and sink the chill a little way *into* the body. Cooling only the
      // wetted face loses: conduction from the still-burning cells behind it
      // puts a coal surface back over its 580° autoignition within four ticks,
      // so a surface-only douse has to win the same cell over and over. The
      // flood is deliberately shallow (WATER_CHILL) — a thin bed goes out at
      // once, a deep pile has to be worked face by face, and CO₂ keeps its edge.
      chillThroughFuel(x, y, sim, WATER_CHILL);
      if (!spec.easyDouse && sim.chance(DOUSE_STEAM_CHANCE)) {
        spendDousingAgent(nx, ny, sim);
      }
      return false;
    }
  }

  // Re-pin heat so diffusion into cooler neighbors can't drop this cell below
  // its autoignition and quietly extinguish the front. Oxygen blown against the
  // fuel drives the pin higher (forced draught) — the only way to reach the
  // temperatures that melt iron with a mere coal fire. Consumed oxygen is
  // written to EMPTY, which is always a safe neighbor write (no same-tick
  // reprocessing); the self setTemp is unchanged bookkeeping.
  let pin = myBurnTemp;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === OXYGEN.id) {
      pin = Math.min(pin + OXY_BOOST, OXY_MAX_PIN);
      if (sim.chance(OXY_CONSUME)) sim.set(nx, ny, EMPTY);
    }
  }
  sim.setTemp(x, y, pin);
  // An oxygen-fed cell isn't just ordinary Fire running hot — the flame it
  // throws off is Blue Flame itself, so it inherits Blue Flame's own rock-
  // melting/slower-burnout behavior instead of Fire's (see blueflame.ts). One
  // consequence: CO2/Soda's "snuff any adjacent Fire cell outright" step
  // (co2.ts/soda.ts) checks the literal FIRE id, so it no longer displaces
  // these licks directly — same as Blue Flame always being immune to a casual
  // snuff. Their separate "smother the burning fuel" cooling pass still works
  // regardless (it targets the fuel cell's own temperature, not the flame's
  // material id), so CO2/Soda still put an oxygen-fed fire out; only the loose
  // flame gas is tougher, matching Blue Flame's established toughness.
  const oxygenated = pin > myBurnTemp;

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) {
      // A lick of visible flame in the open air around the body.
      if (sim.chance(WREATH_CHANCE)) sim.spawn(nx, ny, oxygenated ? BLUE_FLAME.id : FIRE.id);
    } else if (getMaterial(nid).combustion !== undefined && sim.getTemp(nx, ny) < myBurnTemp) {
      // Light the neighbor: pin it to this fuel's burn temp so its own turn
      // sees it as burning (its own next burnStep re-pins to its own spec
      // regardless). Gated by burnChance per neighbor, so a just-lit unscanned
      // neighbor can chain-light within the same tick — but each burning cell
      // reaches only its ~4 not-yet-scanned neighbors, so the same-tick
      // branching factor is ~4·burnChance (≈0.6 at the fastest fuel, Alcohol
      // 0.15): subcritical, a bounded flicker of well under one extra cell per
      // cell, not the deterministic one-frame runaway a raw material `set` on
      // an unscanned cell would cause. Criticality is 4·burnChance = 1 at
      // burnChance 0.25, so a fuel much above that would need rethinking this.
      if (sim.chance(spec.burnChance)) sim.setTemp(nx, ny, myBurnTemp);
    }
  }

  // Spent: collapse into rising Fire (or, if oxygen-fed, Blue Flame), which
  // flickers up and burns out on its own (see fire.ts/blueflame.ts) — carrying
  // the flame off the consumed surface. Signal the caller to stop: this cell
  // is a flame now, not fuel to fall/flow. A burning petroleum cell resting
  // *on water* is the exception: it never collapses to a flame (which would
  // then steam the water it's floating on), so the oil-water interface stays
  // oil and keeps shielding the water — a persistent oil fire.
  if (!(isPetroleum && onWater) && sim.chance(spec.burnChance * CONSUME_RATIO)) {
    if (spec.ashChance !== undefined && sim.chance(spec.ashChance)) {
      // Spent remains instead of a flame puff — a solid fuel's cell burns down
      // to ash rather than vanishing into rising Fire.
      sim.set(x, y, ASH.id);
      sim.setTemp(x, y, myBurnTemp);
      return true;
    }
    sim.set(x, y, oxygenated ? BLUE_FLAME.id : FIRE.id);
    // Carry the actual (possibly oxygen-boosted) pin forward instead of
    // collapsing back to the fuel's unboosted base — otherwise a spawned Blue
    // Flame would misleadingly sit at only the fuel's base temperature.
    sim.setTemp(x, y, pin);
    return true;
  }
  // Still burning fuel: the caller runs its normal fall/flow so it keeps moving.
  return false;
}

/**
 * Run one tick of combustion for a fuel cell. Returns true only if the cell was
 * *consumed* into Fire this tick — in which case the caller must stop, since the
 * cell is Fire now and must not be moved as a powder/liquid. In every other case
 * (still-burning fuel, freshly caught, smothered by water, or not burning at
 * all) it returns false and the caller runs its normal fall/flow: a burning fuel
 * keeps moving exactly like its unlit self.
 */
export function tryBurn(x: number, y: number, sim: SimContext): boolean {
  // The fuel's own numbers, read off the cell rather than passed in — a fuel
  // cannot call this with someone else's pace by accident, and a material that
  // isn't a fuel at all simply does nothing here.
  const spec = getMaterial(sim.get(x, y)).combustion;
  if (spec === undefined) return false;
  // Already burning (pinned hot), or hot enough to self-ignite from radiant
  // heat: run its burn step, which reports whether it was consumed.
  if (sim.getTemp(x, y) >= spec.autoIgniteTemp) {
    return burnStep(x, y, sim, spec);
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isFlame(sim.get(nx, ny))) {
      // A flame is adjacent — roll once for the whole cell this tick (catch
      // speed lives entirely in this probability, independent of how many flame
      // neighbors there are). On a catch, pin the cell hot so its next turn sees
      // it as burning; on a miss it stays cold fuel. Either way it is still fuel,
      // so it keeps falling/flowing this tick — return false and let the caller
      // move it (its pinned heat rides along on the swap).
      if (sim.chance(spec.burnChance)) {
        sim.setTemp(x, y, spec.burnTemp ?? FUEL_BURN_TEMP);
      }
      return false;
    }
  }
  return false;
}

// ── 직화 전용 (Combustible.flameOnly) ────────────────────────────────────────
//
// `tryBurn` above lights a fuel two ways: a flame touches it, or its own
// temperature passes `autoIgniteTemp`. The second one is right for everything
// that came out of the ground and wrong for everything you eat. An oven is a box
// held at several hundred degrees on purpose — Iron conducts so well that the
// inside of a sealed firebox measures ~880° — so any food with an ordinary
// autoignition point spontaneously combusts in the appliance built to cook it,
// and there is no number that fixes it: `burnTemp` (800°) has to stay at or
// above `autoIgniteTemp` for `combustion.ts` to read a burning cell as burning,
// which caps the threshold below the temperature an oven actually reaches.
//
// So the food line answers the question with a different rule instead of a
// bigger number: **열만으로는 절대 불이 붙지 않는다. 불꽃이 직접 닿아야 한다.**
// Radiant heat, however fierce, only ever cooks; a flame cell touching the food
// is the sole ignition path. The oven works, the campfire still ruins dinner.
//
// The bookkeeping is the bit that has to be shared. "Is this cell burning?" is
// read off temperature everywhere else in this file, and a flameOnly fuel sits
// far above its own threshold all day without being alight, so it has to
// remember. It does that in one `aux` bit, chosen per material to dodge whatever
// that material already keeps there (Bread's crust, Burnt Meat's dryness), and
// the ramps those materials draw themselves with are sized so the bit falls out
// of `aux % length` and never shows up as a colour.

/** True if a touching cell of the *same* material is already alight — how the
 *  front crosses the inside of a body, where there is no air for a flame cell to
 *  stand in. Without it a burning loaf would only be eaten from the faces its
 *  wreathing flames could reach and the middle would never go. */
function litNeighbor(x: number, y: number, sim: SimContext, litBit: number): boolean {
  const id = sim.get(x, y);
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) !== id) continue;
    if ((sim.getAux(nx, ny) & litBit) !== 0) return true;
  }
  return false;
}

/**
 * `tryBurn` for a fuel that declares `combustion.flameOnly`: identical once
 * alight, but reachable only by flame contact (or by a neighbour of the same
 * material that is already alight). Returns true only if the cell was consumed
 * into flame this tick, exactly like `tryBurn`, so a powder caller still knows
 * whether it has anything left to move.
 *
 * `litBit` is the material's own free `aux` bit. Its `combustion` spec supplies
 * the rest: `burnChance` doubles as the per-tick chance of catching from contact
 * (so lighting the body feels the same whether it started at the flame or two
 * cells in), and `autoIgniteTemp` is read not as an ignition point — nothing here
 * ever reaches it by being heated — but as the floor an already-lit cell must
 * stay above to still count as alight. That is the other end of the same number:
 * `combustion.ts` writes AMBIENT_TEMP into a cell water has smothered, so a cell
 * that has fallen under the floor is a cell whose fire is out, and the lit bit
 * has to go with it or the fuel would re-light itself out of the water every
 * tick. The codex hides the 발화점 stat for these and shows 직화 전용 instead.
 */
export function tryFlameOnlyBurn(
  x: number,
  y: number,
  sim: SimContext,
  litBit: number,
): boolean {
  const spec = getMaterial(sim.get(x, y)).combustion;
  if (spec === undefined) return false;
  const aux = sim.getAux(x, y);
  if ((aux & litBit) !== 0) {
    if (sim.getTemp(x, y) < spec.autoIgniteTemp) {
      sim.setAux(x, y, aux & ~litBit);
      return false;
    }
    return tryBurn(x, y, sim);
  }
  if (!flameAdjacent(x, y, sim) && !litNeighbor(x, y, sim, litBit)) return false;
  if (!sim.chance(spec.burnChance)) return false;
  sim.setAux(x, y, aux | litBit);
  // Pin it into the burning band so `tryBurn` reads it as alight on its next
  // turn; from then on `burnStep` re-pins it itself each tick.
  const burnTemp = spec.burnTemp ?? FUEL_BURN_TEMP;
  if (sim.getTemp(x, y) < burnTemp) sim.setTemp(x, y, burnTemp);
  return false;
}
