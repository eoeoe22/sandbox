// Headless behavioural harness for 로켓 캔디 (Rocket Candy) — the 초석 + 캐러멜
// propellant.
//
// Two halves, and each fails silently without the other noticing:
//
//   • **The recipe.** A 2-body row in the declarative table (caramel.ts's
//     `reactions`), which means it is data — a fat-fingered `tempMin`/`tempMax`,
//     or the rule quietly losing its `otherBecomes`, changes nothing that throws.
//     It is a melt-cast: niter poured into caramel takes only while the caramel
//     is *molten but not yet ruined*, so the gate is a window with a floor as
//     well as a ceiling, and both edges are checked below — set toffee is as
//     inert as a burning pile is. Plus that ingredients convert 1:1 inside the
//     window, and that the recipe never fires on either ingredient alone.
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
import { CARAMEL } from '../src/game/materials/caramel';
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
/** Cells of `id` riding in some host's 겹침 (overlap) slot. A liquid poured over a
 *  powder bed soaks into a fraction of the grains and stops being a primary cell,
 *  so a census that reads `grid.cells` alone reports the melt as *gone* — which is
 *  exactly the false alarm the mass check below would otherwise raise. */
function countSoaked(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.overlay.length; i++) if (grid.overlay[i] === id) n++;
  return n;
}
/** A horizontal run of `id` at row `y`, resting on the floor so nothing falls
 *  out from under the measurement. */
function line(grid: Grid, x0: number, x1: number, y: number, id: number): void {
  for (let x = x0; x < x1; x++) grid.set(x, y, id);
}
/** Alternating 초석/캐러멜 cells at `temp` — a niter grain in every hollow of the
 *  melt, which is the shape a player gets by drawing one over the other and the
 *  only shape where every cell has a partner to react with. */
function mixedBed(
  grid: Grid,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  temp: number,
): number {
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      grid.set(x, y, (x + y) % 2 === 0 ? CARAMEL.id : SALTPETER.id);
      grid.setTemp(x, y, temp);
      n++;
    }
  return n;
}

/** Hold every cell of the bed that is still caramel at `temp` — the pan the melt
 *  is sitting in. Without it the pour gives its heat to the floor and drops out
 *  of the recipe's window mid-measurement, which is real behaviour but not what
 *  these two scenes are about. */
function holdMelt(grid: Grid, x0: number, x1: number, y0: number, y1: number, temp: number): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (grid.get(x, y) === CARAMEL.id) grid.setTemp(x, y, temp);
}

// 1. The recipe. 초석 stirred into molten 캐러멜 becomes Rocket Candy, and does so
//    gradually rather than flipping the whole bed on tick one (the pin on
//    CANDY_MIX_CHANCE actually gating anything).
{
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 36);
  const grains = mixedBed(grid, 10, 30, 30, 36, 180);

  for (let t = 0; t < 2; t++) sim.step();
  const early = count(grid, ROCKET_CANDY.id);
  check(
    '배합은 서서히 일어난다 (두 틱 만에 다 바뀌지 않는다)',
    early < grains * 0.9,
    `${early}/${grains} after 2 ticks`,
  );

  for (let t = 0; t < 120; t++) {
    holdMelt(grid, 10, 30, 28, 36, 180);
    sim.step();
  }
  const made = count(grid, ROCKET_CANDY.id);
  // 0.7 rather than "nearly all of it", and the slack is measured rather than
  // guessed: this bed plateaus — the last stragglers are cells whose partner has
  // already been taken, plus the melt that soaked into a grain and cooled there —
  // and over eight seeds it lands anywhere in 89..101 of 120 (the same spread
  // before and after the 저어 넣기 rule that scene 2.5 below pins). A gate at 0.8
  // sits on the *mean* of that spread, i.e. it was a coin toss that happened to be
  // landing heads; this one asks the question the scene is actually for — did the
  // bulk of the bed convert — with room for the tail.
  check(
    '녹아 있는 캐러멜 + 초석은 로켓 캔디가 된다',
    made > grains * 0.7,
    `${made}/${grains} converted`,
  );
  // 1:1, both cells at once — the mix creates nothing out of nothing, which is
  // what would break if the rule ever lost its `otherBecomes` (one ingredient
  // would start converting the other for free).
  //
  // Not phrased as an exact equality, and the slack is a known bargain rather
  // than sloppiness: molten caramel soaks into a fraction of the grains it is
  // poured over, and the declarative pass runs across that seam too
  // (reactions.ts's applySoakedReaction). There the caramel's own half of the
  // reaction is a *powder*, which an overlap slot cannot hold, so it has to
  // surface — and a grain deep inside a packed bed occasionally has nowhere to
  // surface into. The half that is exact is the one that matters — `left <=
  // grains`, nothing is created — and the leak bound below it is measured rather
  // than aspirational: across nine seeds this scene loses 1..5 cells that way,
  // both before and after 저어 넣기 (which soaks more of the melt and so sits at
  // the top of that range). Six is therefore "a rounding error"; the leak this is
  // really watching for lost 36 cells of 120.
  const soaked = countSoaked(grid, CARAMEL.id);
  const left = made + count(grid, CARAMEL.id) + soaked + count(grid, SALTPETER.id);
  check(
    '재료 두 칸이 캔디 두 칸이 된다 (질량 보존)',
    left <= grains && left >= grains - 6,
    `${made} candy + ${count(grid, CARAMEL.id)}+${soaked} caramel + ${count(grid, SALTPETER.id)} niter = ${left} vs ${grains}`,
  );
}

// 2. …and only in contact, and only inside the melt window. Either ingredient
//    alone is inert; a bed that has set hard (below 120°) no longer takes the
//    niter; and a bed started hot burns/chars/decomposes instead of quietly
//    cooking itself into propellant mid-flame. The two temperature checks are the
//    floor and the ceiling of the same window and fail in opposite directions.
{
  for (const solo of [CARAMEL, SALTPETER]) {
    const { grid, sim } = makeWorld(40, 40);
    floor(grid, 36);
    for (let y = 30; y < 36; y++)
      for (let x = 10; x < 30; x++) {
        grid.set(x, y, solo.id);
        grid.setTemp(x, y, 180);
      }
    for (let t = 0; t < 60; t++) sim.step();
    check(`${solo.name} 혼자서는 캔디가 되지 않는다`, count(grid, ROCKET_CANDY.id) === 0);
  }

  {
    // Set toffee: the caramel is there, the niter is there, and nothing happens.
    const { grid, sim } = makeWorld(40, 40);
    floor(grid, 36);
    mixedBed(grid, 10, 30, 30, 36, 20);
    for (let t = 0; t < 60; t++) sim.step();
    check(
      '굳은 캐러멜은 배합되지 않는다 (120° 미만에서 게이트가 닫힌다)',
      count(grid, ROCKET_CANDY.id) === 0,
      `${count(grid, ROCKET_CANDY.id)} made at 20°`,
    );
  }

  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 36);
  mixedBed(grid, 10, 30, 30, 36, 500);
  for (let t = 0; t < 60; t++) sim.step();
  check(
    '태워 먹은 캐러멜은 배합되지 않는다 (250° 초과에서 게이트가 닫힌다)',
    count(grid, ROCKET_CANDY.id) === 0,
    `${count(grid, ROCKET_CANDY.id)} made at 500°`,
  );
}

// 2.5. 양방향 — the recipe works whichever ingredient you pour onto which, and it
//    is not a given, because the two directions are not the same problem. Dropping
//    초석 into a caramel pool needs nothing from the material: the grain outweighs
//    the melt (4.3 against 3.4) and a Powder may displace a Liquid, so gravity
//    rains the grains through the pool and mixes it for free. Pouring the melt onto
//    a niter *pile* has no such path — `SimContext.isDisplaceable` refuses every
//    Powder, whatever it weighs, so a liquid can never displace a grain — and for a
//    while this direction was simply broken: the flat seam converted in the first
//    few ticks, the fresh candy stood between the two ingredients, and that was the
//    end of it. caramel.ts's 저어 넣기 (stirIntoBed) is what answers it.
//
//    Two things are checked, and each catches a different way of losing it:
//
//      • 깊이. Candy exists strictly BELOW the row the two beds originally met on.
//        This is the one that pins the actual bug rather than a quantity: while it
//        was broken the deepest candy in the scene was *exactly* the seam row, on
//        every seed, because nothing ever got any deeper. It is also the check that
//        cannot be talked down by tuning a rate.
//      • 대칭. The pour converts at least as much as the mirrored pool scene does.
//        Before: 34 cells against the pool's 61. Now: 66..82 against 54..68 over
//        eight seeds, i.e. the harder direction is, if anything, slightly ahead.
//
//    Both scenes start at ambient except for the melt, and neither is held at
//    temperature — the pour has to do its mixing on the heat it arrives with, which
//    is the whole bargain the material advertises through its colour ramp.
{
  const SEAM = 34;
  /** A 20-wide stone basin: `bottom` filling rows SEAM..40, `top` above it. The
   *  melt (whichever side it is) starts at 180°, the powder at ambient. */
  function pour(caramelOnTop: boolean): { grid: Grid; sim: Simulation } {
    const { grid, sim } = makeWorld(40, 44);
    floor(grid, 40);
    for (let y = 28; y < 40; y++) {
      grid.set(9, y, STONE.id);
      grid.set(30, y, STONE.id);
    }
    for (let y = 28; y < 40; y++)
      for (let x = 10; x < 30; x++) {
        const melt = y >= SEAM ? !caramelOnTop : caramelOnTop;
        grid.set(x, y, melt ? CARAMEL.id : SALTPETER.id);
        if (melt) grid.setTemp(x, y, 180);
      }
    for (let t = 0; t < 200; t++) sim.step();
    return { grid, sim };
  }

  const poured = pour(true).grid;
  let deepest = -1;
  for (let y = 0; y < poured.height; y++)
    for (let x = 0; x < poured.width; x++)
      if (poured.get(x, y) === ROCKET_CANDY.id && y > deepest) deepest = y;
  check(
    '초석 더미에 부은 캐러멜은 접촉면 한 겹에서 멈추지 않는다',
    deepest > SEAM,
    `deepest candy row ${deepest}, seam ${SEAM}`,
  );

  const pourMade = count(poured, ROCKET_CANDY.id);
  const poolMade = count(pour(false).grid, ROCKET_CANDY.id);
  check(
    '…그리고 반대 방향(캐러멜 웅덩이에 초석)만큼 배합된다',
    pourMade >= poolMade * 0.8,
    `${pourMade} poured-on-pile vs ${poolMade} dropped-in-pool`,
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
  // A small flame rather than one cell, for the reason spelled out in scene 5: a
  // single Fire cell sometimes expires on its own first turn, before the scan
  // reaches the grain beside it, and then the line simply never lights and the
  // travel time reads as "never arrived" — a coin toss in front of the
  // measurement, not part of it.
  for (let y = 27; y < 30; y++) grid.set(9, y, FIRE.id);

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
  for (let y = 27; y < 30; y++) s.grid.set(9, y, FIRE.id);
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
  // Three cells of flame against the pile's face rather than one, and it is a
  // reproducibility fix rather than a bigger match: a single Fire cell rolls its
  // own lifetime, and on an unlucky roll it expires on its very first turn —
  // before the scan reaches the grain beside it, which therefore never sees an
  // igniter and the pile just sits there. That is a real coin toss (it lands
  // tails on ~1 seed in 5) and it made this scene fail or pass on unrelated edits
  // *elsewhere in this file*, since every scene draws from one shared stream. A
  // small flame can't all blink out at once: 8 seeds, 8 ignitions.
  for (let y = 41; y < 44; y++) grid.set(19, y, FIRE.id);

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
  // The trail is laid right up against the charge, and lit with a small flame
  // rather than a single cell — both for the same reason as scene 5's pile: what
  // this scene is for is that a *burning candy grain* triggers the charge, and
  // with a one-cell fuse gap and a one-cell match there were two separate coin
  // tosses in front of that question (the match expiring on its first turn before
  // the grain beside it is scanned; the flame lick failing to land in the gap
  // before the front burns out). Both landed tails on 1 seed in 8, on unrelated
  // edits elsewhere in this file. Abutted and lit properly: 8 seeds, 8 detonations.
  line(grid, 10, 31, 29, ROCKET_CANDY.id);
  for (let y = 27; y < 29; y++) grid.set(30, y, ROCKET_CANDY.id); // banked up the charge's face
  for (let y = 27; y < 30; y++) line(grid, 31, 36, y, GUNPOWDER.id);
  const charge = count(grid, GUNPOWDER.id);
  for (let y = 27; y < 30; y++) grid.set(9, y, FIRE.id);

  for (let t = 0; t < 120; t++) sim.step();
  check(
    '캔디 도화선이 흑색화약을 격발한다',
    count(grid, GUNPOWDER.id) < charge,
    `${count(grid, GUNPOWDER.id)}/${charge} left`,
  );
}

console.log(failures === 0 ? '\nAll 로켓 캔디 checks passed.' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
