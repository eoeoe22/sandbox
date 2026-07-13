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
// Electricity is its other undoing: a Spark reaching the blob (from an electrified
// conductor, or the very Water it's drinking) seeds an *electric-dissolve front*
// (spark.ts stamps the marker below), and that front violently unzips the whole
// blob back to Water — every front cell reverts to Water and hands the reaction to
// its slime neighbours, so a shock races through the goo and it slumps into a
// puddle. It's the same spreading-reaction idea as an H₂O₂ corrosion front eating
// a Virus, just ending in Water instead of nothing (전기에 닿으면 물로 회귀).
const ABSORB_CHANCE = 0.05; // drinks an adjacent water cell into more slime
const MELT_CHANCE = 0.3; // per-tick chance a flame beside it melts it
const MELT_TEMP = 130; // …or enough ambient heat does the same

// Aux marker for a cell caught in the electric-dissolve reaction. Slime uses aux
// for nothing else (a healthy cell reads 0), so any non-zero aux means "this cell
// is a dissolve front": on its turn it reverts to Water and passes the front on.
// Exported so Spark can stamp it when a pulse touches the blob (see spark.ts).
export const SLIME_DISSOLVE_MARK = 1;

// A dissolve-front cell reverts to Water and hands the front to every still-healthy
// Slime neighbour, so the reaction sweeps through the whole connected blob a ring
// per tick and leaves a puddle behind. `spawn` marks each seeded neighbour moved so
// it acts only next tick (one ring per tick — no same-tick runaway), mirroring the
// discipline the Virus corrosion front uses.
function dissolveToWater(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === SLIME.id && sim.getAux(nx, ny) === 0) {
      sim.spawn(nx, ny, SLIME.id); // re-stamp → flagged moved (acts next tick)…
      sim.setAux(nx, ny, SLIME_DISSOLVE_MARK); // …carrying the dissolve front onward
    }
  }
  sim.set(x, y, WATER.id); // this cell has fully reverted to water
  // set() only auto-clears aux on an EMPTY write, so scrub the dissolve marker
  // by hand — otherwise the fresh Water would carry aux 1, which Water reads as a
  // spark refractory and would (for one tick) refuse to conduct current.
  sim.setAux(x, y, 0);
}

function updateSlime(x: number, y: number, sim: SimContext): void {
  // Electric-dissolve front (aux marker seeded by an adjacent Spark): revert to
  // Water and spread the reaction through the blob. Checked first so a shocked
  // cell always dissolves, whatever else is around it.
  if (sim.getAux(x, y) !== 0) {
    dissolveToWater(x, y, sim);
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

  // Feed: absorb an adjacent Water cell, growing the blob by one cell.
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (sim.get(nx, ny) === WATER.id && sim.chance(ABSORB_CHANCE)) {
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
