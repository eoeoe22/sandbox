import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { IRON } from './iron';
import { METAL_POWDER } from './metalpowder';
import { MOLTEN_METAL, IRON_MELT_TEMP } from './moltenmetal';
import { crawl, eatAndReproduce, touchingBlast, EAT_CHANCE } from './crawler';

// Nanobot (나노봇) — a metal-eating machine that crawls along surfaces, the
// mechanical twin of the Termite (same locomotion — see crawler.ts). It gnaws
// through iron and metal powder, converting each cell it eats into another
// nanobot, so a swarm devours a metal structure and self-replicates as it spreads.
//
// Being a machine, it ignores water entirely — it swims straight through a pool
// and keeps crawling on whatever metal it finds submerged ("액체를 무시하고 돌아다님",
// via the 'ignore' liquid policy). It has no drowning or low-temperature death;
// it fails two ways instead, matching its metal-powder body:
//   • 녹는점 — the same melting point as Metal Powder (Iron's melt temp); heated
//     past it, a nanobot melts into Molten Metal just like any other metal.
//   • 폭발 충격파 (단 Woofer 제외) — an adjacent Blast flash cell shatters it back
//     into loose Metal Powder; a Woofer's flashless shockwave leaves it unharmed
//     (see crawler.ts).
const FOOD = [IRON.id, METAL_POWDER.id] as const;
const RUST_CHANCE = 0.03;

function isSaltwater(x: number, y: number, sim: SimContext): boolean {
  if (!sim.inBounds(x, y)) return false;
  return sim.get(x, y) === SALTWATER.id || sim.getOverlay(x, y) === SALTWATER.id;
}

function touchesSaltwater(x: number, y: number, sim: SimContext): boolean {
  if (sim.getOverlay(x, y) === SALTWATER.id) return true;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (isSaltwater(nx, ny, sim)) {
      return true;
    }
  }
  return false;
}

function updateNanobot(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= IRON_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten Metal
    // reads as molten instead of re-freezing next tick (mirrors Iron/Metal Powder).
    sim.set(x, y, MOLTEN_METAL.id);
    return;
  }
  if (touchingBlast(x, y, sim)) {
    sim.set(x, y, METAL_POWDER.id); // shattered by the shockwave into loose grains
    return;
  }
  if (touchesSaltwater(x, y, sim) && sim.chance(RUST_CHANCE)) {
    sim.set(x, y, RUST.id); // corrodes into Rust when exposed to saltwater
    return;
  }
  eatAndReproduce(x, y, sim, NANOBOT.id, FOOD, EAT_CHANCE);
  crawl(x, y, sim, NANOBOT.id, 'ignore'); // swims through liquid, crawls on metal
}

export const NANOBOT = register({
  id: 111,
  name: 'Nanobot',
  phase: Phase.Solid,
  // A cool cyan-steel machine tone, clearly reading as a swarm of tiny robots
  // rather than the grey metal it consumes.
  color: rgb(120, 208, 202),
  colorVary: 22,
  density: 1000,
  category: '생명',
  // Shattered to Metal Powder when a blast destroys it at the epicenter, matching
  // the death-by-shockwave its update handles for rim survivors.
  blastDeathId: METAL_POWDER.id,
  // Metallic, so it conducts heat about as well as loose Metal Powder — it warms
  // toward its melting point at a metal's pace, not an insulator's.
  thermal: { conductivity: 0.35 },
  update: updateNanobot,
});
