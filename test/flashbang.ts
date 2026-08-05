// Headless behavioural harness for the flashbang object (engine/objects.ts
// stepFlashbang / detonateFlashbang). The four claims the object makes, in order
// of how badly a regression would hurt:
//
//   1. It is SILENT until it goes off. No fuse flame, no smoke, no flash, nothing
//      on the grid at all for three seconds (기획: 터지기 전까지 도화선 효과 없게) —
//      this is the whole thing that separates it from the dynamite, and it is the
//      one property nothing else in the engine enforces.
//   2. Then it flashes: white Flash cells (materials/flash.ts), not the ordinary
//      orange BLAST shell, and they are gone again moments later leaving no fire.
//   3. The flash BREAKS nothing (파괴력 6, below every durability) but SHOVES the
//      loose matter around it, mass-conservingly.
//   4. 열·폭발·끼임 set it off early — heat cook-off, and a real blast reaching it.
//
// Run: `node test/run-flashbang.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import {
  createFlashbang,
  createDynamite,
  FLASHBANG_FUSE_TICKS,
  FLASHBANG_RADIUS,
  FLASHBANG_HALF_LENGTH,
} from '../src/game/engine/objects';
import { FLASHBANG_SPRITE_W, FLASHBANG_SPRITE_H } from '../src/game/render/flashbangSprite';
import { getMaterial } from '../src/game/materials/registry';
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
Math.random = mulberry32(1109);

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
const SAND = ID('Sand');
const WOOD = ID('Wood');
const FLASH = ID('Flash');
const BLAST = ID('Blast');
const FIRE = ID('Fire');
const SMOKE = ID('Smoke');

function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Cells of `id` inside the rect [x0,x1]×[y0,y1]. */
function countIn(grid: Grid, id: number, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (grid.cells[grid.idx(x, y)] === id) n++;
  }
  return n;
}
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid.cells[grid.idx(x, y)] = id;
}
/** A bare room with a stone floor at y≥100. */
function makeRoom(): { grid: Grid; sim: Simulation } {
  const grid = new Grid(140, 140);
  const sim = new Simulation(grid);
  fill(grid, 0, 100, 139, 139, STONE);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  return { grid, sim };
}

// 1. The headline: three seconds of nothing, then the flash.
{
  const { grid, sim } = makeRoom();
  grid.objects.push(createFlashbang(70, 90));
  // Every tick of the countdown: the can is still there and the grid is exactly as
  // empty of effects as it was before it was thrown. Checked EVERY tick, not just
  // at the end — a one-tick puff of anything would be a regression.
  let dirtied = 0;
  for (let i = 0; i < FLASHBANG_FUSE_TICKS - 1; i++) {
    sim.step();
    if (count(grid, FLASH) + count(grid, BLAST) + count(grid, FIRE) + count(grid, SMOKE) > 0) {
      dirtied++;
    }
  }
  check('도화선 효과 없음 — nothing at all is emitted while the timer runs', dirtied === 0, `${dirtied} dirty ticks of ${FLASHBANG_FUSE_TICKS - 1}`);
  check('and the can is still sitting there', grid.objects.length === 1);

  sim.step(); // the tick the countdown hits zero
  const flash = count(grid, FLASH);
  check('at 3s it flashes', flash > 100, `${flash} Flash cells`);
  check('the can is spent and gone', grid.objects.length === 0);
  check('it is a FLASH, not an orange shockwave shell', count(grid, BLAST) === 0, `${count(grid, BLAST)} Blast cells`);

  // The light is over almost before you see it, and leaves no fire behind (which
  // is the difference between 번쩍 and 불타오른다). Flash cells carry a ~7-tick life
  // but only tick while their tile is active, so the last few of a wide disc take
  // a while to be swept up — hence the generous window rather than a tight one.
  for (let i = 0; i < 150; i++) sim.step();
  check('the light dies out on its own', count(grid, FLASH) === 0, `${count(grid, FLASH)} Flash cells left`);
  check('and drops no fire', count(grid, FIRE) === 0, `${count(grid, FIRE)} Fire cells`);
}

// 2. 파괴력 6: it cannot crack anything. A stone slab and a wooden beam right up
//    against the can come through the flash untouched.
{
  const { grid, sim } = makeRoom();
  fill(grid, 40, 80, 60, 95, STONE);
  fill(grid, 80, 80, 100, 95, WOOD);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const stoneBefore = count(grid, STONE);
  const woodBefore = count(grid, WOOD);
  grid.objects.push(createFlashbang(70, 88));
  for (let i = 0; i < FLASHBANG_FUSE_TICKS + 40; i++) sim.step();
  check('stone is untouched by the flash', count(grid, STONE) === stoneBefore, `${stoneBefore} → ${count(grid, STONE)}`);
  check('so is timber', count(grid, WOOD) === woodBefore, `${woodBefore} → ${count(grid, WOOD)}`);
}

// 3. …but it SHOVES. A sand bed under the can is heaved aside — and every grain
//    of it is still in the world afterwards (the shove is mass-conserving Debris,
//    not destruction).
{
  const { grid, sim } = makeRoom();
  fill(grid, 50, 92, 90, 99, SAND);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  grid.objects.push(createFlashbang(70, 88));
  // Let it land and the bed settle, then take the baseline right before the flash.
  for (let i = 0; i < FLASHBANG_FUSE_TICKS - 5; i++) sim.step();
  const sandBefore = count(grid, SAND);
  const underBefore = countIn(grid, SAND, 62, 92, 78, 99);
  for (let i = 0; i < 200; i++) sim.step(); // flash, then let the debris land
  const underAfter = countIn(grid, SAND, 62, 92, 78, 99);
  check('loose sand under the can is heaved aside', underAfter < underBefore, `${underBefore} → ${underAfter} grains under the epicenter`);
  check('and not one grain is destroyed', count(grid, SAND) === sandBefore, `${sandBefore} → ${count(grid, SAND)}`);
}

// 4. 열: sustained heat cooks it off long before its own timer, by either of the
//    two routes heat reaches a body — the 가열 브러시 writing the body's own
//    reservoir (which works even in mid-air), and hot surroundings conducting in.
//
//    NOT tested with a lava pool, deliberately: the can is denser than water but
//    lighter than lava, so it floats ON a lava pond with its footprint clear of it
//    and never gets hot — which is the buoyancy layer working correctly, not a
//    flashbang bug, and is true of the smoke bomb and the dynamite too.
{
  const { grid, sim } = makeRoom();
  const can = createFlashbang(70, 90);
  grid.objects.push(can);
  for (let i = 0; i < 5; i++) sim.step(); // let it land
  can.temp = 600; // 가열 브러시
  let popped = -1;
  for (let i = 0; i < FLASHBANG_FUSE_TICKS; i++) {
    sim.step();
    if (grid.objects.length === 0) {
      popped = i;
      break;
    }
  }
  check('the 가열 브러시 cooks it off early', popped >= 0 && popped < FLASHBANG_FUSE_TICKS / 2, `went off at tick ${popped} of ${FLASHBANG_FUSE_TICKS}`);
}
{
  const { grid, sim } = makeRoom();
  const can = createFlashbang(70, 90);
  grid.objects.push(can);
  let popped = -1;
  for (let i = 0; i < FLASHBANG_FUSE_TICKS; i++) {
    // A bath of hot surroundings held around the can, the way a fire under it
    // would: cells the footprint overlaps, re-held each tick against diffusion.
    for (let y = Math.floor(can.y) - 5; y <= Math.floor(can.y) + 5; y++) {
      for (let x = Math.floor(can.x) - 3; x <= Math.floor(can.x) + 3; x++) {
        grid.temp[grid.idx(x, y)] = 800;
      }
    }
    sim.step();
    if (grid.objects.length === 0) {
      popped = i;
      break;
    }
  }
  check('so does a hot bath around it', popped >= 0 && popped < FLASHBANG_FUSE_TICKS / 2, `went off at tick ${popped} of ${FLASHBANG_FUSE_TICKS}`);
}

// 5. 폭발: a real blast reaching a can sets it off, whatever its timer says. The
//    stick's own fuse is shortened by hand so the test doesn't ride its random
//    3–5s roll, and the can's is stretched so the ONLY thing that can end it is
//    the dynamite.
{
  const { grid, sim } = makeRoom();
  const can = createFlashbang(70, 90);
  can.fuseTicks = 100_000;
  grid.objects.push(can);
  const stick = createDynamite(80, 90);
  stick.fuseTicks = 20;
  grid.objects.push(stick);
  // Sampled the tick the last body goes, not at the end: the flash is a ~7-tick
  // light, so by tick 60 it would be long over and the check would prove nothing.
  let flashAtEnd = 0;
  for (let i = 0; i < 60; i++) {
    sim.step();
    if (grid.objects.length === 0) {
      flashAtEnd = count(grid, FLASH);
      break;
    }
  }
  check('a blast sets a flashbang off (연쇄)', grid.objects.length === 0, `${grid.objects.length} bodies left`);
  check('…and it really was the flash, not just the stick', flashAtEnd > 0, `${flashAtEnd} Flash cells`);
}

// 6. 끼임: a can entombed in solid stone is crushed, and a crushed charge goes off
//    rather than being quietly deleted.
{
  const { grid, sim } = makeRoom();
  fill(grid, 40, 40, 100, 90, STONE);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const can = createFlashbang(70, 65);
  can.fuseTicks = 100_000; // only the crush can end it
  grid.objects.push(can);
  for (let i = 0; i < 30; i++) sim.step();
  check('being crushed sets it off too', grid.objects.length === 0, `${grid.objects.length} bodies left`);
}

// 7. Art and physics agree. The capsule box is 2·radius × 2·(halfLength+radius)
//    cells and the sprite is drawn at 2 sprite px per cell, so the two aspect
//    ratios must match exactly or the can renders outside the shape it collides
//    with (see the create-svg-assets skill, §3).
{
  const boxW = 2 * FLASHBANG_RADIUS;
  const boxH = 2 * (FLASHBANG_HALF_LENGTH + FLASHBANG_RADIUS);
  check(
    'sprite and collision box share one aspect ratio',
    boxW * FLASHBANG_SPRITE_H === boxH * FLASHBANG_SPRITE_W,
    `${boxW}×${boxH} cells vs ${FLASHBANG_SPRITE_W}×${FLASHBANG_SPRITE_H} px`,
  );
}

console.log(failures === 0 ? '\nAll flashbang checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
