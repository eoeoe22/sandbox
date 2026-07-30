import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { ASH } from './ash';
import { isSoil, isFreshWater, findMoisture, ROOT_REACH } from './soil';
import { PLANT, plantSproutAux } from './plant';

// Seed (씨앗) — a little kernel that falls and piles like any powder, but landed
// on damp ground it sprouts into a Plant (plant.ts).
//
// 씨앗 사용 개편 — the rule a player actually expects is "물 준 땅에 씨앗을 뿌리면
// 싹이 난다", so this asks for exactly that and nothing more, and it *shows* what
// it's doing while it waits:
//
//   • 땅: any loose ground counts — Dirt, Mud, Sand or Ash — not just Dirt/Mud.
//     A beach or a burnt-out field grows a plant, so you're never hunting for
//     the one substrate that works.
//   • 물: fresh Water or Mud anywhere in the seed's 8 neighbours — or, and this
//     is the fix that matters, damp ground *under* it. Poured water soaks into
//     loose ground and drains out of sight within seconds, so a watered bed used
//     to read as bone dry to a seed sitting on it: you did the obvious thing and
//     nothing happened. It now feels for the water table below the way roots do
//     (see soil.ts). Saltwater is deliberately not moisture: brine kills plants
//     and grows Coral instead (coral.ts), which is the one "why won't it
//     sprout?" case worth having, and the palette's Coral tab answers it.
//   • 보이는 진행도: germination progress is the seed's `aux`, and the seed draws
//     the matching entry of a brown → green ramp (Material.auxPalette), so a
//     planted seed visibly swells and greens as it matures instead of sitting
//     there looking exactly like an inert grain. Nothing happening is legible
//     too: a seed that never greens is a seed that isn't planted or isn't wet.
//   • 절대 낭비되지 않음: progress only ever pauses. Dry it out, lift it off the
//     ground, freeze it or scorch it and the countdown just stops where it is —
//     re-wet it later and it carries on from there. A fully ripe seed with no
//     room to sprout waits (bright green) until something opens up.
//
// This is the front of the little ecosystem: Water + Dirt → Mud, drop a Seed,
// and a plant climbs out of the wet ground — and a mature plant sets seeds of
// its own (plant.ts), so a well-watered plot reseeds itself.
const GERMINATE_CHANCE = 0.2; // how often a planted, moist seed advances
const SPROUT_PROGRESS = 15; // aux steps to reach before it becomes a Plant
// A seed is alive: it won't work through a frost or an oven, it just waits.
const GERMINATE_MIN_TEMP = 1;
const GERMINATE_MAX_TEMP = 60;

/** Brown (a dry kernel) → green (a ripe sprout), one entry per germination step,
 *  drawn by `aux` = progress. Built rather than written out so the ramp can't
 *  drift out of step with SPROUT_PROGRESS. */
const SPROUT_RAMP: readonly number[] = Array.from({ length: SPROUT_PROGRESS + 1 }, (_, i) => {
  const t = i / SPROUT_PROGRESS;
  return rgb(
    Math.round(122 + (112 - 122) * t),
    Math.round(94 + (168 - 94) * t),
    Math.round(52 + (76 - 52) * t),
  );
});

function updateSeed(x: number, y: number, sim: SimContext): void {
  // Planted only when resting on ground directly below.
  const onSoil = sim.inBounds(x, y + 1) && isSoil(sim.get(x, y + 1));
  let moist = false;
  let room = false;
  if (onSoil) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (isFreshWater(nid)) moist = true;
      // Somewhere for the sprout to climb into once it comes up. A seed buried
      // deep in a pile holds its progress until the ground shifts instead of
      // germinating into a cell it can't grow out of.
      if (sim.isEmpty(nx, ny)) room = true;
    }
    // Nothing standing nearby? The bed may still be watered — a poured bucket
    // drains down through loose ground within seconds and sits below as a water
    // table, which is exactly the "I watered it and nothing happened" case. The
    // seed feels for it the same way the plant's roots will (see soil.ts).
    if (!moist) moist = findMoisture(x, y, sim, ROOT_REACH) >= 0;
    // The seed's own cell can be soaked too (a grain sitting in a wet bed).
    if (!moist) moist = sim.getOverlay(x, y) === WATER.id;
  }

  const temp = sim.getTemp(x, y);
  const alive = temp >= GERMINATE_MIN_TEMP && temp <= GERMINATE_MAX_TEMP;

  if (onSoil && moist) {
    const progress = sim.getAux(x, y);
    if (progress >= SPROUT_PROGRESS) {
      if (!room) return; // ripe, but nowhere to sprout — wait for space
      // Germinate: become a Plant sprout — a full-vigour growing tip, pre-charged
      // with moisture so it starts climbing straight away (see plant.ts).
      const sprout = plantSproutAux(sim);
      sim.set(x, y, PLANT.id);
      sim.setAux(x, y, sprout);
      return;
    }
    if (alive && sim.chance(GERMINATE_CHANCE)) sim.setAux(x, y, progress + 1);
    return; // planted seeds stay put while they mature
  }

  updatePowder(x, y, sim);
}

export const SEED = register({
  id: 90,
  name: 'Seed',
  phase: Phase.Powder,
  color: rgb(122, 94, 52), // the dry-kernel end of SPROUT_RAMP (the palette swatch)
  // The cell's colour is its germination progress (see SPROUT_RAMP): a planted
  // seed greens as it matures, which is the whole feedback loop for "is this
  // actually growing?". The ordinary powder speckle still rides on top.
  auxPalette: SPROUT_RAMP,
  // A real seed kernel (~1.2-1.4 g/cm³) is a light organic powder, well under
  // mineral powders like Sand/Salt — but still denser than Water, so it sinks
  // to reach the soil bed at the bottom of a flooded plot instead of floating
  // on the surface out of germinating reach.
  density: 3.45,
  category: 'life',
  // 피폭사 — a kernel is alive too, so radiation kills it where it lies and it goes
  // the same way a grown Plant does, to Ash (see engine/radiation.ts). Sowing into
  // a hot zone is therefore futile in the most legible way possible: the seeds you
  // scatter never green, they just grey out one by one.
  radiationDeath: ASH.id,
  thermal: { conductivity: 0.3 },
  update: updateSeed,
});
