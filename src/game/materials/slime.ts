import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { isFlame } from './combustion';
import { WATER } from './water';
import { SMOKE } from './smoke';

// Slime (슬라임) — a thick, gooey green semi-fluid. It oozes rather than flows,
// slumping only on a fraction of ticks (like Honey/Mud), so a dropped blob holds
// a wobbling mound before it slowly spreads. Its gimmick is that it *feeds*: an
// adjacent Water cell is absorbed and turned into more Slime, so a blob dropped in
// a puddle swells as it drinks the water up — 통과 유체를 흡수해 몸집을 키운다.
//
// Fire is its bane: an open flame beside it (or enough heat) melts the goo, and it
// boils away as a puff of Smoke. So the way to deal with a spreading slime is to
// burn it back.
//
// Electricity is its other undoing, and it works EXACTLY like an H₂O₂ splash
// eating a Virus (virus.ts). A Spark reaching the blob (from an electrified
// conductor, or the very Water it's drinking) seeds a single *electric-dissolve
// front* on one touched cell, carrying a small "reach" budget in aux
// (SLIME_DISSOLVE_BUDGET; spark.ts stamps exactly one cell per pulse). On its turn
// a front cell reverts itself to Water and, if any reach is left, hands budget-1 to
// ONE randomly-chosen still-healthy slime neighbour. That one random step per tick
// makes the eaten edge ragged and organic, and the decrementing budget hard-caps
// how much a single spark can dissolve — so one lone spark takes only a small bite,
// and it takes *sustained* current (a battery pulsing spark after spark into the
// blob) to erode the whole thing back to a puddle (전기에 닿으면 물로 회귀).
const ABSORB_CHANCE = 0.05; // drinks an adjacent water cell into more slime
const MELT_CHANCE = 0.3; // per-tick chance a flame beside it melts it
const MELT_TEMP = 130; // …or enough ambient heat does the same

// Reach budget a Spark stamps on the one slime cell it seeds (see spark.ts), and
// the whole aux state slime uses: a healthy cell reads 0, a front cell holds its
// remaining reach (1..BUDGET). Matches the Virus corrosion front's CURE_SEED_BUDGET
// so a single spark dissolves at most about this many cells — never the whole blob.
export const SLIME_DISSOLVE_BUDGET = 10;

// The catch with "slime → Water" (vs the Virus front's "→ Empty"): slime *drinks*
// water, so it would just re-absorb its own dissolved puddle and heal — the electric
// counter would do nothing. So freshly-dissolved Water is stamped with a short
// "recently electrolysed" countdown in its aux, and slime refuses to drink water
// whose aux is non-zero. Water's own update already ticks any aux down each turn
// (its post-spark refractory bookkeeping), so the mark clears itself after a beat —
// long enough for the puddle to drain/rise clear of the blob before it can be eaten
// back. (A minor, in-theme side effect: for that beat the spent water also won't
// carry a spark — it reads as briefly "used up".) This is what makes a sustained
// current actually eat a blob down rather than fight a losing tug-of-war with it.
const DISSOLVE_WATER_GRACE = 14;

// One dissolve-front step (aux = remaining reach), mirroring virus.ts's corrosion
// front: revert this cell to Water and, while reach is left, hand budget-1 to ONE
// random still-healthy slime neighbour via `spawn` (which flags it moved, so it acts
// only next tick — one random step per tick, no same-tick runaway). The decrementing
// budget bounds a single seed's total reach, giving a frayed bite rather than a
// clean sweep.
function dissolveFront(x: number, y: number, sim: SimContext): void {
  const budget = sim.getAux(x, y);
  if (budget > 1) {
    const cxs: number[] = [];
    const cys: number[] = [];
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      if (sim.get(nx, ny) === SLIME.id && sim.getAux(nx, ny) === 0) {
        cxs.push(nx);
        cys.push(ny);
      }
    }
    if (cxs.length > 0) {
      const k = sim.randInt(cxs.length);
      sim.spawn(cxs[k], cys[k], SLIME.id); // moved-guard: acts next tick
      sim.setAux(cxs[k], cys[k], budget - 1);
    }
  }
  sim.set(x, y, WATER.id); // this cell has reverted to water…
  // …carrying a brief "recently electrolysed" grace so the slime around it can't
  // instantly drink it back (see DISSOLVE_WATER_GRACE and the absorb guard below).
  // set() leaves aux untouched on a non-EMPTY write, so we stamp it explicitly
  // rather than inheriting the leftover reach byte.
  sim.setAux(x, y, DISSOLVE_WATER_GRACE);
}

function updateSlime(x: number, y: number, sim: SimContext): void {
  // Electric-dissolve front (aux = remaining reach, seeded by an adjacent Spark):
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

  // Feed: absorb an adjacent Water cell, growing the blob by one cell — but NOT
  // water that's still marked as freshly electrolysed (aux !== 0), so a blob can't
  // heal itself off its own electric-dissolve puddle before that water drains away.
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.getAux(nx, ny) === 0 && sim.chance(ABSORB_CHANCE)) {
      sim.spawn(nx, ny, SLIME.id);
      return;
    }
  }

  // Very viscous — its `viscosity` holds a wobbling mound as it oozes slowly.
  updateLiquid(x, y, sim);
}

export const SLIME = register({
  id: 91,
  name: 'Slime',
  phase: Phase.Liquid,
  color: rgb(96, 190, 88),
  // Denser than water so a blob sinks and oozes along the floor of a pool while
  // it drinks the water around it.
  density: 4,
  category: '생명',
  // Thick, gooey ooze — holds a mound instead of spreading flat.
  viscosity: 0.86,
  // Springy goo: a glob flung by a blast/pressure wave bounces around energetically
  // (high coefficient of restitution) before it settles (see debris.ts 탄성).
  elasticity: 0.92,
  thermal: { conductivity: 0.2 },
  update: updateSlime,
});
