// Headless behavioural harness for 로켓 캔디 (Rocket Candy) — the 초석 + 설탕
// propellant.
//
// Two halves, and each fails silently without the other noticing:
//
//   • **The recipe.** A 2-body row in the declarative table (sugar.ts's
//     `reactions`), which means it is data — a fat-fingered `tempMax`, or the
//     rule quietly losing its `otherBecomes`, changes nothing that throws. The
//     checks below pin that cold ingredients do convert 1:1, that hot ones
//     don't (they burn/char/decompose instead, which is the whole point of the
//     gate), and that the recipe never fires on either ingredient alone.
//
//   • **The front speed**, which is the entire reason this is a material rather
//     than "sugar, but faster". The claim is specific and measurable: a burning
//     grain lights every touching grain *deterministically*, and the deferral
//     (`markMoved`) holds that to **exactly one cell per tick**. Both bounds
//     matter and they fail in opposite directions — drop the chain and it
//     collapses to conduction-speed (tens of ticks a cell); drop the
//     `markMoved` and the entire line goes up inside one frame, in whichever
//     direction the scan happened to run. So the line is measured against both
//     an upper and a lower bound, and against Sugar burning the same line.
//
// Scenes are lit with a Fire cell rather than by writing heat, because that is
// what a player does and it exercises the id-based igniter path.
//
// Run: `node test/run-rocketcandy.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { STONE } from '../src/game/materials/stone';
import { WATER } from '../src/game/materials/water';
import { FIRE } from '../src/game/materials/fire';
import { SMOKE } from '../src/game/materials/smoke';
import { SUGAR } from '../src/game/materials/sugar';
import { SALTPETER } from '../src/game/materials/saltpeter';
import { GUNPOWDER } from '../src/game/materials/gunpowder';
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
Math.random = mulberry32(7);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function makeWorld(w = 80, h = 60): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function floor(grid: Grid, y: number, id = STONE.id): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, yy)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** A horizontal run of `id` at row `y`, resting on the floor so nothing falls
 *  out from under the measurement. */
function line(grid: Grid, x0: number, x1: number, y: number, id: number): void {
  for (let x = x0; x < x1; x++) grid.set(x, y, id);
}
/** Alternating 초석/설탕 grains — the shape a player gets by drawing one over the
 *  other, and the only shape where every grain has a partner to react with. */
function mixedBed(grid: Grid, x0: number, x1: number, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      grid.set(x, y, (x + y) % 2 === 0 ? SUGAR.id : SALTPETER.id);
      n++;
    }
  return n;
}

// 1. The recipe. Cold 초석 + 설탕 in contact becomes Rocket Candy, and does so
//    gradually rather than flipping the whole bed on tick one (the pin on
//    CANDY_MIX_CHANCE actually gating anything).
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 36);
  const grains = mixedBed(grid, 10, 30, 30, 36);

  for (let t = 0; t < 2; t++) sim.step();
  const early = count(grid, ROCKET_CANDY.id);
  check(
    '배합은 서서히 일어난다 (두 틱 만에 다 바뀌지 않는다)',
    early < grains * 0.9,
    `${early}/${grains} after 2 ticks`,
  );

  for (let t = 0; t < 120; t++) sim.step();
  const made = count(grid, ROCKET_CANDY.id);
  check(
    '차가운 초석 + 설탕은 로켓 캔디가 된다',
    made > grains * 0.8,
    `${made}/${grains} converted`,
  );
  // 1:1, both cells at once — nothing is created or destroyed by mixing.
  check(
    '재료 두 칸이 캔디 두 칸이 된다 (질량 보존)',
    made + count(grid, SUGAR.id) + count(grid, SALTPETER.id) === grains,
    `${made} candy + ${count(grid, SUGAR.id)} sugar + ${count(grid, SALTPETER.id)} niter vs ${grains}`,
  );
}

// 2. …and only in contact, and only cold. Either ingredient alone is inert, and
//    a bed started hot burns/chars/decomposes instead of quietly cooking itself
//    into propellant mid-flame (the tempMax gate, shared with the black-powder
//    recipe).
{
  for (const solo of [SUGAR, SALTPETER]) {
    const { grid, sim } = makeWorld(40, 40);
    floor(grid, 36);
    for (let y = 30; y < 36; y++) for (let x = 10; x < 30; x++) grid.set(x, y, solo.id);
    for (let t = 0; t < 60; t++) sim.step();
    check(`${solo.name} 혼자서는 캔디가 되지 않는다`, count(grid, ROCKET_CANDY.id) === 0);
  }

  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 36);
  mixedBed(grid, 10, 30, 30, 36);
  for (let y = 30; y < 36; y++) for (let x = 10; x < 30; x++) grid.setTemp(x, y, 500);
  for (let t = 0; t < 60; t++) sim.step();
  check(
    '뜨거운 재료는 배합되지 않는다 (150° 초과에서 게이트가 닫힌다)',
    count(grid, ROCKET_CANDY.id) === 0,
    `${count(grid, ROCKET_CANDY.id)} made at 500°`,
  );
}

// 3. The deflagration front, measured. A 40-cell line lit at one end: the far
//    end must catch in roughly 25-40 ticks — one to two cells per tick — and the
//    bounds are checked on both sides on purpose.
//
//    The lower bound is the one that fails if either deferral is dropped (the
//    `markMoved` on the chained grain, or the arm-now-burn-next-tick step): with
//    a same-tick cascade the whole line goes inside a handful of scans and this
//    lands in the single digits. The upper bound is the one that fails if the
//    deterministic chain is dropped for a probability roll or for conduction —
//    Sugar, checked right after, never finishes at all.
{
  const LEN = 40;
  const { grid, sim } = makeWorld(60, 40);
  floor(grid, 30);
  line(grid, 10, 10 + LEN, 29, ROCKET_CANDY.id);
  grid.set(9, 29, FIRE.id);

  const farX = 10 + LEN - 1;
  let ticks = -1;
  for (let t = 1; t <= 200; t++) {
    sim.step();
    // "Reached" = the far grain is no longer unlit candy: either it is mid-burn
    // (aux set) or it has already gone to smoke.
    const i = grid.idx(farX, 29);
    if (grid.cells[i] !== ROCKET_CANDY.id || grid.aux[i] !== 0) {
      ticks = t;
      break;
    }
  }
  check(
    `${LEN}칸 캔디 선의 불길이 끝까지 간다`,
    ticks > 0,
    ticks > 0 ? `${ticks} ticks` : 'never arrived in 200 ticks',
  );
  check(
    '…한 틱에 한두 칸씩 — 같은 틱에 줄 전체가 타지 않는다',
    ticks >= LEN * 0.5,
    `${ticks} ticks for ${LEN} cells`,
  );
  check(
    '…그리고 확률 굴림이 아니라 확정 전파다 (칸당 두 틱 미만)',
    ticks > 0 && ticks <= LEN * 1.75,
    `${ticks} ticks for ${LEN} cells`,
  );

  // The same line in the material it is made of. Sugar is an ordinary
  // `combustion` fuel (burnChance 0.09), so its front is an order of magnitude
  // slower — this is the comparison that makes "아주 빠르게" a claim rather than
  // an adjective.
  const s = makeWorld(60, 40);
  floor(s.grid, 30);
  line(s.grid, 10, 10 + LEN, 29, SUGAR.id);
  s.grid.set(9, 29, FIRE.id);
  let sugarTicks = -1;
  for (let t = 1; t <= 2000; t++) {
    s.sim.step();
    if (s.grid.cells[s.grid.idx(farX, 29)] !== SUGAR.id) {
      sugarTicks = t;
      break;
    }
  }
  check(
    '설탕 같은 길이보다 훨씬 빠르다',
    sugarTicks < 0 || ticks * 3 < sugarTicks,
    `candy ${ticks} vs sugar ${sugarTicks < 0 ? '2000+' : sugarTicks}`,
  );
}

// 4. The front's shape read directly rather than inferred from a travel time.
//    One lit grain in the middle of a 40-cell line: after a single step the lit
//    span may reach two cells either side (one from the chain, one more from the
//    lick of flame that lands diagonally ahead of it) and no further. This is the
//    check that actually pins "no same-tick cascade" — a travel time can be
//    talked down by tuning, but a span of 40 after one tick cannot.
{
  const { grid, sim } = makeWorld(60, 40);
  floor(grid, 30);
  line(grid, 10, 50, 29, ROCKET_CANDY.id);
  // Light the middle grain directly (aux = the burn countdown) so the scene has
  // exactly one source and no flame gas drifting ahead of the front.
  const mid = 30;
  grid.aux[grid.idx(mid, 29)] = 5;

  sim.step();
  const lit: number[] = [];
  for (let x = 10; x < 50; x++) {
    const i = grid.idx(x, 29);
    if (grid.cells[i] !== ROCKET_CANDY.id || grid.aux[i] !== 0) lit.push(x);
  }
  check(
    '한 틱 뒤 불길은 양옆 두 칸 안에 머문다 (같은 틱 연쇄 없음)',
    lit.length > 0 && Math.min(...lit) >= mid - 2 && Math.max(...lit) <= mid + 2,
    `lit x = [${lit.join(', ')}]`,
  );
}

// 5. The exhaust. A burning pile is a smoke generator — the second half of what
//    the material is for, and the half that vanishes silently if the spend path
//    ever stops leaving Smoke behind.
{
  const { grid, sim } = makeWorld(60, 50);
  floor(grid, 44);
  const SIZE = 12;
  for (let y = 44 - SIZE; y < 44; y++) line(grid, 20, 20 + SIZE, y, ROCKET_CANDY.id);
  const grains = count(grid, ROCKET_CANDY.id);
  grid.set(19, 43, FIRE.id);

  let peak = 0;
  for (let t = 0; t < 120; t++) {
    sim.step();
    const s = count(grid, SMOKE.id);
    if (s > peak) peak = s;
  }
  // Phrased on the *standing* cloud rather than on the total ever emitted: Smoke
  // decays on its own ~37-tick timer while the pile burns down in a couple of
  // dozen ticks, so what is checkable — and what the player sees — is how much
  // is in the air at once. Half the pile's own cell count, hanging over it, is a
  // cloud several times the size of the charge.
  check(
    '캔디 더미는 더미 크기의 절반이 넘는 연기를 동시에 띄운다',
    peak > grains * 0.5,
    `${peak} smoke at peak vs ${grains} grains`,
  );
  check(
    '…그리고 더미는 남김없이 소모된다',
    count(grid, ROCKET_CANDY.id) === 0,
    `${count(grid, ROCKET_CANDY.id)} grains left`,
  );
}

// 6. Self-oxidizing: submerged candy still burns through. There is no douse
//    branch in the material at all, so this is the check that would catch one
//    arriving by accident (e.g. via a shared helper picking the material up).
{
  const { grid, sim } = makeWorld(60, 40);
  floor(grid, 30);
  line(grid, 10, 40, 29, ROCKET_CANDY.id);
  for (let y = 24; y < 29; y++) for (let x = 8; x < 42; x++) grid.set(x, y, WATER.id);
  // Lit from inside the line, since a Fire cell would be doused by the water
  // before it ever reached the propellant.
  grid.aux[grid.idx(11, 29)] = 5;

  for (let t = 0; t < 120; t++) sim.step();
  check(
    '물속에서도 끝까지 탄다 (자체 산화제)',
    count(grid, ROCKET_CANDY.id) === 0,
    `${count(grid, ROCKET_CANDY.id)} grains survived under water`,
  );
}

// 7. It is a fuse. The flame a burning grain throws off is what makes the line
//    useful for anything — a candy trail run into a charge sets it off.
{
  const { grid, sim } = makeWorld(60, 40);
  floor(grid, 30);
  line(grid, 10, 30, 29, ROCKET_CANDY.id);
  for (let y = 27; y < 30; y++) line(grid, 31, 36, y, GUNPOWDER.id);
  const charge = count(grid, GUNPOWDER.id);
  grid.set(9, 29, FIRE.id);

  for (let t = 0; t < 120; t++) sim.step();
  check(
    '캔디 도화선이 흑색화약을 격발한다',
    count(grid, GUNPOWDER.id) < charge,
    `${count(grid, GUNPOWDER.id)}/${charge} left`,
  );
}

console.log(failures === 0 ? '\nAll 로켓 캔디 checks passed.' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
