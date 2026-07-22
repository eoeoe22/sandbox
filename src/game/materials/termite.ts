import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { tryBurn, type Combustible } from './combustion';
import { updateCrawler } from './crawler';
import { WOOD } from './wood';
import { SAWDUST } from './sawdust';

// Termite (흰개미) — a wood-colored crawler that wanders the surface of solid
// and powder terrain, gnawing Wood/Sawdust. A bite always clears the eaten
// cell; REPRODUCE_CHANCE of the time it also spawns a fresh termite there
// (colony growth), otherwise the food just disappears. Free to cluster with
// other crawlers (own kind or Nanobot) — see crawler.ts for the shared
// crawl/eat/reproduce core and its ground-hop-count gravity guard.
//
// It's exactly as flammable as the Sawdust it's made of (same Combustible
// spec) — `tryBurn` runs first every tick so a termite standing in an actual
// flame catches and burns down to Fire/Ash precisely like a grain of sawdust
// would. Separately, it's a fragile living thing: ordinary heat (70°+, well
// under Sawdust's own 450° autoignition point) cooks it outright into
// Sawdust, so a termite dies to mere warmth long before it would ever
// self-ignite from radiant heat alone — checked only once `tryBurn` has had
// its turn, so an already-catching/burning termite (temp pinned at/above the
// autoignition point) is left to actually burn instead of being pre-empted by
// this cooler-but-still-hot heat-death.
const SPEC: Combustible = { burnChance: 0.08, autoIgniteTemp: 450, ashChance: 0.15 }; // same as Sawdust
const DIE_TEMP = 70;
const EAT_CHANCE = 0.05;
const REPRODUCE_CHANCE = 0.3;

const FOOD = new Set<number>([WOOD.id, SAWDUST.id]);

function updateTermite(x: number, y: number, sim: SimContext): void {
  if (tryBurn(x, y, sim, SPEC)) return; // consumed into Fire/Ash, exactly like Sawdust
  if (sim.getTemp(x, y) >= SPEC.autoIgniteTemp) return; // actively catching/burning — let it run its course
  if (sim.getTemp(x, y) >= DIE_TEMP) {
    sim.set(x, y, SAWDUST.id); // cooked by ordinary heat, well below ignition
    return;
  }
  updateCrawler(x, y, sim, {
    selfId: TERMITE.id,
    foodIds: FOOD,
    eatChance: EAT_CHANCE,
    reproduceChance: REPRODUCE_CHANCE,
    avoidsLiquid: SAWDUST.id, // steers away from liquid; drowns into Sawdust on contact
  });
}

export const TERMITE = register({
  id: 110,
  name: 'Termite',
  phase: Phase.Powder,
  // A warm wood-brown, close to Wood/Sawdust's own tones but distinct enough
  // (redder, slightly darker) to read as a separate living critter crawling
  // over them rather than blending into the timber itself.
  color: rgb(150, 100, 58),
  density: 2, // as light as the Sawdust it eats and dies into
  combustible: true,
  colorVary: 0, // a single small creature, not a granular pile — no per-grain shimmer
  crawler: true, // participates in the shared crawler ground-hop-count/no-defy-gravity logic
  category: '생명',
  thermal: { conductivity: 0.2 },
  // Caught in a real explosion's non-destructive concussion (crater shove or
  // the outer pressure ring — see blast.ts), it dies into Sawdust instead of
  // being flung around unharmed like ordinary loose matter. A harmless blast
  // (Woofer) is exempt — see DetonateOptions.harmless.
  shockFragile: SAWDUST.id,
  update: updateTermite,
});
