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
  MOLOTOV_BURST_TEMP,
} from '../src/game/engine/objects';
import type { SimDynamite } from '../src/game/engine/objects';
import { getMaterial } from '../src/game/materials/registry';
import { detonate } from '../src/game/materials/blast';
import { FUEL_BURN_TEMP } from '../src/game/materials/combustion';
import { AMBIENT_TEMP } from '../src/game/config';
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
const MOLTEN_GLASS = ID('Molten Glass');
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
/** Horizontal spread of material `id` on the grid, in cells (0 if there is none) —
 *  how far it travelled, which is what tells a thrown scatter from a heap. */
function spread(grid: Grid, id: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] !== id) continue;
    const x = i % grid.width;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi < lo ? 0 : hi - lo + 1;
}
/** Ticks for launched Debris fragments to finish their arc and deposit their
 *  cargo (LIFE_MIN..LIFE_MIN+LIFE_VAR is 9..16 ticks; see materials/debris.ts). */
const SETTLE_TICKS = 40;

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
  check('it leaves Alcohol', count(grid, ALCOHOL) > 0, `${count(grid, ALCOHOL)} cells`);
  // The shards LAUNCH, so on the break tick they are Debris in flight — no Broken
  // Glass has landed yet, and it fills in once the arcs finish. This pair shows the
  // DELAY but not the travel (a fake that withheld the glass and then dropped it in
  // place would pass it too); the spread comparison in scene 5 is what shows the
  // shards actually went somewhere.
  check('the shards are in flight on the break tick', count(grid, GLASS) === 0,
    `${count(grid, GLASS)} landed`);
  for (let t = 0; t < SETTLE_TICKS; t++) sim.step();
  check('and land as Broken Glass', count(grid, GLASS) > 0, `${count(grid, GLASS)} cells`);

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
  const spillW = spread(grid, ALCOHOL); // measured on the break tick, before it flows
  check('an unlit bottle still spills alcohol', broke >= 0 && count(grid, ALCOHOL) > 0,
    `${count(grid, ALCOHOL)} cells`);
  check('and it is cold', spillHeat < 250, `hottest spill cell ${spillHeat.toFixed(0)}°`);
  for (let t = 0; t < SETTLE_TICKS; t++) sim.step();
  check('no fire comes of it', count(grid, FIRE) === 0, `${count(grid, FIRE)} Fire cells`);
  // 사방으로 튄다: the shards land spread WIDER than the bottle that threw them,
  // while the fuel — same break, same footprint, spawned in place — starts out no
  // wider than the bottle itself. One flies, one doesn't.
  const glassW = spread(grid, GLASS);
  check('the shards scatter wider than the bottle', glassW > spillW,
    `glass ${glassW} cells vs the spill's ${spillW}`);
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
  check('and no Alcohol at all', count(grid, ALCOHOL) === alcoholBefore,
    `${count(grid, ALCOHOL)} vs ${alcoholBefore} before`);
  for (let t = 0; t < SETTLE_TICKS; t++) sim.step(); // let the thrown shards land
  check('into Broken Glass', count(grid, GLASS) > 0, `${count(grid, GLASS)} cells`);
}

// 10. Heat at glass's own melting point MELTS the bottle where it stands, and that
//     is a different ending from every other one: it does NOT throw Broken Glass.
//     A bottle at GLASS_MELT_TEMP is glass at the temperature glass runs at, so it
//     leaves MOLTEN GLASS and ALCOHOL in EQUAL amounts (알콜과 녹은 유리를 동일한 양),
//     poured in place. Shards would only re-melt where they landed anyway.
//
//     The control is the point, and getting it to actually PROVE the point took
//     two goes. What has to be shown is the guarantee MOLOTOV_BURST_TEMP is placed
//     to give: a bottle sitting in heat *hotter than the Fire its own wick emits*
//     (fire.ts pins its cells at 1000°) still doesn't give way, so a burning molotov
//     can never burst itself. A control below 1000° would only show the weaker
//     "cooler than my own flame is safe".
//
//     The temperature is therefore applied to the SURROUNDING CELLS, not by
//     assigning the body's `temp` reservoir. Writing the reservoir directly does
//     not hold: evaluateTriggers relaxes it before it computes the heat it judges
//     by, so a reservoir stamped at 1050° each tick in ~20° air is compared at
//     rather less than that — under Fire's 1000°, i.e. not testing the claim at
//     all. A cell bath enters through `exp.maxTemp`, which is read fresh with no
//     relaxation.
//
//     What makes the control *bite* rather than merely pass is the pair of holds
//     under it. The bath is applied to air, and air no longer conducts into a body
//     at all (the reservoir only trades with matter it touches — see
//     scanBodyExposure), so the reservoir is no longer evidence of anything here
//     and asking it "are you past 1000°?" would now fail for a reason that has
//     nothing to do with the claim. The claim is about the temperature the bottle
//     is JUDGED at, so it is tested where it lives: the same bath at
//     MOLOTOV_BURST_TEMP melts the bottle and at 1050° it does not. That is the
//     boundary itself, one hundred degrees wide, and it proves both halves at once
//     — the bath really does reach the bottle, and 1050° really is not enough.
{
  /** Hold the body in a `deg` bath for `ticks` ticks. Only EMPTY cells are heated
   *  — the stone floor is left alone, since at 1600° it would melt and change the
   *  scene out from under the measurement.
   *
   *  Byproducts are counted the tick the body goes, NOT after settling: molten
   *  glass is a liquid that flows and freezes back into panes, and alcohol in a
   *  1600° bath burns off within a few ticks, so anything measured later is
   *  measuring the fire, not the bottle. */
  const hold = (
    deg: number,
    ticks: number,
  ): {
    survived: boolean;
    shards: number;
    molten: number;
    alcohol: number;
  } => {
    const { grid, sim } = makeWorld();
    floor(grid, 70);
    const m = createMolotov(50, 62);
    grid.objects.push(m);
    const BATH = 10; // cells around the body, comfortably past its 7-cell reach
    let shards = 0;
    let molten = 0;
    let alcohol = 0;
    for (let t = 0; t < ticks; t++) {
      for (let y = Math.floor(m.y) - BATH; y <= Math.floor(m.y) + BATH; y++) {
        for (let x = Math.floor(m.x) - BATH; x <= Math.floor(m.x) + BATH; x++) {
          if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
          if (grid.cells[grid.idx(x, y)] !== 0) continue; // air only — never the floor
          grid.setTemp(x, y, deg);
        }
      }
      sim.step();
      if (grid.objects.length === 0) {
        shards = count(grid, GLASS);
        molten = count(grid, MOLTEN_GLASS);
        alcohol = count(grid, ALCOHOL);
        break;
      }
    }
    return { survived: grid.objects.length === 1, shards, molten, alcohol };
  };
  const hot = hold(1600, 60);
  check('a sustained 1600° bath melts the bottle open', !hot.survived);
  check('leaving molten glass', hot.molten > 0, `${hot.molten} cells`);
  check('and alcohol', hot.alcohol > 0, `${hot.alcohol} cells`);
  check(
    '알콜과 녹은 유리를 동일한 양 — the two come out equal',
    Math.abs(hot.molten - hot.alcohol) <= 1,
    `${hot.molten} molten glass vs ${hot.alcohol} alcohol`,
  );
  check(
    'and NOT as flying shards — a melted bottle has no shards to throw',
    hot.shards === 0,
    `${hot.shards} Broken Glass cells`,
  );

  // Two properties of the puddle the counts above cannot see, both of which a
  // player hit at once: what came out of a Blue Flame read as 고체 유리, never
  // 녹은 유리. The counts stayed green through it because they are read on the melt
  // tick itself, before a single tick of heat diffusion.
  //
  // 1. THE FUEL IS BORN ALIGHT. `spawn` resets a cell to its material's own initial
  //    temperature, which for Alcohol is room temperature — so a 20° sink sat
  //    against every 1400° Molten Glass cell. Reaching this path means the bottle
  //    sat at GLASS_MELT_TEMP or above long enough to run, so its contents were in
  //    that same fire; room-temperature fuel was never right.
  // 2. THE GLASS POOLS AT THE BOTTOM. The two halves used to be shuffled together,
  //    which left every glass cell isolated, and a lone hot cell sheds heat far
  //    faster than a pool. It was backwards physically too: molten glass has
  //    density 5 against alcohol's 1.9.
  //
  // What this scene does NOT claim: that the puddle stays molten for long. Measured
  // against a plain 25-cell Molten Glass puddle dropped on the same cold floor with
  // no bottle involved, the game's own baseline is 13 of 25 still molten after 10
  // ticks and 1 after 20 — molten glass sets fast here, and that is a property of
  // Molten Glass, not of the bottle.
  {
    const { grid, sim } = makeWorld();
    floor(grid, 70);
    const m = createMolotov(50, 62);
    grid.objects.push(m);
    let fuelTemps: number[] = [];
    const glassTemps: number[] = [];
    let glassY = 0;
    let fuelY = 0;
    for (let t = 0; t < 200; t++) {
      for (let y = Math.floor(m.y) - 10; y <= Math.floor(m.y) + 10; y++)
        for (let x = Math.floor(m.x) - 10; x <= Math.floor(m.x) + 10; x++) {
          if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
          if (grid.cells[grid.idx(x, y)] !== 0) continue;
          grid.setTemp(x, y, 1600);
        }
      sim.step();
      if (grid.objects.length === 0) {
        let gn = 0;
        let fn = 0;
        for (let y = 0; y < grid.height; y++)
          for (let x = 0; x < grid.width; x++) {
            const i = grid.idx(x, y);
            if (grid.cells[i] === MOLTEN_GLASS) { glassY += y; gn++; glassTemps.push(grid.temp[i]); }
            else if (grid.cells[i] === ALCOHOL) { fuelY += y; fn++; fuelTemps.push(grid.temp[i]); }
          }
        glassY /= gn || 1;
        fuelY /= fn || 1;
        break;
      }
    }
    check(
      '쏟아진 알콜은 불붙은 채로 나온다 — the fuel a melted bottle spills is already alight',
      fuelTemps.length > 0 && Math.min(...fuelTemps) >= FUEL_BURN_TEMP - 1,
      `coldest fuel cell ${Math.min(...fuelTemps).toFixed(0)}° (room temperature would be ${AMBIENT_TEMP}°, and it sat against 1400° glass)`,
    );
    check(
      '웅덩이는 자기를 녹인 불의 온도로 태어난다 — the pool inherits the heat that melted it',
      Math.max(...glassTemps) > 1450,
      `hottest glass cell ${Math.max(...glassTemps).toFixed(0)}° in a 1600° bath (Molten Glass's own birth temperature is 1400°)`,
    );
    check(
      '녹은 유리는 알콜 아래에 고인다 — the denser glass pools under the fuel',
      glassY > fuelY,
      `glass mean y ${glassY.toFixed(1)} vs fuel ${fuelY.toFixed(1)} (density 5 vs 1.9; y grows down)`,
    );
  }

  // The control sits above Fire's 1000° and below the melting point, which is now
  // the same number as glass's own — so this is simultaneously "its own flame can
  // never do it" and "it gives way exactly when glass does".
  const warm = hold(1050, 200);
  check("a 1050° bath — hotter than Fire's own 1000° — still never gives way (대조군)",
    warm.survived, `melting point is ${MOLOTOV_BURST_TEMP}°`);
  check('and spills nothing', warm.molten + warm.alcohol + warm.shards === 0);
  // The other side of that same boundary: one hundred degrees up, on the exact
  // number, the identical bath does melt it. Without this the control above would
  // pass just as well if the bath never reached the bottle at all.
  const atPoint = hold(MOLOTOV_BURST_TEMP, 200);
  check('while the same bath at the melting point itself does melt it',
    !atPoint.survived, `${MOLOTOV_BURST_TEMP}°`);
  check('and that one really does pour (녹은 유리 + 알콜)',
    atPoint.molten > 0 && atPoint.alcohol > 0,
    `${atPoint.molten} molten glass, ${atPoint.alcohol} alcohol`);
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
  for (let t = 0; t < SETTLE_TICKS; t++) sim.step(); // let the thrown shards land
  check('with the usual glass wreckage', count(grid, GLASS) > 0, `${count(grid, GLASS)} cells`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
