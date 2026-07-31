// Headless behavioural harness for the Molotov cocktail object (engine/objects.ts
// SimMolotov): the fragile shatter, the wick's douse/re-light cycle, the fifteen
// seconds of fuel that end in an empty bottle, and what each of those states
// leaves on the grid when the glass goes. Run: `node test/run-molotov.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import {
  createDynamite,
  createMolotov,
  createWoodBox,
  molotovBottle,
  MOLOTOV_FUEL_TICKS,
  MOLOTOV_IGNITE_TEMP,
  MOLOTOV_SMASH_SPEED,
} from '../src/game/engine/objects';
import type { SimDynamite } from '../src/game/engine/objects';
import { getMaterial } from '../src/game/materials/registry';
import { detonate } from '../src/game/materials/blast';
import { MOLOTOV_SPRITES, MOLOTOV_SPRITE_W, MOLOTOV_SPRITE_H } from '../src/game/render/molotovSprite';
import '../src/game/materials';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(11);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const ID = (name: string): number => {
  for (let i = 1; i < 256; i++) {
    const m = getMaterial(i);
    if (m && m.name === name) return i;
  }
  throw new Error('no material ' + name);
};
const STONE = ID('Stone');
const WATER = ID('Water');
const FIRE = ID('Fire');
const GLASS = ID('Broken Glass');
const ALCOHOL = ID('Alcohol');

function makeWorld(w = 100, h = 100): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function floor(grid: Grid, y: number, id = STONE): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, yy)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
/** Fill the rectangle [x0,x1)×[y0,y1) with `id` (used for ponds and lava pools). */
function fillRect(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid.cells[grid.idx(x, y)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** The hottest cell of material `id` on the grid (-Infinity if there is none) —
 *  how a burning spill is told from a cold one. */
function hottest(grid: Grid, id: number): number {
  let t = -Infinity;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] !== id) continue;
    const temp = grid.getTemp(i % grid.width, Math.floor(i / grid.width));
    if (temp > t) t = temp;
  }
  return t;
}
/** Step until the object array empties (the body broke) or `limit` ticks pass.
 *  Returns the tick it broke on, or -1 if it survived. */
function stepUntilGone(sim: Simulation, grid: Grid, limit: number): number {
  for (let t = 0; t < limit; t++) {
    sim.step();
    if (grid.objects.length === 0) return t;
  }
  return -1;
}

// 1. Geometry: the body is sized from its own art, so the sprite and the capsule
//    the world collides with cannot disagree. (Row widths are checked by the
//    sprite module itself at load — a mistyped row throws.)
{
  const m = createMolotov(50, 50);
  const boxW = MOLOTOV_SPRITE_W * 0.5;
  const boxH = MOLOTOV_SPRITE_H * 0.5;
  check('capsule box matches the sprite box', 2 * m.radius === boxW && 2 * (m.halfLength + m.radius) === boxH,
    `capsule ${2 * m.radius}×${2 * (m.halfLength + m.radius)} cells vs sprite ${boxW}×${boxH}`);
  check('both bottle sprites are the same box',
    MOLOTOV_SPRITES.full.length === MOLOTOV_SPRITE_W * MOLOTOV_SPRITE_H &&
      MOLOTOV_SPRITES.empty.length === MOLOTOV_SPRITE_W * MOLOTOV_SPRITE_H);
  check('spawns lit and full', m.lit && m.fuelTicks === MOLOTOV_FUEL_TICKS && molotovBottle(m) === 'full',
    `fuel=${m.fuelTicks} ticks`);
}

// 2. A bottle set down gently survives — including toppling off its base, which is
//    what every freshly-spawned one does (a capsule has nothing to keep it upright).
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const m = createMolotov(50, 62); // base 1 cell above the floor
  grid.objects.push(m);
  for (let t = 0; t < 200; t++) sim.step();
  check('a bottle placed on the ground survives (topple included)', grid.objects.length === 1,
    `angle=${m.angle.toFixed(2)} rad`);
  check('and no glass was spilled', count(grid, GLASS) === 0);
}

// 3. 느린 충돌에도 파괴: a modest drop shatters the bottle, while the wooden crate —
//    dropped from the very same height onto the very same floor — is untouched.
//    Same scene twice, so "the bottle broke" can't be read as "the fall was huge".
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  grid.objects.push(createMolotov(50, 40)); // ~23 cells of free fall
  const broke = stepUntilGone(sim, grid, 120);
  check('a ~23-cell drop shatters the bottle', broke >= 0, `broke on tick ${broke}`);
  check('it leaves Broken Glass', count(grid, GLASS) > 0, `${count(grid, GLASS)} cells`);
  check('it leaves Alcohol', count(grid, ALCOHOL) > 0, `${count(grid, ALCOHOL)} cells`);

  const w2 = makeWorld();
  floor(w2.grid, 70);
  const crate = createWoodBox(50, 40);
  w2.grid.objects.push(crate);
  for (let t = 0; t < 120; t++) w2.sim.step();
  check('the same drop leaves a wooden crate intact (대조군)', w2.grid.objects.length === 1);
  check('smash threshold really is a fraction of the crate\'s', MOLOTOV_SMASH_SPEED < 9 / 3,
    `${MOLOTOV_SMASH_SPEED} vs 9 cells/tick`);
}

// 4. 불붙은 상태에서 파괴 → 불붙은 alcohol. The spill is pinned into the burning band
//    the moment it lands, and it really does catch (Fire appears over it).
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  grid.objects.push(createMolotov(50, 40));
  const broke = stepUntilGone(sim, grid, 120);
  const spillHeat = hottest(grid, ALCOHOL);
  check('a lit bottle spills BURNING alcohol', broke >= 0 && spillHeat >= 250,
    `hottest spill cell ${spillHeat.toFixed(0)}° (Alcohol autoignites at 250°)`);
  for (let t = 0; t < 40; t++) sim.step();
  check('the burning spill actually flames', count(grid, FIRE) > 0, `${count(grid, FIRE)} Fire cells`);
}

// 5. 불이 안 붙은 상태에선 그냥 alcohol. Same fall, same spill, no fire at all.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const m = createMolotov(50, 40);
  m.lit = false; // doused before it was thrown
  grid.objects.push(m);
  const broke = stepUntilGone(sim, grid, 120);
  const spillHeat = hottest(grid, ALCOHOL);
  check('an unlit bottle still spills alcohol', broke >= 0 && count(grid, ALCOHOL) > 0,
    `${count(grid, ALCOHOL)} cells`);
  check('and it is cold', spillHeat < 250, `hottest spill cell ${spillHeat.toFixed(0)}°`);
  for (let t = 0; t < 40; t++) sim.step();
  check('no fire comes of it', count(grid, FIRE) === 0, `${count(grid, FIRE)} Fire cells`);
}

// 6. 물에 빠져도 소화 — and the contrast that makes the claim mean something: a stick
//    of dynamite dropped into the SAME pond keeps its fuse burning (물 안에서는 안 꺼짐).
{
  const { grid, sim } = makeWorld();
  floor(grid, 90);
  fillRect(grid, 20, 60, 80, 90, WATER);
  const m = createMolotov(50, 40);
  grid.objects.push(m);
  let out = -1;
  for (let t = 0; t < 200; t++) {
    sim.step();
    if (grid.objects.length === 0) break;
    if (out < 0 && !m.lit) out = t;
  }
  check('a bottle that falls in water goes out', out >= 0, `out on tick ${out}`);
  check('and stays out', !m.lit && grid.objects.length === 1);
  check('and it floats rather than sinking to the bottom', m.y < 80, `y=${m.y.toFixed(1)} (bed at 90)`);
  check('its remaining fuel is kept, not spent', m.fuelTicks > MOLOTOV_FUEL_TICKS * 0.9,
    `${m.fuelTicks}/${MOLOTOV_FUEL_TICKS} ticks left`);

  const w2 = makeWorld();
  floor(w2.grid, 90);
  fillRect(w2.grid, 20, 60, 80, 90, WATER);
  const dyn = createDynamite(50, 40);
  w2.grid.objects.push(dyn);
  for (let t = 0; t < 60; t++) w2.sim.step();
  const stick = w2.grid.objects[0] as SimDynamite | undefined;
  check('the same pond does NOT put a dynamite fuse out (대조군)', stick !== undefined && stick.lit);
}

// 7. Re-light: a doused, still-fuelled bottle catches again from a flame.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const m = createMolotov(50, 62);
  m.lit = false;
  grid.objects.push(m);
  for (let t = 0; t < 20; t++) sim.step();
  check('it stays out with nothing to light it', !m.lit);
  const fuelBefore = m.fuelTicks;
  check('and burns no fuel while out', fuelBefore === MOLOTOV_FUEL_TICKS,
    `${fuelBefore}/${MOLOTOV_FUEL_TICKS}`);
  m.temp = MOLOTOV_IGNITE_TEMP + 50; // a flame touched to the wick (the 가열 브러시 path)
  sim.step();
  check('a flame lights it again', m.lit, `temp=${m.temp.toFixed(0)}°`);
}

// 8. The lit wick throws REAL Fire into the world (not art) — so a burning bottle
//    lights what it is lying against.
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  grid.objects.push(createMolotov(50, 62));
  let fire = 0;
  for (let t = 0; t < 60; t++) {
    sim.step();
    fire = Math.max(fire, count(grid, FIRE));
  }
  check('a lit wick emits real Fire particles', fire > 0, `peak ${fire} Fire cells`);
}

// 9. 15초 이상 지속 → 빈 유리병, and the regression pin that goes with it: the bottle
//    survives its OWN flame for the whole fifteen seconds (its wick's Fire must not
//    cook it off — see MOLOTOV_BURST_TEMP).
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const m = createMolotov(50, 62);
  grid.objects.push(m);
  for (let t = 0; t < MOLOTOV_FUEL_TICKS + 60; t++) {
    sim.step();
    if (grid.objects.length === 0) break;
  }
  check('it survives its own flame for the full burn', grid.objects.length === 1);
  check('after 15s the fuel is gone', m.fuelTicks === 0 && !m.lit);
  check('and it is now the empty bottle', molotovBottle(m) === 'empty');

  // Break the spent bottle: glass only, no alcohol (알콜 생성 없이 깨진 유리만).
  const alcoholBefore = count(grid, ALCOHOL);
  m.vy = 20; // hurl it at the floor
  const broke = stepUntilGone(sim, grid, 60);
  check('an empty bottle still shatters', broke >= 0, `broke on tick ${broke}`);
  check('into Broken Glass', count(grid, GLASS) > 0, `${count(grid, GLASS)} cells`);
  check('and no Alcohol at all', count(grid, ALCOHOL) === alcoholBefore,
    `${count(grid, ALCOHOL)} vs ${alcoholBefore} before`);
}

// 10. Heat far past its own flame bursts the bottle where it stands — the fuel
//     boils and the glass lets go. Driven through the body's own heat reservoir,
//     which is exactly what the 가열 브러시 and the Laser's heat ray write
//     (PointerPainter.heatObjectsWhere / footprintHazards.rayHeat).
//     The control is the point: held at 900° — hotter than ordinary Fire, which
//     is what the lit wick puts out right beside itself — the bottle is fine. That
//     is what keeps a burning molotov from bursting itself (MOLOTOV_BURST_TEMP).
{
  const hold = (deg: number, ticks: number): { survived: boolean; glass: number } => {
    const { grid, sim } = makeWorld();
    floor(grid, 70);
    const m = createMolotov(50, 62);
    grid.objects.push(m);
    for (let t = 0; t < ticks; t++) {
      if (grid.objects.length === 0) break;
      m.temp = deg; // one tick of the 가열 브러시
      sim.step();
    }
    return { survived: grid.objects.length === 1, glass: count(grid, GLASS) };
  };
  const hot = hold(1600, 60);
  check('sustained 1600° bursts the bottle', !hot.survived);
  check('leaving glass behind', hot.glass > 0, `${hot.glass} cells`);
  const warm = hold(900, 200);
  check('but 900° — hotter than its own Fire — never does (대조군)', warm.survived);
  check('and spills nothing', warm.glass === 0, `${warm.glass} cells`);
}

// 11. A blast直격 destroys it through the shared byproduct path (no special case).
{
  const { grid, sim } = makeWorld();
  floor(grid, 70);
  const m = createMolotov(50, 62);
  grid.objects.push(m);
  for (let t = 0; t < 10; t++) sim.step();
  detonate(sim.context, Math.floor(m.x), Math.floor(m.y), 0, { reach: 20, power: 6, pressure: false });
  const broke = stepUntilGone(sim, grid, 20);
  check('a blast direct hit shatters it', broke >= 0, `broke on tick ${broke}`);
  check('with the usual glass wreckage', count(grid, GLASS) > 0, `${count(grid, GLASS)} cells`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
