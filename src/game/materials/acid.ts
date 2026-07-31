import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid, diffuseWith } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryCorrode, ACID_CORROSION } from './corrosion';
import { ACID_VAPOR } from './acidvapor';
import { WATER } from './water';

// Liquid: flows like water, but each tick has a chance to corrode any
// non-resistant Solid/Powder neighbor (dissolving it to Empty). If it
// corroded anything this tick, it also has a chance to consume itself —
// bounds how much a given puddle of acid can eat through before running out.
// With no corrodible neighbor, it just sits there — acid only ever shrinks
// as a byproduct of actually corroding something, never on its own.
//
// That corrosion pass isn't written here. All three corrosive materials — this,
// Acid Vapor and Acid Slime — share the one implementation in corrosion.ts and
// differ only by the spec they hand it; `ACID_CORROSION` is the liquid's, and
// this file supplies the rest of the liquid's life (boiling, diffusion, flow).
//
// One class of neighbor gets a louder ending than "blinks out": a metal above
// hydrogen in the reactivity series (`Material.acidHydrogen` — the aluminum
// three, Uranium, Iron and its filings, solid Gallium) fizzes, and the acid cell
// doing the eating turns into the hydrogen bubble itself (corrosion.ts's
// tryEvolveHydrogen). Metals *below* hydrogen (Wire's copper core, Mercury) and
// the oxides / carbonates (Rust, Iron Ore, Limestone) carry no tag and keep
// dissolving silently — which is the honest chemistry, not an omission. The
// liquid is the only corroder that fizzes: see `CorrosionSpec.evolvesHydrogen`.
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
const ACID_BOIL_TEMP = 100;
const DIFFUSE_CHANCE = 0.02;

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

  // Corrode (and fizz): the shared pass in corrosion.ts. True means this cell is
  // gone — spent on the bite, or turned into a hydrogen bubble — so stop here.
  if (tryCorrode(x, y, sim, ACID_CORROSION)) return;

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
