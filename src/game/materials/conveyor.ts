import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';

// Conveyor Belt (컨베이어) — a static solid that transports whatever loose matter
// (powder or liquid) rests on its top surface one cell along the belt each beat,
// so you can pour sand or water onto it and watch it get carried sideways. It's
// the "지정 방향으로 미는 벨트" toy: a moving floor that never itself moves.
//
// The belt runs to the RIGHT (screen +x). It only pushes the cell directly on top
// of it (screen-up), and only into open air, so material rides along the surface
// and spills off the end / piles where the belt is blocked — it doesn't drag
// through walls or shove into packed material.
const BELT_SPEED = 0.6; // per-tick chance a carried cell advances (belt speed)

function updateConveyor(x: number, y: number, sim: SimContext): void {
  if (!sim.chance(BELT_SPEED)) return;
  // The load sits on the belt's top surface (the cell directly above, screen-up).
  const ay = y - 1;
  if (!sim.inBounds(x, ay)) return;
  const load = sim.get(x, ay);
  if (load === EMPTY) return;
  // A load that already moved this tick isn't carried again, so a run of belts
  // relays a cell one step per tick rather than teleporting it across in one scan.
  if (sim.hasMoved(x, ay)) return;
  const phase = getMaterial(load).phase;
  if (phase !== Phase.Powder && phase !== Phase.Liquid) return; // only carry loose matter
  // Advance it one cell along the belt (to the right) if that cell is open. swap
  // carries the load's temp/aux/tint and marks both cells moved.
  const tx = x + 1;
  if (sim.inBounds(tx, ay) && sim.get(tx, ay) === EMPTY) {
    sim.swap(x, ay, tx, ay);
  }
}

export const CONVEYOR = register({
  id: 100,
  name: 'Conveyor',
  phase: Phase.Solid,
  // A dark industrial belt; the (x^y) lattice weave reads as belt tread.
  color: rgb(64, 66, 74),
  lattice: rgb(44, 46, 52),
  density: 1000,
  category: '특수',
  // Belts don't burn or corrode away underfoot.
  acidResistant: true,
  thermal: { conductivity: 0.3 },
  update: updateConveyor,
});
