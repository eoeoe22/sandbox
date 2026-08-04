import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updateLiquid, diffuseWith } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryCorrode, tryCorrodeSoaked, ACID_CORROSION } from './corrosion';
import { ACID_VAPOR } from './acidvapor';
import { WATER } from './water';
import { SLIME } from './slime';
import { ACID_SLIME } from './acidslime';
import { tryPhaseChange } from './phasechange';

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

// Slime is the one *liquid* acid does something to. It can't corrode it (that
// pass only eats Solids and Powders), and the two goos are chemically the same
// stuff, so contact soaks the acid into the goo instead: 산 + 슬라임 → 산성 슬라임.
//
// The shape is Acid's own corrosion, not a new bargain: **it acidifies on
// contact, and only sometimes spends the cell doing it** — exactly how this
// liquid already treats every solid and powder it eats (corrosion.ts's
// `ACID_CORROSION`, whose `selfConsumeChance` is this same 0.08). A splash
// therefore works through a blob rather than staining one cell per drop, and a
// puddle still runs out eventually, which is what keeps it from being a free
// catalyst (compare Liquid Gallium's deliberately never-consumed aluminum rules,
// liquidgallium.ts — that one IS a catalyst, and says so).
//
// It started at a strict 1:1 (`produce: EMPTY` unconditionally, 0.2 per contact)
// and that was too weak to read as an effect at all: measured on a 144-cell blob
// with a pool of acid poured over it, 1:1 converted 73 cells over 300 ticks while
// the reverse direction (water) converted all 144 in 200 — 산이 물보다 한참 굼떠
// 보였다. Raising the *probability* barely moved it (76 → 74 at p=1), because the
// limit was never the roll: acid is a thin liquid, so most of the pool drains off
// the blob before it ever touches it, and 1:1 meant every cell that did touch was
// worth exactly one conversion. Spending the acid only occasionally is what fixed
// it (104 cells at 0.08), and letting the two goos interdiffuse a little faster
// carried it the rest of the way to water's pace (118 — acidslime.ts's
// DIFFUSE_CHANCE, which is what surfaces the buried core for either direction).
//
// Declared here rather than on Slime's side for the usual import-graph reason:
// Acid Slime already imports Slime, so a rule on Slime naming Acid Slime would
// close a module-scope cycle, while this direction (acid → acid slime → slime)
// has no edge coming back.
//
// The reverse — water washing the acid back out of the goo — lives on Acid
// Slime's own update (acidslime.ts), because it is a dilution rather than a
// contact reaction: it happens as the blob *drinks*, which is Slime's mechanic.
const SLIME_ACIDIFY_CHANCE = 1;
const SLIME_ACIDIFY_SELF_CONSUME = 0.08;

function updateAcid(x: number, y: number, sim: SimContext): void {
  // Conductor bookkeeping: tick down the post-spark refractory stamped in `aux`
  // so this cell can carry current again (mirrors Water/Saltwater — see spark.ts).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (tryPhaseChange(x, y, sim)) return;

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
  // On a par with brine and better than fresh water — 1 per cell out of a pulse's
  // 63, so ~63 cells of reach (see Material.sparkLoss).
  sparkLoss: 1,
  thermal: { conductivity: 0.5 },
  // Chilled well below zero it freezes in place (frosted, immobile) until it thaws.
  freeze: { temp: -20 },
  // 끓는점 — the Vapor is born with the hot temperature, then rises and
  // corrodes/condenses on its own (see acidvapor.ts).
  phaseChange: { at: () => ACID_BOIL_TEMP, when: 'atOrAbove', into: () => ACID_VAPOR.id },
  // 산 + 슬라임 → 산성 슬라임. Two rows for one reaction, because the table has no
  // "consume the declaring cell sometimes" field and this needs one (see above).
  // The rows are tried in order, so the first is the branch where the acid is
  // spent (joint probability: it fires, AND it was the cell's last bite) and the
  // second is the ordinary one where the acid survives to keep working.
  reactions: [
    {
      with: SLIME.id,
      produce: EMPTY,
      otherBecomes: ACID_SLIME.id,
      probability: SLIME_ACIDIFY_CHANCE * SLIME_ACIDIFY_SELF_CONSUME,
    },
    { with: SLIME.id, otherBecomes: ACID_SLIME.id, probability: SLIME_ACIDIFY_CHANCE },
  ],
  update: updateAcid,
  // 스며든 산도 계속 먹는다: soaked into a powder bed through the 겹침 layer, it
  // corrodes the grain holding it (corrosion.ts's `tryCorrodeSoaked`) instead of
  // sitting inert inside a perfectly corrodible pile — the grain dissolving hands
  // the acid the cell back, so it eats its way out and goes on as a puddle.
  // Boiling stays out of the soaked turn on purpose: the Vapor is a gas, which no
  // powder can hold, so acid buried in a bed simply waits until it resurfaces.
  overlapUpdate: (x, y, sim) => tryCorrodeSoaked(x, y, sim, ACID_CORROSION),
});
