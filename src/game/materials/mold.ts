import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { ACID } from './acid';
import { ACID_VAPOR } from './acidvapor';
import { ACID_SLIME } from './acidslime';
import { ALCOHOL } from './alcohol';
import { HYDROGEN_PEROXIDE } from './hydrogenperoxide';
import { SOAPY_WATER } from './soapywater';
import { WALL } from './wall';

// Mold (곰팡이) — the visible half of the 부패 line (spoil.ts). It is what tells
// you a pantry has gone over before anything has actually turned, and it is the
// reason "하나 썩으면 다 썩는다" is true: food with mold against it rots several
// times faster (MOLD_ACCEL, spoil.ts).
//
// ## 곰팡이는 빈칸에만 자란다 — 그게 설계 전부다
//
// The requirement was that mold creep over non-food surfaces too, *without*
// those surfaces rotting: a mouldy cellar should look neglected, not collapse.
// Every version of that written as "mold damages X but not Y" is an exception
// list that grows forever and gets one entry wrong. So mold never converts
// anything at all. It only ever occupies EMPTY cells, and it can only occupy one
// that is touching something solid — it is a *film on a surface*, and a film
// takes nothing away from what it grows on.
//
// Everything the brief asked for falls out of that one rule rather than being
// arranged:
//
//   • 나무 벽에 곰팡이가 슬어도 벽은 그대로다. There is no code path that could
//     take it, because mold writes to empty space and nowhere else.
//   • 표면만 덮는다, 덩어리가 되지 않는다. A cell only spreads into an empty
//     neighbour that touches a **non-mold** support (see `hasSupport`). Mold does
//     not hold up more mold, so a colony is one cell thick against whatever it
//     grows on and cannot fill a room.
//   • 물속에는 안 핀다 — almost. Submerged surfaces have no empty cells against
//     them, so the film rule keeps mold out of the water for free. There is one
//     hole it does not cover and it needed a rule of its own: a Powder rising
//     through a liquid absorbs a cell of it into its 겹침 slot and leaves an
//     empty behind (two cells become one), so a tank with anything rotting in it
//     *does* develop bubbles, deep down, next to the very thing that is rotting.
//     A bubble is not air — see `isDrowned`.
//
// The one exclusion is Wall, which is the world's perfect boundary — it is
// outside the temperature system entirely, and letting the map's own frame go
// green is noise rather than consequence.
//
// ## 두 속도
//
// 유기물 위에서는 눈에 띄게, 그 외 표면에서는 아주 느리게. That is the whole of
// the "비식품도 천천히 뒤덮게" request: the same growth rule reading a different
// constant depending on what the target cell is clinging to. On food it is a
// process you watch; on stone it is something you notice an entire session later.
//
// ## 죽이는 법
//
// Heat and cold at the same two bounds spoiling itself respects (spoil.ts), so
// "요리하면 멎는다 · 얼리면 멎는다" is one sentence for the whole system, plus the
// disinfectants that already exist for the Virus: alcohol, H₂O₂, soapy water, and
// anything acidic. A blowtorch and a bottle of soju are both correct answers.

/** 곰팡이가 죽는 온도 — the same two bounds spoiling stops at (spoil.ts), so the
 *  player learns one rule instead of two. Above: cooking/sterilising heat. Below:
 *  a freezer. */
const MOLD_DIE_TEMP = 60;
const MOLD_FREEZE_TEMP = 0;

/** Per-tick chance a colony cell puts out one new cell, by what the target is
 *  clinging to. The organic figure is a process you can sit and watch (a food
 *  surface furs over in tens of seconds); the surface figure is ~13× slower, so a
 *  stone cellar greys over across a whole session rather than a minute. Both are
 *  bounded by the one-cell-thick rule above — these set the pace of the creep,
 *  never how much there can eventually be. */
const SPREAD_ON_ORGANIC = 0.02;
const SPREAD_ON_SURFACE = 0.0015;

/** 얼룩덜룩한 회녹색 — white, blue-green and grey all at once at any real scale,
 *  which is what `colorVary` at this width buys. Kept well clear of Plant's
 *  green so a furred surface never reads as something growing on purpose. */
const MOLD_COLOR = rgb(150, 158, 128);

/** 살균 — every disinfectant the Virus already answers to (virus.ts), so the
 *  cabinet a player has built up for one outbreak works on the other. Acid is in
 *  here for the same reason it is there: contact, not corrosion.ts's pass, since
 *  that eats Solids on the corroder's own turn and this is cheaper to settle
 *  here where the cell is already looking at its neighbours. */
function isSterilant(id: number): boolean {
  return (
    id === ACID.id ||
    id === ACID_VAPOR.id ||
    id === ACID_SLIME.id ||
    id === ALCOHOL.id ||
    id === HYDROGEN_PEROXIDE.id ||
    id === SOAPY_WATER.id
  );
}

/**
 * 곰팡이가 붙을 수 있는 것 — any solid or powder that is not itself mold, and not
 * the world frame.
 *
 * Excluding MOLD is the load-bearing half: it is what keeps a colony one cell
 * thick. If mold counted as its own support, the first cell on a wall would grow
 * a second out into the air, that one a third, and a pantry would fill solid.
 */
function isSupport(id: number): boolean {
  if (id === EMPTY || id === MOLD.id || id === WALL.id) return false;
  const phase = getMaterial(id).phase;
  return phase === Phase.Solid || phase === Phase.Powder;
}

/**
 * 물에 잠긴 빈칸인가 — whether this empty cell is a bubble rather than air.
 *
 * The test is what is holding it *down*: a void with liquid on its upward side is
 * under that liquid, and a void with anything else there (or nothing) is open to
 * the world. Cheap, and it reads the gravity vector rather than assuming down is
 * +y, so a tank in flipped gravity behaves the same way its occupants do.
 *
 * This is the one place mold needs a rule about water instead of getting one for
 * free. Sinking rot leaves bubbles behind it (see the module note), and those sit
 * against exactly the cells most likely to be seeding spores — so without this a
 * drowned corpse furs over on the bottom of the tank, which is the one thing
 * "물속에는 안 핀다" was supposed to mean.
 *
 * In zero-G there is no upward side and nothing is drowned; a tank with no gravity
 * has no waterline to be under either way.
 */
function isDrowned(x: number, y: number, sim: SimContext): boolean {
  const ux = -Math.sign(sim.gravityX);
  const uy = -Math.sign(sim.gravityY);
  if (ux === 0 && uy === 0) return false;
  const nx = x + ux;
  const ny = y + uy;
  if (!sim.inBounds(nx, ny)) return false;
  const id = sim.get(nx, ny);
  return id !== EMPTY && getMaterial(id).phase === Phase.Liquid;
}

/** Whether an empty cell has anything to grow on, and how readily. Returns the
 *  spread chance for that cell, or 0 if there is nothing to cling to. Organic
 *  wins over bare surface when both are touching, so mold advancing along a
 *  loaf against a stone wall keeps the loaf's pace.
 *
 *  "유기물" is read straight off `Material.spoil` rather than off a second tag:
 *  the things mold grows quickly on are exactly the things that rot, and 부패물
 *  is in that set because it declares its own onward step to 퇴비 (spoiledfood.ts).
 *  One declaration, so the two halves of the system cannot disagree about what
 *  counts as food. */
function supportChance(x: number, y: number, sim: SimContext): number {
  if (isDrowned(x, y, sim)) return 0;
  let best = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const id = sim.get(nx, ny);
    if (!isSupport(id)) continue;
    if (getMaterial(id).spoil) return SPREAD_ON_ORGANIC;
    best = SPREAD_ON_SURFACE;
  }
  return best;
}

/** Whether (x,y) — an EMPTY cell — has any support at all. Used by the spore
 *  seeding in spoil.ts, which needs the yes/no and not the pace. */
export function hasSupport(x: number, y: number, sim: SimContext): boolean {
  return supportChance(x, y, sim) > 0;
}

/**
 * 포자 — try to put a mold cell into one empty, supported neighbour of (x,y).
 * Called by rotting food and by 부패물 (spoil.ts / spoiledfood.ts) rather than by
 * mold itself, because a colony has to *start* on something that has gone over.
 * Nothing here ever writes to an occupied cell.
 */
export function seedMold(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (!sim.isEmpty(nx, ny)) continue;
    if (!hasSupport(nx, ny, sim)) continue;
    sim.spawn(nx, ny, MOLD.id);
    return;
  }
}

function updateMold(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  if (t >= MOLD_DIE_TEMP || t <= MOLD_FREEZE_TEMP) {
    sim.set(x, y, EMPTY);
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isSterilant(sim.get(nx, ny))) {
      sim.set(x, y, EMPTY);
      return;
    }
  }

  // Creep. One empty, supported neighbour per tick at most, at the pace that
  // neighbour's own support sets — `spawn` marks the new cell moved, so a colony
  // advances one cell per tick however many cells are pushing.
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (!sim.isEmpty(nx, ny)) continue;
    const chance = supportChance(nx, ny, sim);
    if (chance > 0 && sim.chance(chance)) {
      sim.spawn(nx, ny, MOLD.id);
      return;
    }
  }
}

export const MOLD = register({
  id: 159,
  name: 'Mold',
  phase: Phase.Solid,
  color: MOLD_COLOR,
  // Blotchy on purpose — a furred surface is never one tone, and this is wider
  // than any of the organic solids (Wood 16, Bread 14) because mold genuinely is
  // the patchiest thing here.
  colorVary: 24,
  density: 1000,
  category: 'life',
  // 피폭사 — it is alive, and it goes the way everything else in the tab goes
  // (engine/radiation.ts). A radioactive store room keeps its bread.
  radiationDeath: EMPTY,
  // A damp film: it barely conducts, so a furred wall is not a thermal bridge.
  thermal: { conductivity: 0.15 },
  update: updateMold,
});
