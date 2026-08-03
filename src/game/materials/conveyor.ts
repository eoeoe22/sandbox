import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { floodDeviceBody } from '../engine/deviceBody';

// Conveyor Belt (컨베이어) — an electric appliance that transports whatever loose
// matter (powder or liquid) rests on it, in the direction it was drawn. Drag the
// brush left or right while placing a belt and every cell records that direction
// in the low 2 bits of its aux byte; the renderer draws a chevron so which way a
// belt runs is obvious at a glance (see CanvasRenderer). A moving floor that never
// itself moves.
//
// Two things beyond the basic "push one grain sideways":
//   • It carries a whole *body* of material, not just the single grain directly on
//     top: every cell of the loose column standing on a belt cell shifts forward
//     each tick wherever there is room, up to LIFT_HEIGHT cells above the surface.
//     So a silo emptied onto a belt comes out as a slab tens of cells deep rather
//     than as a thin sheet skimmed off the top of the pile.
//   • It climbs: when the straight-ahead cell is blocked but the cell one step
//     up-and-forward is open, the load steps up. A belt laid as a shallow
//     staircase therefore carries material UP a gentle (~30°) slope, stably,
//     instead of only moving it along the flat.
//
// **It only runs on power** (전원 공급시에만 작동). A belt is a machine, not a
// slope, so it belongs in the 전기 category with the Fan/Laser/Pump/Electromagnet
// and answers power exactly the way they do — it is deliberately NOT `conductive`
// (a belt run must never double as free wire) and instead declares the shared
// electric-appliance hook (`Material.directPulse` = `energizeConveyorBody`). Any
// pulse source touching any face — a Battery/LFP Battery/Turbine/Solar Panel in
// direct contact, or a Spark relayed down a wire — floods the whole connected belt
// through `floodDeviceBody` and stamps a powered countdown onto every one of its
// cells at once, whatever strength that pulse had left (전기 세기에 관계없이 연결
// 부위 전역 즉시 활성화 — see engine/deviceBody.ts and docs/ELECTRICITY.md). An
// unpowered belt is inert: it carries nothing and its tread stands still, so it
// reads as an ordinary dark floor.
//
// The countdown is POWERED_TICKS long for the same reason the Fan's is — a Battery
// pulses only every PULSE_PERIOD (12) ticks, so a one-tick life would make the belt
// stutter between pulses. Refreshed to a comfortably longer 24, the belt runs
// continuously and coasts to a stop a beat or two after power is genuinely cut.

/** aux direction codes (low 2 bits of a belt cell's aux; 0/unset ⇒ right). */
export const CONVEYOR_RIGHT = 1;
export const CONVEYOR_LEFT = 2;
/** Low-bit mask separating the direction from the packed powered countdown. */
const DIR_MASK = 0b11;

/** Ticks one power pulse keeps the belt running. Same value and same reasoning as
 *  the Fan's: set well above the Battery's PULSE_PERIOD (12) so the tread never
 *  lapses in the gaps between pulses. Fits the 6-bit countdown field
 *  (aux >> 2, ≤ 63). */
const POWERED_TICKS = 24;

/** How many cells above the belt's surface are carried in one shift. The loop
 *  below stops at the top of the contiguous loose column anyway, so this is a
 *  backstop against a pathological full-height column rather than the limit a
 *  build normally meets — but it used to BE the limit: at 10 it capped the moving
 *  layer at ~9 cells no matter how deep the load was (실측), which is what made a
 *  belt under a pile skim a thin sheet off it. At 60 the cap stops binding for any
 *  silo anyone builds (a 40칸 silo delivers a ~35칸 slab, geometry-limited, the
 *  same as with no cap at all). */
const LIFT_HEIGHT = 60;

/** True if `id` is loose matter the belt carries (powder or liquid). */
function isLoose(id: number): boolean {
  if (id === EMPTY) return false;
  const p = getMaterial(id).phase;
  return p === Phase.Powder || p === Phase.Liquid;
}

/** True if `id` is a solid — a "step" the belt can climb over (the next belt
 *  segment, a wall). The belt only climbs over solids, never over loose matter
 *  piled ahead (which would lift grains into floating positions off the belt). */
function isSolidStep(id: number): boolean {
  return id !== EMPTY && getMaterial(id).phase === Phase.Solid;
}

// The belt advances its load one cell EVERY tick (deterministically, not on a
// probability). The scan runs a belt cell before the load resting on it (bottom-
// to-top), so the belt carries a surface grain — and marks it moved — before that
// grain's own gravity update can tumble it off. That's what makes uphill carry
// stable: a grain riding an ascending staircase is stepped up each tick instead
// of getting a chance to roll off the front of a step into the gap below it.
function updateConveyor(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const timer = aux >> 2;
  if (timer <= 0) return; // unpowered: an inert floor, carrying nothing
  // Spin the countdown down one tick before doing any carrying, keeping the
  // direction bits. Done up front so it happens on every powered tick — the
  // carry below has several "nothing to move" early exits, and a belt that only
  // aged while it had a load would keep running forever once it emptied.
  sim.setAux(x, y, ((timer - 1) << 2) | (aux & DIR_MASK));

  const dir = (aux & DIR_MASK) === CONVEYOR_LEFT ? -1 : 1; // 0/unset ⇒ right

  // The load rests on the belt's top surface (the cell against gravity). Nothing
  // to carry if that cell isn't loose matter.
  const sy1 = y - 1;
  if (!sim.inBounds(x, sy1)) return;
  if (!isLoose(sim.get(x, sy1))) return;

  // Decide the step for the whole stack from what's directly ahead at belt level:
  // straight along the belt if that's open or is more loose matter; else, if a
  // SOLID step blocks the way (the next belt segment of an ascending staircase, or
  // a wall) and there's headroom above it, climb one cell up-and-along; else
  // blocked. Only solids are ever *climbed* — the belt never lifts its load over a
  // grain piled ahead into a floating spot off the belt.
  if (!sim.inBounds(x + dir, sy1)) return;
  const fwd = sim.get(x + dir, sy1);
  let stepDy: number;
  if (fwd === EMPTY || isLoose(fwd)) {
    stepDy = 0; // flat carry — into open air, or shearing into the pile ahead
  } else if (
    isSolidStep(fwd) &&
    sim.inBounds(x + dir, sy1 - 1) &&
    sim.get(x + dir, sy1 - 1) === EMPTY
  ) {
    stepDy = -1; // climb the solid step
  } else {
    return; // a solid dead ahead with no headroom to climb
  }

  // Shift the contiguous loose stack (up to LIFT_HEIGHT tall) by (dir, stepDy).
  // Source column x and target column x+dir are disjoint, so the cells can't
  // collide as they shift.
  //
  // Only the top of the stack ends the loop. A cell that *can't* move right now —
  // its landing is occupied, or it already resolved this tick — is **skipped, not
  // a stopping point**, and that is what lets a belt move a body of material
  // instead of skimming it (아래 더미를 얇게가 아니라 통째로 수송).
  //
  // 왜 그게 필요했나: 벨트가 예전엔 (a) 앞 칸에 가루가 있으면 **아무것도 안 하고**
  // 기다렸고, (b) 스택 안에서 못 가는 칸을 만나면 **거기서 멈췄다.** 더미 하나를 놓으면
  // 안식각 비탈이 지므로 앞 칸에 가루가 없는 벨트 셀은 **비탈 끝의 한 칸뿐**이고, 그
  // 자리는 더미에서 가장 얇은 곳이다 — 그래서 20칸 높이 더미도 **1~3칸짜리 얇은 층**으로만
  // 흘러 나갔다(실측 sheet 두께 평균 1.2~3.1). 지금은 이웃 기둥보다 높이 솟은 부분이 매
  // 틱 앞으로 밀리므로, 더미가 층으로 벗겨지는 게 아니라 **덩어리째 전진**한다.
  //
  // 겹쳐 쌓인 것을 찢지는 않는다: 목적지가 반드시 비어 있어야 하므로, 앞 기둥이 자기와
  // 같은 높이로 꽉 찬 균일한 슬래브는 갈 데가 없어 그대로 있고(비압축), 벽에 막힌 벨트도
  // 예전처럼 선다.
  for (let h = 1; h <= LIFT_HEIGHT; h++) {
    const sy = y - h;
    if (!sim.inBounds(x, sy)) break;
    const load = sim.get(x, sy);
    if (!isLoose(load)) break; // top of the contiguous stack (air, or a solid on it)
    // Already resolved this tick — a belt relays a grain one step per tick and
    // never teleports it across a run. Skip it and keep looking up the stack.
    if (sim.hasMoved(x, sy)) continue;
    const tx = x + dir;
    const ty = sy + stepDy;
    if (!sim.inBounds(tx, ty) || sim.get(tx, ty) !== EMPTY) continue; // no room; skip
    // swap carries the load's temp/aux/tint and marks both cells moved.
    sim.swap(x, sy, tx, ty);
  }
}

/**
 * Deliver a power pulse to the connected belt containing (sx,sy): flood the whole
 * thing through conveyor cells and refresh every cell's powered countdown to
 * POWERED_TICKS, keeping each cell's own direction bits — so a belt run wired at
 * one end starts moving along its entire length in the tick the pulse lands, at
 * full speed whatever strength that pulse had left.
 *
 * The flood is **8-connected** (`floodDeviceBody`'s `diagonal`), unlike every
 * other device's. A belt is a run rather than a block, and the shape this material
 * is *for* — the ascending staircase — steps by one cell in both axes at once, so
 * consecutive steps touch only at their corners. 4-connected, that belt is a heap
 * of separate one-step machines: a battery at the foot powers the first step and
 * the rest of the climb stands dead, so a grain rides up exactly one step and
 * stops (measured — the whole staircase delivers when every cell is forced on).
 * Two belts that merely touch at a corner therefore power together, which is the
 * right reading: they are one machine on screen.
 * The one-way "outside → inside" sink every electric appliance shares (see the
 * header note and fan.ts): a pulse only ever *arrives* here, never leaves.
 * Memoized per tick via SimContext.conveyorFlood so a belt touched from several
 * faces or sources in one tick still floods exactly once.
 */
export function energizeConveyorBody(sim: SimContext, sx: number, sy: number): void {
  floodDeviceBody(
    sim,
    sx,
    sy,
    CONVEYOR.id,
    sim.conveyorFlood,
    (x, y) => {
      sim.setAux(x, y, (POWERED_TICKS << 2) | (sim.getAux(x, y) & DIR_MASK));
    },
    undefined,
    true, // 8-connected: a staircase belt's steps touch only at their corners
  );
}

export const CONVEYOR = register({
  id: 100,
  name: 'Conveyor',
  phase: Phase.Solid,
  // A dark industrial belt; the direction chevron (drawn per-cell from the aux
  // direction — see CanvasRenderer) shows which way it runs, and **the tread
  // scrolls one cell per tick along that direction while the belt is powered**
  // (the countdown in aux >> 2 is what gates it), so a running belt is obvious at
  // a glance and a dead one visibly stands still.
  color: rgb(64, 66, 74),
  // Bright tread color the direction chevron is drawn in.
  lattice: rgb(126, 132, 148),
  arrow: true,
  density: 1000,
  category: 'electric',
  thermal: { conductivity: 0.3 },
  // One-way "outside → inside" electric sink (see the header note): any pulse
  // source touching a face floods the connected belt and refreshes its run
  // countdown. Declared once here so every source powers it through the shared
  // dispatch (spark.ts reactToPulse), with no per-source id special-casing.
  directPulse: energizeConveyorBody,
  update: updateConveyor,
});
