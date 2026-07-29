import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, flameAdjacent, type Combustible } from './combustion';
import { RUST_POWDER } from './rustpowder';
import { THERMITE } from './thermite';
import { SALTPETER } from './saltpeter';
import { FLASH_POWDER } from './flashpowder';
import { MOLTEN_ALUMINUM, ALUMINUM_MELT_TEMP } from './moltenaluminum';

// Aluminum Powder (알루미늄 가루) — the bright silver metal dust, and the hub the
// whole aluminum line runs through. Everything it does starts here:
//
//   • **+ Rust Powder → Thermite** — the cutting charge (see the `reactions`
//     rules below).
//   • **+ Saltpeter → Flash Powder** — the flash charge (same rules block).
//   • **heat it past 660° with no flame on it → Molten Aluminum → Aluminum** —
//     the casting line (see `tryMeltAluminum` below and moltenaluminum.ts).
//   • **light it** — the game's most stubborn, hottest ordinary fuel (below).
//
// The oldest of those is the thermite recipe: **Aluminum Powder + Rust Powder →
// Thermite**. Thermite had always been a palette-only
// material; now it has the same "pour the ingredients into one pile and it
// becomes the product" crafting step Gunpowder got from Sulfur + Saltpeter +
// Coal Powder. And the ingredients are the real ones: thermite *is* iron oxide
// plus aluminum powder, and Rust Powder is already the game's iron oxide dust
// (it's what Metal Powder corrodes into in salt water) — so the recipe closes a
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
// every iron-bearing powder in the palette — Metal Powder, Rust Powder, Iron
// Ore — answers the field, so until now sweeping a magnet over a heap only ever
// separated metal from non-metal. Now the iron grains march off and the aluminum
// stays put. (It is not the only non-magnetic metal powder — Sodium never
// carried the tag either — but Sodium is a soft alkali metal nobody was going to
// mistake for iron filings in the first place.)
const SPEC: Combustible = {
  // Between Coal Powder (0.035) and Wood (0.06): a metal dust front creeps
  // rather than races — it took real heat to start and it doesn't hurry.
  burnChance: 0.05,
  // The highest autoignition in the game. In practice it is now reached only by
  // a grain sitting *in* a flame: `tryMeltAluminum` vetoes melting while any
  // flame is adjacent, so a grain against Fire/Lava/Blue Flame/a lit Thermite
  // wreath climbs right past 660° to here and catches, while one heated with no
  // flame on it melts at 660° and never arrives. (Flame in direct contact also
  // lights it outright at `burnChance`, as it does every fuel — see tryBurn.)
  autoIgniteTemp: 1000,
  // The hottest ordinary fuel here — past Iron (1200°), Glass (1150°) and
  // Stone (1100°), so burning aluminum genuinely melts what it rests on. Kept
  // just under Blue Flame / `OXY_MAX_PIN` (1800°) so the oxygen forced-draught
  // boost in combustion.ts still *raises* the pin instead of clamping it down.
  burnTemp: 1700,
};

// Melt vs burn. Aluminum's real melting point (660°, see moltenaluminum.ts) is
// far *below* its autoignition point here (1000°), so heat alone now has two
// possible answers and the cell has to pick one. It picks the same way the
// petroleum fuels do (see `flameAdjacent` / petroleumdistill.ts): **direct flame
// contact wins**.
//
//   • A flame actually touching the grain — Fire, Lava or Blue Flame — means it
//     burns, exactly as before: `tryBurn` above rolls `burnChance` and the melt
//     path is vetoed while any flame is adjacent, so the grain heats on toward
//     1000° and catches instead of quietly slumping into a puddle first.
//   • Heat with no flame on it — a coal bed through a wall, a molten metal pool,
//     a hot pipe — melts it at 660°, and it never reaches 1000° at all.
//
// That reads as one rule ("불을 대면 타고, 그냥 데우면 녹는다") and it is the
// physically honest one too: bulk aluminum melts, and it is fine aluminum *dust
// in a flame* that burns. It also produces a nice split inside a single heap
// resting on lava — the face in contact with the flame lights while the grains
// behind it, heated only by conduction, run down into melt.
//
// The upper bound matters as much as the lower one: a cell at or above the
// autoignition point is either already burning (its heat pinned at BURN_TEMP by
// combustion.ts) or about to, and a burning grain only wreathes itself in Fire
// on a WREATH_CHANCE roll — so on the ticks where no flame happens to be beside
// it, an unbounded melt check would yank a mid-burn grain out of the fire and
// turn it into a puddle. Melting strictly below the autoignition point leaves
// every burning cell to `tryBurn`.
function tryMeltAluminum(x: number, y: number, sim: SimContext): boolean {
  const t = sim.getTemp(x, y);
  if (t < ALUMINUM_MELT_TEMP || t >= SPEC.autoIgniteTemp) return false;
  if (flameAdjacent(x, y, sim)) return false;
  // In-place `set` keeps the (now high) temperature so the fresh Molten Aluminum
  // reads as molten instead of instantly re-freezing next tick.
  sim.set(x, y, MOLTEN_ALUMINUM.id);
  return true;
}

function updateAluminumPowder(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  if (tryMeltAluminum(x, y, sim)) return;
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

export const ALUMINUM_POWDER = register({
  // 127 is deliberately skipped — it's claimed by a material being added on a
  // parallel branch, so leaving the gap keeps the two from colliding when both
  // land (npm run check:material-ids enforces uniqueness at build time).
  id: 128,
  name: 'Aluminum Powder',
  phase: Phase.Powder,
  // Bright, near-white silver — deliberately lighter than Metal Powder's dusty
  // steel rgb(158, 162, 172), so the two metal dusts never read the same in a
  // mixed heap (which is exactly the heap the Electromagnet is meant to sort).
  color: rgb(208, 212, 218),
  // Real aluminum (~2.7 g/cm³) is roughly a third the weight of iron and about
  // half that of iron oxide, and the density scale keeps that ordering:
  // Aluminum Powder < Rust Powder (5.5) < Metal Powder (7). It also lands below
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
  combustible: true,
  // Filed with the plain powders rather than 폭발, so it sits directly beside
  // Metal Powder and Rust Powder: the partner it reacts with, and the metal-dust
  // family it belongs to. (Sulfur/Saltpeter went the other way — into 폭발 next
  // to the Gunpowder they make — because *both* of their partners were already
  // there. Here Rust Powder is anchored in 가루 by its corrosion role, and
  // splitting a two-ingredient recipe across two tabs would hide it.)
  category: 'powder',
  // Flaky, slightly cohesive dust — piles steeply, a touch more than Sulfur
  // (0.42), less than angular coal dust (0.48) (마찰).
  friction: 0.45,
  // Aluminum out-conducts iron in reality, and loose grains bridge heat far
  // worse than a solid bar, so this sits just above Metal Powder's 0.35 — hot
  // enough to carry a burn front through a pile without a flame between grains.
  thermal: { conductivity: 0.4 },
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
  ],
  update: updateAluminumPowder,
});
