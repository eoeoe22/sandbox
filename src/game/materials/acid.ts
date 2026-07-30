import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
import { updateLiquid, diffuseWith } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { ACID_VAPOR } from './acidvapor';
import { WATER } from './water';
import { HYDROGEN } from './hydrogen';

// Liquid: flows like water, but each tick has a chance to corrode any
// non-resistant Solid/Powder neighbor (dissolving it to Empty). If it
// corroded anything this tick, it also has a chance to consume itself —
// bounds how much a given puddle of acid can eat through before running out.
// With no corrodible neighbor, it just sits there — acid only ever shrinks
// as a byproduct of actually corroding something, never on its own.
//
// One class of neighbor gets a louder ending than "blinks out": a metal above
// hydrogen in the reactivity series (`Material.acidHydrogen` — the aluminum
// three, Uranium, Iron and its filings, solid Gallium) fizzes, and the acid cell
// doing the eating turns into the hydrogen bubble itself (tryEvolveHydrogen
// below). Metals *below* hydrogen (Wire's copper core, Mercury) and the oxides /
// carbonates (Rust, Iron Ore, Limestone) carry no tag and keep dissolving
// silently — which is the honest chemistry, not an omission.
//
// Sodium is *not* on that list and none of this file's code runs for it: it sits
// at the very top of the series, so acid contact takes the same violent path
// water does (flame + hot hydrogen, and a detonation when packed), driven
// entirely by its own update — see sodium.ts for why it declines the tag.
// Heated past its boiling point it flashes to Acid Vapor (corrosive fumes), the
// gaseous counterpart that rises, etches, and condenses back to acid — the same
// pattern as Water↔Steam (see acidvapor.ts).
//
// Same density as Water, so a poured-in layer of either sits on top of the
// other instead of sinking through — but same-density fluids never trade
// places via the normal density-sorted flow, so left alone they'd stay in
// perfectly flat layers forever. DIFFUSE_CHANCE gives their shared boundary a
// slow, occasional swap with a neighboring Water cell instead, so the two
// gradually interdiffuse across the interface like miscible liquids.
const CORRODE_CHANCE = 0.03;
const SELF_CONSUME_CHANCE = 0.08;
const ACID_BOIL_TEMP = 100;
const DIFFUSE_CHANCE = 0.02;

// Default heat of reaction for the hydrogen evolution below (Material.acidHydrogen
// may override it). Deliberately well under Hydrogen's 200° autoignition point, so
// the bubble is born cool enough to rise and collect under a ceiling instead of
// lighting the instant it appears — the whole point of the 산 → 수소 chain is that
// you get to choose when it goes off.
const HYDROGEN_HEAT = 25;

function isCorrodible(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.acidResistant) return false;
  return m.phase === Phase.Solid || m.phase === Phase.Powder;
}

/**
 * 산 + 이온화 경향이 수소보다 큰 금속 → 수소. A metal tagged `acidHydrogen`
 * (types.ts) doesn't just blink out when acid eats it: the acid cell at (x,y)
 * *becomes* the hydrogen bubble while the metal cell at (nx,ny) dissolves.
 *
 * The bubble replaces the *acid* cell rather than venting into a free neighbor
 * because a metal sitting at the bottom of a puddle — which is where every player
 * will put it — has no empty neighbor at all, so a vented byproduct would be
 * invisible exactly when it matters. Consuming both sides 1:1 also keeps it
 * honest: the puddle is used up as it works, so a given amount of acid dissolves
 * a bounded amount of metal instead of acting as a free hydrogen catalyst.
 *
 * Returns true when it fired (the acid cell is gone — the caller must stop).
 */
function tryEvolveHydrogen(x: number, y: number, nx: number, ny: number, sim: SimContext): boolean {
  const spec = getMaterial(sim.get(nx, ny)).acidHydrogen;
  if (spec === undefined || !sim.chance(spec.chance)) return false;
  sim.set(nx, ny, EMPTY);
  // In-place set() keeps this cell's temperature, so the heat of reaction lands
  // on top of however warm the puddle already was.
  sim.set(x, y, HYDROGEN.id);
  sim.setTemp(x, y, sim.getTemp(x, y) + (spec.heat ?? HYDROGEN_HEAT));
  // The fresh gas has already had its turn this tick (it rises from the next one)
  // — mirrors the moved-guard the declarative reaction pass applies to both
  // participants, so nothing downstream in this scan picks the bubble up again.
  sim.markMoved(x, y);
  return true;
}

function updateAcid(x: number, y: number, sim: SimContext): void {
  // Conductor bookkeeping: tick down the post-spark refractory stamped in `aux`
  // so this cell can carry current again (mirrors Water/Saltwater — see spark.ts).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (sim.getTemp(x, y) >= ACID_BOIL_TEMP) {
    // Boil in place: the resulting Vapor keeps the (hot) temperature, then
    // rises and corrodes/condenses on its own (see acidvapor.ts).
    sim.set(x, y, ACID_VAPOR.id);
    return;
  }

  let corroded = false;
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (!isCorrodible(nid)) continue;
    // A hydrogen-evolving metal gets its own roll first, so the characteristic
    // fizz can't lose a race against this very pass (the lesson the aluminum
    // line's `reactions`-row workaround left behind — see types.ts's
    // `acidHydrogen`). A miss falls straight through to the plain silent bite.
    if (tryEvolveHydrogen(x, y, nx, ny, sim)) return;
    if (sim.chance(CORRODE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      corroded = true;
    }
  }
  if (corroded && sim.chance(SELF_CONSUME_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }
  if (diffuseWith(x, y, sim, WATER.id, DIFFUSE_CHANCE)) return;
  updateLiquid(x, y, sim);
}

export const ACID = register({
  id: 11,
  name: 'Acid',
  phase: Phase.Liquid,
  color: rgb(150, 225, 70),
  density: 3,
  // An electrolyte: a Spark travels through it, losing strength slowly — it
  // conducts on a par with brine (better than fresh water). Like Water/Saltwater
  // a passing pulse can also electrolyse the cell into Hydrogen + Oxygen, leaving
  // no residue (see spark.ts).
  conductive: true,
  thermal: { conductivity: 0.5 },
  // Chilled well below zero it freezes in place (frosted, immobile) until it thaws.
  freeze: { temp: -20 },
  update: updateAcid,
});
