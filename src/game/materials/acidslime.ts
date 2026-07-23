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
// Electricity: like plain Slime it conducts and dissolves under current — and
// then some. It's the roster's one non-metal at *zero* strength loss (전기전도성
// 최대치 — see spark.ts CONDUCTOR_LOSS), so a pulse runs full length through a
// blob rather than fading out. Its weakness to that current is Slime's, unchanged:
// a spark that travelled *through* a cell has a low chance to seed a bounded,
// ragged electric-dissolve front (aux = remaining reach) that reverts the cell to
// Water and frays outward to healthy Acid-Slime neighbours (전기 닿으면 물로 분해).
// One lone spark takes only a small bite; a battery pulsing spark after spark is
// what erodes a whole blob back to a puddle — identical to Slime's mechanism.
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

// Freshly-dissolved Water carries this brief "recently electrolysed" countdown in
// its aux so the blob can't instantly drink its own dissolve puddle back and heal
// (mirrors slime.ts DISSOLVE_WATER_GRACE — Water's own update ticks the mark down).
const DISSOLVE_WATER_GRACE = 14;

function isCorrodible(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.acidResistant) return false;
  return m.phase === Phase.Solid || m.phase === Phase.Powder;
}

// One electric-dissolve-front step (aux = remaining reach), mirroring slime.ts:
// revert this cell to Water and, while reach is left, hand budget-1 to ONE random
// still-healthy Acid-Slime neighbour via `spawn` (moved-guard: it acts next tick,
// one random step per tick). The decrementing budget bounds a single seed's reach.
function dissolveFront(x: number, y: number, sim: SimContext): void {
  const budget = sim.getAux(x, y);
  if (budget > 1) {
    const cxs: number[] = [];
    const cys: number[] = [];
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      if (sim.get(nx, ny) === ACID_SLIME.id && sim.getAux(nx, ny) === 0) {
        cxs.push(nx);
        cys.push(ny);
      }
    }
    if (cxs.length > 0) {
      const k = sim.randInt(cxs.length);
      sim.spawn(cxs[k], cys[k], ACID_SLIME.id); // moved-guard: acts next tick
      sim.setAux(cxs[k], cys[k], budget - 1);
    }
  }
  sim.set(x, y, WATER.id); // this cell has reverted to water…
  // …carrying a brief "recently electrolysed" grace so the blob can't instantly
  // drink it back (set() leaves aux untouched on a non-EMPTY write, so stamp it).
  sim.setAux(x, y, DISSOLVE_WATER_GRACE);
}

function updateAcidSlime(x: number, y: number, sim: SimContext): void {
  // Electric-dissolve front (aux = remaining reach, seeded by a passing Spark):
  // revert to Water and pass the bounded front on. Checked first so a caught cell
  // always dissolves, whatever else is around it.
  if (sim.getAux(x, y) !== 0) {
    dissolveFront(x, y, sim);
    return;
  }

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

  // Feed: absorb an adjacent Water cell, growing the blob by one cell — but NOT
  // water still marked as freshly electrolysed (aux !== 0), so a blob can't heal
  // itself off its own electric-dissolve puddle before that water drains away.
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.getAux(nx, ny) === 0 && sim.chance(ABSORB_CHANCE)) {
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
  // Conducts at the maximum: spark.ts lists it at zero strength loss (전기전도성
  // 최대치), so current runs full length through a blob, and a pulse passing
  // *through* a cell seeds the same electric-dissolve-to-Water front Slime has.
  conductive: true,
  thermal: { conductivity: 0.2 },
  update: updateAcidSlime,
});
