import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { updateCrawler } from './crawler';
import { IRON } from './iron';
import { METAL_POWDER } from './metalpowder';
import { MOLTEN_METAL, IRON_MELT_TEMP } from './moltenmetal';

// Nanobot (나노봇) — a metal-colored crawler that wanders the surface of solid
// and powder terrain, slowly gnawing Iron/Metal Powder. A bite always clears
// the eaten cell; REPRODUCE_CHANCE of the time it also spawns a fresh nanobot
// there (self-replication), otherwise the metal just disappears. See
// crawler.ts for the shared crawl/eat/no-clump core.
//
// Unlike Termite it has no flammability and no fear of liquid (a machine
// doesn't drown) — instead it shares Iron/Metal Powder's own melting point:
// heated past it, it melts away into Molten Metal exactly like a grain of
// Metal Powder would, rather than dying outright.
const EAT_CHANCE = 0.05;
const REPRODUCE_CHANCE = 0.3;

const FOOD = new Set<number>([IRON.id, METAL_POWDER.id]);

function updateNanobot(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= IRON_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten
    // Metal reads as molten instead of instantly re-freezing next tick
    // (mirrors Iron/Metal Powder's own melt).
    sim.set(x, y, MOLTEN_METAL.id);
    return;
  }
  updateCrawler(x, y, sim, {
    selfId: NANOBOT.id,
    foodIds: FOOD,
    eatChance: EAT_CHANCE,
    reproduceChance: REPRODUCE_CHANCE,
    // No avoidsLiquid: a nanobot has no liquid aversion or drowning death.
  });
}

export const NANOBOT = register({
  id: 111,
  name: 'Nanobot',
  phase: Phase.Powder,
  // A cool steel-blue-grey, close to Iron/Metal Powder's own tones but with a
  // faint blue cast so it reads as a machine crawling over the metal rather
  // than blending into it.
  color: rgb(170, 182, 196),
  density: 7, // same weight class as the Metal Powder it eats and melts into
  colorVary: 0, // a single small machine, not a granular pile — no per-grain shimmer
  category: '생명',
  thermal: { conductivity: 0.35 },
  // Caught in a real explosion's non-destructive concussion (crater shove or
  // the outer pressure ring — see blast.ts), it dies into Metal Powder instead
  // of being flung around unharmed like ordinary loose matter. A harmless
  // blast (Woofer) is exempt — see DetonateOptions.harmless.
  shockFragile: METAL_POWDER.id,
  update: updateNanobot,
});
