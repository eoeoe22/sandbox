import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updateLiquid, diffuseWith } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { isFlame } from './combustion';
import { SMOKE } from './smoke';
import { SLIME } from './slime';
import { WATER } from './water';

// Acid Slime (산성 슬라임) — Slime's corrosive cousin. It behaves almost exactly
// like ordinary Slime (slime.ts): a thick, gooey semi-fluid that oozes rather
// than flows (holding a wobbling mound), *feeds* by absorbing an adjacent Water
// cell into more of itself, and melts away into Smoke beside an open flame or in
// enough heat. On top of all that it carries Acid's full corrosive bite: every
// tick it has a chance to eat any non-resistant Solid/Powder neighbour down to
// Empty (the very same CORRODE_CHANCE the liquid Acid uses — 동일한 부식력), and
// like Acid it can use *itself* up as a byproduct of corroding, so a blob only
// shrinks by actually eating through something, never on its own.
//
// Against ordinary Slime it doesn't corrode (Slime is a liquid, not a corrodible
// solid/powder) — the two simply *interdiffuse* across their shared boundary,
// slowly mixing like Water+Acid do (see acid.ts DIFFUSE_CHANCE). Both goos share
// the same density, so left alone they'd stack in flat layers; the occasional
// diffusive swap is what blends a blob of one into the other over time.
//
// Deliberately NOT conductive (unlike plain Slime): the Spark subsystem packs its
// conductor id into a 3-bit class field that is already exactly full (7 classes —
// see spark.ts CONDUCTOR_IDS/CLASS_MASK), so an 8th conductor can't be added
// without widening that packing and re-tuning the whole electricity engine. Acid
// Slime therefore forgoes Slime's niche electric-dissolve weakness and keeps only
// its ooze/feed/melt identity plus the acid corrosion — a clean, self-contained
// addition that leaves the electricity subsystem untouched.
const ABSORB_CHANCE = 0.05; // drinks an adjacent water cell into more acid slime
const MELT_CHANCE = 0.3; // per-tick chance a flame beside it melts it
const MELT_TEMP = 130; // …or enough ambient heat does the same

// Acid's own corrosion knobs, reused verbatim so the bite is identical to the
// liquid (동일한 부식력): a chance to eat a non-resistant solid/powder neighbour to
// Empty, and — if it corroded anything — a chance to consume itself doing so, which
// bounds how much a given blob can eat through.
const CORRODE_CHANCE = 0.03;
const SELF_CONSUME_CHANCE = 0.08;

// Slow, occasional swap with a neighbouring plain-Slime cell so the two miscible
// goos gradually interdiffuse across their boundary (mirrors Acid↔Water).
const DIFFUSE_CHANCE = 0.02;

function isCorrodible(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.acidResistant) return false;
  return m.phase === Phase.Solid || m.phase === Phase.Powder;
}

function updateAcidSlime(x: number, y: number, sim: SimContext): void {
  // Melt away in heat: past the melt point, or beside an open flame.
  if (sim.getTemp(x, y) >= MELT_TEMP) {
    sim.set(x, y, SMOKE.id);
    return;
  }
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isFlame(sim.get(nx, ny)) && sim.chance(MELT_CHANCE)) {
      sim.set(x, y, SMOKE.id);
      return;
    }
  }

  // Corrode like Acid: eat a non-resistant solid/powder neighbour, and if we ate
  // anything this tick, maybe get used up doing so (bounds a blob's total reach).
  let corroded = false;
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isCorrodible(sim.get(nx, ny)) && sim.chance(CORRODE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      corroded = true;
    }
  }
  if (corroded && sim.chance(SELF_CONSUME_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }

  // Feed: absorb an adjacent Water cell, growing the blob by one cell.
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(ABSORB_CHANCE)) {
      sim.spawn(nx, ny, ACID_SLIME.id);
      return;
    }
  }

  // Interdiffuse with plain Slime across their shared boundary (like Water+Acid).
  if (diffuseWith(x, y, sim, SLIME.id, DIFFUSE_CHANCE)) return;

  // Very viscous — its `viscosity` holds a wobbling mound as it oozes slowly.
  updateLiquid(x, y, sim);
}

export const ACID_SLIME = register({
  // 113·114 are reserved by another in-flight branch, so this picks up at 115.
  id: 115,
  name: 'Acid Slime',
  phase: Phase.Liquid,
  // An acidic, toxic chartreuse — Slime's green pushed toward Acid's yellow-green.
  color: rgb(160, 210, 60),
  // Same density as plain Slime, so a blob of each stacks in flat layers and only
  // blends via the diffusive swap above (mirrors Acid/Water being equal density).
  density: 4,
  category: '생명',
  // Thick, gooey ooze — holds a mound instead of spreading flat (like Slime).
  viscosity: 0.86,
  // Springy goo: a glob flung by a blast bounces energetically before it settles.
  elasticity: 0.92,
  thermal: { conductivity: 0.2 },
  update: updateAcidSlime,
});
