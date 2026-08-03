import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn } from './combustion';
import { tryMeltAluminumDust, tryDustExplosion } from './aluminumdust';
import { RUST_POWDER } from './rustpowder';
import { THERMITE } from './thermite';
import { SALTPETER } from './saltpeter';
import { FLASH_POWDER } from './flashpowder';
import { AMMONIUM_NITRATE } from './ammoniumnitrate';
import { AMMONAL } from './ammonal';
import { STEAM } from './steam';
import { HYDROGEN } from './hydrogen';
import { chlorineMetalBurn } from './chlorine';

// Aluminum Powder (알루미늄 가루) — the bright silver metal dust, and the hub the
// whole aluminum line runs through. Everything it does starts here:
//
//   • **+ Rust Powder → Thermite** — the cutting charge (see the `reactions`
//     rules below).
//   • **+ Saltpeter → Flash Powder** — the flash charge (same rules block).
//   • **+ Ammonium Nitrate → Ammonal** — the metal-fuelled bulk charge, ANFO's
//     stronger cousin (same rules block; see ammonal.ts).
//   • **+ Acid → Hydrogen** — the cheapest gas generator in the game (the
//     `acidHydrogen` tag below; acid's own corrosion pass drives it).
//   • **+ Steam, while it is burning → Hydrogen** — 불타는 금속에 물을 끼얹으면
//     오히려 더 커진다 (same rules block).
//   • **+ Liquid Gallium → Activated Aluminum** — the oxide film comes off and
//     the dust starts tearing hydrogen out of plain water (declared on the
//     gallium side; see activatedaluminum.ts).
//   • **heat it past 660° with no flame on it → Molten Aluminum → Aluminum** —
//     the casting line (see `tryMeltAluminumDust` in aluminumdust.ts and
//     moltenaluminum.ts).
//   • **light it** — the game's most stubborn, hottest ordinary fuel (below) —
//     unless it is *airborne*, in which case it is a dust explosion
//     (`tryDustExplosion`, aluminumdust.ts).
//
// The oldest of those is the thermite recipe: **Aluminum Powder + Rust Powder →
// Thermite**. Thermite had always been a palette-only
// material; now it has the same "pour the ingredients into one pile and it
// becomes the product" crafting step Gunpowder got from Sulfur + Saltpeter +
// Coal Powder. And the ingredients are the real ones: thermite *is* iron oxide
// plus aluminum powder, and Rust Powder is already the game's iron oxide dust
// (it's what Iron Powder corrodes into in salt water) — so the recipe closes a
// loop that was already half-built, 소금물에 삭힌 철가루 → 녹가루 → 테르밋.
//
// On its own it's the game's most *stubborn* fuel, and its hottest. Real
// aluminum powder is wrapped in a passivating oxide skin, which is exactly why
// thermite needs a magnesium ribbon to start rather than a match — so its
// autoignition point is the highest in the palette (Coal, the previous hardest
// to light, needs 580°). Lighting it therefore takes a flame in *contact*:
// like every fuel in combustion.ts it catches from a touching Fire/Lava/Blue
// Flame cell rolled at `burnChance`, so a match does work — it just takes its
// time. Radiant heat with no flame on it no longer lights it at all, because
// the melting point now sits underneath the autoignition point and answers
// first (see `tryMeltAluminum`); that split is the metal's central rule.
// Once it does catch it runs at BURN_TEMP, hotter than any other fuel here,
// melting the iron/stone/glass it rests on — but still nowhere near Thermite's
// 2800°, which is the whole point: lighting the aluminum alone gets you a torch,
// mixing it with rust first gets you a cutting charge.
//
// It is deliberately NOT `magnetic` (aluminum isn't ferrous), which is what
// makes it the first powder an Electromagnet can sort *other metal dust* from:
// every iron-bearing powder in the palette — Iron Powder, Rust Powder, Iron
// Ore — answers the field, so until now sweeping a magnet over a heap only ever
// separated metal from non-metal. Now the iron grains march off and the aluminum
// stays put. (It is not the only non-magnetic metal powder — Sodium never
// carried the tag either — but Sodium is a soft alkali metal nobody was going to
// mistake for iron filings in the first place.)

// The highest autoignition in the game. In practice it is reached only by a
// grain sitting *in* a flame: `tryMeltAluminumDust` vetoes melting while any
// flame is adjacent, so a grain against Fire/Lava/Blue Flame/a lit Thermite
// wreath climbs right past 660° to here and catches, while one heated with no
// flame on it melts at 660° and never arrives. (Flame in direct contact also
// lights it outright at `burnChance`, as it does every fuel — see tryBurn.)
//
// Named rather than written straight into `combustion` because the steam
// reaction below has to start at exactly this temperature — only a burning grain
// cracks steam — and both sit inside the same register literal, where the
// material itself is not yet there to be read back.
const AUTO_IGNITE_TEMP = 1000;

// The melt-vs-burn split ("불을 대면 타고, 그냥 데우면 녹는다") and the
// dust-explosion path both live in aluminumdust.ts now, because the activated
// dust obeys exactly the same two rules with different numbers — see that file
// for why each one is shaped the way it is.
function updateAluminumPowder(x: number, y: number, sim: SimContext): void {
  // Airborne and lit → the whole grain flashes at once, and the front rips
  // through the rest of the cloud. Checked *first*, before the ordinary
  // catch-from-a-flame roll, because that is the difference the rule exists to
  // express: a heap of this stuff is the hardest thing here to light, and the
  // same grains hanging in the air are a bomb. It is gated strictly on
  // suspension, so a pile behaves exactly as it always did.
  if (tryDustExplosion(x, y, sim)) return;
  if (tryBurn(x, y, sim)) return;
  if (tryMeltAluminumDust(x, y, sim)) return;
  updatePowder(x, y, sim);
}

// Per-tick, per-contact chance an aluminum grain resting against a rust grain
// grinds into Thermite — the same 0.25 (~4 ticks from contact) the black-powder
// recipe uses, so both crafting steps feel identical in the hand.
const MIX_CHANCE = 0.25;
// …and the same 150° cold gate. Mixing is *grinding*, not reacting: a pile
// that's already hot enough to be doing something on its own should do that
// instead. The margin is enormous (this powder autoignites at 1000°, Rust Powder
// melts at IRON_MELT_TEMP 1200°), so the recipe can never pre-empt either.
//
// One asymmetry worth naming, because it differs from the hand-rolled
// black-powder helper: reactions.ts checks `tempMax` against the cell that
// *declares* the rule only, so this gates the aluminum grain, never its rust
// partner (gunpowdermix.ts, checking both sides itself, has no such gap). A
// hot rust grain touching a still-cold aluminum grain can therefore be pulled
// into Thermite. Two things keep that from mattering.
//
// First it is self-closing, because the gate the rule *does* check is on the
// cell being heated: conduction lifts the aluminum past 150° within a few ticks
// of meeting a hot neighbour, and the rule stops firing. Measured with a 600°
// rust bed under cold aluminum, some aluminum was left under the gate for only
// 14 of 200 ticks, and conversion came out roughly half an ambient pile's.
//
// Second, every outcome it can produce is a sensible one. The rust side has no
// floor at all — being ungated is the whole point of this note, and the ordinary
// recipe is two ambient grains — but it does have a ceiling: Rust Powder melts at
// 1200°, so above that it is Slag/Molten Iron Ore before this rule ever sees it
// and nothing converts (measured at a 1400° bed, zero Thermite). So the rust
// partner is anywhere from ambient to just under 1200°, the Thermite inherits
// whatever that was, and both halves of that range read correctly: below
// Thermite's own 900° autoignition it is inert powder, which is exactly what
// thermite is until something lights it, and from 900° to 1200° it is born
// already alight — which is what mixing aluminum into red-hot iron oxide ought
// to do.
const MIX_MAX_TEMP = 150;

// Per-tick, per-contact chance a grain touching Acid dissolves into a hydrogen
// bubble (see `Material.acidHydrogen`). Second only to the activated dust this
// powder becomes (0.2, activatedaluminum.ts — it has no oxide film left to
// strip): aluminum in hydrochloric acid is one of the most violent fizzes in a
// school lab. Low enough, still, that a pile in a puddle fizzes for a beat
// rather than flashing.
const ACID_HYDROGEN_CHANCE = 0.12;
// …and the same for steam meeting a *burning* grain. Faster, because that
// reaction is a runaway rather than a fizz.
const STEAM_REACT_CHANCE = 0.25;
// Heat carried into the hydrogen this one makes — and unlike the acid rule's,
// this number is deliberately *large*, because the whole point of the rule is
// that the gas lights. Steam already arrives hot (110° from the kettle, more
// beside a 1700° grain), but that is an assumption about the neighbourhood
// rather than a guarantee; +200 puts the fresh bubble past Hydrogen's own 200°
// autoignition point (hydrogen.ts) from any steam temperature at all, so
// "물을 끼얹으면 오히려 커진다" is enforced by the rule instead of merely being
// likely. The exotherm is honest too: this reaction is what blew the roofs off
// at Fukushima.
const STEAM_REACT_HEAT = 200;

// Per-tick, per-contact chance a grain touching Chlorine burns (2Al + 3Cl₂ →
// 2AlCl₃ — see chlorine.ts's `chlorineMetalBurn` for the reaction and why the
// rule lives on this side). Between the two extremes of the family: faster than
// the cast bar (0.06, which also has to be hot first) because a loose grain
// presents all of itself to the gas instead of one face, and slower than the
// activated dust (0.4) because the oxide film every ordinary grain still wears
// is precisely what that dust has had stripped off. The same film is why this
// powder is the hardest fuel in the game to light — chlorine just gets through
// it far more easily than a flame does, which is the point of the reaction: the
// metal you can barely light with a match burns on contact in the gas.
const CHLORINE_REACT_CHANCE = 0.2;

export const ALUMINUM_POWDER = register({
  // 127 is deliberately skipped — it's claimed by a material being added on a
  // parallel branch, so leaving the gap keeps the two from colliding when both
  // land (npm run check:material-ids enforces uniqueness at build time).
  id: 128,
  name: 'Aluminum Powder',
  phase: Phase.Powder,
  // Bright, near-white silver — deliberately lighter than Iron Powder's dusty
  // steel rgb(158, 162, 172), so the two metal dusts never read the same in a
  // mixed heap (which is exactly the heap the Electromagnet is meant to sort).
  color: rgb(208, 212, 218),
  // Real aluminum (~2.7 g/cm³) is roughly a third the weight of iron and about
  // half that of iron oxide, and the density scale keeps that ordering:
  // Aluminum Powder < Rust Powder (5.5) < Iron Powder (7). It also lands below
  // the mineral powders (Sand/Salt 5) and above Saltwater (4)/Water (3), so a
  // poured charge still sinks in a pool. Set 4.6 rather than 4.5 so it isn't
  // exactly tied with Lava and has a definite sink/float answer everywhere.
  //
  // Being lighter than its partner means a pile poured one-on-top-of-the-other
  // settles into two layers and only the seam between them converts (measured:
  // ~1/3 of a 5-deep-each stack, and it plateaus there — the Thermite the seam
  // makes is heavier than both and does not stir the layers back together). That
  // is exactly how the black-powder recipe already behaves with its own
  // density-sorted ingredients, and the answer is the same: stir the heap with
  // the 섞기 브러시, or lay the two down interleaved, and the bulk goes over
  // (measured: 90% of an interleaved pile inside ~60 ticks).
  density: 4.6,
  combustion: {
    // Between Coal Powder (0.035) and Wood (0.06): a metal dust front creeps
    // rather than races — it took real heat to start and it doesn't hurry.
    burnChance: 0.05,
    autoIgniteTemp: AUTO_IGNITE_TEMP,
    // The hottest ordinary fuel here — past Iron (1200°), Glass (1150°) and
    // Stone (1100°), so burning aluminum genuinely melts what it rests on. Kept
    // just under Blue Flame / `OXY_MAX_PIN` (1800°) so the oxygen forced-draught
    // boost in combustion.ts still *raises* the pin instead of clamping it down.
    burnTemp: 1700,
  },
  // 금속화재(D급) — water is not the answer, and this world already models why:
  // burning aluminum cracks Water and Steam into Hydrogen (see the reactions
  // below). Declaring the class keeps the shared suppression pass (suppress.ts)
  // from quietly dousing the fire first, so a player who reaches for the hose
  // gets the hydrogen instead of a tidy extinguish. CO₂/Soda still work on it.
  fireClass: 'D',
  // Filed with the plain powders rather than 폭발, so it sits directly beside
  // Iron Powder and Rust Powder: the partner it reacts with, and the metal-dust
  // family it belongs to. (Sulfur/Saltpeter went the other way — into 폭발 next
  // to the Gunpowder they make — because *both* of their partners were already
  // there. Here Rust Powder is anchored in 가루 by its corrosion role, and
  // splitting a two-ingredient recipe across two tabs would hide it.)
  category: 'powder',
  // Flaky, slightly cohesive dust — piles steeply, a touch more than Sulfur
  // (0.42), less than angular coal dust (0.48) (마찰).
  friction: 0.45,
  // Aluminum out-conducts iron in reality, and loose grains bridge heat far
  // worse than a solid bar, so this sits just above Iron Powder's 0.35 — hot
  // enough to carry a burn front through a pile without a flame between grains.
  thermal: { conductivity: 0.4 },
  // **Acid → Hydrogen.** Pouring acid on aluminum used to do the least
  // interesting thing in the game: corrosion.ts's `isCorrodible` looks at nothing but
  // the phase, so the grains simply blinked out with no product at all. Now the
  // acid cell that eats a grain *becomes* the bubble — 1:1, so the puddle is
  // spent as it works and its size is the cap on how much gas you get (see
  // corrosion.ts's tryEvolveHydrogen for why the bubble replaces the acid cell rather
  // than venting into a free neighbour).
  acidHydrogen: { chance: ACID_HYDROGEN_CHANCE },
  // The thermite recipe. Unlike black powder's three-body mix — which needed a
  // shared helper module because the declarative table is structurally 2-body
  // (see gunpowdermix.ts) — this one *is* two-body, so it's exactly the one
  // table row engine/reactions.ts exists for, with the same discipline the
  // helper hand-rolls: both cells transform, both are marked moved so neither
  // re-reacts or gets picked up again this tick, and `set` keeps each cell's
  // temperature (no heat of mixing — grinding aluminum into rust doesn't light
  // it; that's what the ignition source is for). Mass-conserving 1:1, the same
  // 고증 concession the 1:1:1 black-powder ratio makes: real thermite is about
  // 3:1 rust:aluminum by mass, but metering that out with a pixel brush would
  // be labor rather than fun.
  reactions: [
    {
      with: RUST_POWDER.id,
      produce: THERMITE.id,
      otherBecomes: THERMITE.id,
      probability: MIX_CHANCE,
      tempMax: MIX_MAX_TEMP,
    },
    // The second recipe off the same grain: **Aluminum Powder + Saltpeter →
    // Flash Powder** (see flashpowder.ts). Identical shape and identical gates
    // to the Thermite row above — same 0.25 mixing chance, same 150° cold gate —
    // so all three of the game's crafting recipes feel the same in the hand.
    // The two rows can never contend: they take different partners, and
    // `tryReact` applies the first rule that finds one, so a grain touching both
    // an oxide and an oxidizer simply becomes Thermite this tick and is free to
    // become Flash Powder on a later one if the rust is gone.
    //
    // Which is the *interesting* half of putting them side by side: aluminum is
    // the fuel in both, and what you grind it with decides whether you get the
    // slow, blinding cutting charge or the instantaneous flash — 산화철이면
    // 절단, 산화제 염이면 섬광.
    {
      with: SALTPETER.id,
      produce: FLASH_POWDER.id,
      otherBecomes: FLASH_POWDER.id,
      probability: MIX_CHANCE,
      tempMax: MIX_MAX_TEMP,
    },
    // …and the third, on the same gates again: **+ Ammonium Nitrate → Ammonal**
    // (ammonal.ts), the metal-fuelled bulk charge. It completes the sentence the
    // other two started — 이 가루를 무엇과 갈아 섞느냐가 전부다: 산화철이면
    // 절단(Thermite), 산화제 염이면 섬광(Flash Powder), 질산암모늄이면
    // 광산 폭약(Ammonal). Seen from the prill's side it is the dry counterpart
    // to ANFO: pour fuel oil on ammonium nitrate and you get ANFO, grind metal
    // dust into it and you get something stronger still.
    {
      with: AMMONIUM_NITRATE.id,
      produce: AMMONAL.id,
      otherBecomes: AMMONAL.id,
      probability: MIX_CHANCE,
      tempMax: MIX_MAX_TEMP,
    },
    // (Acid → Hydrogen lives on the `acidHydrogen` tag below, not here: acid's
    // own corrosion pass drives it so the fizz can't lose a race against the
    // silent bite. It used to be a row right here — see types.ts.)
    //
    // **Burning aluminum + Steam → Hydrogen.** The one that inverts a piece of
    // common sense: throwing water at a metal fire makes it *worse*. Hot
    // aluminum (and zirconium — this is the reaction behind the hydrogen
    // explosions at Fukushima) tears the oxygen out of steam and hands back
    // hydrogen, which then finds the very flame that made it.
    //
    // The `tempMin` gate is what keeps it a metal-fire rule rather than a
    // kettle rule, and 1000° is not an arbitrary number: it is this powder's own
    // autoignition point, so in practice the only cells that ever qualify are
    // the ones actually on fire (a burning grain pins at 1700°). A grain merely
    // heated toward it melts at 660° long before it arrives — the melt/burn
    // split doing the gating for us.
    {
      with: STEAM.id,
      produce: EMPTY,
      otherBecomes: HYDROGEN.id,
      probability: STEAM_REACT_CHANCE,
      heat: STEAM_REACT_HEAT,
      tempMin: AUTO_IGNITE_TEMP,
    },
    // **+ Chlorine → 불꽃 + 흰 연기.** No gate at all, unlike every other row
    // here: chlorine is an oxidiser in its own right, so the burn needs no
    // flame, no air and no heat to start — a cloud let into a sealed box with a
    // heap of this in it lights the heap. Listed last only because it is the
    // one rule whose partner is a *gas*: the rows above all want a powder
    // neighbour, and a grain can be touching several at once, so keeping the
    // crafting recipes ahead of it means a heap being ground into Thermite in a
    // chlorine atmosphere still becomes Thermite rather than being burned out
    // from under the recipe.
    chlorineMetalBurn(CHLORINE_REACT_CHANCE),
  ],
  update: updateAluminumPowder,
});
