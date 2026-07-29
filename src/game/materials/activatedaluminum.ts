import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { tryMeltAluminumDust, tryDustExplosion } from './aluminumdust';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { ACID } from './acid';
import { HYDROGEN } from './hydrogen';

// Activated Aluminum (활성 알루미늄) — aluminum dust with its oxide skin taken
// off, and the palette's water-fuelled hydrogen generator.
//
// Every awkward thing about Aluminum Powder — it is the hardest fuel here to
// light, it shrugs off water, it needs a flame held against it — traces back to
// one fact: every grain is wrapped in a passivating oxide film. Liquid Gallium
// is the one thing in the game that takes that film off. It already crumbles
// *cast* Aluminum by wicking into its grain boundaries (see liquidgallium.ts);
// applied to the powder it does the other half of the real trick, and what comes
// out is a metal that tears the oxygen out of water on contact:
//
//   **Aluminum Powder + Liquid Gallium → Activated Aluminum**
//   **Activated Aluminum + 물 → Hydrogen + 발열**
//
// (The first rule is declared on the gallium side, alongside the embrittlement
// rule it belongs with — see liquidgallium.ts for why that direction and not
// this one. The gallium is *not* consumed by it, so one puddle activates a whole
// heap: it really is a catalyst here, exactly as it is in reality.)
//
// Against the palette's other water-reactive metal it is the slow half of the
// pair, which is the point of adding it. Sodium detonates the instant it gets
// wet — you get one bang and it is over. This just fizzes: it turns the pool it
// is in into rising hydrogen, cell by cell, and warms it while it does. So the
// bomb is not the powder, it is **whatever the gas collects under** — a
// two-stage machine (drop it in the water, cap the pool, light the ceiling
// later) rather than a one-touch explosion. Cap the pool with a Wood roof and
// the room fills; leave it open and it just bubbles.
//
// Its off switch is the casting line it came from: melt it (660°, below) and it
// pours out as ordinary Molten Aluminum, which freezes to ordinary Aluminum. The
// activation does not survive being melted — real activated aluminum is spent
// dust, and the oxide re-forms the moment it is a bulk metal again — so the loop
// closes: 가루 → 활성화 → 수소 발생 → (남은 것은) 녹여서 되돌리기.

// Water is the reaction's real fuel — it is the water that gives up its hydrogen
// and the grain that pays for it — so both cells are consumed 1:1. Deliberately
// `otherBecomes` (the water cell itself *becomes* the bubble) rather than
// `byproduct` (which vents into an adjacent empty cell): a heap at the bottom of
// a pool has no empty neighbour at all, so a vented byproduct would make the
// signature reaction of this material invisible in the one place players will
// always try it first. Turning the water cell into the gas puts the bubble
// exactly where the reaction happened, and it rises through the pool on its own.
const WATER_REACT_CHANCE = 0.06;
// Heat carried into the fresh bubble. Small on purpose: it must stay far under
// Hydrogen's 200° autoignition point, or every bubble would light itself at
// birth and the gas would never get the chance to collect anywhere.
const WATER_REACT_HEAT = 30;
// …and the exotherm you can actually feel, on the ticks the reaction doesn't
// fire. This one transforms nothing (no `produce`, no `otherBecomes`): it just
// deposits heat into the grain and the water touching it, so a working pile
// visibly warms its pool — and if the pool boils away to Steam the fizzing
// stops, because Steam is not one of the partners. That is the reaction
// throttling itself, and it is what real hydrogen generators do.
const FIZZ_HEAT_CHANCE = 0.1;
const FIZZ_HEAT = 6;
// Acid strips aluminum with or without the oxide film (see aluminumpowder.ts's
// own acid row) — activated dust just gets there faster, having nothing left to
// strip.
const ACID_REACT_CHANCE = 0.2;
const ACID_REACT_HEAT = 25;

// Burning. Same metal, same 1700° flame as Aluminum Powder, but it lights far
// more readily — the oxide skin is precisely what made the plain powder the
// hardest fuel in the palette to start (see aluminumpowder.ts). It catches from
// a flame at nearly twice the rate, and its autoignition drops from the game's
// highest (1000°) to 700°.
//
// 700 and not lower, because the number has a floor it must clear: the melt/burn
// split below is a half-open band `660 ≤ temp < autoIgniteTemp`, so an
// autoignition point *under* the 660° melt point would collapse that band to
// nothing and the dust could never melt at all. Keeping it just above 660° is
// what preserves the parent powder's rule — 불을 대면 타고, 그냥 데우면 녹는다 —
// and with it the recycling path (melt the leftovers, cast them, start over).
const SPEC: Combustible = {
  burnChance: 0.09,
  autoIgniteTemp: 700,
  burnTemp: 1700,
};

function updateActivatedAluminum(x: number, y: number, sim: SimContext): void {
  // Airborne and lit → the whole grain goes at once (분진 폭발). Checked first,
  // exactly as in aluminumpowder.ts, and gated on suspension so a heap is
  // untouched by it.
  if (tryDustExplosion(x, y, sim)) return;
  if (tryBurn(x, y, sim, SPEC)) return;
  // Melting is the un-activation: what pours out is ordinary Molten Aluminum.
  if (tryMeltAluminumDust(x, y, sim, SPEC.autoIgniteTemp)) return;
  updatePowder(x, y, sim);
}

export const ACTIVATED_ALUMINUM = register({
  // Past the end of the current roster rather than filling the gap at 142 —
  // that number is still held open for a branch in flight, and ids are stable
  // identifiers (save files and spark.ts's conductor table index by them), so
  // gaps are never worth closing. `npm run check:material-ids` enforces
  // uniqueness at build time.
  id: 144,
  name: 'Activated Aluminum',
  phase: Phase.Powder,
  // A duller, warmer grey than Aluminum Powder's bright rgb(208, 212, 218):
  // stripping the oxide film is what takes the shine off real aluminum dust
  // (activated powder is visibly dark and tarnished), and a player needs to see
  // at a glance which half of a heap the gallium has already been through.
  color: rgb(172, 168, 158),
  // Just over its parent powder (4.6): the gallium wicked into the grain
  // boundaries stays there (gallium is denser than aluminum), and being the
  // heavier of the two means fresh activated dust settles *through* the
  // un-activated powder above it rather than floating on it. Still well over
  // Water (3) and Saltwater (4), so a pinch poured into a pool sinks to the
  // bottom and works from there instead of skating on the surface.
  density: 4.8,
  combustible: true,
  // Filed with the plain powders beside the Aluminum Powder it comes from,
  // rather than in 폭발 — it is not a charge, it is a gas generator.
  category: 'powder',
  // Slightly stickier than the plain powder (0.45): the gallium alloyed into
  // the grain surfaces makes the dust clump (마찰).
  friction: 0.47,
  // Same as its parent powder — a metal dust bridges heat well enough to carry
  // a burn front through a pile.
  thermal: { conductivity: 0.4 },
  reactions: [
    // The signature reaction, in both flavours of water. Note the ordering: the
    // consuming rule is listed before the pure-exotherm one, because `tryReact`
    // applies the first rule that finds a partner and passes its roll — so a
    // contact first rolls for a bubble, and only when that misses does it fall
    // through to simply running hot.
    {
      with: WATER.id,
      produce: EMPTY,
      otherBecomes: HYDROGEN.id,
      probability: WATER_REACT_CHANCE,
      heat: WATER_REACT_HEAT,
    },
    {
      with: SALTWATER.id,
      produce: EMPTY,
      otherBecomes: HYDROGEN.id,
      probability: WATER_REACT_CHANCE,
      heat: WATER_REACT_HEAT,
    },
    { with: WATER.id, probability: FIZZ_HEAT_CHANCE, heat: FIZZ_HEAT },
    { with: SALTWATER.id, probability: FIZZ_HEAT_CHANCE, heat: FIZZ_HEAT },
    // Acid does the same thing faster, and the same way — see aluminumpowder.ts
    // for why the acid cell becomes the bubble instead of venting one.
    {
      with: ACID.id,
      produce: EMPTY,
      otherBecomes: HYDROGEN.id,
      probability: ACID_REACT_CHANCE,
      heat: ACID_REACT_HEAT,
    },
  ],
  update: updateActivatedAluminum,
});
