import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updateLiquid, collapseVoidBelow } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { isFlame } from './combustion';
import { WATER } from './water';
import { HYDROGEN } from './hydrogen';
import { OXYGEN } from './oxygen';
import { SMOKE } from './smoke';
import { tryPhaseChange } from './phasechange';

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
// Electricity is its other undoing, and it works the same way an H₂O₂ splash
// eats a Virus (virus.ts), just with a bigger bite. A Spark reaching the blob
// (from an electrified conductor, or the very Water it's drinking) seeds a
// single *electric-dissolve front* on one touched cell, carrying a "reach"
// budget in aux (SLIME_DISSOLVE_BUDGET; spark.ts stamps exactly one cell per
// pulse). On its turn a front cell electrolyses itself away and, if any reach is
// left, hands budget-1 to ONE randomly-chosen still-healthy slime neighbour. That
// one random step per tick makes the eaten edge ragged and organic, and the
// decrementing budget hard-caps how much a single spark can dissolve — so one lone
// spark takes only a small bite, and it takes *sustained* current (a battery
// pulsing spark after spark into the blob) to erode a whole blob away.
//
// **What a dissolved cell becomes is the whole design**, and it is the second
// answer to that question. It used to revert to Water, on the reading that the goo
// is water-based and electricity merely undoes it — and that quietly made the
// counter unwinnable. Slime *drinks water and grows without bound*, so every cell
// the current dissolved was handed straight back as feedstock: a 전기 브러시 swept
// across a whole puddle left it 97% cleared and the survivors rebuilt all of it
// within a few seconds. Measured, repeatedly, at every setting of every knob —
// 한 칸이라도 남으면 웅덩이는 반드시 100% 복구된다. Tuning cannot fix that, because
// the loop is a conversion between two things that are both still on the board.
//
// So the goo now goes where its water actually goes under a current: it splits
// into Hydrogen (and, half the time, a bubble of Oxygen), exactly as the passing
// spark already does to plain water/brine/acid (spark.ts's `electrolyse`). The
// mass leaves the world as gas instead of settling into a puddle, so a sweep is
// permanent and there is nothing left to grow back from — 전기분해된 슬라임은 물로
// 돌아가지 않고 수소로 날아간다. The gas is flammable, which is the price: clear a
// big blob in a sealed room and you have filled it with H₂.
const ABSORB_CHANCE = 0.05; // drinks an adjacent water cell into more slime
const MELT_CHANCE = 0.3; // per-tick chance a flame beside it melts it
const MELT_TEMP = 130; // …or enough ambient heat does the same

// Thick, heavy goo doesn't drop like thin water: the whole movement step (fall +
// spread) only runs on a fraction of ticks, so a blob oozes and settles slowly
// rather than splashing straight down (낙하 속도 ↓). Its `viscosity` throttles the
// lateral spread but NOT the straight fall (see updateLiquid), so this gate is
// what actually slows the drop — the same one Lava uses (lava.ts FLOW_CHANCE),
// and at the same value: slime is the roster's thickest goo (viscosity 0.86, the
// highest of any liquid), so it creeps at magma pace rather than the half-speed
// stall it used to have. Exported so Acid Slime flows identically.
export const SLIME_FLOW_CHANCE = 0.15;

// Reach budget a Spark stamps on the one slime cell it seeds (see spark.ts), and
// the whole aux state slime uses: a healthy cell reads 0, a front cell holds its
// remaining reach (1..BUDGET). Well past the Virus corrosion front's
// CURE_SEED_BUDGET (10) — slime's electric weakness bites harder per shock than
// the virus's H₂O₂ counter does, so a single spark still dissolves at most about
// this many cells (never the whole blob), but the bite is bigger. Measured: one
// front seeded in the middle of a 722-cell pool takes 24 cells and stops, 3% of
// the blob, so 지속적인 전류가 필요하다 survives the change above.
export const SLIME_DISSOLVE_BUDGET = 24;

// …and, half the time, a free neighbour gets the Oxygen that goes with it
// (2H₂O → 2H₂ + O₂). The twin of spark.ts's ELECTROLYSIS_OXYGEN_CHANCE, spelled
// again rather than imported because spark.ts imports *this* module — naming it
// back would close a cycle for one number. Keep the two in step: the goo splitting
// and the water it is made of splitting should not read as different chemistry.
const ELECTROLYSIS_OXYGEN_CHANCE = 0.5;

/** Split one cell of goo into gas: it becomes Hydrogen, and about half the time a
 *  free open neighbour gets an Oxygen bubble. The same shape as spark.ts's
 *  `electrolyse` (which does this to plain water/brine/acid), and shared with
 *  Acid Slime so both goos come apart identically.
 *
 *  `set` rather than `spawn`, again matching `electrolyse`: the gas keeps the
 *  cell's heat instead of resetting to ambient, so electrolysing hot goo gives hot
 *  hydrogen. The aux is cleared explicitly because `set` leaves it untouched on a
 *  non-EMPTY write and this cell is holding a front's leftover reach. */
export function electrolyseGoo(x: number, y: number, sim: SimContext): void {
  sim.set(x, y, HYDROGEN.id);
  sim.setAux(x, y, 0);
  if (!sim.chance(ELECTROLYSIS_OXYGEN_CHANCE)) return;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === EMPTY) {
      sim.spawn(nx, ny, OXYGEN.id);
      return;
    }
  }
}

// One dissolve-front step (aux = remaining reach), mirroring virus.ts's corrosion
// front: electrolyse this cell away and, while reach is left, hand budget-1 to ONE
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
  electrolyseGoo(x, y, sim); // …and this cell splits into gas and is gone for good
}

function updateSlime(x: number, y: number, sim: SimContext): void {
  // Electric-dissolve front (aux = remaining reach, seeded by an adjacent Spark):
  // split into gas and pass the bounded front on. Checked first so a caught cell
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

  // Feed: absorb an adjacent Water cell, growing the blob by one cell. Water still
  // carrying per-cell state (aux !== 0 — a post-spark refractory) is skipped: it
  // reads as briefly spent, and `spawn` would clear the byte anyway, which on this
  // material means "no dissolve front".
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.getAux(nx, ny) === 0 && sim.chance(ABSORB_CHANCE)) {
      sim.spawn(nx, ny, SLIME.id);
      return;
    }
  }

  // An enclosed hole inside the goo collapses at once, outside the gate below —
  // otherwise the gate + viscosity leave a settling blob full of black windows
  // (see behaviors.ts's collapseVoidBelow for the measurements and why enclosure
  // is what keeps this from just making slime runny).
  if (collapseVoidBelow(x, y, sim)) return;

  // Very viscous — the flow gate throttles all movement (fall included) to Lava's
  // pace, and `viscosity` on top of that holds a wobbling mound instead of leveling
  // flat. Everything above (feeding, melting, dissolving) still runs every tick;
  // only the movement is gated, so a stalled blob keeps drinking and burning.
  if (sim.chance(SLIME_FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const SLIME = register({
  id: 91,
  name: 'Slime',
  phase: Phase.Liquid,
  color: rgb(96, 190, 88),
  // Denser than water so a blob sinks and oozes along the floor of a pool while
  // it drinks the water around it.
  density: 4,
  category: 'life',
  // Thick, gooey ooze — holds a mound instead of spreading flat (the lateral half
  // of its viscosity; SLIME_FLOW_CHANCE above is the half that slows the fall).
  viscosity: 0.86,
  // Springy goo: a glob flung by a blast/pressure wave bounces around energetically
  // (high coefficient of restitution) before it settles (see debris.ts 탄성).
  elasticity: 0.92,
  // Conducts (see spark.ts CONDUCTOR_IDS/CONDUCTOR_LOSS): the poorest conductor
  // in the roster in spirit (its acidic cousin Acid Slime aside, which conducts at
  // the max), but current still carries a good stretch into a blob (~31 cells,
  // on par with fresh Water) instead of dying within a cell or two. That reach is
  // why the 전기 브러시 works as a weapon at all: painting the surface of a pool
  // sends pulses deep enough to seed fronts through the whole body of it, rather
  // than only skinning the top row.
  conductive: true,
  // The worst conductor on the roster in spirit — a thick, non-ionic goo — but only
  // as lossy as fresh water (2 of 63, ~31 cells), so current has room to punch
  // into a blob rather than dying at its face (see Material.sparkLoss).
  sparkLoss: 2,
  // No `radiationDeath`, deliberately — the goo is 방사선 내성, one of only three
  // things in the 생명 tab a 방사능 source can't touch (see engine/radiation.ts).
  // There's a real organism behind it: the radiation-tolerant extremophiles that
  // shrug off doses which sterilise everything else. It also settles a mechanical
  // problem cleanly — slime *drinks water and grows*, so any corpse that left
  // water behind would just be drunk back by the rest of the blob, and the dose
  // would spend forever in a tug-of-war with the thing it was meant to kill.
  // Together with Nanobot (a machine) it's what still lives in a hot zone: the
  // fallout gets a resident, not just a caretaker.
  thermal: { conductivity: 0.2 },
  // 분해점 — the goo cooks off rather than melting into anything.
  phaseChange: { at: () => MELT_TEMP, when: 'atOrAbove', into: () => SMOKE.id },
  update: updateSlime,
});
