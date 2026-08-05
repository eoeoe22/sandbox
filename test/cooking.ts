// Headless behavioural harness for the 요리 line — Flour/Batter/Bread, the
// Raw→Cooked→Burnt Meat grill, and the Corn Kernel→Popcorn pop.
//
// Three of the mechanisms here fail *silently* — the material still works, it
// just quietly stops being the thing it was designed to be — so each gets a
// scene whose assertion is the distinction rather than the outcome:
//
//   • **Flour's whole identity is a contradiction.** A heap must not burn and a
//     cloud must explode, and both halves ride on one gate (`isSuspended`,
//     dustexplosion.ts). Break the gate in either direction and flour still
//     "works": it just becomes either an ordinary fuel or an inert powder. So
//     scene 1 runs the *same* grains as a heap and as a cloud at the *same*
//     temperature and demands opposite answers.
//   • **Bread has an inside.** Crust vs crumb is decided once, at the tick each
//     cell bakes (batter.ts `bakeCrustAux`), and it is stored in an aux byte
//     nothing else reads. A loaf that came out all-crust would look plausible in
//     every screenshot; only a count tells you the middle went missing.
//   • **The two leaveners are supposed to differ.** Soda is instant and modest,
//     yeast is slow and larger. If the ferment ever stopped climbing, or the
//     rise stopped reading the leaven level, both would still bake into bread —
//     just into the same amount of it. Scene 4 bakes plain, soda and
//     fully-proofed dough from one recipe and demands the three come out in
//     order.
//
// The meat and popcorn scenes are ordinary threshold checks by comparison, with
// one exception worth its own run: a kernel with something directly overhead
// must puff *in place* rather than expanding, because the expansion is the only
// place in this line that creates cells and "a sealed pot cannot double" is what
// keeps that bounded.
//
// Run: `node test/run-cooking.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { STONE } from '../src/game/materials/stone';
import { WALL } from '../src/game/materials/wall';
import { IRON } from '../src/game/materials/iron';
import { COAL } from '../src/game/materials/coal';
import { WATER } from '../src/game/materials/water';
import { FIRE } from '../src/game/materials/fire';
import { ASH } from '../src/game/materials/ash';
import { SODA } from '../src/game/materials/soda';
import { YEAST } from '../src/game/materials/yeast';
import { FLOUR } from '../src/game/materials/flour';
import { BATTER } from '../src/game/materials/batter';
import { BREAD } from '../src/game/materials/bread';
import { RAW_MEAT } from '../src/game/materials/rawmeat';
import { COOKED_MEAT } from '../src/game/materials/cookedmeat';
import { BURNT_MEAT } from '../src/game/materials/burntmeat';
import { CORN_KERNEL } from '../src/game/materials/cornkernel';
import { POPCORN } from '../src/game/materials/popcorn';
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
Math.random = mulberry32(0xf100d);

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
/** A rectangle of `id` at `temp`; returns how many cells it painted. */
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
/** Hold every cell of one of `ids` at `temp` — the burner under the pan. Heat has
 *  to be *maintained*: left alone a hot bed gives its warmth to the floor and the
 *  air within a few dozen ticks. */
function hold(grid: Grid, ids: number[], temp: number): void {
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      if (ids.includes(grid.get(x, y))) grid.setTemp(x, y, temp);
    }
}
/** How many cells of `id` carry each aux value. */
function auxHistogram(grid: Grid, id: number): Map<number, number> {
  const h = new Map<number, number>();
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.get(x, y) === id) {
        const a = grid.getAux(x, y);
        h.set(a, (h.get(a) ?? 0) + 1);
      }
  return h;
}
function maxAux(grid: Grid, id: number): number {
  let m = -1;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.get(x, y) === id) m = Math.max(m, grid.getAux(x, y));
  return m;
}

console.log('— 밀가루 (Flour) —');

// 1. 더미 vs 구름. The same powder, the same temperature, opposite answers. 400°
//    is over the 350° flash point on purpose: a *cloud* at this temperature goes
//    off with no igniter at all, so a heap that merely chars is the suspension
//    gate doing the only job it has. The Fire count is the real assertion —
//    charring to Ash is expected and correct (heat alone browns flour), catching
//    fire is not.
{
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  const heap = block(grid, 20, 40, 44, 50, FLOUR.id, 400);
  for (let t = 0; t < 120; t++) {
    hold(grid, [FLOUR.id], 400);
    sim.step();
  }
  check(
    '400°로 달군 밀가루 더미는 불이 붙지 않는다',
    count(grid, FIRE.id) === 0,
    `${count(grid, FIRE.id)} fire cells from ${heap} grains`,
  );
  check(
    '…대신 그냥 새까맣게 타서 재가 된다',
    count(grid, ASH.id) > heap * 0.8,
    `${count(grid, ASH.id)}/${heap} charred`,
  );
}

// 2. …and the same grains hanging in the air are a bomb. A loose lattice with
//    nothing under any grain, lit by one lick of flame, the way a Fan leaves a
//    heap it has blown apart. Started high above the floor because the cloud is
//    falling the whole time and a grain that lands is a heap again.
{
  const { grid, sim } = makeWorld(80, 80);
  floor(grid, 76);
  for (let y = 20; y < 35; y++)
    for (let x = 30; x < 50; x++) if ((x + y) % 2 === 0) grid.set(x, y, FLOUR.id);
  const cloud = count(grid, FLOUR.id);
  grid.set(41, 27, FIRE.id);
  for (let t = 0; t < 35; t++) sim.step();
  check(
    '공중에 흩날린 밀가루 구름은 불씨 하나로 폭발한다',
    count(grid, FLOUR.id) < cloud * 0.5,
    `${count(grid, FLOUR.id)}/${cloud} grains left`,
  );
  check(
    '…그리고 터진 자리에 재를 조금 남긴다',
    count(grid, ASH.id) > 0,
    `${count(grid, ASH.id)} ash from ${cloud} grains`,
  );
}

console.log('— 반죽 · 빵 (Batter / Bread) —');

// 3. 밀가루 + 물 → 반죽, and the cell count is the mass check: one grain and one
//    water cell make *two* cells of dough, so an equal bed of each must come out
//    as exactly that many cells of batter with neither reagent left over.
{
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  const flour = block(grid, 20, 40, 38, 44, FLOUR.id, 20);
  const water = block(grid, 20, 40, 44, 50, WATER.id, 20);
  for (let t = 0; t < 300; t++) sim.step();
  check(
    '밀가루에 물을 부으면 반죽이 된다',
    count(grid, BATTER.id) > (flour + water) * 0.9,
    `${count(grid, BATTER.id)}/${flour + water} cells of dough`,
  );
  check(
    '…그리고 밀가루도 물도 거의 남지 않는다',
    count(grid, FLOUR.id) < flour * 0.1 && count(grid, WATER.id) < water * 0.1,
    `${count(grid, FLOUR.id)} flour, ${count(grid, WATER.id)} water left`,
  );
  // The one that actually caught a bug, and the reason it is a separate check:
  // the reaction is conservative by construction (1+1 → 2), so any shortfall is
  // mass leaking somewhere else entirely. It was — flour is *lighter* than water,
  // and canOverlapAt admits a lighter powder as a host regardless of its
  // `liquidOverlap` coefficient, so grains soaked up water invisibly and that
  // water was destroyed the moment the grain turned into a Liquid (see
  // flour.ts's `overlapFluids`). Measured 203/240 before the fix. Counting the
  // three materials together is what makes the leak visible at all — every
  // individual count above still looked reasonable while it was happening.
  const conserved = count(grid, BATTER.id) + count(grid, FLOUR.id) + count(grid, WATER.id);
  check(
    '…반죽을 만드는 동안 물질이 사라지지 않는다 (질량 보존)',
    conserved === flour + water,
    `${conserved}/${flour + water} cells accounted for`,
  );
}

// 3b. …and the dough never inherits state from the water it was made of. Water is
//     a conductor and parks its post-spark refractory countdown in `aux` while
//     still being Water (water.ts); Batter reads that same byte's low three bits
//     as its leaven level. While the recipe was a `reactions` row this collided
//     silently — `applyReaction` transforms with `sim.set`, which keeps `aux` —
//     and dough mixed beside a live wire came out pre-risen at up to soda's own
//     level with nothing added to it (17 of 34 cells at level 2-3). The symptom
//     is invisible in every other check: the dough looks right, bakes right, and
//     simply rises when it should not.
{
  const { grid, sim } = makeWorld(30, 30);
  floor(grid, 26);
  block(grid, 10, 20, 22, 24, FLOUR.id, 20);
  block(grid, 10, 20, 24, 26, WATER.id, 20);
  for (let t = 0; t < 200; t++) {
    // Re-stamp the refractory every tick, as a wire live in the pool would.
    for (let y = 0; y < 30; y++)
      for (let x = 0; x < 30; x++) if (grid.get(x, y) === WATER.id) grid.setAux(x, y, 3);
    sim.step();
  }
  const leavened = [...auxHistogram(grid, BATTER.id)]
    .filter(([a]) => (a & 0b111) > 0)
    .reduce((n, [, c]) => n + c, 0);
  check(
    '전기가 흐르던 물로 반죽해도 저절로 부풀지 않는다',
    leavened === 0,
    `${leavened} cells born pre-leavened of ${count(grid, BATTER.id)}`,
  );
}

// 4. 굽기, and the crust/crumb split. A deep body of dough on a hot floor: the
//    faces that met air while baking must be crust (aux 0) and the middle, walled
//    in by dough the whole time, must be crumb (aux 1). An all-crust loaf would
//    look perfectly normal and is exactly the failure this catches.
{
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  const dough = block(grid, 20, 40, 38, 50, BATTER.id, 200);
  for (let t = 0; t < 400; t++) {
    hold(grid, [BATTER.id, BREAD.id], 200);
    sim.step();
  }
  const baked = count(grid, BREAD.id);
  const hist = auxHistogram(grid, BREAD.id);
  const crust = hist.get(0) ?? 0;
  const crumb = hist.get(1) ?? 0;
  check(
    '120° 이상에서 반죽은 빵으로 구워진다',
    baked > dough * 0.9,
    `${baked}/${dough} baked`,
  );
  check(
    '…껍질과 속살이 모두 생긴다 (안이 있는 빵)',
    crust > 0 && crumb > 0,
    `${crust} crust, ${crumb} crumb`,
  );
  check(
    '…그리고 속살이 껍질보다 많다 (한 겹짜리 빵이 아니다)',
    crumb > crust,
    `${crumb} crumb vs ${crust} crust`,
  );
}

// 5. 팽창제 — the two of them, and the order between them. Same dough, same oven,
//    three recipes: plain, sprinkled with soda, and left to proof with yeast
//    first. The bake must come out plain < soda < proofed, because that ordering
//    is the entire reason there are two leaveners.
function bakeLoaf(kind: 'plain' | 'soda' | 'yeast'): { bread: number; leaven: number } {
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  block(grid, 20, 40, 40, 50, BATTER.id, 20);
  if (kind === 'soda') block(grid, 20, 40, 38, 40, SODA.id, 20);
  if (kind === 'yeast') block(grid, 20, 40, 38, 40, YEAST.id, 20);
  // Proof at room temperature. Soda needs none of this and is unaffected by it;
  // the yeast dough spends it climbing.
  for (let t = 0; t < 900; t++) sim.step();
  const leaven = maxAux(grid, BATTER.id) & 0b111;
  // …then the oven.
  for (let t = 0; t < 500; t++) {
    hold(grid, [BATTER.id, BREAD.id], 200);
    sim.step();
  }
  return { bread: count(grid, BREAD.id), leaven };
}
{
  const plain = bakeLoaf('plain');
  const soda = bakeLoaf('soda');
  const yeast = bakeLoaf('yeast');
  check(
    '베이킹소다를 뿌린 반죽은 부풀어 빵이 더 많이 나온다',
    soda.bread > plain.bread,
    `${soda.bread} vs ${plain.bread} cells`,
  );
  check(
    '…그냥 반죽은 전혀 부풀지 않는다',
    plain.leaven === 0,
    `plain leaven level ${plain.leaven}`,
  );
  check(
    '충분히 발효시킨 효모 반죽은 베이킹소다보다 더 크게 부푼다',
    yeast.leaven > soda.leaven && yeast.bread > soda.bread,
    `yeast leaven ${yeast.leaven}/${yeast.bread} cells vs soda ${soda.leaven}/${soda.bread}`,
  );
  // The ceiling, and it is the reason the rise rolls once per cell and spends the
  // leaven whether or not it landed. Without that a cell would re-roll every tick
  // until it succeeded and a loaf would grow until it ran out of room. A fully
  // proofed dough must land on *exactly* double and nothing may exceed it.
  check(
    '아무리 부풀어도 최대 두 배까지다',
    yeast.bread === plain.bread * 2 && soda.bread <= plain.bread * 2,
    `plain ${plain.bread} → soda ${soda.bread} → yeast ${yeast.bread}`,
  );
  // The bug this scene could not see on its own: a proofing dough buries itself
  // in the CO₂ it burps out, and a rise that only accepted an EMPTY cell was
  // smothered by its own fermentation (232 instead of 400). It is checked here
  // rather than in a scene of its own because the *only* symptom is the loaf
  // coming out smaller than its leaven says it should — which is precisely what
  // the exact `=== plain*2` above now pins.
}

// 6. 효모는 뜨거우면 죽는다 — the same 60° that pasteurises a mash (yeast.ts).
//    Dough proofed at 80° must never build any leaven at all, which is what makes
//    "발효시킨 뒤에 굽는다" a real ordering rather than decoration.
{
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  block(grid, 20, 40, 40, 50, BATTER.id, 80);
  block(grid, 20, 40, 38, 40, YEAST.id, 80);
  for (let t = 0; t < 900; t++) {
    hold(grid, [BATTER.id], 80);
    sim.step();
  }
  check(
    '80°에서는 효모가 죽어 반죽이 발효되지 않는다',
    (maxAux(grid, BATTER.id) & 0b111) === 0,
    `leaven level ${maxAux(grid, BATTER.id) & 0b111}`,
  );
}

// 6b. 오븐. The scene that sent the whole rule back to the drawing board: a loaf
//     baking in an insulated iron box over a coal bed, with no flame touching it.
//     Iron conducts so well that the box interior settles at ~880° — far over any
//     autoignition point a bread could plausibly declare — so the original
//     `autoIgniteTemp: 300` meant the loaf was ash by t=400 no matter how well
//     the fire was walled off. There is no number that fixes that, which is why
//     bread ignites on flame *contact* only now (`combustion.flameOnly`).
//
//     The assertion is deliberately "zero ash, and the bread is genuinely that
//     hot": a bread that survived because the oven turned out to be cool would
//     pass a bread-count check and prove nothing.
{
  const { grid, sim } = makeWorld(50, 50);
  floor(grid, 44);
  block(grid, 14, 36, 41, 44, COAL.id, 900);
  for (let x = 15; x < 35; x++) {
    grid.set(x, 40, IRON.id);
    grid.set(x, 32, IRON.id);
  }
  for (let y = 33; y < 40; y++) {
    grid.set(15, y, IRON.id);
    grid.set(34, y, IRON.id);
  }
  block(grid, 16, 34, 36, 40, BATTER.id, 20);
  for (let t = 0; t < 900; t++) {
    hold(grid, [COAL.id], 900);
    sim.step();
  }
  let hottest = -Infinity;
  for (let y = 0; y < 50; y++)
    for (let x = 0; x < 50; x++)
      if (grid.get(x, y) === BREAD.id) hottest = Math.max(hottest, grid.getTemp(x, y));
  check(
    '불이 닿지 않는 오븐 안에서는 빵이 타지 않는다',
    count(grid, BREAD.id) > 0 && count(grid, ASH.id) === 0,
    `${count(grid, BREAD.id)} bread, ${count(grid, ASH.id)} ash`,
  );
  check(
    '…그 오븐이 실제로 빵을 태우고도 남을 만큼 뜨거운데도 그렇다',
    hottest > 600,
    `hottest loaf cell ${hottest.toFixed(0)}°`,
  );
}

// 6c. …and the other half of the same rule, which is what stops "빵은 안 탄다"
//     from being the new bug: a flame actually touching the loaf still eats it.
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 34);
  const loaf = block(grid, 12, 28, 30, 34, BREAD.id, 20);
  for (let t = 0; t < 500; t++) {
    for (let x = 12; x < 28; x++) if (grid.get(x, 29) === 0) grid.set(x, 29, FIRE.id);
    sim.step();
  }
  check(
    '불을 직접 대면 빵은 타서 재가 된다',
    count(grid, BREAD.id) < loaf * 0.2 && count(grid, ASH.id) > 0,
    `${count(grid, BREAD.id)}/${loaf} left, ${count(grid, ASH.id)} ash`,
  );
}

console.log('— 고기 (Meat) —');

// 7. The grill, as three temperature bands off one axis: under 70° nothing
//    happens, 70-200° cooks and *stops*, over 200° chars. The middle band is the
//    one that matters — a steak held at 150° that kept going to burnt would make
//    the whole material a countdown instead of a choice.
{
  const bands: Array<[number, number, string]> = [
    [50, RAW_MEAT.id, '50°에서는 생고기 그대로다'],
    [150, COOKED_MEAT.id, '70~200° 사이에서는 익은 고기가 되고 거기서 멈춘다'],
    // 250°, not 400°: the char that comes out of this is a *fuel* (autoignition
    // 350°), so a burner held above that point would light it and the scene
    // would measure the burn instead of the char. That the char burns is scene
    // 8's job.
    [250, BURNT_MEAT.id, '200°를 넘기면 탄 고기가 된다'],
  ];
  for (const [temp, want, label] of bands) {
    const { grid, sim } = makeWorld(40, 40);
    floor(grid, 34);
    const cut = block(grid, 12, 28, 28, 34, RAW_MEAT.id, temp);
    for (let t = 0; t < 300; t++) {
      hold(grid, [RAW_MEAT.id, COOKED_MEAT.id, BURNT_MEAT.id], temp);
      sim.step();
    }
    check(label, count(grid, want) > cut * 0.9, `${count(grid, want)}/${cut} cells`);
  }
}

// 8. …and the char is the only state that burns. Wet meat in a fire has to cook
//    and blacken first; only then can it catch. Checked from the other end — a
//    burnt cut over a flame is consumed, a raw one of the same size is not — so
//    the assertion survives any retuning of the individual burn rates.
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 34);
  const cut = block(grid, 12, 28, 30, 34, BURNT_MEAT.id, 600);
  for (let t = 0; t < 400; t++) {
    for (let x = 12; x < 28; x++) if (grid.get(x, 29) === 0) grid.set(x, 29, FIRE.id);
    sim.step();
  }
  check(
    '탄 고기는 불에 타서 재가 된다',
    count(grid, BURNT_MEAT.id) < cut * 0.5 && count(grid, ASH.id) > 0,
    `${count(grid, BURNT_MEAT.id)}/${cut} left, ${count(grid, ASH.id)} ash`,
  );
}

console.log('— 팝콘 (Popcorn) —');

// 9. 튀김. A row of kernels on a hot plate with clear air above: each pops into
//    two puffs, one thrown upward, so the pile must come out visibly bigger than
//    it went in. That doubling is the only cell-creating step in this whole line.
{
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  const kernels = block(grid, 20, 40, 48, 50, CORN_KERNEL.id, 250);
  for (let t = 0; t < 200; t++) {
    hold(grid, [CORN_KERNEL.id], 250);
    sim.step();
  }
  check(
    '180°가 넘으면 옥수수 알갱이는 남김없이 팝콘이 된다',
    count(grid, CORN_KERNEL.id) === 0,
    `${count(grid, CORN_KERNEL.id)}/${kernels} kernels left`,
  );
  check(
    '…그리고 부피가 눈에 띄게 불어난다',
    count(grid, POPCORN.id) > kernels * 1.4,
    `${count(grid, POPCORN.id)} popcorn from ${kernels} kernels`,
  );
}

// 9b. …and the puffs are genuinely *launched*, not placed. The pop hands its
//     popcorn to the blast's own ballistic carrier (`launchDebris`), so a pan of
//     kernels erupts instead of quietly changing colour. Measured against the
//     pan's own footprint: the puffs must clear it vertically and scatter wider
//     than it. The first version teleported the puff up to 3 cells and read as
//     limp — a height/spread check is the only thing that can tell the two apart,
//     since the *counts* were identical.
{
  const { grid, sim } = makeWorld(60, 60);
  floor(grid, 50);
  block(grid, 20, 40, 48, 50, CORN_KERNEL.id, 250);
  let apexY = 60;
  let minX = 60;
  let maxX = -1;
  for (let t = 0; t < 200; t++) {
    hold(grid, [CORN_KERNEL.id], 250);
    sim.step();
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++)
        if (grid.get(x, y) === POPCORN.id) {
          if (y < apexY) apexY = y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
  }
  // The pan's top row is y=48, so anything above that is airborne popcorn.
  check(
    '팝콘은 팬 위로 실제로 튀어오른다',
    48 - apexY >= 8,
    `${48 - apexY} cells above the pan`,
  );
  check(
    '…그리고 팬보다 넓게 흩어진다',
    maxX - minX + 1 > 20 * 1.5,
    `${maxX - minX + 1} cells wide, from a 20-cell pan`,
  );
}

// 10. …but a sealed pot cannot double. Kernels packed solid under a lid have
//     nowhere to throw a puff, so every one of them must puff in place — 1:1,
//     exactly. This is the bound on the expansion above, and the one thing here
//     that would be a genuine bug rather than a tuning drift if it broke.
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 34);
  const kernels = block(grid, 12, 28, 26, 34, CORN_KERNEL.id, 250);
  // A lid pressed directly onto the packed grains, and walls so nothing spills.
  block(grid, 11, 29, 25, 26, WALL.id, 20);
  for (let y = 25; y < 34; y++) {
    grid.set(11, y, WALL.id);
    grid.set(28, y, WALL.id);
  }
  for (let t = 0; t < 200; t++) {
    hold(grid, [CORN_KERNEL.id], 250);
    sim.step();
  }
  check(
    '위가 막혀 있으면 알갱이는 제자리에서만 부푼다 (부피가 늘지 않는다)',
    count(grid, POPCORN.id) === kernels,
    `${count(grid, POPCORN.id)} popcorn from ${kernels} kernels`,
  );
}

console.log(failures === 0 ? '\nAll 요리 checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
