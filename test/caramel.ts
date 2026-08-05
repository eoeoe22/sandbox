// Headless behavioural harness for 캐러멜 (Caramel) — the state Sugar passes
// through on its way to being either a solid you built or a ruin you burnt.
//
// The material exists to turn one line of prose into something you can watch.
// sugar.ts used to send a heated grain straight to Ash while claiming in a
// comment that it "caramelised and then charred"; now that sentence is two
// thresholds and two materials, and this file is what stops either half from
// quietly collapsing back into the other:
//
//   Sugar --160°--> Caramel --250°--> Ash
//
// Three things here fail silently rather than throwing, which is why each gets a
// scene of its own:
//
//   • **The chain has a middle.** If CARAMELIZE_TEMP ever drifted above
//     CARBONIZE_TEMP, or the caramelise branch were re-pointed at Ash, heating
//     sugar would still "work" — it would just skip the interesting state. So
//     scene 1 heats a bed to a temperature that is past sugar's threshold and
//     *under* caramel's, and demands both that caramel appears and that no Ash
//     does.
//   • **Two states, one id.** Hot caramel flows; cold caramel is a solid you can
//     build with. That is `freeze` plus a temperature gate in the update, and it
//     is reversible — the check that actually matters is that a set slab starts
//     flowing again when reheated, because a one-way set would be a much duller
//     material and nothing else would notice.
//   • **The whole pipeline.** Scene 4 runs the player's actual recipe end to end
//     — a sugar pile over a niter bed with heat under it — and asks only for
//     propellant at the far end. rocketcandy.ts pins the reaction's gates
//     precisely; this one pins that the gates are reachable *by cooking*, which
//     is the part a tuning change to any single threshold would break.
//
// Run: `node test/run-caramel.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { STONE } from '../src/game/materials/stone';
import { ASH } from '../src/game/materials/ash';
import { SUGAR } from '../src/game/materials/sugar';
import { CARAMEL } from '../src/game/materials/caramel';
import { SALTPETER } from '../src/game/materials/saltpeter';
import { ROCKET_CANDY } from '../src/game/materials/rocketcandy';
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

function makeWorld(w: number, h: number): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function floor(grid: Grid, y: number): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, yy)] = STONE.id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** A rectangle of `id` at `temp`. */
function block(
  grid: Grid,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  id: number,
  temp: number,
): number {
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      grid.set(x, y, id);
      grid.setTemp(x, y, temp);
      n++;
    }
  return n;
}
/** Hold every cell of one of `ids` in the window at `temp` — the burner under the
 *  pan. Heat has to be *maintained* for any of this: a pour left alone gives its
 *  warmth to the floor and the air within a few dozen ticks, which is the whole
 *  point of scene 3 but would stall scenes 1, 2 and 4 halfway. */
function hold(grid: Grid, ids: number[], temp: number): void {
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      if (ids.includes(grid.get(x, y))) grid.setTemp(x, y, temp);
    }
}
/** Every cell holding `id`, as "x,y" keys — for asking whether a slab moved. */
function cellsOf(grid: Grid, id: number): Set<string> {
  const s = new Set<string>();
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) if (grid.get(x, y) === id) s.add(`${x},${y}`);
  return s;
}
function sameCells(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}
/** Horizontal extent of `id`, i.e. how far a pour has spread. */
function spread(grid: Grid, id: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.get(x, y) === id) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
  return hi < lo ? 0 : hi - lo + 1;
}

// 1. 설탕 --160°--> 캐러멜. A sugar bed held at 200° — past sugar's caramelisation
//    point, comfortably under caramel's own charring point — melts into caramel
//    and *stops there*. The Ash count is the real assertion: it is what tells the
//    two thresholds apart, and it is 0 or the chain has no middle.
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 36);
  const grains = block(grid, 10, 30, 30, 36, SUGAR.id, 200);

  for (let t = 0; t < 200; t++) {
    hold(grid, [SUGAR.id, CARAMEL.id], 200);
    sim.step();
  }
  // Every grain, not most of them — the count is the mass check too. Melting a
  // bed used to lose a third of it: molten caramel percolated into the grains
  // beneath it, and the write that melted one of *those* grains turned its host
  // into a liquid, which cannot hold an occupant, so the caramel soaked into it
  // was deleted (see sugar.ts's `liquidOverlap`). A pan of sugar has to weigh
  // what the sugar weighed.
  check(
    '200°로 가열한 설탕은 남김없이 캐러멜이 된다',
    count(grid, CARAMEL.id) === grains,
    `${count(grid, CARAMEL.id)}/${grains} melted`,
  );
  check(
    '…그리고 곧바로 재가 되지는 않는다 (사슬에 중간 단계가 있다)',
    count(grid, ASH.id) === 0 && count(grid, SUGAR.id) < grains * 0.1,
    `${count(grid, ASH.id)} ash, ${count(grid, SUGAR.id)} sugar left`,
  );
}

// 2. 캐러멜 --250°--> 재. Cook the same melt too far and it chars. Held at 270°,
//    which is past the charring point and still under the 300° at which it would
//    catch fire instead — burning is a different path with a different product,
//    and this scene is about the one that doesn't need a flame.
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 36);
  const cells = block(grid, 10, 30, 30, 36, CARAMEL.id, 270);

  for (let t = 0; t < 200; t++) {
    hold(grid, [CARAMEL.id], 270);
    sim.step();
  }
  check(
    '270°까지 올리면 캐러멜은 새까맣게 타서 재가 된다',
    count(grid, ASH.id) > cells * 0.9,
    `${count(grid, ASH.id)}/${cells} charred`,
  );
}

// 3. Two states, one id — and reversible. A hot pour left alone on cold stone
//    gives up its heat, stops where it is, and stays there; put the heat back and
//    the same cells run again. The "stays there" half is checked by comparing the
//    exact cell set across another 200 ticks rather than by a count, since a slab
//    that is still creeping one cell every few ticks would pass any count.
{
  const { grid, sim } = makeWorld(60, 40);
  floor(grid, 36);
  const cells = block(grid, 28, 32, 28, 36, CARAMEL.id, 180);

  for (let t = 0; t < 400; t++) sim.step();
  const settled = cellsOf(grid, CARAMEL.id);
  const width = spread(grid, CARAMEL.id);
  let hottest = -Infinity;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.get(x, y) === CARAMEL.id) hottest = Math.max(hottest, grid.getTemp(x, y));
  check(
    '식은 캐러멜은 120° 아래로 떨어져 있다',
    hottest < 120,
    `hottest cell ${hottest.toFixed(1)}°`,
  );
  check(
    '…굳은 뒤에는 한 칸도 움직이지 않는다',
    settled.size === cells && sameCells(settled, (sim.step(), cellsOf(grid, CARAMEL.id))),
    `${settled.size}/${cells} cells`,
  );
  for (let t = 0; t < 200; t++) sim.step();
  check(
    '…200틱을 더 돌려도 그대로다 (고체처럼 군다)',
    sameCells(settled, cellsOf(grid, CARAMEL.id)),
    `spread ${spread(grid, CARAMEL.id)} vs ${width}`,
  );

  // Put the pan back on the heat: the same slab melts and runs.
  for (let t = 0; t < 400; t++) {
    hold(grid, [CARAMEL.id], 200);
    sim.step();
  }
  check(
    '다시 데우면 굳은 캐러멜이 도로 흐른다',
    spread(grid, CARAMEL.id) > width,
    `spread ${spread(grid, CARAMEL.id)} vs ${width} when set`,
  );
}

// 4. The player's recipe, end to end, with nothing painted that isn't an
//    ingredient: a sugar pile sitting on a niter bed, over a heat source. The
//    sugar melts, the melt runs down into the grains, and the grains take it up
//    as propellant. Every threshold in the chain has to line up for a single
//    grain of candy to exist here.
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 36);
  block(grid, 12, 28, 32, 36, SALTPETER.id, 20);
  const sugar = block(grid, 12, 28, 28, 32, SUGAR.id, 200);

  for (let t = 0; t < 300; t++) {
    hold(grid, [SUGAR.id, CARAMEL.id], 200);
    sim.step();
  }
  check(
    '설탕 더미를 가열해 초석 위에 흘려 넣으면 로켓 캔디가 나온다',
    count(grid, ROCKET_CANDY.id) > sugar * 0.5,
    `${count(grid, ROCKET_CANDY.id)} candy from ${sugar} sugar`,
  );
  check(
    '…그 과정에서 재는 생기지 않는다 (200°는 탄화점 아래다)',
    count(grid, ASH.id) === 0,
    `${count(grid, ASH.id)} ash`,
  );
}

console.log(failures === 0 ? '\nAll 캐러멜 checks passed.' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
