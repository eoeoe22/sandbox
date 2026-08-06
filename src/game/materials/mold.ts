import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateFloatyPowder } from '../engine/behaviors';
import { SIM_HZ_AT_1X } from '../config';
import type { SimContext } from '../engine/SimContext';
import { moldCanEat } from './spoil';
import { SPOILED_FOOD } from './spoiledfood';
import { ACID } from './acid';
import { ACID_VAPOR } from './acidvapor';
import { ACID_SLIME } from './acidslime';
import { ALCOHOL } from './alcohol';
import { HYDROGEN_PEROXIDE } from './hydrogenperoxide';
import { SOAPY_WATER } from './soapywater';
import { WALL } from './wall';

// Mold (곰팡이) — 포자 가루. The visible half of the 부패 line (spoil.ts), and the
// thing that actually eats what has gone over.
//
// It is three behaviours that read as one material: it **drifts** as a spore, it
// **roots** where it lands on something, and where what it landed on is food it
// **eats it**. 식품 → 곰팡이 → 부패물 → 퇴비 — mold is a stage of the chain, not a
// decoration on it.
//
// ## 흩날리는 가루 — 그런데 자라는 건 중력과 무관하다
//
// Physically a `Phase.Powder` on the floaty model Ash and Flour use: a loose
// grain stalls in the air, wanders sideways as it falls, and rafts on water. That
// is what a spore should do.
//
// But growth is not falling. A colony that could only stack downward would give
// up "곰팡이 슬은 벽" entirely — the picture the material exists for — so the two
// are kept apart: **a grain touching any surface is rooted and does not move at
// all**, and rooted mold creeps sideways and upward into empty cells the same way
// it always did. Only a grain with nothing to cling to is loose, and a loose grain
// is exactly what a drifting spore is. One test (`isRooted`), and the material
// gets both readings without either being special-cased.
//
// ## 침식 — 식품만, 그리고 보존된 것은 아니다
//
// A mold grain converts one adjacent food cell into mold per tick at
// ERODE_CHANCE. "Food" is `Material.spoil` — the same declaration that decides
// what rots at all (engine/types.ts), so there is one answer to "이건 식품인가"
// and mold cannot disagree with the spoilage model about it.
//
// **It eats nothing else.** Not wood, not the crate, not the wall it is growing
// on. That boundary is the same one the whole round is built around — 지어 둔 것이
//삭으면 안 된다 — and here it needs no list: the erosion path only fires on a cell
// that declares `spoil`, and structural materials do not.
//
// **And only a cell the clock has already brought most of the way.** Erosion goes
// through `moldCanEat` (spoil.ts), which asks two things of the target: that it
// has reached the same stage spores appear at, and that nothing is preserving it.
// Both halves are load-bearing. The stage gate stops 침식 outrunning the very
// clock it is meant to be the visible end of — without it a colony ate *fresh*
// food on contact and, since every eaten cell becomes another eater, the front
// ran away exponentially and quietly destroyed the things food is for (a dough
// could no longer be proofed; a cut on a warm plate was gone). The preservation
// half is what keeps 보존 from meaning "keeps until something eats it".
//
// ## 먹은 것만 남긴다 (`ATE_BIT`)
//
// A grain that ate a food cell carries that cell's mass and hands it on: after
// DECAY_SECONDS it becomes 부패물, and from there 퇴비. A grain that merely *grew*
// into empty space carries nothing and so leaves nothing — it just stays as the
// film on the wall.
//
// The distinction is one aux bit, and it is load-bearing rather than tidy. Growth
// writes cells that did not exist before; if those decayed into 부패물 too, a
// stone wall would be a compost generator — mass out of nothing, forever, from a
// material whose whole point is that it takes nothing from what it grows on. With
// the bit, the chain conserves exactly what entered it and the film is free
// scenery that stays scenery.
//
// `spawn` clears aux, so a grown grain reads 0 = film with nothing to remember,
// which is the right default. The erosion path uses `set` (which preserves the
// *food's* aux word) and therefore has to write the bit explicitly.
//
// ## 죽이는 법
//
// Heat and cold at the same two bounds spoiling itself respects (spoil.ts), so
// "요리하면 멎는다 · 얼리면 멎는다" is one sentence for the whole system, plus the
// disinfectants that already exist for the Virus: alcohol, H₂O₂, soapy water and
// anything acidic. A blowtorch and a bottle of soju are both correct answers.
// Killing a grain that had eaten still yields 부패물 — the food it ate does not
// stop having existed because the mold on it died.

/** 곰팡이가 죽는 온도 — the same two bounds spoiling stops at (spoil.ts), so the
 *  player learns one rule instead of two. Above: cooking/sterilising heat. Below:
 *  a freezer. */
const MOLD_DIE_TEMP = 60;
const MOLD_FREEZE_TEMP = 0;

/** Per-tick chance a rooted grain creeps into one new empty cell, by what that
 *  cell is clinging to. The organic figure is a process you can watch; the
 *  surface figure is ~13× slower, so a stone cellar greys over across a whole
 *  session rather than a minute. Both are bounded by the one-cell-thick rule
 *  (`isSupport`) — these set the pace of the creep, never how much there can be. */
const SPREAD_ON_ORGANIC = 0.02;
const SPREAD_ON_SURFACE = 0.0015;

/** Per-tick chance a grain eats one adjacent food cell. Fast enough to watch a
 *  loaf go — a cell a second or so — and slow enough that you can still get to it
 *  with salt, a torch or a freezer. This replaced an invisible ×3 multiplier on
 *  the food's own clock: the same "one bad thing takes the shelf" outcome, except
 *  you can see it happening and see which way it is going. */
const ERODE_CHANCE = 0.02;

/** 먹은 것만 남긴다 — how long a grain that ate holds the food's mass before
 *  handing it on as 부패물. Memoryless per tick, so a colony that ate a loaf
 *  together does not turn over in one frame. Film mold (bit clear) never runs
 *  this at all; see the module note for why that asymmetry is the point. */
const DECAY_SECONDS = 40;
const DECAY_CHANCE = 1 / (DECAY_SECONDS * SIM_HZ_AT_1X);

/** `aux` bit 0 — set on a grain that got here by eating a food cell, clear on one
 *  that grew into empty space. Bit 0 because it is the material's only aux user,
 *  and 0 = film because `spawn` (the growth path) leaves aux at 0 and a
 *  hand-painted grain out of the palette should be film, not a debt of mass the
 *  player never created. Exported for `test/spoil.ts`, which has to tell the two
 *  populations apart to check the chain conserves mass. */
export const MOLD_ATE_BIT = 0b1;

/** 얼룩덜룩한 회녹색 — white, blue-green and grey all at once at any real scale,
 *  which is what `colorVary` at this width buys. Kept well clear of Plant's green
 *  so a furred surface never reads as something growing on purpose. */
const MOLD_COLOR = rgb(150, 158, 128);

/** 살균 — every disinfectant the Virus already answers to (virus.ts), so the
 *  cabinet a player has built for one outbreak works on the other. */
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
 * Excluding MOLD is the load-bearing half twice over. It is what keeps a colony
 * one cell thick (mold that held up more mold would fill a pantry solid), and it
 * is what makes `isRooted` mean "landed on something" rather than "touching the
 * pile it is part of" — without it, a drift of loose spores would freeze in
 * mid-air the moment two of them touched.
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
 * the world. It reads the gravity vector rather than assuming down is +y, so a
 * tank in flipped gravity behaves the same way its occupants do.
 *
 * Sinking rot leaves bubbles behind it (a Powder rising through a liquid absorbs
 * a cell of it and leaves an empty), and those sit against exactly the cells most
 * likely to be seeding spores — so without this a drowned corpse furs over on the
 * bottom of the tank, which is the one thing "물속에는 안 핀다" was supposed to mean.
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
 *  creep chance for that cell, or 0 if there is nothing to cling to. Organic wins
 *  over bare surface when both are touching, so mold advancing along a loaf
 *  against a stone wall keeps the loaf's pace.
 *
 *  "유기물" is read straight off `Material.spoil` rather than off a second tag:
 *  the things mold grows quickly on are exactly the things it can eat, which are
 *  exactly the things that rot. One declaration, so the parts cannot disagree. */
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

/** Whether a mold grain at (x,y) has landed on something. A rooted grain holds
 *  its place and creeps; a loose one drifts (see the module note). */
function isRooted(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && isSupport(sim.get(nx, ny))) return true;
  }
  return false;
}

/**
 * 포자 — puff a spore into one empty neighbour of (x,y). Called by rotting food
 * (spoil.ts) rather than by mold itself, because a colony has to *start* on
 * something that has gone over.
 *
 * Deliberately does NOT require the target to have a support: a spore is a thing
 * that gets thrown into the air. If it lands against something it roots and films;
 * if not it drifts and settles somewhere else, which is the whole reason the
 * material is a powder. `spawn` clears aux, so it starts as film with no mass debt.
 */
export function seedMold(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (!sim.isEmpty(nx, ny)) continue;
    if (isDrowned(nx, ny, sim)) continue;
    sim.spawn(nx, ny, MOLD.id);
    return;
  }
}

/**
 * 침식 — eat one adjacent food cell, if there is one that is not being kept.
 * Returns true if this tick was spent eating.
 *
 * **부패물은 안 먹는다**, and that exclusion is what lets the chain finish rather
 * than a nicety. 부패물 declares `spoil` too (it has its own step onward to 퇴비),
 * so a plain "eat anything that rots" rule ate it as well — and since mold that
 * ate decays *into* 부패물, the two fed each other: 부패물 → 곰팡이 → 부패물 →
 * 곰팡이, a livelock in which nothing ever reached 퇴비. Measured before the fix:
 * 64 cells of raw meat, run for 900 seconds, produced **0 부패물 and 0 퇴비** —
 * the entire mass still cycling.
 *
 * The rule that fixes it is the honest one: mold does not eat what it leaves
 * behind. Everything upstream of mold in the chain is food; the one thing
 * downstream of it is not.
 */
function tryErode(x: number, y: number, sim: SimContext): boolean {
  if (!sim.chance(ERODE_CHANCE)) return false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === SPOILED_FOOD.id) continue; // 자기가 남길 것은 다시 안 먹는다
    const spec = getMaterial(nid).spoil;
    if (spec === undefined) continue;
    // 상하기 시작한 것만, 그리고 보존된 것은 아니다 — one shared predicate
    // (spoil.ts), so 침식 can never disagree with the clock it finishes.
    if (!moldCanEat(nx, ny, sim, spec)) continue;
    // The food becomes mold that remembers it ate. `set` keeps the food's own aux
    // word (a dryness counter, a crust bit, a leaven level), none of which means
    // anything here, so the flag is written rather than or-ed in.
    sim.set(nx, ny, MOLD.id);
    sim.setAux(nx, ny, MOLD_ATE_BIT);
    sim.markMoved(nx, ny);
    return true;
  }
  return false;
}

function updateMold(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  const ate = (sim.getAux(x, y) & MOLD_ATE_BIT) !== 0;

  // Death, by heat, cold or disinfectant. A grain that had eaten still hands the
  // food's mass on — dying does not un-eat it.
  let killed = t >= MOLD_DIE_TEMP || t <= MOLD_FREEZE_TEMP;
  if (!killed) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      if (isSterilant(sim.get(nx, ny))) {
        killed = true;
        break;
      }
    }
  }
  // 먹은 것만 남긴다 — and the same on an ordinary lifetime, so a colony that ate
  // a loaf turns into the rot of that loaf rather than sitting there forever.
  if (killed || (ate && sim.chance(DECAY_CHANCE))) {
    if (ate) {
      sim.set(x, y, SPOILED_FOOD.id);
      sim.setAux(x, y, 0);
    } else {
      sim.set(x, y, EMPTY);
    }
    return;
  }

  // 침식 first: a grain that spent its tick eating does not also creep, which is
  // what keeps a colony from doubling in a single frame.
  if (tryErode(x, y, sim)) return;

  // Loose spore: it has not landed on anything, so it drifts. Rooted mold falls
  // through to the creep below and never moves — see the module note.
  if (!isRooted(x, y, sim)) {
    updateFloatyPowder(x, y, sim);
    return;
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
  phase: Phase.Powder,
  color: MOLD_COLOR,
  // Blotchy on purpose — a furred surface is never one tone, and this is wider
  // than any of the organic solids (Wood 16, Bread 14) because mold genuinely is
  // the patchiest thing here.
  colorVary: 24,
  // A spore is nearly nothing, so this wants to be the lightest thing in the
  // palette — but it is pinned just above Popcorn (1.8) instead of under Ash
  // (1.5), because two existing entries describe themselves as "재 다음으로
  // 가벼운" and a lighter arrival would quietly make both of them false. It floats
  // on water (3) and drifts on the floaty model either way, which is what the
  // material actually needs from this number.
  density: 1.9,
  category: 'life',
  // 가루 shelf too: it is one, and someone looking for something to scatter finds
  // it there.
  alsoIn: ['powder'],
  // 흩뿌리기 — spores are scattered, not poured. A hand-painted patch reads as a
  // dusting rather than a solid green slab (see Material.placementDensity).
  placementDensity: 0.15,
  // 피폭사 — it is alive, and it goes the way everything else in the tab goes
  // (engine/radiation.ts). A radioactive store room keeps its bread.
  radiationDeath: EMPTY,
  // A damp film: it barely conducts, so a furred wall is not a thermal bridge.
  thermal: { conductivity: 0.15 },
  update: updateMold,
});
