import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP, FIRE_SMOKE_CHANCE } from '../config';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { STEAM } from './steam';
import { SMOKE } from './smoke';

// Gas: rises/flickers like the default gas behavior. Each tick: any
// Water/Saltwater neighbor extinguishes it (self -> Empty, that neighbor ->
// Steam, deterministic — "물 인접 시 즉시 소화"); otherwise any `flammable`
// neighbor has a low per-tick chance to ignite (spread is deliberately slow —
// see comment on IGNITE_CHANCE); otherwise a small chance to burn out to
// Smoke each tick.
const IGNITE_CHANCE = 0.04; // ~50% ignited after ~17 ticks (~0.3s@60Hz) — a
// visible crawl, not an instant flash. A value like 0.35 ignites within 1-2
// ticks (~30ms), which reads as instantaneous and defeats a watchable spread.
const BURNOUT_CHANCE = 0.1; // flames snuff quickly (was 0.02) — ~10-tick life
// (~0.17s@60Hz) so a fire front flares and vanishes almost as fast as it appears.

function updateFire(x: number, y: number, sim: SimContext): void {
  let extinguished = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id) {
      sim.spawn(nx, ny, STEAM.id);
      extinguished = true;
    }
  }
  if (extinguished) {
    sim.set(x, y, EMPTY);
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (getMaterial(nid).flammable && sim.chance(IGNITE_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }

  if (sim.chance(BURNOUT_CHANCE)) {
    // Burning out means the heat is spent, so drop to ambient (and only
    // sometimes leave Smoke behind — mirrors Steam condensing). This is the
    // 'high' (unthinned) rate; the SimContext smoke-level seam thins it further
    // at 'medium'/'off', so the net smoke on screen tracks the chosen level.
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, sim.chance(FIRE_SMOKE_CHANCE) ? SMOKE.id : EMPTY);
    return;
  }
  updateGas(x, y, sim);
}

export const FIRE = register({
  id: 9,
  name: 'Fire',
  phase: Phase.Gas,
  color: rgb(255, 120, 40),
  density: 1,
  category: '불·열',
  // Burns hot, so it heats what it touches. Heat exchange across any interface is
  // gated by min(두 전도도), so Fire's own conductivity is the ceiling on how fast
  // it warms *anything* — at the old 0.1 it was the shared bottleneck that made
  // heating a solid container (Iron/Diamond/Stone, all far more conductive) crawl
  // no matter which solid you picked, since min(0.1, 0.85) = 0.1 clamps it. Set to
  // the material default (0.3) so a flame actually drives heat into what it licks
  // (e.g. melting an ore charge through a crucible wall in a sane time). This only
  // speeds the *rate*; Fire still can't push anything past its own ~1000°, so it
  // still won't melt Stone (1100°) — that stays Blue Flame/Lava's job.
  thermal: { init: 1000, conductivity: 0.3 },
  update: updateFire,
});
