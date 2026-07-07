import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
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
const BURNOUT_CHANCE = 0.02; // flames snuff a bit sooner (was 0.012) so a fire
// front is shorter-lived and less persistent.
const SMOKE_CHANCE = 0.3; // …and only some burnouts leave Smoke; the rest clear
// straight to Empty, so a fire gives off noticeably less smoke than it used to.

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
    // sometimes leave Smoke behind — mirrors Steam condensing).
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, sim.chance(SMOKE_CHANCE) ? SMOKE.id : EMPTY);
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
  // Burns hot, so it heats what it touches; conducts poorly like other gases.
  thermal: { init: 1000, conductivity: 0.1 },
  update: updateFire,
});
