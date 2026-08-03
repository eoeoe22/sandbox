import { DIR8 } from '../engine/directions';
import { getMaterial } from './registry';
import { EMPTY, Phase, type FireClass } from '../engine/types';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP, RADIANT_HEAT_RANGE } from '../config';
// Read only from inside spendDousingAgent, never at module scope: Water imports
// this file back (for fightingFire/steamHasRoom) and Snow/Ice import Water, so touching
// either binding while the modules are still loading would blow up.
import { WATER, WATER_SURFACE_CAP } from './water';
import { STEAM } from './steam';
import { FIRE } from './fire';
import { BLUE_FLAME } from './blueflame';

// 소화(消火) — the one place that knows how an extinguishing agent actually puts a
// fire out, shared by CO₂, Dry Ice's CO₂, Soda, Liquid N₂ and the water family.
//
// The thing every agent has to beat is that a burning fuel cell *is fuel*, pinned
// hot (~800°, Coal 1300°) and re-wreathing flame every tick — it does not vanish
// while it burns (see combustion.ts). So killing the visible flame achieves
// nothing: the body simply makes more. What genuinely puts it out is cooling the
// fuel back under its autoignition point.
//
// And cooling the *surface* cell isn't enough either. Measured on a burning Coal
// block whose top row was chilled to ambient and then left alone, conduction from
// the still-burning cells beneath took it back over Coal's 580° autoignition in
// four ticks and to a full 1300° in five. A surface-only agent therefore has to
// re-extinguish the same cell forever, and loses — which is exactly why water
// used to fail: 80 cells of it poured on an 80-cell wood bed only ever reached a
// burning fuel cell 21 times, while 79 of them were annihilated by the loose Fire
// gas wreathing the bed.
//
// So suppression is a *flood*: from the contact point the chill travels through
// connected fuel — cool cells included, which is what lets it reach a burning
// core hiding behind an already-cooled crust — and resets every cell it finds in
// the burning band back to ambient. Bounded by depth and a cell cap, and those
// two numbers are the entire balance knob between the agents: CO₂ sinks deep
// through a whole bed, water only reaches a few cells in from the face it wets.
//
// The second knob is `classes` — 화재 등급. Water is only allowed to traverse and
// cool class-A fuel, so an oil fire (class B, derived from `petroleum`) and a
// metal fire (class D, the aluminum line) are untouched by it no matter how much
// you pour. CO₂ and the dry chemicals pass every class, which is what makes
// keeping one in the palette worth it.

/** How far and how hard one agent's chill sinks into a fuel mass. */
export interface ChillSpec {
  /** Cells at/above this are "burning" and get reset to ambient. Sits above every
   *  fuel's autoignition point (the highest is Coal at 580) but below the ~800°
   *  burn pin, so the chill cools actively-burning cells without touching
   *  merely-warm material. */
  smotherTemp: number;
  /** Flood radius through connected fuel, in cells. */
  maxDepth: number;
  /** Hard cap on cells visited by one flood, so a *giant* fuel field keeps a
   *  deep, slowly-burning core rather than being snuffed whole in one op. */
  maxCells: number;
  /** 화재 등급 this agent works on. The flood neither cools nor travels through a
   *  fuel outside this set. */
  classes: readonly FireClass[];
}

const SMOTHER_TEMP = 600;

// How far a water cell looks for the fire it is fighting (see fightingFire).
// Deliberately RADIANT_HEAT_RANGE and not "the cell next door": a fire at/above
// RADIANT_HEAT_MIN_TEMP casts rays this far (config.ts), so every cell within it
// is being cooked by the fire whether or not it is touching anything. Measured on
// a poured column, the cells that actually boiled away were almost never the ones
// in contact — they were the ones behind them, heated across the gap. Checking
// only the contact face left the column being eaten from the inside while its
// face was being politely shielded.
const FIGHT_RANGE = RADIANT_HEAT_RANGE;
const ALL_CLASSES: readonly FireClass[] = ['A', 'B', 'D'];
const CLASS_A: readonly FireClass[] = ['A'];

/** CO₂ (and the CO₂ that Dry Ice fumes off): the reference extinguisher. Deep
 *  enough to cover a fat brush stroke (brush size N ≈ 2N+1 cells thick), every
 *  class, and — crucially — CO₂ is not consumed by doing it, so one blanket
 *  walks a whole burning bed cold. */
export const CO2_CHILL: ChillSpec = {
  smotherTemp: SMOTHER_TEMP,
  maxDepth: 9,
  maxCells: 160,
  classes: ALL_CLASSES,
};

/** Soda (dry chemical): the same all-class reach as CO₂ but shallower, and each
 *  grain is spent doing it (see soda.ts) — a powder you throw, not a blanket
 *  that stays. */
export const SODA_CHILL: ChillSpec = {
  smotherTemp: SMOTHER_TEMP,
  maxDepth: 5,
  maxCells: 60,
  classes: ALL_CLASSES,
};

/** Water/Saltwater/Sugar Water/Snow/Ice. Class A only, and shallow: water wets a
 *  face and soaks a little way in, so a thin burning bed goes out at once while a
 *  deep coal pile has to be worked over face by face — which is what a player
 *  expects of a hose versus an extinguisher, and leaves CO₂ its edge. */
export const WATER_CHILL: ChillSpec = {
  smotherTemp: SMOTHER_TEMP,
  maxDepth: 3,
  maxCells: 24,
  classes: CLASS_A,
};

/** Liquid N₂: colder than anything else in the box and it conducts that cold
 *  well, so it reaches as deep as CO₂ — but every cell of it flash-boils away in
 *  the process (see liquidnitrogen.ts), so it is a one-shot dump rather than a
 *  blanket. Class A only: cryogen on a metal fire is no better than water. */
export const CRYO_CHILL: ChillSpec = {
  smotherTemp: SMOTHER_TEMP,
  maxDepth: 9,
  maxCells: 120,
  classes: CLASS_A,
};

/** The 화재 등급 of a fuel id. Class B is *derived* from `petroleum` rather than
 *  declared, so the oil family can never drift out of sync with the
 *  burning-slick-floats-on-water machinery that same tag already drives (see
 *  water.ts). Everything else defaults to A. */
export function fireClassOf(id: number): FireClass {
  const m = getMaterial(id);
  if (m.fireClass) return m.fireClass;
  return m.petroleum === true ? 'B' : 'A';
}

/** True if `id` is fuel this agent is allowed to fight. */
export function suppressible(id: number, spec: ChillSpec): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  if (m.combustion === undefined) return false;
  return spec.classes.includes(fireClassOf(id));
}

/**
 * Sink an agent's chill into a fuel mass from a contact cell: an 8-connected
 * flood that *travels through connected fuel regardless of temperature* and cools
 * any cell in the burning band back to ambient. Traversing the already-cooled
 * crust is what lets the chill reach burning cells buried behind it — without it
 * a thick line's core keeps re-lighting its own surface. Bounded by
 * `spec.maxDepth`/`spec.maxCells`, and confined to the 화재 등급 the agent works
 * on. Cooling is a pure setTemp (no material write), so it never causes same-tick
 * reprocessing.
 */
export function chillThroughFuel(sx: number, sy: number, sim: SimContext, spec: ChillSpec): void {
  if (!suppressible(sim.get(sx, sy), spec)) return;
  const w = sim.width;
  const visited = new Set<number>([sy * w + sx]);
  const qx: number[] = [sx];
  const qy: number[] = [sy];
  const qd: number[] = [0];
  let head = 0;
  let visits = 0;
  while (head < qx.length && visits < spec.maxCells) {
    const x = qx[head];
    const y = qy[head];
    const d = qd[head];
    head++;
    visits++;
    if (sim.getTemp(x, y) >= spec.smotherTemp) sim.setTemp(x, y, AMBIENT_TEMP);
    if (d >= spec.maxDepth) continue;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const key = ny * w + nx;
      if (visited.has(key)) continue;
      if (suppressible(sim.get(nx, ny), spec)) {
        visited.add(key);
        qx.push(nx);
        qy.push(ny);
        qd.push(d + 1);
      }
    }
  }
}

/**
 * The water family, as far as fire is concerned: the three drinkable liquids plus
 * the two frozen forms, all of which declare `Material.douses`. Snow and Ice used
 * to carry no fire logic at all — they melted on contact and left the resulting
 * Water to fight alone, so a snowball thrown on a bonfire did strictly nothing.
 */
export function isDousingAgent(id: number): boolean {
  return id !== EMPTY && getMaterial(id).douses !== undefined;
}

/**
 * Spend one dousing cell on the fire it just put out — it becomes whatever its
 * `Material.douses` form says: a liquid flashes off as Steam, frozen water only
 * melts to Water, so the puddle a snowball leaves fights on.
 *
 * Callers spend exactly one cell per flame, never a whole neighbourhood. Fire
 * used to steam *every* water cell it touched, up to eight for one flame lick,
 * which is what made pouring water read as instant evaporation: a burning bed
 * carries ~95 loose Fire cells at a time, so the water was shredded by the flame
 * gas long before any of it reached the fuel underneath.
 */
export function spendDousingAgent(x: number, y: number, sim: SimContext): void {
  const form = getMaterial(sim.get(x, y)).douses;
  if (form === undefined) return;
  sim.spawn(x, y, form === 'melt' ? WATER.id : STEAM.id);
}

/**
 * True if a boiling cell has somewhere to put the Steam — an adjacent cell that
 * is empty or already gas.
 *
 * Saltwater and Sugar Water have always required this (they had to: the salt has
 * to go somewhere, so they spawn the Steam into a free neighbour and only then
 * give up the cell). Fresh Water instead boiled *in place*, needing no room at
 * all, and that lone inconsistency was worth about 5× in a firefight: measured
 * on the same burning bed with the same amount poured, a packed column of Water
 * lost 55 cells to self-boil against Saltwater's 9, so the brine put fires out
 * roughly twice as fast as fresh water — which is nonsense, and exactly the "물을
 * 부어도 증발만 빠르다" the whole pass is about.
 *
 * Requiring room brings Water in line with its own solutions and costs almost
 * nothing elsewhere, because a *surface* always has room: a pool boils off its
 * top exactly as before, and the Obsidian quench never comes through here at all
 * (water touching Lava yields its turn to lava.ts). What changes is the inside of
 * a body of water, which now needs the boil to work its way in from a face rather
 * than flashing the whole volume at once.
 */
export function steamHasRoom(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY || getMaterial(nid).phase === Phase.Gas) return true;
  }
  return false;
}

/**
 * Hold every water-family neighbour of a just-snuffed flame at/below the surface
 * cap, so the heat that flame put into them in this tick's diffusion pass doesn't
 * boil them off after it is gone. Called by Fire/Blue Flame right after they
 * spend one cell dousing themselves — see the note at that call site for why the
 * 1:1 exchange is only real with this.
 */
export function coolNeighbourWater(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (!isDousingAgent(sim.get(nx, ny))) continue;
    sim.setTemp(nx, ny, Math.min(sim.getTemp(nx, ny), WATER_SURFACE_CAP));
  }
}

/**
 * True if the water sitting in this cell is *in the middle of putting a fire
 * out* — within radiant reach (FIGHT_RANGE) of burning class-A fuel, or of the
 * Fire/Blue Flame that fuel throws off.
 *
 * The trigger is *burning*, not merely warm, so the shield lifts the moment the
 * fire is actually out and the leftover water then boils away on the scene's
 * residual heat exactly as it always did. What it costs is that a pot of water
 * standing within three cells of a live wood fire will not come to the boil —
 * use Lava, a hot metal plate or a Heat Ray for steam, which is what every steam
 * rig in the box already does.
 *
 * Water/Saltwater/Sugar Water call this to hold themselves just below boiling
 * instead of flashing to Steam, exactly the way they already refuse to boil under
 * a burning oil slick (burningPetroleumAdjacent in water.ts). The reason is that
 * without it the same evaporation is counted twice, and water can never win.
 * Firefighting water is already consumed by two explicit rolls — one cell per
 * flame snuffed (fire.ts) and DOUSE_STEAM_CHANCE per fuel cell doused
 * (combustion.ts). Letting the temperature system *also* delete it is what made
 * pouring water read as pure evaporation: heat diffusion runs for the whole grid
 * before any material update, so a water cell laid against a burning fuel is
 * already at 110° by the time anything gets a turn — measured, one tick against
 * burning Coal is enough — and it boiled off no matter how those rolls went.
 * Measured on a burning wood bed: 59 cells of a poured column lost to self-boil
 * versus 34 to actual firefighting, while Saltwater (which happens to need
 * somewhere to *put* the Steam, so a packed column can't boil) lost 13 and put
 * the fire out twice as fast. With the cap, how fast the water goes is governed
 * by the douse rolls alone, which is where it belongs.
 *
 * Deliberately narrow on both sides. Class B (유류) is already handled by the
 * older petroleum shield, and class D (금속) *must* keep boiling here — burning
 * aluminum turning water and steam into Hydrogen is the whole point of a metal
 * fire, and capping it would quietly delete that. Lava is not in the flame list
 * either: water hitting lava is supposed to flash off (that is what quenches it
 * to Obsidian and drives every steam rig in the box).
 */
export function fightingFire(x: number, y: number, sim: SimContext): boolean {
  // Nothing anywhere in the world was alight last tick, so the sweep below can
  // only come back false — skip it. This matters because the sweep runs for every
  // water cell at or above boiling, and a steam plant holds a whole reservoir
  // there permanently: measured on a ~40k-cell forced-boiling pool, the sweep was
  // ~37% of tick time and found nothing every single time. See
  // SimContext.fireActive for how the flag is kept.
  if (!sim.fireActive) return false;
  for (let dy = -FIGHT_RANGE; dy <= FIGHT_RANGE; dy++) {
    for (let dx = -FIGHT_RANGE; dx <= FIGHT_RANGE; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (nid === FIRE.id || nid === BLUE_FLAME.id) return true;
      if (!suppressible(nid, WATER_CHILL)) continue;
      if (sim.getTemp(nx, ny) >= WATER_CHILL.smotherTemp) return true;
    }
  }
  return false;
}
