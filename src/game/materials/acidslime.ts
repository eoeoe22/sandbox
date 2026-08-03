import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updateLiquid, diffuseWith } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { isFlame } from './combustion';
import { tryCorrode, tryCorrodeSoaked, ACID_SLIME_CORROSION } from './corrosion';
import { SMOKE } from './smoke';
import { SLIME, SLIME_FLOW_CHANCE } from './slime';
import { WATER } from './water';
import { tryPhaseChange } from './phasechange';

// Acid Slime (산성 슬라임) — Slime's corrosive cousin, and what a blob of ordinary
// Slime turns into when Acid is poured on it (the recipe is declared on the acid's
// side — see acid.ts). It behaves almost exactly like ordinary Slime (slime.ts): a
// thick, gooey semi-fluid that oozes rather than flows (holding a wobbling mound),
// *feeds* by absorbing an adjacent Water cell — half of which now comes back as
// plain Slime, and the drinking cell itself can be rinsed clean by that water, so
// water is the recipe's undo (see DILUTE_CHANCE) — and melts away into Smoke
// beside an open flame or in enough heat. On top of all that it carries Acid's
// full corrosive bite: every tick it has a chance to eat any non-resistant
// Solid/Powder neighbour down to
// Empty (the very same CORRODE_CHANCE the liquid Acid uses — 동일한 부식력), and
// like Acid it can use *itself* up as a byproduct of corroding, so a blob only
// shrinks by actually eating through something, never on its own. That bite is
// not reimplemented here: all three corrosive materials run the one pass in
// corrosion.ts, and `ACID_SLIME_CORROSION` reuses the liquid's own numbers, so
// "동일한 부식력" is now enforced by sharing a constant rather than by two files
// agreeing to spell 0.03 the same way.
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
const ABSORB_CHANCE = 0.05; // drinks an adjacent water cell into more slime
const MELT_CHANCE = 0.3; // per-tick chance a flame beside it melts it
const MELT_TEMP = 130; // …or enough ambient heat does the same

// Water is the counter to the acid recipe (acid.ts: 산 + 슬라임 → 산성 슬라임), and
// it works on both cells of the contact — 물이 산성 슬라임을 침식한다:
//
//  • **What it drinks comes back half-strength.** Plain Slime's feeding turns an
//    absorbed water cell into more of itself; here the water carries only half
//    the acid over, so a growing acid blob is 50% 일반 슬라임 / 50% 산성 슬라임 by
//    cell. Feeding in a puddle no longer purely strengthens it — it dilutes the
//    blob's *average* acidity even as it grows.
//  • **The cell doing the drinking gets washed out.** Separately, contact with
//    water can rinse the acid out of this very cell, leaving plain Slime behind
//    and spending the water cell doing it (한 칸이 한 칸을 중화). Spending the
//    water is what makes the neutralisation cost something: a splash takes the
//    face off a blob, a full quench is what turns the whole thing green again.
//
// Set above the feed (0.08 vs 0.05) so a water contact is more likely to rinse a
// cell than to be drunk by it — 침식이 주도해야 물이 해독제로 읽힌다. It still isn't
// a wipe, because what limits the neutralisation is *contact* rather than the
// roll: only the blob's wet face is being rinsed, and the plain Slime it grows
// there drinks the pool alongside it while walling the acid core off. So a
// quenched blob reads as mostly-green goo with an acidic middle that surfaces
// (and gets rinsed in its turn) as the two goos slowly interdiffuse — see
// DIFFUSE_CHANCE. Both paths refuse water still marked freshly-electrolysed
// (aux !== 0), on the same terms and for the same reason the feed always has.
const DILUTE_CHANCE = 0.08;
const ABSORB_ACID_CHANCE = 0.5; // …of a drunk water cell coming back acidic

// Slow, occasional swap with a neighbouring plain-Slime cell so the two miscible
// goos gradually interdiffuse across their boundary (mirrors Acid↔Water).
const DIFFUSE_CHANCE = 0.02;

// Freshly-dissolved Water carries this "recently electrolysed" countdown in its aux
// so the blob can't drink its own dissolve puddle back and heal before it drains —
// run long enough that a big blob's dissolved water actually escapes rather than
// being re-eaten (mirrors slime.ts DISSOLVE_WATER_GRACE; Water's update ticks it
// down each turn). Kept in step with plain Slime so the two behave identically.
const DISSOLVE_WATER_GRACE = 40;

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
  if (tryPhaseChange(x, y, sim)) return;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isFlame(sim.get(nx, ny)) && sim.chance(MELT_CHANCE)) {
      sim.set(x, y, SMOKE.id);
      return;
    }
  }

  // Corrode like Acid — literally like Acid: the same pass, with the same numbers
  // (corrosion.ts). True means this cell was used up doing it, bounding how much
  // a given blob can eat through, so stop here.
  if (tryCorrode(x, y, sim, ACID_SLIME_CORROSION)) return;

  // Water contact — feed and dilute, on the same neighbours (see DILUTE_CHANCE).
  // Water still marked as freshly electrolysed (aux !== 0) is skipped by both, so
  // a blob can't heal itself off its own electric-dissolve puddle before that
  // water drains away.
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) !== WATER.id || sim.getAux(nx, ny) !== 0) continue;
    // Rinsed: the water is spent washing the acid out of this cell, which is
    // left as plain Slime. The write of EMPTY needs no moved mark (see
    // SimContext.spawn's note), but the fresh Slime *does*, and for a reason that
    // did not exist before the acid recipe did: Slime is now a reaction-table
    // partner (acid.ts). Left unmarked, an Acid cell scanned later this same tick
    // — the scan runs bottom-up, so any acid above this row still has its turn —
    // would pick the rinsed cell up as a `with: SLIME.id` partner and convert it
    // straight back, spending a water cell and an acid cell for no visible change.
    // `tryReact`'s hasMoved guard is exactly what stops that; this is how a cell
    // opts into it (spawn() does the same for every other product).
    if (sim.chance(DILUTE_CHANCE)) {
      sim.set(nx, ny, EMPTY);
      sim.set(x, y, SLIME.id);
      sim.markMoved(x, y);
      return;
    }
    // Feed: absorb the water cell, growing the blob by one cell — half the time
    // as plain Slime, the acid not making it across (ABSORB_ACID_CHANCE).
    if (sim.chance(ABSORB_CHANCE)) {
      sim.spawn(nx, ny, sim.chance(ABSORB_ACID_CHANCE) ? ACID_SLIME.id : SLIME.id);
      return;
    }
  }

  // Interdiffuse with plain Slime across their shared boundary (like Water+Acid).
  if (diffuseWith(x, y, sim, SLIME.id, DIFFUSE_CHANCE)) return;

  // Very viscous — the flow gate throttles all movement (fall included) to Lava's
  // pace, and `viscosity` on top of that holds a wobbling mound instead of leveling
  // flat. Shared with plain Slime (SLIME_FLOW_CHANCE) so both ooze identically.
  if (sim.chance(SLIME_FLOW_CHANCE)) updateLiquid(x, y, sim);
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
  category: 'life',
  // Thick, gooey ooze — holds a mound instead of spreading flat (like Slime; the
  // lateral half of its viscosity, SLIME_FLOW_CHANCE being the half that slows
  // the fall).
  viscosity: 0.86,
  // Springy goo: a glob flung by a blast bounces energetically before it settles.
  elasticity: 0.92,
  // Conducts at the maximum: spark.ts lists it at zero strength loss (전기전도성
  // 최대치), so current runs full length through a blob, and a pulse passing
  // *through* a cell seeds the same electric-dissolve-to-Water front Slime has.
  conductive: true,
  // 방사선 내성 — no `radiationDeath`, exactly like plain Slime and for the same
  // reasons (see slime.ts, and engine/radiation.ts for the pass).
  thermal: { conductivity: 0.2 },
  // 분해점 — the goo cooks off rather than melting into anything.
  phaseChange: { at: () => MELT_TEMP, when: 'atOrAbove', into: () => SMOKE.id },
  update: updateAcidSlime,
  // Goo thin enough to soak into a powder bed keeps its bite there, on the same
  // terms as the liquid it's made of (see acid.ts / corrosion.ts's
  // `tryCorrodeSoaked`) — minus the fizz, which is `ACID_SLIME_CORROSION`'s call.
  overlapUpdate: (x, y, sim) => tryCorrodeSoaked(x, y, sim, ACID_SLIME_CORROSION),
});
