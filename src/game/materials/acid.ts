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
// contact, and only sometimes spends the cell doing it** — the way this liquid
// already treats every solid and powder it eats (corrosion.ts's `ACID_CORROSION`,
// whose `selfConsumeChance` is this same 0.08). A splash therefore works through
// a blob rather than staining one cell per drop, and a puddle still runs out
// eventually, which is what keeps it from being a free catalyst (compare Liquid
// Gallium's deliberately never-consumed aluminum rules, liquidgallium.ts — that
// one IS a catalyst, and says so).
//
// One difference from the corrosion pass is worth stating, because the table's
// shape forces it: `tryCorrode` rolls its self-consume **once per tick**, after
// the whole neighbour loop, while `tryReact` re-rolls each rule **per matching
// neighbour** (engine/reactions.ts). So the spend chance here is per *contact*,
// not per turn — an acid cell against one slime cell keeps working for a hundred
// ticks or so, while one engulfed on all sides is spent almost at once (measured
// averages: ~100 ticks at one neighbour, ~5.6 at four, ~1.2 at eight). It reads
// as "the more goo it is working on, the faster it is used up", which is fine on
// its own terms — and it errs toward the acid running out sooner rather than
// lasting forever, which is the side to err on.
//
// It started at a strict 1:1 (`produce: EMPTY` unconditionally, 0.2 per contact)
// and that was too weak to read as an effect at all: measured on a 144-cell blob
// with a pool of acid poured over it, 1:1 converted 73 cells over 300 ticks while
// the reverse direction (water) was visibly quicker — 산이 물보다 한참 굼떠 보였다.
// Raising the *probability* barely moved it (76 → 74 at p=1), because the limit
// was never the roll, and spending the acid only occasionally rather than every
// time (104 cells at 0.08) plus a brisker interdiffusion (118 — acidslime.ts's
// DIFFUSE_CHANCE, which is what surfaces the buried core for either direction)
// only narrowed the gap. What actually closed it was none of these: it was the
// contact area, which none of them touch — see SLIME_ABSORB_CHANCE below. These
// rows survive because they are what makes the liquid *corrosive* rather than
// merely edible, but the pace is not theirs.
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

// …and the piece that actually sets the *pace*: 슬라임은 산도 마신다. Either goo
// absorbs an adjacent Acid cell and grows by it, the drunk cell coming back as
// Acid Slime — Slime's own feeding mechanic (slime.ts's ABSORB_CHANCE), pointed
// at the other liquid it can touch. This is the row that makes the recipe run at
// the undo's speed, and it took a second pass to find, because the obvious knob
// was the wrong one.
//
// Both directions only ever act on the goo's *wet face*, so what decides how fast
// a blob turns over is not the roll at that face but whether the face
// **advances**. Water's does: the goo drinks the pool, so the boundary sweeps up
// through it and every cell born there is fresh. Acidification alone doesn't — it
// rewrites the face and then stares at a wall of goo it has already converted,
// leaving only the two goos' interdiffusion (acidslime.ts DIFFUSE_CHANCE) to
// reach the core. A sealed-box A/B (24×12 of each) showed exactly that shape: at
// p=1 per contact — the roll already maxed out — the acid still needed 600 ticks
// to reach 46% converted, having spent 7 of its 288 cells doing it, while water
// was done at 51% with its pool drunk dry by tick 150. 굼뜬 건 확률이 아니라
// 접촉면이었다, which is why raising the probability had barely moved it.
//
// Drinking the acid is what advances the face, and it costs nothing in balance
// terms: the cell is consumed by definition (it *became* goo), so this is the
// least catalytic row in the table, not a new way for one drop to eat the world.
// Both goos drink it, for the same reason water is drunk by both — otherwise the
// blob's newly-acidified face would stop the growth dead the moment it forms.
//
// The number is half of Slime's water feed and is not comparable to it: this rule
// is rolled from the *acid's* turn across all 8 neighbours, where the pool is the
// numerous side, while Slime's feed is rolled from the goo's turn across 4 — and
// the acidify rows below pile on top of it. So it is tuned against the thing the
// player can actually see, which is **how fast the goo drinks the pool**:
//
//   시약 288칸이 사라지기까지 (밀폐 상자, 3시드 평균)
//     산성 슬라임 + 물 152틱   |  산성 슬라임 + 산 150틱
//     일반 슬라임 + 물 154틱   |  일반 슬라임 + 산 157틱
//
// 물이든 산이든 goo가 웅덩이를 마시는 속도가 같다 — that parity is the point, and it
// is the check `test:acidslime` pins. The first pass at this rule missed it badly:
// tuned only against the *conversion* count it landed at 0.01, where the goo took
// 353–392 ticks to drink an acid pool against water's 153 — 산성 슬라임이 산을 제대로
// 침식하지 않는다는 피드백이 정확히 이 자리였다. Once acid meets goo that is already
// acidic there is nothing left to acidify, so this row is the *only* thing acting,
// and at 0.01 it was 2.5× too slow.
//
// The conversion pace stays honest at this rate too, scored as the **share** of
// the goo that has changed rather than a raw count — the raw counts are not
// comparable between the directions, since 100% of a drunk acid cell comes back
// acidic while only 50% of a drunk water cell comes back plain (acidslime.ts's
// ABSORB_ACID_CHANCE), which flatters the acid side for free. By share, on open
// ground at 200 ticks over 8 seeds: 산 73–76% vs 물 56–62%, a ratio of 1.20–1.29.
// The corrosive direction running ~a quarter ahead is the right way round, and it
// is the side to err on — this rule has now been reported as too slow twice and
// never as too fast.
const SLIME_ABSORB_CHANCE = 0.025;

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
    // Drunk by the goo: this cell *is* the new Acid Slime, the goo cell it fed is
    // untouched. Tried first so a contact is a feed before it is a bite — the
    // growth is what carries the recipe through a blob (SLIME_ABSORB_CHANCE).
    { with: SLIME.id, produce: ACID_SLIME.id, probability: SLIME_ABSORB_CHANCE },
    { with: ACID_SLIME.id, produce: ACID_SLIME.id, probability: SLIME_ABSORB_CHANCE },
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
