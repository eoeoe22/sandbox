import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { RUST_POWDER } from './rustpowder';
import { THERMITE } from './thermite';

// Aluminum Powder (알루미늄 가루) — the bright silver metal dust, and the *fuel*
// half of the thermite recipe: **Aluminum Powder + Rust Powder → Thermite**
// (see the `reactions` rule below). Thermite has always been a palette-only
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
// to light, needs 580°). That governs the *radiant* path only: like every fuel
// in combustion.ts it will still catch from a flame cell actually touching it
// (Fire/Lava/Blue Flame, rolled at `burnChance`), so a match does work — it just
// takes its time, and nothing short of touching flame or serious heat starts it.
// Once it does catch it runs at BURN_TEMP, hotter than any other fuel here,
// melting the iron/stone/glass it rests on — but still nowhere near Thermite's
// 2800°, which is the whole point: lighting the aluminum alone gets you a torch,
// mixing it with rust first gets you a cutting charge.
//
// It is deliberately NOT `magnetic` (aluminum isn't ferrous), which makes it the
// first powder an Electromagnet *can't* pick up — so a heap of mixed metal dust
// can now actually be sorted: sweep the field over it and the iron/rust grains
// leave, the aluminum stays.
const SPEC: Combustible = {
  // Between Coal Powder (0.035) and Wood (0.06): a metal dust front creeps
  // rather than races — it took real heat to start and it doesn't hurry.
  burnChance: 0.05,
  // The highest autoignition in the game — nothing merely warm sets this off by
  // radiant heat; it takes Lava, a Blue Flame, molten metal or a lit Thermite
  // grain nearby. (Flame in direct contact still lights it at `burnChance`
  // above, as it does every fuel — see tryBurn.)
  autoIgniteTemp: 1000,
  // The hottest ordinary fuel here — past Iron (1200°), Glass (1250°) and
  // Stone (1100°), so burning aluminum genuinely melts what it rests on. Kept
  // just under Blue Flame / `OXY_MAX_PIN` (1800°) so the oxygen forced-draught
  // boost in combustion.ts still *raises* the pin instead of clamping it down.
  burnTemp: 1700,
};

function updateAluminumPowder(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return;
  updatePowder(x, y, sim);
}

// Per-tick, per-contact chance an aluminum grain resting against a rust grain
// grinds into Thermite — the same 0.25 (~4 ticks from contact) the black-powder
// recipe uses, so both crafting steps feel identical in the hand.
const MIX_CHANCE = 0.25;
// …and the same 150° cold gate. Mixing is *grinding*, not reacting: a pile
// that's already hot enough to be doing something on its own should do that
// instead. The margin here is enormous (this powder autoignites at 1000°, Rust
// Powder doesn't melt until 1538°), so the recipe can never pre-empt the burn.
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
  ],
  update: updateAluminumPowder,
});
