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
import { FIRE } from './fire';
import { STONE } from './stone';
import { LAVA } from './lava';

// Blue Flame — a far hotter cousin of ordinary Fire. It does everything Fire
// does (rises/flickers like a gas, ignites flammable neighbors, is doused by
// water into Steam), but burns hot enough to *melt rock*: any adjacent Stone
// has a per-tick chance to turn molten and flow away as Lava — something plain
// Fire (which leaves Stone untouched) never does.
//
// Two knobs make the rock-melting reliable despite the flame rising away: it's
// placed extremely hot (above Stone's own melt point, so it also melts rock by
// conduction, not just by the direct roll), and it burns out noticeably slower
// than Fire so a painted blob lingers long enough to eat into a wall. Igniting
// flammables produces ordinary Fire, not more Blue Flame, so it stays a
// deliberately-applied cutting torch rather than an unstoppable world-melter.
const MELT_CHANCE = 0.1; // per-tick chance to melt one adjacent Stone → Lava
const IGNITE_CHANCE = 0.08; // per-tick chance to set a flammable neighbor alight
const BURNOUT_CHANCE = 0.05; // ~20-tick life vs Fire's ~10 — burns out quickly but
// still lingers a touch longer than Fire (and stays extremely hot) to melt rock
const SMOKE_CHANCE = 0.25; // …and only some burnouts leave Smoke behind

function updateBlueFlame(x: number, y: number, sim: SimContext): void {
  // Water/Saltwater neighbor snuffs it instantly (self → Empty, that cell →
  // Steam), exactly like Fire — even the hottest flame is put out by water.
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

  // Melt adjacent rock and ignite flammables. `spawn` marks the neighbor moved,
  // so a just-melted Lava cell (or just-lit Fire) can't be reprocessed this
  // same tick — the fresh Lava reads as molten (spawn seeds it at Lava's own
  // init temperature) and starts flowing next tick.
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === STONE.id) {
      if (sim.chance(MELT_CHANCE)) sim.spawn(nx, ny, LAVA.id);
    } else if (getMaterial(nid).flammable && sim.chance(IGNITE_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }

  if (sim.chance(BURNOUT_CHANCE)) {
    sim.setTemp(x, y, AMBIENT_TEMP);
    sim.set(x, y, sim.chance(SMOKE_CHANCE) ? SMOKE.id : EMPTY);
    return;
  }
  updateGas(x, y, sim);
}

export const BLUE_FLAME = register({
  id: 19,
  name: 'Blue Flame',
  phase: Phase.Gas,
  color: rgb(90, 160, 255),
  density: 1,
  // Hotter than Lava (1500) and well past Stone's melt point (1100), so its
  // conducted heat melts rock even where the direct roll doesn't; conducts
  // poorly like every other gas.
  thermal: { init: 1800, conductivity: 0.15 },
  update: updateBlueFlame,
});
