import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
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
const BURNOUT_CHANCE = 0.012;

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
    if (nid === EMPTY) continue;
    if (getMaterial(nid).flammable && sim.chance(IGNITE_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }

  if (sim.chance(BURNOUT_CHANCE)) {
    sim.set(x, y, SMOKE.id);
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
  update: updateFire,
});
